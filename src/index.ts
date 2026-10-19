import { Plugin, WebSearch } from "@opencode/plugin";
import { Schema } from "effect";
import {
  DEFAULT_FETCH_PROVIDER_CONFIG,
  DEFAULT_SEARCH_PROVIDER_CONFIG,
  RotateConfigError,
  fetchWeb,
  searchWeb,
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
    type PluginProviderEntry = ProviderEntry & {
      enabled?: boolean | undefined;
    };

    function resolveProviderConfig<T extends object>(
      options: unknown,
      defaults: Readonly<Record<string, ProviderEntry | undefined>>,
    ): T {
      const { providers, ...rest } = (options ?? {}) as {
        providers?: Record<string, PluginProviderEntry>;
      };
      const merged: Record<string, ProviderEntry> = {};
      for (const [id, entry] of Object.entries(defaults))
        if (entry) merged[id] = entry;
      for (const [id, raw] of Object.entries(providers ?? {})) {
        const { enabled, ...entry } = raw;
        if (enabled === false) {
          delete merged[id];
          continue;
        }
        merged[id] = { ...merged[id], ...entry };
      }
      return { ...rest, providers: merged } as T;
    }

    const fetchConfig = resolveProviderConfig<FetchProviderConfig>(
      ctx.options.fetch,
      DEFAULT_FETCH_PROVIDER_CONFIG.providers ?? {},
    );
    const searchConfig = resolveProviderConfig<SearchProviderConfig>(
      ctx.options.search,
      DEFAULT_SEARCH_PROVIDER_CONFIG.providers ?? {},
    );

    const SEARCH_PROVIDER_ID = "Websearch Rotate Core";
    const MAX_OPERATION_MS = Number(ctx.options.maxOperationMs) || 100_000;
    const MAX_URLS_PER_REQUEST = Math.max(
      1,
      Math.floor(Number(ctx.options.maxUrlsPerRequest) || 20),
    );

    const [webfetch, websearch] = await Promise.all([
      ctx.tool.transform((tools) => {
        tools.add({
          name: "webfetch",

          description:
            "Fetch one or more HTTP(S) URLs as Markdown (default), plain text, or HTML. " +
            "Images may be returned as attachments. Read-only.",
          input: {
            type: "object",
            properties: {
              url: {
                type: ["string", "array"],
                items: { type: "string", minLength: 1 },
                minLength: 1,
                minItems: 1,
                maxItems: MAX_URLS_PER_REQUEST,
                description:
                  "URL, array of URLs, or comma-separated URLs to fetch.",
              },
              format: {
                type: "string",
                enum: ["markdown", "text", "html"],
                description: "Output format (default: markdown).",
              },
              timeout: {
                type: "number",
                minimum: 1,
                maximum: Math.floor(MAX_OPERATION_MS / 1000),
                description: "Timeout in seconds (default: 30).",
              },
            },
            required: ["url"],
            additionalProperties: false,
          } as const,

          options: { permission: "webfetch", codemode: false },
          execute: async (input) => {
            const raw = input as {
              url?: unknown;
              format?: unknown;
              timeout?: unknown;
            };
            const urlList = (
              Array.isArray(raw.url) ? raw.url.flat(Infinity) : [raw.url ?? ""]
            )
              .flatMap((value) => {
                const text = String(value).replace(/^[\s"'<]+|[\s"'>]+$/g, "");
                if (text.startsWith("[")) {
                  try {
                    const parsed: unknown = JSON.parse(text);
                    if (Array.isArray(parsed)) return parsed.map(String);
                  } catch {}
                }
                return text.split(/[\r\n,;]+/);
              })
              .map((value) => value.replace(/^[\s"'<]+|[\s"'>]+$/g, ""))
              .filter(Boolean);
            if (!urlList.length)
              throw new Error("webfetch-rotate: url is required");
            if (urlList.length > MAX_URLS_PER_REQUEST)
              throw new Error(
                `webfetch-rotate: no more than ${MAX_URLS_PER_REQUEST} URLs are allowed`,
              );
            const urls = urlList.map((value) => {
              let parsed: URL;
              try {
                parsed = new URL(
                  value.startsWith("//")
                    ? `https:${value}`
                    : /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(value)
                      ? value
                      : `https://${value}`,
                );
              } catch {
                throw new Error(`webfetch-rotate: invalid URL: ${value}`);
              }
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
              (Math.min(
                Number(raw.timeout),
                Math.floor(MAX_OPERATION_MS / 1000),
              ) || 30) * 1000,
            );
            try {
              const outcome = await fetchWeb({
                urls,
                format,
                signal,
                config: fetchConfig,
              });
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
          tool.input = Schema.Struct({
            query: Schema.String.annotate({
              description:
                "Search query; include dates or versions when relevant.",
            }),
          });
          tool.output = Schema.Any;
          tool.description =
            "Search the web for current information and facts requiring verification. " +
            `Current date (UTC): ${new Date().toISOString().slice(0, 10)}. ` +
            "Use relevant dates in time-sensitive queries and cite source URLs.";
        });
      }),
      ctx.websearch.transform((draft) => {
        draft.add({
          id: SEARCH_PROVIDER_ID,
          name: "Multi-Key Rotating Web Search",
          execute: async (input, { signal }) => {
            try {
              const { results } = await searchWeb({
                queries: [input.query.trim()] as URLList,
                signal: AbortSignal.any([
                  signal,
                  AbortSignal.timeout(MAX_OPERATION_MS),
                ]),
                config: searchConfig,
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
