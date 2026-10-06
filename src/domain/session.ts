import type * as acp from "@agentclientprotocol/sdk"
import type { AgentId } from "./agents"
import type { AskQuestion, Todo } from "./cursor"

export interface ImageAttachment {
  readonly name: string
  readonly mimeType: string
  /** Base64, without a data: prefix (ACP's image block format). */
  readonly data: string
}

export type TimelineItem =
  | {
      readonly _tag: "User"
      readonly id: string
      readonly text: string
      readonly images?: ReadonlyArray<ImageAttachment>
    }
  | { readonly _tag: "Agent"; readonly id: string; readonly text: string }
  | { readonly _tag: "Thought"; readonly id: string; readonly text: string }
  | {
      readonly _tag: "Tool"
      readonly id: string
      readonly title: string
      readonly kind: acp.ToolKind
      readonly status: acp.ToolCallStatus
      readonly content: ReadonlyArray<acp.ToolCallContent>
      readonly locations: ReadonlyArray<acp.ToolCallLocation>
      readonly rawInput: unknown
    }
  | { readonly _tag: "Plan"; readonly id: string; readonly entries: ReadonlyArray<acp.PlanEntry> }
  | { readonly _tag: "Notice"; readonly id: string; readonly text: string; readonly tone: "info" | "error" }

export type SessionStatus = "starting" | "ready" | "working" | "failed"

/** Something the agent is blocked on until the user answers. */
export type PendingRequest =
  | {
      readonly _tag: "Permission"
      readonly toolCall: acp.ToolCallUpdate
      readonly options: ReadonlyArray<acp.PermissionOption>
    }
  | {
      readonly _tag: "Question"
      readonly title: string | null
      readonly questions: AskQuestion["questions"]
    }
  | {
      readonly _tag: "PlanApproval"
      readonly name: string | null
      readonly overview: string | null
      readonly plan: string
      readonly todos: ReadonlyArray<Todo>
    }

export interface Session {
  readonly id: string
  readonly projectId: string
  readonly cwd: string
  readonly agentId: AgentId
  readonly acpSessionId: string | null
  readonly title: string
  readonly status: SessionStatus
  /** False until the agent process is running for this thread. */
  readonly connected: boolean
  readonly error: string | null
  readonly items: ReadonlyArray<TimelineItem>
  readonly configOptions: ReadonlyArray<acp.SessionConfigOption>
  readonly modes: acp.SessionModeState | null
  readonly usage: { readonly used: number; readonly size: number } | null
  readonly request: PendingRequest | null
  /** Whether the agent accepts image blocks in prompts. */
  readonly supportsImages: boolean
  readonly authMethods: ReadonlyArray<acp.AuthMethod>
  readonly createdAt: number
  readonly updatedAt: number
  readonly turnStartedAt: number | null
}

export const untitled = "New thread"

export const makeSession = (fields: {
  id: string
  projectId: string
  cwd: string
  agentId: AgentId
  now: number
}): Session => ({
  id: fields.id,
  projectId: fields.projectId,
  cwd: fields.cwd,
  agentId: fields.agentId,
  acpSessionId: null,
  title: untitled,
  status: "starting",
  connected: false,
  error: null,
  items: [],
  configOptions: [],
  modes: null,
  usage: null,
  request: null,
  supportsImages: false,
  authMethods: [],
  createdAt: fields.now,
  updatedAt: fields.now,
  turnStartedAt: null,
})

const newId = () => crypto.randomUUID()

const chunkText = (block: acp.ContentBlock): string => {
  switch (block.type) {
    case "text":
      return block.text
    case "resource_link":
      return `[${block.name}](${block.uri})`
    case "resource":
      return "text" in block.resource ? block.resource.text : ""
    default:
      return ""
  }
}

/** Appends streamed text to the trailing item of the same kind, or starts a new one. */
const appendText = (
  items: ReadonlyArray<TimelineItem>,
  tag: "User" | "Agent" | "Thought",
  text: string,
): ReadonlyArray<TimelineItem> => {
  if (text === "") return items
  const last = items.at(-1)
  if (last?._tag === tag) {
    return [...items.slice(0, -1), { ...last, text: last.text + text }]
  }
  return [...items, { _tag: tag, id: newId(), text }]
}

const updateTool = (
  items: ReadonlyArray<TimelineItem>,
  update: acp.ToolCallUpdate,
): ReadonlyArray<TimelineItem> =>
  items.map((item) =>
    item._tag === "Tool" && item.id === update.toolCallId
      ? {
          ...item,
          title: update.title ?? item.title,
          kind: update.kind ?? item.kind,
          status: update.status ?? item.status,
          content: update.content ?? item.content,
          locations: update.locations ?? item.locations,
          rawInput: update.rawInput ?? item.rawInput,
        }
      : item,
  )

const setPlan = (items: ReadonlyArray<TimelineItem>, entries: ReadonlyArray<acp.PlanEntry>) => {
  const index = items.findLastIndex((item) => item._tag === "Plan")
  // Keep the plan in place while the turn is still about it; otherwise start fresh at the end.
  const lastUser = items.findLastIndex((item) => item._tag === "User")
  if (index > lastUser) {
    return items.map((item, i) => (i === index ? { ...item, entries } : item))
  }
  return [...items, { _tag: "Plan" as const, id: newId(), entries }]
}

export const applyUpdate = (session: Session, update: acp.SessionUpdate): Session => {
  switch (update.sessionUpdate) {
    case "user_message_chunk":
      return { ...session, items: appendText(session.items, "User", chunkText(update.content)) }
    case "agent_message_chunk":
      return { ...session, items: appendText(session.items, "Agent", chunkText(update.content)) }
    case "agent_thought_chunk":
      return { ...session, items: appendText(session.items, "Thought", chunkText(update.content)) }
    case "tool_call": {
      if (session.items.some((item) => item._tag === "Tool" && item.id === update.toolCallId)) {
        return { ...session, items: updateTool(session.items, update) }
      }
      const tool: TimelineItem = {
        _tag: "Tool",
        id: update.toolCallId,
        title: update.title,
        kind: update.kind ?? "other",
        status: update.status ?? "pending",
        content: update.content ?? [],
        locations: update.locations ?? [],
        rawInput: update.rawInput,
      }
      return { ...session, items: [...session.items, tool] }
    }
    case "tool_call_update":
      return { ...session, items: updateTool(session.items, update) }
    case "plan":
      return { ...session, items: setPlan(session.items, update.entries) }
    case "current_mode_update":
      return session.modes ? { ...session, modes: { ...session.modes, currentModeId: update.currentModeId } } : session
    case "config_option_update":
      return { ...session, configOptions: update.configOptions }
    case "session_info_update":
      return update.title ? { ...session, title: update.title } : session
    case "usage_update":
      return { ...session, usage: { used: update.used, size: update.size } }
    default:
      return session
  }
}

/** Tool calls that are still running when a turn ends never will finish. */
export const settleTools = (items: ReadonlyArray<TimelineItem>): ReadonlyArray<TimelineItem> =>
  items.map((item) =>
    item._tag === "Tool" && (item.status === "pending" || item.status === "in_progress")
      ? { ...item, status: "failed" as const }
      : item,
  )

export const titleFrom = (text: string) => {
  const line = text.trim().split("\n")[0] ?? ""
  return line.length > 60 ? `${line.slice(0, 57).trimEnd()}...` : line || untitled
}

export const configOption = (session: Session, category: string) =>
  session.configOptions.find((option) => option.category === category && option.type === "select")
