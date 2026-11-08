# oc-web-rotate

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/Sn0wo2/oc-web-rotate)

Rotate [OpenCode2](https://github.com/anomalyco/opencode/) `websearch` and `webfetch` providers

## i18n

[简体中文](./README-zh-CN.md)

## Configuration

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  // ...

  "plugins": [
    {
      "package": "github:Sn0wo2/oc-web-rotate",
      "options": {
        "maxOperationMs": 60000, // default 100000
        "maxUrlsPerRequest": 20,
        "cache": { "enabled": true, "cap": 256 }, // false to disable

        "search": {
          "prefer": "keyless", // or "keyed"
          "concurrency": 4,
          "maxAttempts": 3,
          "cacheWindowSeconds": 3600, // 0 = off
          "searchResults": 8,
          "providers": {
            // keys: comma/space separated multi-key, "tier::key" tier, or [{ key, tier, weight }]; "keyless" = keyless route
            "perplexity": { "keys": "{env:PERPLEXITY_API_KEY}" }, // api: "search" | "answer"
            "exa": { "keys": "{env:EXA_API_KEY}" }, // Keyless
            "octen": { "keys": "{env:OCTEN_API_KEY}" },
            "parallel": { "keys": "{env:PARALLEL_API_KEY}" }, // Keyless; mode, advanced_settings
            "brave": { "keys": "{env:BRAVE_API_KEY}" },
            "you": { "keys": "{env:YOU_API_KEY}" },
            "nimble": { "keys": "{env:NIMBLE_API_KEY}" },
            "openai": { "keys": "{env:OPENAI_API_KEY}" }, // model series; filters
            "firecrawl": { "keys": "{env:FIRECRAWL_API_KEY}" }, // Keyless
            "tinyfish": { "keys": "{env:TINYFISH_API_KEY}" },
            "deepseek": { "keys": "{env:DEEPSEEK_API_KEY}" }, // localization, need_content
            "linkup": { "keys": "{env:LINKUP_API_KEY}" },
            "tavily": { "keys": ["{env:TAVILY_API_KEY}", "{env:TAVILY_API_KEY_2}"] }, // Keyless
            "serper": { "keys": "{env:SERPER_API_KEY}" },
            "keenable": {}, // Keyless only
            "zhipu": { "keys": "{env:ZHIPU_API_KEY}" }, // api, baseUrl, model
            "jina": { "keys": "{env:JINA_API_KEY}" }, // api, headers
            "bocha": { "keys": "{env:BOCHA_API_KEY}" },
            "apify": { "keys": "{env:APIFY_API_KEY}" },
            "doubao": { "keys": "{env:DOUBAO_API_KEY}" }, // api, baseUrl, model
            "grok": { "keys": "{env:XAI_API_KEY}" }, // model series; api
            "claude": { "keys": "{env:ANTHROPIC_API_KEY}" }, // model series
            "gemini": { "keys": "{env:GEMINI_API_KEY}" }, // model series; api, google_search
            "diffbot": { "keys": "{env:DIFFBOT_API_KEY}" },
            "brightdata": { "keys": "{env:BRIGHTDATA_API_KEY}" },
            "scrapingbee": { "keys": "{env:SCRAPINGBEE_API_KEY}" },
            "hyperbrowser": { "keys": "{env:HYPERBROWSER_API_KEY}" },
            "native": {} // Keyless fallback
          }
        },

        "fetch": {
          "prefer": "keyless",
          "concurrency": 4,
          "maxAttempts": 3,
          "cacheWindowSeconds": 3600, // 0 = off
          // "none" | "defuddle" | "readability" | "article-extractor" | "mercury" | "trafilatura" | "firecrawl-html"
          "cleanup": "none",
          "providers": {
            "scrapfly": { "keys": "{env:SCRAPFLY_API_KEY}" }, // cache, headers, js_scenario, extraction
            "scrapingbee": { "keys": "{env:SCRAPINGBEE_API_KEY}" },
            "firecrawl": { "keys": "{env:FIRECRAWL_API_KEY}" }, // Keyless
            "parallel": { "keys": "{env:PARALLEL_API_KEY}" }, // Keyless; advanced_settings
            "apify": { "keys": "{env:APIFY_API_KEY}" },
            "exa": { "keys": "{env:EXA_API_KEY}" }, // text
            "brightdata": { "keys": "{env:BRIGHTDATA_API_KEY}", "zone": "{env:BRIGHTDATA_ZONE}" }, // zone required
            "tinyfish": { "keys": "{env:TINYFISH_API_KEY}" },
            "tavily": { "keys": "{env:TAVILY_API_KEY}" }, // Keyless
            "nimble": { "keys": "{env:NIMBLE_API_KEY}" },
            "you": { "keys": "{env:YOU_API_KEY}" },
            "jina": { "keys": "{env:JINA_API_KEY}" }, // Keyless; headers
            "linkup": { "keys": "{env:LINKUP_API_KEY}" },
            "diffbot": { "keys": "{env:DIFFBOT_API_KEY}" },
            "keenable": {}, // Keyless only; live, max_chars, prompt
            "octen": { "keys": "{env:OCTEN_API_KEY}" }, // max_age_seconds
            "serper": { "keys": "{env:SERPER_API_KEY}" },
            "zhipu": { "keys": "{env:ZHIPU_API_KEY}" }, // baseUrl
            "hyperbrowser": { "keys": "{env:HYPERBROWSER_API_KEY}" }, // cache, outputs
            "deepseek": { "keys": "{env:DEEPSEEK_API_KEY}" },
            "bocha": { "keys": "{env:BOCHA_API_KEY}" },
            "doubao": { "keys": "{env:DOUBAO_API_KEY}" },
            "claude": { "keys": "{env:ANTHROPIC_API_KEY}" }, // model series
            "gemini": { "keys": "{env:GEMINI_API_KEY}" }, // model series
            "scrapingant": { "keys": "{env:SCRAPINGANT_API_KEY}" },
            "native": {} // Keyless fallback
          }
        }
      }
    }
  ]
}
```
