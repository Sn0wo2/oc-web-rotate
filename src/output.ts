import type { WebSearch } from "@opencode/plugin"
import type { SearchOutcome } from "web-rotate-core"

export function searchResults(outcome: SearchOutcome): WebSearch.Result[] {
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
          ...(!existing.content && content ? { content } : {}),
          ...(existing.time.published === undefined && published !== undefined ? { time: { published } } : {}),
        }
      return
    }
    indexes.set(sourceUrl, results.length)
    results.push({
      url: sourceUrl,
      ...(title ? { title } : {}),
      ...(content ? { content } : {}),
      time: published === undefined ? {} : { published },
    })
  }

  for (const item of outcome.results) {
    const content =
      item.content?.trim() || [...new Set(item.snippets?.map((snippet) => snippet.trim()).filter(Boolean))].join("\n")
    addResult(item.url, item.title?.trim(), content, item.published)
  }
  for (const response of outcome.responses)
    for (const citation of response.citations ?? []) addResult(citation.url, citation.title?.trim())
  return results
}
