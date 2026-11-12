import { Plugin } from "@opencode/plugin"
import { type ToolContext, Error as ToolError } from "@opencode/plugin/promise/tool"
import { uniq } from "es-toolkit"
import type { FetchOutcome, SearchOutcome, URLList } from "web-rotate-core"
import { DEFAULT_FETCH_PROVIDER_CONFIG, DEFAULT_SEARCH_PROVIDER_CONFIG, fetchWeb, searchWeb } from "web-rotate-core"
import { collectSecrets, mergeProviders, parseOptions } from "./config"
import { failureReason, rotationMetadata, SEARCH_PROVIDER_ID } from "./diagnostics"
import { searchResults } from "./output"

const URL_WRAPPER_PATTERN = /^[\s"'<]+|[\s"'>]+$/g
const URL_SEPARATOR_PATTERN = /[\r\n,;]+/
const URL_PROTOCOL_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//

export default Plugin.define({
  id: "oc-web-rotate",
  setup: async (ctx) => {
    const {
      maxOperationMs,
      maxUrlsPerRequest,
      cache,
      fetch: fetchOptions,
      search: searchOptions,
    } = parseOptions(ctx.options)
    const fetchConfig = mergeProviders(DEFAULT_FETCH_PROVIDER_CONFIG, fetchOptions, cache)
    const searchConfig = mergeProviders(DEFAULT_SEARCH_PROVIDER_CONFIG, searchOptions, cache)
    const secrets = collectSecrets([fetchConfig, searchConfig])
    const lifetime = new AbortController()

    const assertPermission = (action: "webfetch" | "websearch", resources: string[], context: ToolContext) =>
      ctx.permission.assert({
        action,
        resources,
        save: ["*"],
        sessionID: context.sessionID,
        agent: context.agent,
        source: { type: "tool", messageID: context.messageID, id: context.id },
      })

    const runOperation = async <T extends FetchOutcome | SearchOutcome>(
      operation: "webfetch" | "websearch",
      timeoutMs: number,
      context: { signal: AbortSignal; progress?: ToolContext["progress"] },
      run: (signal: AbortSignal) => Promise<{ outcome: T; extra?: Record<string, unknown> }>,
    ) => {
      const signal = AbortSignal.any([context.signal, lifetime.signal, AbortSignal.timeout(timeoutMs)])
      try {
        signal.throwIfAborted()
        const { outcome, extra } = await run(signal)
        signal.throwIfAborted()
        const metadata = { ...rotationMetadata(operation, outcome, secrets), ...extra }
        await context.progress?.(metadata).catch(() => {})
        return { outcome, metadata }
      } catch (error) {
        const metadata = rotationMetadata(operation, error instanceof Error ? error : new Error(String(error)), secrets)
        await context.progress?.(metadata).catch(() => {})
        throw Object.assign(
          new ToolError({ message: `${operation}-rotate: ${failureReason(error, signal)}`, metadata }),
          {
            cause: error,
          },
        )
      }
    }

    const registrations = await Promise.allSettled([
      ctx.tool.transform((tools) => {
        tools.add({
          name: "webfetch",
          description: "Read HTTP(S) URLs as Markdown, text, HTML, or image attachments.",
          input: {
            type: "object",
            properties: {
              url: {
                type: ["string", "array"],
                items: { type: "string", minLength: 1 },
                minLength: 1,
                minItems: 1,
                maxItems: maxUrlsPerRequest,
                description: "URL(s): string, array, or comma-separated list.",
              },
              format: {
                type: "string",
                enum: ["markdown", "text", "html"],
                description: "Default: markdown.",
              },
              timeout: {
                type: "number",
                minimum: 1,
                maximum: Math.floor(maxOperationMs / 1000),
                description: `Seconds (default: ${Math.min(30, Math.floor(maxOperationMs / 1000))}).`,
              },
            },
            required: ["url"],
            additionalProperties: false,
          } as const,
          options: { permission: "webfetch", codemode: false },
          execute: async (input, context) => {
            const raw = input as { url?: unknown; format?: unknown; timeout?: unknown }
            const urlList = (Array.isArray(raw.url) ? raw.url.flat(Infinity) : [raw.url ?? ""])
              .flatMap((value) => {
                const text = String(value).replace(URL_WRAPPER_PATTERN, "")
                if (text.startsWith("[")) {
                  try {
                    const parsed: unknown = JSON.parse(text)
                    if (Array.isArray(parsed)) return parsed.map(String)
                  } catch {}
                }
                return text.split(URL_SEPARATOR_PATTERN)
              })
              .map((value) => value.replace(URL_WRAPPER_PATTERN, ""))
              .filter(Boolean)
            if (!urlList.length) throw new Error("webfetch-rotate: url is required")
            if (urlList.length > maxUrlsPerRequest)
              throw new Error(`webfetch-rotate: no more than ${maxUrlsPerRequest} URLs are allowed`)
            const urls = uniq(
              urlList.map((value) => {
                let parsed: URL
                try {
                  parsed = new URL(
                    value.startsWith("//")
                      ? `https:${value}`
                      : URL_PROTOCOL_PATTERN.test(value)
                        ? value
                        : `https://${value}`,
                  )
                } catch (cause) {
                  throw new Error(`webfetch-rotate: invalid URL: ${value}`, { cause })
                }
                if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
                  throw new Error("webfetch-rotate: only HTTP(S) URLs are supported")
                return parsed.toString()
              }),
            ) as URLList
            await assertPermission("webfetch", urls, context)
            const requested = String(raw.format ?? "")
              .trim()
              .toLowerCase()
            const format =
              requested === "text" || requested === "txt" || requested === "plain"
                ? "text"
                : requested === "html" || requested === "htm"
                  ? "html"
                  : "markdown"
            const timeoutMs = raw.timeout === undefined ? 30_000 : Number(raw.timeout) * 1000
            if (!Number.isFinite(timeoutMs) || timeoutMs < 1000)
              throw new Error("webfetch-rotate: timeout must be at least one second")
            const { outcome, metadata } = await runOperation(
              "webfetch",
              Math.min(Math.floor(timeoutMs), maxOperationMs),
              context,
              (signal) =>
                fetchWeb({ urls, format, signal, config: fetchConfig }).then((outcome) => {
                  return {
                    outcome,
                    extra: { url: urls.length === 1 ? urls[0] : urls, format },
                  }
                }),
            )
            if (outcome.type === "image")
              return {
                content: [{ type: "file", uri: `data:${outcome.mime};base64,${outcome.base64}`, mime: outcome.mime }],
                metadata: { ...metadata, url: outcome.url, contentType: outcome.mime },
              }
            return {
              content: outcome.pages.map((item) => {
                return {
                  type: "text" as const,
                  text: item.error
                    ? `${item.url}: ${failureReason(item.error)}`
                    : `${item.finalURL ?? item.url}\n\n${item.content?.trim() ?? ""}`,
                }
              }),
              metadata,
            }
          },
        })

        tools.add({
          name: "websearch",
          description: "Search the web with a natural-language question or research request. Cite source URLs.",
          input: {
            type: "object",
            properties: {
              query: { type: "string", description: "Include relevant dates or versions." },
            },
            required: ["query"],
            additionalProperties: true,
          } as const,
          options: { permission: "websearch", codemode: false },
          execute: async (input, context) => {
            const { query } = input as { query: string }
            await assertPermission("websearch", [query], context)
            const { outcome, metadata } = await runOperation("websearch", maxOperationMs, context, (signal) =>
              searchWeb({ queries: [query.trim()] as URLList, signal, config: searchConfig }).then((outcome) => {
                return { outcome }
              }),
            )
            const results = searchResults(outcome)
            const answers = new Set(outcome.responses.map((response) => response.answer?.trim()).filter(Boolean))
            const sources = results
              .map((result, index) =>
                [
                  `[${index + 1}] ${result.title ? `${result.title}\n${result.url}` : result.url}`,
                  answers.has(result.content) ? undefined : result.content,
                ]
                  .filter(Boolean)
                  .join("\n"),
              )
              .join("\n\n")
            const content = []
            if (answers.size) content.push({ type: "text" as const, text: [...answers].join("\n\n") })
            if (sources) content.push({ type: "text" as const, text: `Sources:\n${sources}` })
            if (!content.length) content.push({ type: "text" as const, text: "No search results found." })
            return { content, metadata }
          },
        })
      }),
      ctx.websearch.transform((draft) => {
        draft.add({
          id: SEARCH_PROVIDER_ID,
          name: "Multi-Key Rotating Web Search",
          execute: async (input, { signal }) =>
            searchResults(
              (
                await runOperation("websearch", maxOperationMs, { signal }, async (requestSignal) => {
                  return {
                    outcome: await searchWeb({
                      queries: [input.query.trim()] as URLList,
                      signal: requestSignal,
                      config: searchConfig,
                    }),
                  }
                })
              ).outcome,
            ),
        })
        draft.default.set(SEARCH_PROVIDER_ID)
      }),
    ])
    const dispose = async () => {
      if (lifetime.signal.aborted) return
      lifetime.abort(new DOMException("oc-web-rotate disposed", "AbortError"))
      cache?.clear()
      await Promise.all(
        registrations.flatMap((registration) =>
          registration.status === "fulfilled" ? [registration.value.dispose()] : [],
        ),
      )
    }
    try {
      const failure = registrations.find((registration) => registration.status === "rejected")
      if (failure)
        throw failure.reason instanceof Error
          ? failure.reason
          : new Error(String(failure.reason), { cause: failure.reason })
      await ctx.websearch.reload()
    } catch (error) {
      await dispose().catch(() => {})
      throw error
    }
    return dispose
  },
})
