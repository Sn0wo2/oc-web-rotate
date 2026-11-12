import { stripVTControlCharacters } from "node:util"
import { sumBy, uniq } from "es-toolkit"
import type { AttemptDiagnostics, FetchOutcome, SearchOutcome } from "web-rotate-core"
import { RotateConfigError } from "web-rotate-core"

export const SEARCH_PROVIDER_ID = "Websearch Rotate Core"

const HTTP_STATUS_PATTERN = /\bHTTP\s+(\d{3})\b/i
const WHITESPACE_PATTERN = /\s+/g

export const failureReason = (error: unknown, signal?: AbortSignal) => {
  if (signal?.aborted) return signal.reason?.name === "TimeoutError" ? "request timed out" : "request cancelled"
  if (error instanceof Error && error.name === "TimeoutError") return "request timed out"
  if (error instanceof RotateConfigError) return "invalid provider configuration"
  const status = (error instanceof Error ? error.message : String(error)).match(HTTP_STATUS_PATTERN)?.[1]
  return status ? `request failed (HTTP ${status})` : "request failed"
}

export const rotationMetadata = (
  operation: "webfetch" | "websearch",
  outcome: FetchOutcome | SearchOutcome | Error,
  secrets: readonly string[],
) => {
  const redact = (value: string) => {
    let text = stripVTControlCharacters(value).replace(WHITESPACE_PATTERN, " ").trim()
    for (const secret of secrets) text = text.replaceAll(secret, "[redacted]")
    return text.slice(0, 500)
  }
  const rawAttempts = (outcome as { attempts?: AttemptDiagnostics[] }).attempts ?? []
  const attempts = rawAttempts.map((attempt) => {
    return {
      provider: redact(attempt.provider),
      keyless: attempt.keyless,
      ...(attempt.keyIndex === undefined ? {} : { keyIndex: attempt.keyIndex }),
      ...(attempt.tier === undefined ? {} : { tier: redact(attempt.tier) }),
      durationMs: attempt.durationMs,
      ok: attempt.ok,
      cached: attempt.cached === true,
      ...(attempt.error ? { error: redact(attempt.error) } : {}),
    }
  })
  const errors =
    outcome instanceof Error
      ? [redact(outcome.message)]
      : "pages" in outcome
        ? outcome.pages.filter((page) => page.error).map((page) => `${redact(page.url)}: ${redact(page.error ?? "")}`)
        : "errors" in outcome
          ? (outcome.errors ?? []).map((item) => `${redact(item.provider)}: ${redact(item.error)}`)
          : []
  const providers =
    outcome instanceof Error
      ? []
      : "pages" in outcome
        ? outcome.pages.flatMap((page) => (page.provider ? [page.provider] : []))
        : "results" in outcome
          ? [...outcome.results, ...outcome.responses].flatMap((item) => (item.provider ? [item.provider] : []))
          : [outcome.provider]
  const provider = uniq(providers.length ? providers.map(redact) : attempts.map((attempt) => attempt.provider)).join(
    ", ",
  )
  const usage = ("usage" in outcome ? (outcome.usage ?? []) : []).map((entry) => {
    return {
      provider: redact(entry.provider),
      keyless: entry.keyless,
      ...(entry.tier === undefined ? {} : { tier: redact(entry.tier) }),
      calls: entry.requests,
      errors: entry.errors,
      ...(entry.results === undefined ? {} : { results: entry.results }),
      ...(entry.pages === undefined ? {} : { pages: entry.pages }),
    }
  })
  const cachedURLs = new Set(rawAttempts.filter((attempt) => attempt.cached).flatMap((attempt) => attempt.urls ?? []))
  const reports = (
    "responses" in outcome
      ? outcome.responses
      : "pages" in outcome
        ? outcome.pages.filter((page) => !cachedURLs.has(page.url))
        : []
  ).flatMap((response) => {
    const metadata = response.metadata ?? {}
    const cost = metadata.costDollars as { total?: unknown } | null | undefined
    const reported = metadata.usage as Record<string, unknown> | null | undefined
    const metrics = (
      [
        ["USD", cost?.total],
        ["credits", reported?.credits ?? metadata.creditsUsed],
        ["input tokens", reported?.input_tokens ?? reported?.prompt_tokens],
        ["output tokens", reported?.output_tokens ?? reported?.completion_tokens],
        ["total tokens", reported?.total_tokens],
      ] as const
    ).flatMap(([unit, value]) =>
      typeof value === "number" && Number.isFinite(value) && value >= 0 ? [{ unit, value }] : [],
    )
    return metrics.length ? [{ provider: redact(response.provider ?? "unknown"), metrics }] : []
  })
  const cachedOnly = attempts.length > 0 && attempts.every((attempt) => attempt.cached)
  const routes = attempts.map((attempt) =>
    attempt.cached
      ? `cache${provider && provider !== "cache" ? ` (${provider})` : ""}`
      : `${attempt.provider} (${attempt.keyless ? "keyless" : `key #${(attempt.keyIndex ?? 0) + 1}`}${attempt.tier ? `, ${attempt.tier}` : ""})${attempt.ok ? "" : " failed"}`,
  )
  const count =
    outcome instanceof Error
      ? "failed"
      : "pages" in outcome
        ? `${outcome.pages.filter((page) => page.content).length}/${outcome.pages.length} pages`
        : "results" in outcome
          ? `${outcome.results.length} results`
          : "image"
  const summary = `${routes.join(" → ") || "no provider"} · ${count} · ${sumBy(attempts, (attempt) => attempt.durationMs)}ms`
  return {
    provider: operation === "websearch" ? `${SEARCH_PROVIDER_ID}${provider ? ` (${provider})` : ""}` : provider,
    attempts,
    cached: attempts.some((attempt) => attempt.cached),
    "oc-web-rotate": {
      operation,
      provider,
      usage,
      billing: { status: cachedOnly ? "cache" : reports.length ? "reported" : "not-reported", reports },
      summary,
      details: [
        summary,
        ...attempts.map((attempt, index) =>
          attempt.cached
            ? `${index + 1}. Cache hit (${provider || "unknown provider"}) · ${attempt.durationMs}ms`
            : `${index + 1}. ${attempt.provider} · tier: ${attempt.tier ?? "not configured"} · ${attempt.keyless ? "keyless" : `key #${(attempt.keyIndex ?? 0) + 1}`} · ${attempt.ok ? "ok" : "failed"} · ${attempt.durationMs}ms`,
        ),
        ...usage.map(
          (entry) =>
            `Usage: ${entry.provider} · tier: ${entry.tier ?? "not configured"} · ${entry.calls} core provider calls · ${entry.errors} errors${entry.results === undefined ? "" : ` · ${entry.results} results`}${entry.pages === undefined ? "" : ` · ${entry.pages} pages`}`,
        ),
        ...(cachedOnly
          ? ["Billing: cache hit; no new provider call. Original key/tier is not retained in the cache."]
          : reports.length
            ? [
                "Provider-reported billing/usage (not an invoice total):",
                ...reports.map(
                  (report, index) =>
                    `  ${index + 1}. ${report.provider}: ${report.metrics.map(({ unit, value }) => `${value} ${unit}`).join(" · ")}`,
                ),
                ...(reports.some((report) => report.metrics.some(({ unit }) => unit === "USD"))
                  ? []
                  : ["Monetary cost: not reported (not assumed free)."]),
                "Unreported costs/retries may add charges. Core call counts are not billable units.",
              ]
            : ["Billing: not reported by provider/core (not assumed free). Core call counts are not billable units."]),
        ...new Set([
          ...attempts.flatMap((attempt) => (attempt.error ? [`${attempt.provider}: ${attempt.error}`] : [])),
          ...errors,
        ]),
      ].join("\n"),
      status:
        outcome instanceof Error || ("pages" in outcome && outcome.pages.every((page) => !page.content))
          ? "error"
          : errors.length || attempts.some((attempt) => !attempt.ok)
            ? "warning"
            : "success",
    },
  }
}
