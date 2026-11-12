import { stripVTControlCharacters } from "node:util"
import { Plugin } from "@opencode/plugin/tui"
import type { BoxOptions, BoxRenderable, Renderable, TextOptions, TextRenderable } from "@opentui/core"

type NodeConstructor<Node, Options> = new (renderer: unknown, options: Options) => Node
type Candidate = { id: string; needle: string; label: string; details: string; content: unknown }
type Entry = {
  id: string
  row: BoxRenderable
  container: BoxRenderable
  disclosure: TextRenderable
  result: BoxRenderable
  output: TextRenderable
  content: unknown
  text?: string
  previous: Pick<BoxRenderable, "onMouseUp" | "onMouseOver" | "onMouseOut">
}

const isText = (node: Renderable | null | undefined): node is TextRenderable =>
  !!node && typeof (node as TextRenderable).getTextChildren === "function"
const isBox = (node: Renderable | null | undefined): node is BoxRenderable =>
  !!node &&
  typeof (node as BoxRenderable).add === "function" &&
  typeof (node as BoxRenderable).getChildren === "function"

const readText = (node: unknown, cache?: Map<object, string>): string => {
  if (typeof node === "string") return node
  if (!node || typeof node !== "object") return ""
  const value = node as Renderable & { children?: unknown }
  const cached = cache?.get(value)
  if (cached !== undefined) return cached
  let text = ""
  if (Array.isArray(value.children) && !isText(value))
    text = (value.children as unknown[]).map((child) => readText(child, cache)).join("")
  else if (isText(value)) text = (value.getTextChildren() as unknown[]).map((child) => readText(child, cache)).join("")
  else if (typeof value.getChildren === "function")
    text = (value.getChildren() as unknown[]).map((child) => readText(child, cache)).join("")
  cache?.set(value, text)
  return text
}

const firstText = (node: Renderable, seen = new Set<Renderable>()): TextRenderable | undefined => {
  if (seen.has(node) || node.isDestroyed) return undefined
  seen.add(node)
  if (isText(node)) return node
  for (const child of node.getChildren()) {
    const found = firstText(child, seen)
    if (found) return found
  }
  return undefined
}

const outputText = (content: unknown) =>
  stripVTControlCharacters(
    (Array.isArray(content) ? content : [])
      .map((item) => {
        if (!item || typeof item !== "object") return ""
        const part = item as { type?: string; text?: string; name?: string; uri?: string; mime?: string }
        if (part.type === "text") return part.text ?? ""
        if (part.name) return part.name
        if (typeof part.uri === "string")
          return part.uri.startsWith("data:") ? `Attachment (${part.mime ?? "unknown"})` : part.uri
        return ""
      })
      .filter(Boolean)
      .join("\n\n"),
  )

