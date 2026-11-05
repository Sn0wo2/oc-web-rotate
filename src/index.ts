import { Plugin, type WebSearch } from "@opencode/plugin"
import type { FetchProviderConfig, ProviderEntry, SearchProviderConfig, URLList } from "web-rotate-core"
import {
  DEFAULT_FETCH_PROVIDER_CONFIG,
  DEFAULT_SEARCH_PROVIDER_CONFIG,
  fetchWeb,
  RotateConfigError,
  searchWeb,
} from "web-rotate-core"

const URL_SEPARATOR_PATTERN = /[\r\n,;]+/
const URL_PROTOCOL_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//
const ATTEMPT_ERROR_PREFIX_PATTERN = /^all \d+ attempt\(s\) failed\. Last error: /
const SEARCH_RESULT_PREFIX_PATTERN = /^\[\d+\] /

export default Plugin.define({
  id: "oc-web-rotate",
  setup: async (ctx) => {
    type PluginProviderEntry = ProviderEntry & {
      enabled?: boolean | undefined
    }

    function resolveProviderConfig<T extends object>(
      options: unknown,
      defaults: Readonly<Record<string, ProviderEntry | undefined>>,
    ): T {
      const { providers, ...rest } = (options ?? {}) as {
        providers?: Record<string, PluginProviderEntry>
      }
      const merged: Record<string, ProviderEntry> = {}
      for (const [id, entry] of Object.entries(defaults)) if (entry) merged[id] = entry
      for (const [id, raw] of Object.entries(providers ?? {})) {
        const { enabled, ...entry } = raw
        if (enabled === false) {
          delete merged[id]
          continue
        }
        merged[id] = { ...merged[id], ...entry }
      }
      return { ...rest, providers: merged } as T
    }

    const fetchConfig = resolveProviderConfig<FetchProviderConfig>(
      ctx.options.fetch,
      DEFAULT_FETCH_PROVIDER_CONFIG.providers ?? {},
    )
    const searchConfig = resolveProviderConfig<SearchProviderConfig>(
      ctx.options.search,
      DEFAULT_SEARCH_PROVIDER_CONFIG.providers ?? {},
    )

    const SEARCH_PROVIDER_ID = "Websearch Rotate Core"
    const MAX_OPERATION_MS = Number(ctx.options.maxOperationMs) || 100_000
    const MAX_URLS_PER_REQUEST = Math.max(1, Math.floor(Number(ctx.options.maxUrlsPerRequest) || 20))

    const runSearch = async (query: string, signal: AbortSignal) => {
      try {
        return await searchWeb({
          queries: [query.trim()] as URLList,
          signal: AbortSignal.any([signal, AbortSignal.timeout(MAX_OPERATION_MS)]),
          config: searchConfig,
        })
      } catch (error) {
        if (signal.aborted) throw error
        throw new Error(`websearch-rotate: ${error instanceof Error ? error.message : String(error)}`, {
          cause: error,
        })
      }
    }

    const mapSearchResults = (outcome: Awaited<ReturnType<typeof runSearch>>): WebSearch.Result[] => {
      const results: WebSearch.Result[] = []
      const indexes = new Map<string, number>()
      const addResult = (url: string, title?: string, content?: string, published?: number) => {
        const sourceUrl = url.trim()
        try {
          const protocol = new URL(sourceUrl).protocol
          if (protocol !== "http:" && protocol !== "https:") return
        } catch {
          return
        }
        const existingIndex = indexes.get(sourceUrl)
        if (existingIndex !== undefined) {
          const existing = results[existingIndex]
          if (existing)
            results[existingIndex] = {
              ...existing,
              ...(!existing.title && title ? { title } : {}),
              ...(!existing.content && content ? { content: `[${existingIndex + 1}] ${content}` } : {}),
              ...(existing.time.published === undefined && published !== undefined ? { time: { published } } : {}),
            }
          return
        }
        indexes.set(sourceUrl, results.length)
        results.push({
          url: sourceUrl,
          ...(title ? { title } : {}),
          ...(content ? { content: `[${results.length + 1}] ${content}` } : {}),
          time: published === undefined ? {} : { published },
        })
      }

      for (const item of outcome.results) {
        const content =
          item.content?.trim() ||
          item.snippets
            ?.map((snippet) => snippet.trim())
            .filter(Boolean)
            .join("\n")
        addResult(item.url, item.title, content, item.published)
      }
      for (const response of outcome.responses)
        for (const citation of response.citations ?? []) addResult(citation.url, citation.title)
      return results
    }

    const [webfetch, websearch] = await Promise.all([
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
                maxItems: MAX_URLS_PER_REQUEST,
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
                maximum: Math.floor(MAX_OPERATION_MS / 1000),
                description: "Seconds (default: 30).",
              },
            },
            required: ["url"],
            additionalProperties: false,
          } as const,

          options: { permission: "webfetch", codemode: false },
          execute: async (input) => {
            const raw = input as {
              url?: unknown
              format?: unknown
              timeout?: unknown
            }
            const urlList = (Array.isArray(raw.url) ? raw.url.flat(Infinity) : [raw.url ?? ""])
              .flatMap((value) => {
                const text = String(value).replace(/^[\s"'<]+|[\s"'>]+$/g, "")
                if (text.startsWith("[")) {
                  try {
                    const parsed: unknown = JSON.parse(text)
                    if (Array.isArray(parsed)) return parsed.map(String)
                  } catch {}
                }
                return text.split(URL_SEPARATOR_PATTERN)
              })
              .map((value) => value.replace(/^[\s"'<]+|[\s"'>]+$/g, ""))
              .filter(Boolean)
            if (!urlList.length) throw new Error("webfetch-rotate: url is required")
            if (urlList.length > MAX_URLS_PER_REQUEST)
              throw new Error(`webfetch-rotate: no more than ${MAX_URLS_PER_REQUEST} URLs are allowed`)
            const urls = urlList.map((value) => {
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
            }) as URLList
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
            const signal = AbortSignal.timeout(
              (Math.min(Number(raw.timeout), Math.floor(MAX_OPERATION_MS / 1000)) || 30) * 1000,
            )
            try {
              const outcome = await fetchWeb({
                urls,
                format,
                signal,
                config: fetchConfig,
              })
              if (outcome.type === "image")
                return {
                  content: [
                    { type: "text", text: "Image fetched successfully" },
                    {
                      type: "file",
                      uri: `data:${outcome.mime};base64,${outcome.base64}`,
                      mime: outcome.mime,
                    },
                  ],
                  metadata: { url: outcome.url, contentType: outcome.mime },
                }
              return {
                content: outcome.pages.map((item, index) => {
                  return {
                    type: "text" as const,
                    text: item.error
                      ? `FAILED ${item.url}: ${item.error}`
                      : `SUCCESS ${urls.length > 1 ? `[${index + 1}] ` : ""}${item.url}\n\n${item.content}`,
                  }
                }),
                metadata: { url: urls.length === 1 ? urls[0] : urls, format },
              }
            } catch (error) {
              if (signal.aborted) throw new Error("webfetch-rotate: request timed out", { cause: error })
              if (error instanceof RotateConfigError) throw error
              throw new Error(
                `webfetch-rotate: failed to fetch ${urls.join(", ")}: ` +
                  (error instanceof Error ? error.message : String(error)).replace(ATTEMPT_ERROR_PREFIX_PATTERN, ""),
                { cause: error },
              )
            }
          },
        })

        tools.update("websearch", (tool) => {
          tool.input = {
            type: "object",
            properties: {
              query: { type: "string", description: "Include relevant dates or versions." },
            },
            required: ["query"],
            additionalProperties: true,
          }
          tool.output = {}
          tool.description = "Search the web with a natural-language question or research request. Cite source URLs."
          tool.execute = async (input, { signal }) => {
            const outcome = await runSearch((input as { query: string }).query, signal)
            const results = mapSearchResults(outcome)
            const answer = outcome.responses
              .map((response) => response.answer?.trim())
              .filter(Boolean)
              .join("\n\n")

            const sources = results
              .map((result, index) =>
                [
                  `[${index + 1}] ${result.title ?? result.url}`,
                  result.url,
                  result.content?.replace(SEARCH_RESULT_PREFIX_PATTERN, ""),
                ]
                  .filter(Boolean)
                  .join("\n"),
              )
              .join("\n\n")
            const content = []
            if (answer) content.push({ type: "text" as const, text: answer })
            if (sources) content.push({ type: "text" as const, text: `Sources:\n${sources}` })
            if (!content.length) content.push({ type: "text" as const, text: "No search results found." })
            return { content }
          }
        })
      }),
      ctx.websearch.transform((draft) => {
        draft.add({
          id: SEARCH_PROVIDER_ID,
          name: "Multi-Key Rotating Web Search",
          execute: async (input, { signal }) => mapSearchResults(await runSearch(input.query, signal)),
        })
        draft.default.set(SEARCH_PROVIDER_ID)
      }),
    ])
    await ctx.websearch.reload()
    return async () => {
      await websearch.dispose()
      await webfetch.dispose()
    }
  },
})
