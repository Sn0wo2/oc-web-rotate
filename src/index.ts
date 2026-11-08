import { Plugin } from "@opencode/plugin"
import { type ToolContext, Error as ToolError } from "@opencode/plugin/promise/tool"
import type { FetchProviderConfig, ProviderEntry, SearchProviderConfig, URLList } from "web-rotate-core"
import {
  DEFAULT_FETCH_PROVIDER_CONFIG,
  DEFAULT_SEARCH_PROVIDER_CONFIG,
  fetchWeb,
  LRUCache,
  RotateConfigError,
  searchWeb,
} from "web-rotate-core"
import { failureReason, rotationMetadata, SEARCH_PROVIDER_ID } from "./diagnostics"
import { searchResults } from "./output"

const URL_SEPARATOR_PATTERN = /[\r\n,;]+/
const URL_PROTOCOL_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//
const KEY_SEPARATOR_PATTERN = /[\s,;]+/
const URL_WRAPPER_PATTERN = /^[\s"'<]+|[\s"'>]+$/g

export default Plugin.define({
  id: "oc-web-rotate",
  setup: async (ctx) => {
    const maxOperationMs = Number(ctx.options.maxOperationMs ?? 100_000)
    const maxUrlsPerRequest = Number(ctx.options.maxUrlsPerRequest ?? 20)
    if (!Number.isSafeInteger(maxOperationMs) || maxOperationMs < 1000 || maxOperationMs > 2_147_483_647)
      throw new RotateConfigError("maxOperationMs must be an integer between 1000 and 2147483647")
    if (!Number.isSafeInteger(maxUrlsPerRequest) || maxUrlsPerRequest < 1)
      throw new RotateConfigError("maxUrlsPerRequest must be a positive integer")
    const cacheOptions = (ctx.options.cache ?? {}) as
      | { enabled?: boolean | undefined; cap?: number | undefined }
      | false
    if (cacheOptions !== false && (typeof cacheOptions !== "object" || Array.isArray(cacheOptions)))
      throw new RotateConfigError("cache must be false or an object with enabled and cap options")
    if (cacheOptions !== false && cacheOptions.enabled !== undefined && typeof cacheOptions.enabled !== "boolean")
      throw new RotateConfigError("cache.enabled must be a boolean")
    const cacheCap = Number(cacheOptions === false ? 256 : (cacheOptions.cap ?? 256))
    if (!Number.isSafeInteger(cacheCap) || cacheCap < 0)
      throw new RotateConfigError("cache.cap must be a non-negative integer")
    const cache =
      cacheOptions === false || cacheOptions.enabled === false || cacheCap === 0
        ? undefined
        : new LRUCache<string, NonNullable<unknown>>({ max: cacheCap })
    const lifetime = new AbortController()

    type PluginProviderEntry = ProviderEntry & {
      enabled?: boolean | undefined
    }

    function resolveProviderConfig<T extends object>(
      options: unknown,
      defaults: T & { providers?: Readonly<Record<string, ProviderEntry | undefined>> | undefined },
    ): T {
      const { providers, ...rest } = (options ?? {}) as {
        providers?: Record<string, PluginProviderEntry>
      }
      const merged: Record<string, ProviderEntry> = {}
      for (const [id, entry] of Object.entries(defaults.providers ?? {})) if (entry) merged[id] = entry
      for (const [id, raw] of Object.entries(providers ?? {})) {
        const { enabled, ...entry } = raw
        if (enabled === false) {
          delete merged[id]
          continue
        }
        merged[id] = { ...merged[id], ...entry }
      }
      return { ...defaults, ...rest, providers: merged, ...(cache ? { cache } : {}) } as T
    }

    const fetchConfig = resolveProviderConfig<FetchProviderConfig>(ctx.options.fetch, DEFAULT_FETCH_PROVIDER_CONFIG)
    const searchConfig = resolveProviderConfig<SearchProviderConfig>(ctx.options.search, DEFAULT_SEARCH_PROVIDER_CONFIG)
    const secrets = [
      ...new Set(
        [fetchConfig, searchConfig].flatMap((config) =>
          Object.values(config.providers ?? {}).flatMap((entry) =>
            (Array.isArray(entry?.keys) ? entry.keys : [entry?.keys]).flatMap((item) =>
              typeof item === "string"
                ? item
                    .split(KEY_SEPARATOR_PATTERN)
                    .map((token) => (token.includes("::") ? token.slice(token.indexOf("::") + 2) : token))
                : item && typeof item.key === "string"
                  ? [item.key.trim()]
                  : [],
            ),
          ),
        ),
      ),
    ]
      .filter((key) => key && key !== "keyless")
      .sort((a, b) => b.length - a.length)

    const assertPermission = (action: "webfetch" | "websearch", resources: string[], context: ToolContext) =>
      ctx.permission.assert({
        action,
        resources,
        save: ["*"],
        sessionID: context.sessionID,
        agent: context.agent,
        source: { type: "tool", messageID: context.messageID, id: context.id },
      })

    const runSearch = async (query: string, signal: AbortSignal, progress?: ToolContext["progress"]) => {
      const requestSignal = AbortSignal.any([signal, lifetime.signal, AbortSignal.timeout(maxOperationMs)])
      try {
        requestSignal.throwIfAborted()
        const outcome = await searchWeb({
          queries: [query.trim()] as URLList,
          signal: requestSignal,
          config: searchConfig,
        })
        requestSignal.throwIfAborted()
        const metadata = rotationMetadata("websearch", outcome, secrets)
        if (progress) await progress(metadata).catch(() => {})
        return { outcome, metadata }
      } catch (error) {
        const metadata = rotationMetadata(
          "websearch",
          error instanceof Error ? error : new Error(String(error)),
          secrets,
        )
        if (progress) await progress(metadata).catch(() => {})
        throw Object.assign(
          new ToolError({ message: `websearch-rotate: ${failureReason(error, requestSignal)}`, metadata }),
          { cause: error },
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
            const { signal: callerSignal, progress } = context
            const raw = input as {
              url?: unknown
              format?: unknown
              timeout?: unknown
            }
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
            const urls = [
              ...new Set(
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
              ),
            ] as URLList
            await assertPermission("webfetch", urls, context)
            const format =
              (
                {
                  text: "text",
                  txt: "text",
                  plain: "text",
                  html: "html",
                  htm: "html",
                } as Record<string, "text" | "html" | undefined>
              )[
                String(raw.format ?? "")
                  .trim()
                  .toLowerCase()
              ] ?? "markdown"
            const timeoutMs = raw.timeout === undefined ? 30_000 : Number(raw.timeout) * 1000
            if (!Number.isFinite(timeoutMs) || timeoutMs < 1000)
              throw new Error("webfetch-rotate: timeout must be at least one second")
            const signal = AbortSignal.any([
              callerSignal,
              lifetime.signal,
              AbortSignal.timeout(Math.min(Math.floor(timeoutMs), maxOperationMs)),
            ])
            try {
              signal.throwIfAborted()
              const outcome = await fetchWeb({
                urls,
                format,
                signal,
                config: fetchConfig,
              })
              signal.throwIfAborted()
              const metadata = {
                ...rotationMetadata("webfetch", outcome, secrets),
                url: urls.length === 1 ? urls[0] : urls,
                format,
              }
              await progress(metadata).catch(() => {})
              if (outcome.type === "image")
                return {
                  content: [
                    {
                      type: "file",
                      uri: `data:${outcome.mime};base64,${outcome.base64}`,
                      mime: outcome.mime,
                    },
                  ],
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
            } catch (error) {
              const metadata = rotationMetadata(
                "webfetch",
                error instanceof Error ? error : new Error(String(error)),
                secrets,
              )
              await progress(metadata).catch(() => {})
              throw Object.assign(
                new ToolError({ message: `webfetch-rotate: ${failureReason(error, signal)}`, metadata }),
                { cause: error },
              )
            }
          },
        })

        tools.add({
          name: "websearch",
          input: {
            type: "object",
            properties: {
              query: { type: "string", description: "Include relevant dates or versions." },
            },
            required: ["query"],
            additionalProperties: true,
          } as const,
          description: "Search the web with a natural-language question or research request. Cite source URLs.",
          options: { permission: "websearch", codemode: false },
          execute: async (input, context) => {
            const { query } = input as { query: string }
            await assertPermission("websearch", [query], context)
            const { outcome, metadata } = await runSearch(query, context.signal, context.progress)
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
          execute: async (input, { signal }) => searchResults((await runSearch(input.query, signal)).outcome),
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