export default Plugin.define({
  id: "oc-web-rotate",
  setup: (ctx) => {
    const own = new WeakSet<Renderable>()
    const entries = new Map<string, Entry>()
    const expanded = new Set<string>()
    const claimed = new WeakSet<Renderable>()
    let sessionID: string | undefined
    let timer: ReturnType<typeof setInterval> | undefined

    const cleanupEntry = (entry: Entry) => {
      entries.delete(entry.id)
      claimed.delete(entry.row)
      if (!entry.row.isDestroyed) Object.assign(entry.row, entry.previous)
      if (!entry.disclosure.isDestroyed) entry.disclosure.destroyRecursively()
      if (!entry.result.isDestroyed) entry.result.destroyRecursively()
    }

    const reset = () => {
      for (const entry of [...entries.values()]) cleanupEntry(entry)
    }

    const collect = (): Candidate[] => {
      if (!sessionID) return []
      const candidates: Candidate[] = []
      for (const message of ctx.data.session.message.list(sessionID)) {
        if (message.type !== "assistant") continue
        for (const part of message.content) {
          if (part.type !== "tool" || (part.name !== "websearch" && part.name !== "webfetch")) continue
          if (part.state.status !== "completed") continue
          const diagnostics = part.state.metadata?.["oc-web-rotate"]
          if (
            !diagnostics ||
            typeof diagnostics !== "object" ||
            Array.isArray(diagnostics) ||
            diagnostics.operation !== part.name
          )
            continue
          const input = part.state.input as { query?: unknown; url?: unknown }
          const needle =
            part.name === "websearch"
              ? typeof input.query === "string"
                ? `"${stripVTControlCharacters(input.query)}"`
                : ""
              : typeof input.url === "string"
                ? input.url
                : ""
          if (!needle) continue
          candidates.push({
            id: part.id,
            needle,
            label: part.name === "websearch" ? "Web Sear" : "WebFetch",
            details: typeof diagnostics.details === "string" ? stripVTControlCharacters(diagnostics.details) : "",
            content: part.state.content,
          })
        }
      }
      return candidates
    }

    const findRows = (root: Renderable, pending: Candidate[]) => {
      const rows = new Map<Candidate, BoxRenderable>()
      const cache = new Map<object, string>()
      const seen = new Set<Renderable>()
      const assigned = new Set<Renderable>()
      const stack: Renderable[] = [root]
      while (stack.length && rows.size < pending.length) {
        const node = stack.pop()
        if (!node || seen.has(node) || node.isDestroyed || own.has(node)) continue
        seen.add(node)
        if (isText(node)) {
          const text = readText(node, cache)
          for (const candidate of pending) {
            if (rows.has(candidate) || !text.includes(candidate.needle) || !text.includes(candidate.label)) continue
            let parent = node.parent
            while (parent && isBox(parent)) {
              const parentText = readText(parent, cache)
              if (parentText.includes(candidate.needle) && parentText.includes(candidate.label)) {
                if (!(claimed.has(parent) || assigned.has(parent))) {
                  rows.set(candidate, parent)
                  assigned.add(parent)
                }
                break
              }
              parent = parent.parent
            }
          }
        }
        for (const child of node.getChildren()) stack.push(child)
      }
      return rows
    }

    const attach = (candidate: Candidate, row: BoxRenderable) => {
      const container = row.parent
      if (!isBox(container)) return
      const text = firstText(row)
      if (!text) return
      const BoxCtor = container.constructor as NodeConstructor<BoxRenderable, BoxOptions>
      const TextCtor = text.constructor as NodeConstructor<TextRenderable, TextOptions>
      const isExpanded = expanded.has(candidate.id)
      const outputValue = isExpanded ? outputText(candidate.content) : ""
      const result = new BoxCtor(ctx.renderer, { paddingLeft: 2, visible: isExpanded })
      const detail = candidate.details
        ? new TextCtor(ctx.renderer, {
            fg: ctx.theme.text.muted,
            wrapMode: "word",
            marginBottom: 1,
            content: candidate.details,
          })
        : undefined
      const output = new TextCtor(ctx.renderer, {
        fg: ctx.theme.text.base,
        wrapMode: "word",
        content: outputValue,
      })
      const disclosure = new TextCtor(ctx.renderer, {
        width: 2,
        fg: ctx.theme.text.muted,
        content: isExpanded ? "▾" : "▸",
      })
      for (const node of [result, detail, output, disclosure]) if (node) own.add(node)
      if (detail) result.add(detail)
      result.add(output)

      const previous: Entry["previous"] = {
        onMouseUp: row.onMouseUp,
        onMouseOver: row.onMouseOver,
        onMouseOut: row.onMouseOut,
      }
      const entry: Entry = {
        id: candidate.id,
        row,
        container,
        disclosure,
        result,
        output,
        content: candidate.content,
        ...(isExpanded ? { text: outputValue } : {}),
        previous,
      }
      claimed.add(row)
      const toggle = () => {
        if (entry.row.isDestroyed || entry.result.isDestroyed) return
        const open = !expanded.has(entry.id)
        if (open) expanded.add(entry.id)
        else expanded.delete(entry.id)
        entry.disclosure.content = open ? "▾" : "▸"
        entry.result.visible = open
        if (open) {
          entry.text ??= outputText(entry.content)
          entry.output.content = entry.text
        } else entry.output.content = ""
      }
      row.onMouseUp = (event) => {
        previous.onMouseUp?.(event)
        if (event.button !== 0) return
        if (ctx.renderer.getSelection()?.getSelectedText()) return
        event.stopPropagation()
        toggle()
      }
      row.onMouseOver = (event) => {
        previous.onMouseOver?.(event)
        disclosure.fg = ctx.theme.text.base
      }
      row.onMouseOut = (event) => {
        previous.onMouseOut?.(event)
        disclosure.fg = ctx.theme.text.muted
      }
      row.add(disclosure)
      container.add(result)
      entries.set(candidate.id, entry)
    }

    const scan = () => {
      if (!sessionID) return
      for (const entry of [...entries.values()])
        if (entry.row.isDestroyed || entry.result.isDestroyed || !entry.row.parent || !entry.container.parent)
          cleanupEntry(entry)
      const pending = collect().filter((candidate) => !entries.has(candidate.id))
      if (pending.length === 0) return
      const root = ctx.renderer.root
      if (!root) return
      for (const [candidate, row] of findRows(root, pending)) attach(candidate, row)
    }

    const disposeSlot = ctx.ui.slot({
      append: "session.composer.top",
      render: (input) => {
        if (sessionID !== input.sessionID) {
          reset()
          sessionID = input.sessionID
          expanded.clear()
        }
        if (!timer) {
          timer = setInterval(scan, 500)
          scan()
        }
        return null
      },
    })

    return () => {
      if (timer) clearInterval(timer)
      timer = undefined
      disposeSlot()
      reset()
    }
  },
})
