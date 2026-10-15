# oc-web-rotate

> OpenCode 2 adapter plugin for [`web-rotate-core`](https://github.com/Sn0wo2/web-rotate-core)

## Language

- [README-zh-CN.md](./README-zh-CN.md)

---

See [`web-rotate-core`](https://github.com/Sn0wo2/web-rotate-core) (hereinafter `core`) for details

## Configuration

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

Options follow `core`'s config; each provider's full settings are documented in `core`'s [DeepWiki](https://deepwiki.com/Sn0wo2/web-rotate-core)
