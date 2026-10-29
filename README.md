# oc-web-rotate

> OpenCode 2 adapter plugin for [`web-rotate-core`](https://github.com/Sn0wo2/web-rotate-core)

## Language

- [README-zh-CN.md](./README-zh-CN.md)

---

See [`web-rotate-core`](https://github.com/Sn0wo2/web-rotate-core) (hereinafter `core`) for details

## Configuration

Options follow `core`'s config; each provider's full settings are documented in `core`'s [DeepWiki](https://deepwiki.com/Sn0wo2/web-rotate-core). `cacheWindowSeconds` can be set independently under `search` and `fetch` (default: `0`).

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  // ...

  "plugins": [
    {
      "package": "github:Sn0wo2/oc-web-rotate",
      "options": {
        "maxOperationMs": 60000,
        "maxUrlsPerRequest": 20,
        "search": {
          "prefer": "keyless",
          "providers": {
            "perplexity": { "keys": "{env:PERPLEXITY_API_KEY}" },
            "octen": { "keys": "{env:OCTEN_API_KEY}" },
            "tavily": { "keys": "{env:TAVILY_API_KEY}" }, // also has a keyless route
            "parallel": { "keys": "{env:PARALLEL_API_KEY}" }, // also keyless
            "you": { "keys": "{env:YOU_API_KEY}" },
            "nimble": { "keys": "{env:NIMBLE_API_KEY}" },
            "exa": { "keys": "{env:EXA_API_KEY}" }, // also keyless
            "brave": { "keys": "{env:BRAVE_API_KEY}" },
            "hyperbrowser": { "keys": "{env:HYPERBROWSER_API_KEY}" },
            "firecrawl": { "keys": "{env:FIRECRAWL_API_KEY}" }, // also keyless; set "keyless": false to opt out
            "tinyfish": { "keys": "{env:TINYFISH_API_KEY}" },
            "keenable": {}, // keyless only
            "serper": { "keys": "{env:SERPER_API_KEY}" },
            "bocha": { "keys": "{env:BOCHA_API_KEY}" },
            "jina": { "keys": "{env:JINA_API_KEY}" },
            "scrapingbee": { "keys": "{env:SCRAPINGBEE_API_KEY}" },
            "diffbot": { "keys": "{env:DIFFBOT_API_KEY}" },
            "brightdata": { "keys": "{env:BRIGHTDATA_API_KEY}" },
            "linkup": { "keys": "{env:LINKUP_API_KEY}" },
            "doubao": { "keys": "{env:DOUBAO_API_KEY}" },
            "deepseek": { "keys": "{env:DEEPSEEK_API_KEY}" },
            "openai": { "keys": "{env:OPENAI_API_KEY}" },
            "native": {} // keyless Google-scraping fallback
          }
        },
        "fetch": {
          "prefer": "keyless",
          "providers": {
            "tavily": { "keys": "{env:TAVILY_API_KEY}" }, // also keyless
            "parallel": { "keys": "{env:PARALLEL_API_KEY}" }, // also keyless
            "you": { "keys": "{env:YOU_API_KEY}" },
            "exa": { "keys": "{env:EXA_API_KEY}" },
            "hyperbrowser": { "keys": "{env:HYPERBROWSER_API_KEY}" },
            "firecrawl": { "keys": "{env:FIRECRAWL_API_KEY}" }, // also keyless
            "tinyfish": { "keys": "{env:TINYFISH_API_KEY}" },
            "jina": { "keys": "{env:JINA_API_KEY}" }, // also keyless
            "scrapingant": { "keys": "{env:SCRAPINGANT_API_KEY}" },
            "scrapingbee": { "keys": "{env:SCRAPINGBEE_API_KEY}" },
            "scrapfly": { "keys": "{env:SCRAPFLY_API_KEY}" },
            "diffbot": { "keys": "{env:DIFFBOT_API_KEY}" },
            "brightdata": { "keys": "{env:BRIGHTDATA_API_KEY}" },
            "apify": { "keys": "{env:APIFY_API_KEY}" },
            "linkup": { "keys": "{env:LINKUP_API_KEY}" },
            "deepseek": { "keys": "{env:DEEPSEEK_API_KEY}" },
            "native": {} // keyless direct-HTTP fallback
          }
        }
      }
    }
  ]
}
```
