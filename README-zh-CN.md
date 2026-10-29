# oc-web-rotate

> OpenCode 2 adapter plugin for [`web-rotate-core`](https://github.com/Sn0wo2/web-rotate-core)

## 语言

- [README.md](./README.md)

---

具体说明请参考 [`web-rotate-core`](https://github.com/Sn0wo2/web-rotate-core) (以下简称 `core`)

## 配置

沿用 `core` 的配置, 各提供商的完整配置见 `core` [DeepWiki](https://deepwiki.com/Sn0wo2/web-rotate-core)。`search` 和 `fetch` 均可独立设置 `cacheWindowSeconds` (默认 `0`)

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
            "tavily": { "keys": "{env:TAVILY_API_KEY}" }, // 自带 keyless 路由
            "parallel": { "keys": "{env:PARALLEL_API_KEY}" }, // 自带 keyless
            "you": { "keys": "{env:YOU_API_KEY}" },
            "nimble": { "keys": "{env:NIMBLE_API_KEY}" },
            "exa": { "keys": "{env:EXA_API_KEY}" }, // 自带 keyless
            "brave": { "keys": "{env:BRAVE_API_KEY}" },
            "hyperbrowser": { "keys": "{env:HYPERBROWSER_API_KEY}" },
            "firecrawl": { "keys": "{env:FIRECRAWL_API_KEY}" }, // 自带 keyless; 设 "keyless": false 可关闭
            "tinyfish": { "keys": "{env:TINYFISH_API_KEY}" },
            "keenable": {}, // 仅 keyless
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
            "native": {} // keyless Google 抓取兜底
          }
        },
        "fetch": {
          "prefer": "keyless",
          "providers": {
            "tavily": { "keys": "{env:TAVILY_API_KEY}" }, // 自带 keyless
            "parallel": { "keys": "{env:PARALLEL_API_KEY}" }, // 自带 keyless
            "you": { "keys": "{env:YOU_API_KEY}" },
            "exa": { "keys": "{env:EXA_API_KEY}" },
            "hyperbrowser": { "keys": "{env:HYPERBROWSER_API_KEY}" },
            "firecrawl": { "keys": "{env:FIRECRAWL_API_KEY}" }, // 自带 keyless
            "tinyfish": { "keys": "{env:TINYFISH_API_KEY}" },
            "jina": { "keys": "{env:JINA_API_KEY}" }, // 自带 keyless
            "scrapingant": { "keys": "{env:SCRAPINGANT_API_KEY}" },
            "scrapingbee": { "keys": "{env:SCRAPINGBEE_API_KEY}" },
            "scrapfly": { "keys": "{env:SCRAPFLY_API_KEY}" },
            "diffbot": { "keys": "{env:DIFFBOT_API_KEY}" },
            "brightdata": { "keys": "{env:BRIGHTDATA_API_KEY}" },
            "apify": { "keys": "{env:APIFY_API_KEY}" },
            "linkup": { "keys": "{env:LINKUP_API_KEY}" },
            "deepseek": { "keys": "{env:DEEPSEEK_API_KEY}" },
            "native": {} // keyless 直连 HTTP 兜底
          }
        }
      }
    }
  ]
}
```
