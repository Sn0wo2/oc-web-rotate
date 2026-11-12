import type { WebSearch } from "@opencode/plugin"
import { uniq } from "es-toolkit"
import type { SearchOutcome } from "web-rotate-core"

export const searchResults = (outcome: SearchOutcome) => {
  const results = new Map<string, WebSearch.Result>()
  const add = (url: string, title?: string, content?: string, published?: number) => {
    const sourceUrl = url.trim()
    try {
      const protocol = new URL(sourceUrl).protocol
      if (protocol !== "http:" && protocol !== "https:") return
    } catch {
      return
    }
    const existing = results.get(sourceUrl)
    if (!existing) {
      results.set(sourceUrl, {
        url: sourceUrl,
        ...(title ? { title } : {}),
        ...(content ? { content } : {}),
        time: published === undefined ? {} : { published },
      })
      return
    }
    results.set(sourceUrl, {
      ...existing,
      ...(!existing.title && title ? { title } : {}),
      ...(!existing.content && content ? { content } : {}),
      ...(existing.time.published === undefined && published !== undefined ? { time: { published } } : {}),
    })
  }
  for (const item of outcome.results)
    add(
      item.url,
      item.title?.trim(),
      item.content?.trim() || uniq(item.snippets?.map((snippet) => snippet.trim()).filter(Boolean) ?? []).join("\n"),
      item.published,
    )
  for (const response of outcome.responses)
    for (const citation of response.citations ?? []) add(citation.url, citation.title?.trim())
  return [...results.values()]
}
