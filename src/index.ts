import { Plugin, WebSearch } from "@opencode/plugin";
import { Schema } from "effect";
import {
  DEFAULT_FETCH_PROVIDER_CONFIG,
  DEFAULT_SEARCH_PROVIDER_CONFIG,
  RotateConfigError,
  createWebFetcher,
  createWebSearcher,
} from "web-rotate-core";
import type {
  FetchProviderConfig,
  ProviderEntry,
  SearchProviderConfig,
  URLList,
} from "web-rotate-core";


export default Plugin.define({
  id: "oc-web-rotate",
  setup: async (ctx) => {
    type PluginProviderEntry = ProviderEntry & { enabled?: boolean | undefined };

    function mergeProviders(
      base: Readonly<Record<string, ProviderEntry | undefined>>,
      entries: Record<string, PluginProviderEntry> | undefined,
    ): Record<string, ProviderEntry> {
      const merged: Record<string, ProviderEntry> = {};
      for (const [id, entry] of Object.entries(base))
        if (entry) merged[id] = entry;
      for (const [id, raw] of Object.entries(entries ?? {})) {
        const { enabled, ...entry } = raw;
        if (enabled === false) {
          delete merged[id];
          continue;
        }
        merged[id] = { ...merged[id], ...entry };
      }
      return merged;
    }

    const fetchOptions = (ctx.options.fetch ?? {}) as FetchProviderConfig & {
      providers?: Record<string, PluginProviderEntry>;
    };
    const searchOptions = (ctx.options.search ?? {}) as SearchProviderConfig & {
      providers?: Record<string, PluginProviderEntry>;
    };
    const fetcher = createWebFetcher({
      ...fetchOptions,
      providers: mergeProviders(
        DEFAULT_FETCH_PROVIDER_CONFIG,
        fetchOptions.providers,
      ),
    } as FetchProviderConfig);
    const searcher = createWebSearcher({
      ...searchOptions,
      providers: mergeProviders(
        DEFAULT_SEARCH_PROVIDER_CONFIG,
        searchOptions.providers,
      ),
    } as SearchProviderConfig);

    const SEARCH_PROVIDER_ID = "websearch-rotate";
    const MAX_TIMEOUT_SECONDS = 120;
    const MAX_URLS_PER_REQUEST = 20;
    
    const [webfetch, websearch] = await Promise.all([
      ctx.tool.transform((tools) => {
        tools.add({
          name: "webfetch",
          description:
            "Fetch one or more URLs and return their content as markdown (default), text, or html; " +
            "image URLs may be returned as a media attachment. Read-only; " +
            "prefer a more targeted tool when one is available. " +
            "Cite the source URL when a statement relies on fetched content.",
          input: {
            type: "object",
            properties: {
              url: {
                type: ["string", "array"],
                items: { type: "string" },
                maxItems: MAX_URLS_PER_REQUEST,
                description: "http(s) URL, or an array of URLs",
              },
              format: { type: "string", enum: ["text", "markdown", "html"] },
              timeout: {
                type: "number",
                minimum: 1,
                maximum: MAX_TIMEOUT_SECONDS,
                description: "seconds",
              },
            },
            required: ["url"],
          } as const,
          options: { permission: "webfetch", codemode: false },
          execute: async (input) => {
            const raw = input as {
              url?: unknown;
              format?: unknown;
              timeout?: unknown;
            };
            const urlList = (Array.isArray(raw.url) ? raw.url : [raw.url ?? ""])
              .map((value) => String(value).replace(/^[\s"'<]+|[\s"'>]+$/g, ""))
              .filter(Boolean);
            if (!urlList.length)
              throw new Error("webfetch-rotate: url is required");
            if (urlList.length > MAX_URLS_PER_REQUEST)
              throw new Error(
                `webfetch-rotate: no more than ${MAX_URLS_PER_REQUEST} URLs are allowed`,
              );
            const urls = urlList.map((value) => {
              const parsed = new URL(
                value.startsWith("//")
                  ? `https:${value}`
                  : /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(value)
                    ? value
                    : `https://${value}`,
              );
              if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
                throw new Error(
                  "webfetch-rotate: only HTTP(S) URLs are supported",
                );
              return parsed.toString();
            }) as URLList;
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
              ] ?? "markdown";
            const signal = AbortSignal.timeout(
              (Math.min(Number(raw.timeout), MAX_TIMEOUT_SECONDS) || 30) * 1000,
            );
            try {
              const outcome = await fetcher.fetch({ urls, format, signal });
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
                };
              return {
                content: outcome.pages.map((item, index) => ({
                  type: "text" as const,
                  text: item.error
                    ? `FAILED ${item.url}: ${item.error}`
                    : `SUCCESS ${urls.length > 1 ? `[${index + 1}] ` : ""}${item.url}\n\n${item.content}`,
                })),
                metadata: { url: urls.length === 1 ? urls[0] : urls, format },
              };
            } catch (error) {
              if (signal.aborted)
                throw new Error("webfetch-rotate: request timed out");
              if (error instanceof RotateConfigError) throw error;
              throw new Error(
                `webfetch-rotate: failed to fetch ${urls.join(", ")}: ` +
                  (error instanceof Error
                    ? error.message
                    : String(error)
                  ).replace(/^all \d+ attempt\(s\) failed\. Last error: /, ""),
              );
            }
          },
        });
        tools.update("websearch", (tool) => {
          tool.output = Schema.Any;
          tool.description =
            `${tool.description}\n\n` +
            "Results are numbered [1], [2], ...; when a statement relies on a result, cite it as [n] together with its URL.";
        });
      }),
      ctx.websearch.transform((draft) => {
        draft.add({
          id: SEARCH_PROVIDER_ID,
          name: "Multi-Key Rotating Web Search",
          execute: async (input, { signal }) => {
            try {
              const { results } = await searcher.search({
                queries: [input.query.trim()] as URLList,
                signal: AbortSignal.any([
                  signal,
                  AbortSignal.timeout(
                    Number(ctx.options.maxOperationMs) || 60_000,
                  ),
                ]),
              });
              return results.map((item, index): WebSearch.Result => ({
                url: item.url,
                ...(item.title ? { title: item.title } : {}),
                ...(item.content
                  ? { content: `[${index + 1}] ${item.content}` }
                  : {}),
                time:
                  item.published === undefined
                    ? {}
                    : { published: item.published },
              }));
            } catch (error) {
              if (signal.aborted) throw error;
              throw new Error(
                `websearch-rotate: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
            }
          },
        });
        draft.default.set(SEARCH_PROVIDER_ID);
      }),
    ]);
    await ctx.websearch.reload();
    return async () => {
      await websearch.dispose();
      await webfetch.dispose();
    };
  },
});
