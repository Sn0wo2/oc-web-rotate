# oc-web-rotate

> OpenCode 2 adapter plugin for [`web-rotate-core`](https://github.com/Sn0wo2/web-rotate-core)

## 语言

- [README.md](./README.md)

---

具体说明请参考 [`web-rotate-core`](https://github.com/Sn0wo2/web-rotate-core) (以下简称 `core`)

## 配置

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  // ...

  "plugins": [
    {
      "package": "github:Sn0wo2/opencode-web-rotate",
      "options": {
        "maxOperationMs": 60000,

        "search": {
          "...": "SearchProviderConfig",
          "tavily": { "keys": "{env:TAVILY_API_KEY}" },
          "perplexity": { "keys": ["{env:PPLX_KEY_1}", "{env:PPLX_KEY_2}"] },
        },
        "fetch": {
          "...": "FetchProviderConfig",
          "jina": { "keys": "{env:JINA_API_KEY}" },
        },
      },
    },
  ],
}
```

沿用 `core` 的配置, 各提供商的完整配置见 `core` [DeepWiki](https://deepwiki.com/Sn0wo2/web-rotate-core)
