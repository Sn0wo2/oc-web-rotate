import { stripVTControlCharacters } from "node:util"
import { Plugin } from "@opencode/plugin/tui"
import { BoxRenderable, type Renderable, TextRenderable } from "@opentui/core"
import { createEffect, createRoot, getOwner, onCleanup } from "solid-js"

const PROVIDER_SUFFIX_PATTERN = /^.* \(([^()]+)\)$/

interface TimelineAnchor {
  target: { type: "part"; ref: { messageID: string; partID: string } } | { type: "group"; groupID: string }
  node: Renderable
}

interface SessionTimeline {
  sessionID: string
  anchors: {
    register(anchor: TimelineAnchor): () => void
    list(): TimelineAnchor[]
  }
  groupExpanded: unknown
  setGroupExpanded: unknown
  messageIndex: unknown
}

export default Plugin.define({
  id: "oc-web-rotate",
  setup: (ctx) =>
    ctx.ui.slot({
      append: "session.composer.top",
      render: (input) => {
        let timeline: SessionTimeline | undefined
        for (let owner = getOwner(); owner && !timeline; owner = owner.owner) {
          if (!owner.context) continue
          for (const key of Reflect.ownKeys(owner.context)) {
            const value = Reflect.get(owner.context, key) as Partial<SessionTimeline> | null | undefined
            if (
              value?.sessionID === input.sessionID &&
              typeof value.anchors?.register === "function" &&
              typeof value.anchors.list === "function" &&
              typeof value.groupExpanded === "function" &&
              typeof value.setGroupExpanded === "function" &&
              typeof value.messageIndex === "function"
            ) {
              timeline = value as SessionTimeline
              break
            }
          }
        }
        if (!timeline) return null
        const sessionID = timeline.sessionID
        const anchors = timeline.anchors
        const watchers = new Map<TimelineAnchor, () => void>()
        const bind = (anchor: TimelineAnchor) => {
          if (
            anchor.target.type !== "part" ||
            !(anchor.node instanceof BoxRenderable) ||
            watchers.has(anchor) ||
            anchor.node.isDestroyed
          )
            return
          const { messageID, partID } = anchor.target.ref
          let expanded = false
          const dispose = createRoot((stop) => {
            createEffect(() => {
              const message = ctx.data.session.message.get(sessionID, messageID)
              const part =
                message?.type === "assistant"
                  ? message.content.find((part) => part.type === "tool" && part.id === partID)
                  : undefined
              if (
                part?.type !== "tool" ||
                (part.name !== "websearch" && part.name !== "webfetch") ||
                part.state.status !== "completed" ||
                anchor.node.isDestroyed
              )
                return
              const state = part.state
              const metadata = state.metadata ?? {}
              const diagnostics = metadata["oc-web-rotate"]
              if (!diagnostics || typeof diagnostics !== "object" || Array.isArray(diagnostics)) return
              if (diagnostics.operation !== part.name) return
              const native = anchor.node.getChildren()[0]
              const header = native?.getChildren()[0]
              const icon = header?.getChildren()[0]
              const label = header?.getChildren()[1]
              if (
                !(
                  native instanceof BoxRenderable &&
                  header instanceof BoxRenderable &&
                  icon instanceof TextRenderable &&
                  label instanceof TextRenderable
                )
              )
                return
              const provider = stripVTControlCharacters(
                typeof diagnostics.provider === "string"
                  ? diagnostics.provider
                  : typeof metadata.provider === "string"
                    ? part.name === "websearch"
                      ? (metadata.provider.match(PROVIDER_SUFFIX_PATTERN)?.[1] ?? "")
                      : metadata.provider
                    : "",
              )
              const query = typeof state.input.query === "string" ? stripVTControlCharacters(state.input.query) : ""
              const url = Array.isArray(state.input.url) ? state.input.url.join(", ") : String(state.input.url ?? "")
              const caption =
                part.name === "websearch"
                  ? `WebSearch via web-rotate-core${provider ? ` (${provider})` : ""} "${query}"`
                  : `WebFetch via web-rotate-core${provider ? ` (${provider})` : ""} ${stripVTControlCharacters(url)}`
              const row = new BoxRenderable(ctx.renderer, { flexDirection: "row" })
              const visible = header.visible
              onCleanup(() => {
                if (!header.isDestroyed) header.visible = visible
                row.destroyRecursively()
              })
              const result = new BoxRenderable(ctx.renderer, { paddingLeft: 2, visible: expanded })
              onCleanup(() => result.destroyRecursively())
              if (typeof diagnostics.details === "string" && diagnostics.details)
                result.add(
                  new TextRenderable(ctx.renderer, {
                    fg: ctx.theme.text.muted,
                    wrapMode: "word",
                    marginBottom: 1,
                    content: stripVTControlCharacters(diagnostics.details),
                  }),
                )
              const output = new TextRenderable(ctx.renderer, {
                fg: ctx.theme.text.base,
                wrapMode: "word",
              })
              result.add(output)
              const disclosure = new TextRenderable(ctx.renderer, {
                width: 2,
                fg: ctx.theme.text.muted,
                content: expanded ? "▾" : "▸",
              })
              row.add(
                new TextRenderable(ctx.renderer, {
                  width: 2,
                  fg: icon.fg,
                  content: part.name === "websearch" ? "◈" : "%",
                }),
              )
              row.add(new TextRenderable(ctx.renderer, { flexGrow: 1, fg: label.fg, content: caption }))
              row.add(disclosure)
              const update = () => {
                disclosure.content = expanded ? "▾" : "▸"
                result.visible = expanded
                output.content = expanded
                  ? stripVTControlCharacters(
                      state.content
                        .map((content) =>
                          content.type === "text"
                            ? content.text
                            : (content.name ??
                              (content.uri.startsWith("data:") ? `Attachment (${content.mime})` : content.uri)),
                        )
                        .join("\n\n"),
                    )
                  : ""
              }
              row.onMouseUp = (event) => {
                if (event.button !== 0 || ctx.renderer.getSelection()?.getSelectedText()) return
                event.stopPropagation()
                expanded = !expanded
                update()
              }
              row.onMouseOver = () => {
                disclosure.fg = ctx.theme.text.base
              }
              row.onMouseOut = () => {
                disclosure.fg = ctx.theme.text.muted
              }
              native.insertBefore(row, header)
              native.add(result)
              header.visible = false
              update()
            })
            return stop
          })
          const release = () => {
            if (!watchers.delete(anchor)) return
            anchor.node.off("destroyed", release)
            dispose()
          }
          watchers.set(anchor, release)
          anchor.node.once("destroyed", release)
        }
        const original = anchors.register
        const register: SessionTimeline["anchors"]["register"] = (anchor) => {
          const unregister = original.call(anchors, anchor)
          bind(anchor)
          return () => {
            watchers.get(anchor)?.()
            unregister()
          }
        }
        anchors.register = register
        onCleanup(() => {
          if (anchors.register === register) anchors.register = original
          for (const release of watchers.values()) release()
        })
        for (const anchor of anchors.list()) bind(anchor)
        return null
      },
    }),
})
