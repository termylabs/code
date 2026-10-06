import type * as acp from "@agentclientprotocol/sdk"
import type { TimelineItem } from "./session"

export type ToolItem = Extract<TimelineItem, { _tag: "Tool" }>

export type Block =
  | Exclude<TimelineItem, { _tag: "Tool" }>
  | { readonly _tag: "Stack"; readonly id: string; readonly tools: ReadonlyArray<ToolItem> }

/** Folds consecutive tool calls into one stack. */
export const toBlocks = (items: ReadonlyArray<TimelineItem>): ReadonlyArray<Block> => {
  const blocks: Array<Block> = []
  for (const item of items) {
    if (item._tag !== "Tool") {
      blocks.push(item)
      continue
    }
    const last = blocks.at(-1)
    if (last?._tag === "Stack") {
      blocks[blocks.length - 1] = { ...last, tools: [...last.tools, item] }
    } else {
      blocks.push({ _tag: "Stack", id: item.id, tools: [item] })
    }
  }
  return blocks
}

export const isRunning = (tool: ToolItem) => tool.status === "pending" || tool.status === "in_progress"

interface Phrase {
  readonly verb: string
  readonly noun: (count: number) => string
  /** Lowercase form used after "and". */
  readonly join: string
}

const plural = (one: string, many: string) => (count: number) => `${count} ${count === 1 ? one : many}`

const phrases: Record<acp.ToolKind, Phrase> = {
  read: { verb: "Read", join: "read", noun: plural("file", "files") },
  edit: { verb: "Edited", join: "edited", noun: plural("file", "files") },
  delete: { verb: "Deleted", join: "deleted", noun: plural("file", "files") },
  move: { verb: "Moved", join: "moved", noun: plural("file", "files") },
  search: { verb: "Searched", join: "ran", noun: plural("search", "searches") },
  execute: { verb: "Ran", join: "ran", noun: plural("command", "commands") },
  fetch: { verb: "Fetched", join: "fetched", noun: plural("page", "pages") },
  think: { verb: "Thought", join: "thought", noun: () => "" },
  switch_mode: { verb: "Switched", join: "switched", noun: () => "mode" },
  other: { verb: "Used", join: "used", noun: plural("tool", "tools") },
}

/** How many distinct things a group of tool calls touched (files for file kinds, calls otherwise). */
const countFor = (kind: acp.ToolKind, tools: ReadonlyArray<ToolItem>) => {
  if (kind === "read" || kind === "edit" || kind === "delete" || kind === "move") {
    const paths = new Set(tools.flatMap((tool) => tool.locations.map((location) => location.path)))
    return paths.size || tools.length
  }
  return tools.length
}

export interface SummaryPart {
  readonly lead: string
  readonly object: string
}

/** "Read 4 files" + "and ran 1 search", in the order the kinds first appeared. */
export const summarize = (tools: ReadonlyArray<ToolItem>): ReadonlyArray<SummaryPart> => {
  const byKind = new Map<acp.ToolKind, Array<ToolItem>>()
  for (const tool of tools) byKind.set(tool.kind, [...(byKind.get(tool.kind) ?? []), tool])
  return [...byKind.entries()].map(([kind, group], index) => {
    const phrase = phrases[kind]
    return {
      lead: index === 0 ? phrase.verb : `and ${phrase.join}`,
      object: phrase.noun(countFor(kind, group)),
    }
  })
}

export const verbFor = (tool: ToolItem, running: boolean) => {
  if (!running) return phrases[tool.kind].verb
  switch (tool.kind) {
    case "read":
      return "Reading"
    case "edit":
      return "Editing"
    case "search":
      return "Searching"
    case "execute":
      return "Running"
    case "fetch":
      return "Fetching"
    case "think":
      return "Thinking"
    default:
      return "Working"
  }
}

/** The agent terminal a tool runs in, if it used one (ACP `terminal` content). */
export const terminalOf = (tool: ToolItem): string | null =>
  tool.content.find((content) => content.type === "terminal")?.terminalId ?? null

/** Text output a tool has produced so far, for the live tail under a running step. */
export const outputOf = (tool: ToolItem): string =>
  tool.content
    .flatMap((content) => (content.type === "content" && content.content.type === "text" ? [content.content.text] : []))
    .join("\n")

export const relativePath = (path: string, cwd: string) =>
  path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path
