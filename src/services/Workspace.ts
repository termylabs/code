import type * as acp from "@agentclientprotocol/sdk"
import {
  Cause,
  Clock,
  Context,
  Deferred,
  Effect,
  Exit,
  Layer,
  type Option,
  Predicate,
  Schema,
  Scope,
  SubscriptionRef,
} from "effect"
import { type AgentId, agents } from "@/domain/agents"
import type { Mention, Skill } from "@/domain/mentions"
import {
  AskQuestion,
  CreatePlan,
  GenerateImage,
  mergeTodos,
  methodName,
  Task,
  type Todo,
  toPlanEntries,
  UpdateTodos,
} from "@/domain/cursor"
import {
  applyUpdate,
  type ImageAttachment,
  isHistory,
  makeSession,
  type PendingRequest,
  pendingFork,
  type Session,
  settleTools,
  type TimelineItem,
  timeTurn,
  titleFrom,
  transcript,
  untitled,
} from "@/domain/session"
import { type AcpConnection, AcpClient, AcpError, type Prompt } from "./AcpClient"
import { AgentHost } from "./AgentHost"
import { Database, Project, type SearchHit, type ThreadSummary } from "./Database"
import { Tauri } from "./Tauri"

/** Live output of a command an agent runs through the client (ACP terminal). */
export interface TerminalOutput {
  readonly text: string
  /** Cursor position within the last line, for carriage-return overwrites. */
  readonly column: number
  readonly exitCode: number | null
  readonly signal: string | null
  readonly exited: boolean
}

export interface WorkspaceState {
  readonly loaded: boolean
  readonly projects: ReadonlyArray<Project>
  readonly threads: ReadonlyArray<ThreadSummary>
  /** Threads that are open in this window, keyed by thread id. */
  readonly sessions: Readonly<Record<string, Session>>
  /** Agent terminals, keyed by terminal id. */
  readonly terminals: Readonly<Record<string, TerminalOutput>>
  /** Open tabs, in order. */
  readonly tabs: ReadonlyArray<Tab>
}

/** A tab is a thread, or a full-size shell in a folder. */
export const Tab = Schema.Union([
  Schema.TaggedStruct("Thread", { id: Schema.String }),
  Schema.TaggedStruct("Terminal", { id: Schema.String, cwd: Schema.String, title: Schema.String }),
])
export type Tab = typeof Tab.Type

const decodeTabs = Schema.decodeUnknownOption(Schema.Array(Tab))

const TABS_KEY = "termy.tabs.v2"

export interface QuestionAnswer {
  readonly questionId: string
  readonly selectedOptionIds: ReadonlyArray<string>
}

/** Enough of a running command's output for the live step. */
const TERMINAL_TAIL_CHARS = 16_000

/**
 * Appends PTY text the way a terminal shows it: `\r` returns to the start of
 * the line and later characters overwrite it, so progress bars collapse.
 */
const appendTerminalText = (terminal: TerminalOutput, chunk: string): TerminalOutput => {
  const lineStart = terminal.text.lastIndexOf("\n") + 1
  let committed = terminal.text.slice(0, lineStart)
  let line = [...terminal.text.slice(lineStart)]
  let column = terminal.column
  for (const character of chunk) {
    if (character === "\r") column = 0
    else if (character === "\n") {
      committed += `${line.join("")}\n`
      line = []
      column = 0
    } else {
      line[column] = character
      column += 1
    }
  }
  const text = committed + line.join("")
  return { ...terminal, column, text: text.length > TERMINAL_TAIL_CHARS ? text.slice(-TERMINAL_TAIL_CHARS) : text }
}

export class WorkspaceError extends Schema.TaggedError<WorkspaceError>()("WorkspaceError", {
  message: Schema.String,
}) {}

/** Process-side state for a session that isn't serialisable into the store. */
interface Live {
  readonly scope: Scope.Closeable
  readonly ready: Deferred.Deferred<AcpConnection, WorkspaceError>
  /** Resolves the request the agent is blocked on (permission, question, plan). */
  request: Deferred.Deferred<unknown> | null
  /** Cursor's running todo list, so `merge` updates have something to merge into. */
  todos: ReadonlyArray<Todo>
  /** True while `session/load` replays history we already have on disk. */
  replaying: boolean
}

/** Permission, question and plan requests all share this cancelled shape. */
const cancelled = { outcome: { outcome: "cancelled" } } as const

const describe = (error: unknown): string =>
  Predicate.hasProperty(error, "message") && Predicate.isString(error.message) ? error.message : String(error)

export class Workspace extends Context.Service<
  Workspace,
  {
    readonly state: SubscriptionRef.SubscriptionRef<WorkspaceState>
    addProject(): Effect.Effect<Project | null, WorkspaceError>
    removeProject(id: string): Effect.Effect<void, WorkspaceError>
    /** Starts an unsaved thread and warms up its agent so models and modes are known. */
    createDraft(projectId: string, agentId: AgentId): Effect.Effect<string, WorkspaceError>
    discard(id: string): Effect.Effect<void>
    /** Loads a saved thread into the window and reconnects its agent. */
    open(id: string): Effect.Effect<void, WorkspaceError>
    send(
      id: string,
      text: string,
      images?: ReadonlyArray<ImageAttachment>,
      mentions?: ReadonlyArray<Mention>,
    ): Effect.Effect<void, WorkspaceError>
    cancel(id: string): Effect.Effect<void>
    retry(id: string): Effect.Effect<void>
    setConfigOption(id: string, configId: string, value: string): Effect.Effect<void, WorkspaceError>
    setMode(id: string, modeId: string): Effect.Effect<void, WorkspaceError>
    respondPermission(id: string, optionId: string | null): Effect.Effect<void>
    /** `null` skips the questions. */
    answerQuestions(id: string, answers: ReadonlyArray<QuestionAnswer> | null): Effect.Effect<void>
    decidePlan(id: string, accepted: boolean): Effect.Effect<void>
    searchThreads(query: string): Effect.Effect<ReadonlyArray<SearchHit>, WorkspaceError>
    /** Reads image files for a prompt; with no paths, asks the user to pick them. */
    loadImages(paths?: ReadonlyArray<string>): Effect.Effect<ReadonlyArray<ImageAttachment>, WorkspaceError>
    deleteThread(id: string): Effect.Effect<void, WorkspaceError>
    /** Copies a thread (up to `upTo`, an item id) into a new one for `agentId`. Returns the new thread's id. */
    fork(id: string, agentId: AgentId, upTo?: string): Effect.Effect<string, WorkspaceError>
    /** Removes a tab. An idle thread also lets go of its agent; a working one keeps going. */
    closeTab(id: string): Effect.Effect<void>
    /** Opens a shell in `cwd` as a tab. Returns the tab's id. */
    openTerminal(cwd: string, title: string): Effect.Effect<string>
    /** Follows the shell's own title, e.g. the running command. */
    setTerminalTitle(id: string, title: string): Effect.Effect<void>
    readFile(path: string): Effect.Effect<string, WorkspaceError>
    gitBranch(cwd: string): Effect.Effect<string | null>
    /** Project files relative to `cwd`, for `@` mentions. */
    listFiles(cwd: string): Effect.Effect<ReadonlyArray<string>, WorkspaceError>
    /** Skills the agent can use in `cwd`, for `$` mentions. */
    listSkills(agentId: AgentId, cwd: string): Effect.Effect<ReadonlyArray<Skill>, WorkspaceError>
  }
>()("termy/services/Workspace") {
  static readonly layer = Layer.effect(
    Workspace,
    Effect.gen(function* () {
      const tauri = yield* Tauri
      const db = yield* Database
      const host = yield* AgentHost
      const acpClient = yield* AcpClient
      const state = yield* SubscriptionRef.make<WorkspaceState>({
        loaded: false,
        projects: [],
        threads: [],
        sessions: {},
        terminals: {},
        tabs: [],
      })
      const live = new Map<string, Live>()

      const toWorkspaceError = (error: unknown) => new WorkspaceError({ message: describe(error) })

      const update = (f: (state: WorkspaceState) => WorkspaceState) => SubscriptionRef.update(state, f)

      const updateSession = (id: string, f: (session: Session) => Session) =>
        update((current) => {
          const session = current.sessions[id]
          if (!session) return current
          return { ...current, sessions: { ...current.sessions, [id]: f(session) } }
        })

      const getSession = Effect.fnUntraced(function* (id: string) {
        const session = (yield* SubscriptionRef.get(state)).sessions[id]
        if (!session) return yield* new WorkspaceError({ message: "This thread is no longer open." })
        return session
      })

      // ── persistence ────────────────────────────────────────────────────

      /** Writes a sent thread to disk and refreshes the sidebar summary. */
      const persist = Effect.fnUntraced(function* (id: string) {
        const session = (yield* SubscriptionRef.get(state)).sessions[id]
        if (!session || !session.items.some((item) => item._tag === "User")) return
        const now = yield* Clock.currentTimeMillis
        const record = {
          id: session.id,
          projectId: session.projectId,
          agentId: session.agentId,
          acpSessionId: session.acpSessionId,
          title: session.title,
          items: session.items,
          createdAt: session.createdAt,
          updatedAt: now,
        }
        yield* db.saveThread(record)
        yield* update((current) => ({
          ...current,
          threads: [record, ...current.threads.filter((thread) => thread.id !== id)],
        }))
      }, Effect.catch((error) => Effect.logWarning("Couldn't save thread", error.message)))

      // ── agent connection ──────────────────────────────────────────────

      /** Shows a request in the composer and waits for the user's answer. */
      const ask = <A>(id: string, request: PendingRequest) =>
        Effect.gen(function* () {
          const handle = live.get(id)
          if (!handle) return cancelled as A
          const answer = yield* Deferred.make<unknown>()
          handle.request = answer
          yield* updateSession(id, (session) => ({ ...session, request }))
          const response = yield* Deferred.await(answer)
          handle.request = null
          yield* updateSession(id, (session) => ({ ...session, request: null }))
          return response as A
        })

      const resolveRequest = Effect.fnUntraced(function* (id: string, response: unknown) {
        const handle = live.get(id)
        if (handle?.request) yield* Deferred.succeed(handle.request, response)
      })

      const addNotice = (id: string, text: string) =>
        updateSession(id, (session) => ({
          ...session,
          items: [...session.items, { _tag: "Notice", id: crypto.randomUUID(), text, tone: "info" }],
        }))

      /** Cursor's todo list is shown as the thread's plan. */
      const applyTodos = (id: string, todos: ReadonlyArray<Todo>, merge: boolean) =>
        Effect.gen(function* () {
          const handle = live.get(id)
          const next = mergeTodos(handle?.todos ?? [], todos, merge)
          if (handle) handle.todos = next
          yield* updateSession(id, (session) =>
            applyUpdate(session, { sessionUpdate: "plan", entries: toPlanEntries(next) }),
          )
          return next
        })

      const decode = <S extends Schema.Top>(schema: S, params: unknown) =>
        Schema.decodeUnknownEffect(schema)(params).pipe(
          Effect.tapError((error) => Effect.logWarning("Unexpected extension params", error.message)),
          Effect.option,
        ) as Effect.Effect<Option.Option<S["Type"]>>

      /** Cursor's ACP extensions. Anything else is reported as unsupported. */
      const onExtension = (id: string) => (method: string, params: Record<string, unknown>) =>
        Effect.gen(function* (): Effect.fn.Return<Record<string, unknown> | null> {
          switch (methodName(method)) {
            case "cursor/ask_question": {
              const request = yield* decode(AskQuestion, params)
              if (request._tag === "None") return null
              return yield* ask<Record<string, unknown>>(id, {
                _tag: "Question",
                title: request.value.title ?? null,
                questions: request.value.questions,
              })
            }
            case "cursor/create_plan": {
              const request = yield* decode(CreatePlan, params)
              if (request._tag === "None") return null
              yield* applyTodos(id, request.value.todos, false)
              return yield* ask<Record<string, unknown>>(id, {
                _tag: "PlanApproval",
                name: request.value.name ?? null,
                overview: request.value.overview ?? null,
                plan: request.value.plan,
                todos: request.value.todos,
              })
            }
            case "cursor/update_todos": {
              const request = yield* decode(UpdateTodos, params)
              if (request._tag === "None") return null
              const todos = yield* applyTodos(id, request.value.todos, request.value.merge ?? false)
              return { outcome: { outcome: "accepted", todos } }
            }
            case "cursor/task": {
              const request = yield* decode(Task, params)
              if (request._tag === "Some") yield* addNotice(id, `Subagent finished: ${request.value.description}`)
              return { outcome: { outcome: "completed" } }
            }
            case "cursor/generate_image":
              return { outcome: { outcome: "rejected", reason: "Termy Code can't show generated images yet." } }
            default:
              return null
          }
        })

      const onExtensionNotification = (id: string) => (method: string, params: Record<string, unknown>) =>
        Effect.gen(function* () {
          switch (methodName(method)) {
            case "cursor/update_todos": {
              const request = yield* decode(UpdateTodos, params)
              if (request._tag === "Some") yield* applyTodos(id, request.value.todos, request.value.merge ?? false)
              return
            }
            case "cursor/task": {
              const request = yield* decode(Task, params)
              if (request._tag === "Some") yield* addNotice(id, `Subagent finished: ${request.value.description}`)
              return
            }
            case "cursor/generate_image": {
              const request = yield* decode(GenerateImage, params)
              if (request._tag === "Some") yield* addNotice(id, `Generated an image: ${request.value.description}`)
              return
            }
          }
        })

      const handlers = (id: string) => ({
        // A replay rebuilds history we already have; session-level updates (commands, modes) still apply.
        onUpdate: (notification: acp.SessionNotification) =>
          live.get(id)?.replaying && isHistory(notification.update)
            ? Effect.void
            : updateSession(id, (session) => applyUpdate(session, notification.update)),
        onPermission: (request: acp.RequestPermissionRequest) =>
          ask<acp.RequestPermissionResponse>(id, {
            _tag: "Permission",
            toolCall: request.toolCall,
            options: request.options,
          }),
        onExtension: onExtension(id),
        onExtensionNotification: onExtensionNotification(id),
      })

      /** Spawns the agent, then resumes, replays or starts the ACP session. */
      const establish = (id: string, handle: Live) =>
        Effect.gen(function* () {
          const session = yield* getSession(id)
          const spec = agents[session.agentId]
          const process = yield* host.spawn(spec, session.cwd)
          const connection = yield* acpClient.connect(process, handlers(id))

          let resumed: acp.ResumeSessionResponse | acp.NewSessionResponse | acp.ForkSessionResponse
          let acpSessionId = session.acpSessionId
          let notice: string | null = null
          const fork = acpSessionId ? null : pendingFork(session.items)

          if (acpSessionId && connection.canResume) {
            resumed = yield* connection.resumeSession(acpSessionId, session.cwd)
          } else if (acpSessionId && connection.canLoad) {
            handle.replaying = true
            resumed = yield* connection
              .loadSession(acpSessionId, session.cwd)
              .pipe(Effect.ensuring(Effect.sync(() => (handle.replaying = false))))
          } else if (fork?.handoff === "native" && fork.fromAcpSessionId && connection.canFork) {
            const forked = yield* connection.forkSession(fork.fromAcpSessionId, session.cwd)
            acpSessionId = forked.sessionId
            resumed = forked
          } else {
            // A fork the agent can't do natively falls back to a transcript.
            if (fork?.handoff === "native") {
              yield* updateSession(id, (current) => ({
                ...current,
                items: current.items.map((item) =>
                  item.id === fork.id && item._tag === "Fork" ? { ...item, handoff: "transcript" as const } : item,
                ),
              }))
            }
            const created = yield* connection.newSession(session.cwd)
            if (acpSessionId) {
              notice = `${spec.name} started a fresh session. It can see this project but not the earlier messages.`
            }
            acpSessionId = created.sessionId
            resumed = created
          }

          // Watch for the agent dying underneath us.
          yield* Deferred.await(process.exited).pipe(
            Effect.flatMap((code) =>
              updateSession(id, (current) => ({
                ...current,
                connected: false,
                status: "failed",
                error: [`${spec.name} exited${code === null ? "" : ` with code ${code}`}.`, process.stderrTail()]
                  .filter(Boolean)
                  .join("\n"),
                items: settleTools(current.items),
              })),
            ),
            Effect.ensuring(Effect.sync(() => live.delete(id))),
            Effect.forkIn(handle.scope),
          )

          yield* updateSession(id, (current) => ({
            ...current,
            acpSessionId,
            connected: true,
            status: current.status === "working" ? "working" : "ready",
            error: null,
            authMethods: connection.info.authMethods ?? [],
            supportsImages: Boolean(connection.info.agentCapabilities?.promptCapabilities?.image),
            configOptions: resumed.configOptions ?? current.configOptions,
            modes: resumed.modes ?? current.modes,
            items: notice
              ? [...current.items, { _tag: "Notice", id: crypto.randomUUID(), text: notice, tone: "info" }]
              : current.items,
          }))
          return connection
        }).pipe(
          Scope.provide(handle.scope),
          Effect.catch((error) =>
            Effect.gen(function* () {
              const session = yield* getSession(id)
              const message =
                error instanceof AcpError && error.needsAuth ? agents[session.agentId].loginHint : describe(error)
              yield* updateSession(id, (current) => ({
                ...current,
                connected: false,
                status: "failed",
                error: message,
              }))
              return yield* new WorkspaceError({ message })
            }),
          ),
        )

      /** Returns the live connection, starting the agent on first use. Concurrent callers share one start. */
      const ensureConnected = Effect.fnUntraced(function* (id: string) {
        const existing = live.get(id)
        if (existing) return yield* Deferred.await(existing.ready)

        const handle: Live = {
          scope: yield* Scope.make(),
          ready: yield* Deferred.make<AcpConnection, WorkspaceError>(),
          request: null,
          todos: [],
          replaying: false,
        }
        live.set(id, handle)
        yield* updateSession(id, (session) => ({ ...session, status: "starting", error: null }))

        const exit = yield* Effect.exit(establish(id, handle))
        yield* Deferred.done(handle.ready, exit)
        if (Exit.isFailure(exit)) {
          live.delete(id)
          yield* Scope.close(handle.scope, Exit.void)
        }
        return yield* exit
      })

      const disconnect = Effect.fnUntraced(function* (id: string) {
        const handle = live.get(id)
        if (!handle) return
        live.delete(id)
        if (handle.request) yield* Deferred.succeed(handle.request, cancelled)
        yield* Scope.close(handle.scope, Exit.void)
      })

      // ── projects ──────────────────────────────────────────────────────

      const addProject = Effect.fn("Workspace.addProject")(
        function* () {
          const path = yield* tauri.pickDirectory()
          if (!path) return null
          const now = yield* Clock.currentTimeMillis
          const project = yield* db.saveProject(
            new Project({
              id: crypto.randomUUID(),
              path,
              name: path.split("/").filter(Boolean).at(-1) ?? path,
              createdAt: now,
              lastOpenedAt: now,
            }),
          )
          yield* update((current) => ({
            ...current,
            projects: [project, ...current.projects.filter((existing) => existing.id !== project.id)],
          }))
          return project
        },
        Effect.mapError(toWorkspaceError),
      )

      const removeProject = Effect.fn("Workspace.removeProject")(
        function* (id: string) {
          const current = yield* SubscriptionRef.get(state)
          for (const session of Object.values(current.sessions)) {
            if (session.projectId === id) yield* disconnect(session.id)
          }
          yield* db.deleteProject(id)
          yield* update((current) => ({
            ...current,
            projects: current.projects.filter((project) => project.id !== id),
            tabs: current.tabs.filter(
              (tab) => tab._tag !== "Thread" || current.threads.find((thread) => thread.id === tab.id)?.projectId !== id,
            ),
            threads: current.threads.filter((thread) => thread.projectId !== id),
            sessions: Object.fromEntries(
              Object.entries(current.sessions).filter(([, session]) => session.projectId !== id),
            ),
          }))
        },
        Effect.mapError(toWorkspaceError),
      )

      // ── threads ───────────────────────────────────────────────────────

      const createDraft = Effect.fn("Workspace.createDraft")(function* (projectId: string, agentId: AgentId) {
        const project = (yield* SubscriptionRef.get(state)).projects.find((p) => p.id === projectId)
        if (!project) return yield* new WorkspaceError({ message: "Pick a project first." })
        const now = yield* Clock.currentTimeMillis
        const session = makeSession({ id: crypto.randomUUID(), projectId, cwd: project.path, agentId, now })
        yield* update((current) => ({ ...current, sessions: { ...current.sessions, [session.id]: session } }))
        // Warm the agent in the background; failures land on the session.
        yield* ensureConnected(session.id).pipe(Effect.ignore, Effect.forkDetach)
        return session.id
      })

      const discard = Effect.fn("Workspace.discard")(function* (id: string) {
        yield* disconnect(id)
        yield* update((current) => {
          const { [id]: _removed, ...sessions } = current.sessions
          return { ...current, sessions }
        })
      })

      const open = Effect.fn("Workspace.open")(
        function* (id: string) {
          const current = yield* SubscriptionRef.get(state)
          if (!current.sessions[id]) {
            const record = yield* db.getThread(id)
            if (!record) return yield* new WorkspaceError({ message: "This thread no longer exists." })
            const project = current.projects.find((p) => p.id === record.projectId)
            if (!project) return yield* new WorkspaceError({ message: "This thread's project was removed." })
            const session: Session = {
              ...makeSession({
                id: record.id,
                projectId: record.projectId,
                cwd: project.path,
                agentId: record.agentId,
                now: record.createdAt,
              }),
              acpSessionId: record.acpSessionId,
              title: record.title,
              items: settleTools(record.items),
              status: "ready",
              updatedAt: record.updatedAt,
            }
            yield* update((s) => ({ ...s, sessions: { ...s.sessions, [id]: session } }))
          }
          yield* setTabs((tabs) => (tabs.some((tab) => tab.id === id) ? tabs : [...tabs, { _tag: "Thread", id }]))
          if (!live.has(id)) yield* ensureConnected(id).pipe(Effect.ignore, Effect.forkDetach)
        },
        Effect.mapError(toWorkspaceError),
      )

      const runTurn = (id: string, connection: AcpConnection, acpSessionId: string, prompt: Prompt, startedAt: number) =>
        connection.prompt(acpSessionId, prompt).pipe(
          Effect.matchEffect({
            onSuccess: (response) =>
              updateSession(id, (session) => ({
                ...session,
                status: "ready",
                turnStartedAt: null,
                items: [
                  ...settleTools(session.items),
                  ...(response.stopReason === "refusal"
                    ? [{ _tag: "Notice", id: crypto.randomUUID(), text: "The agent declined this request.", tone: "error" } as TimelineItem]
                    : response.stopReason === "max_tokens" || response.stopReason === "max_turn_requests"
                      ? [{ _tag: "Notice", id: crypto.randomUUID(), text: "The agent stopped at its turn limit. Send a follow-up to continue.", tone: "info" } as TimelineItem]
                      : []),
                ],
              })),
            onFailure: (error) =>
              updateSession(id, (session) => ({
                ...session,
                status: session.connected ? "ready" : "failed",
                turnStartedAt: null,
                items: [
                  ...settleTools(session.items),
                  { _tag: "Notice", id: crypto.randomUUID(), text: error.message, tone: "error" },
                ],
              })),
          }),
          Effect.andThen(Clock.currentTimeMillis),
          Effect.flatMap((now) =>
            updateSession(id, (session) => ({ ...session, items: timeTurn(session.items, now - startedAt) })),
          ),
          Effect.andThen(persist(id)),
        )

      const send = Effect.fn("Workspace.send")(function* (
        id: string,
        text: string,
        images: ReadonlyArray<ImageAttachment> = [],
        mentions: ReadonlyArray<Mention> = [],
      ) {
        const trimmed = text.trim()
        if (!trimmed && images.length === 0) return
        const now = yield* Clock.currentTimeMillis
        yield* updateSession(id, (session) => ({
          ...session,
          title: session.title === untitled ? titleFrom(trimmed || images[0]?.name || "Image") : session.title,
          status: "working",
          turnStartedAt: now,
          items: [
            ...session.items,
            {
              _tag: "User",
              id: crypto.randomUUID(),
              text: trimmed,
              ...(images.length > 0 ? { images } : {}),
              ...(mentions.length > 0 ? { mentions } : {}),
            },
          ],
        }))
        yield* persist(id)

        const connection = yield* ensureConnected(id).pipe(
          Effect.tapError(() =>
            updateSession(id, (session) => ({ ...session, turnStartedAt: null })),
          ),
        )
        const session = yield* getSession(id)
        const handle = live.get(id)
        if (!session.acpSessionId || !handle) {
          return yield* new WorkspaceError({ message: "The agent session isn't ready yet." })
        }
        if (images.length > 0 && !session.supportsImages) {
          return yield* new WorkspaceError({ message: `${agents[session.agentId].name} doesn't accept images.` })
        }
        // The first prompt after a handoff carries the conversation it came from.
        const items = session.items.slice(0, -1)
        const fork = pendingFork(items)
        const context =
          fork?.handoff === "transcript" ? transcript(items, fork, agents[fork.fromAgentId].name) : undefined
        yield* Effect.forkIn(
          runTurn(id, connection, session.acpSessionId, { text: trimmed, images, mentions, context }, now),
          handle.scope,
        )
      })

      const cancel = Effect.fn("Workspace.cancel")(function* (id: string) {
        const handle = live.get(id)
        const session = (yield* SubscriptionRef.get(state)).sessions[id]
        if (!handle || !session?.acpSessionId) return
        if (handle.request) yield* Deferred.succeed(handle.request, cancelled)
        const connection = yield* Deferred.await(handle.ready).pipe(Effect.option)
        if (connection._tag === "Some") yield* connection.value.cancel(session.acpSessionId).pipe(Effect.ignore)
      })

      const retry = Effect.fn("Workspace.retry")(function* (id: string) {
        yield* disconnect(id)
        yield* ensureConnected(id).pipe(Effect.ignore, Effect.forkDetach)
      })

      const withConnection = Effect.fnUntraced(function* (id: string) {
        const session = yield* getSession(id)
        const handle = live.get(id)
        if (!handle || !session.acpSessionId) {
          return yield* new WorkspaceError({ message: "The agent isn't connected." })
        }
        const connection = yield* Deferred.await(handle.ready)
        return { connection, acpSessionId: session.acpSessionId }
      })

      const setConfigOption = Effect.fn("Workspace.setConfigOption")(
        function* (id: string, configId: string, value: string) {
          // Optimistic, so the slider and menus respond instantly.
          yield* updateSession(id, (session) => ({
            ...session,
            configOptions: session.configOptions.map((option) =>
              option.id === configId && option.type === "select" ? { ...option, currentValue: value } : option,
            ),
          }))
          const { connection, acpSessionId } = yield* withConnection(id)
          const configOptions = yield* connection.setConfigOption(acpSessionId, configId, value)
          yield* updateSession(id, (session) => ({ ...session, configOptions }))
        },
        Effect.mapError(toWorkspaceError),
      )

      const setMode = Effect.fn("Workspace.setMode")(
        function* (id: string, modeId: string) {
          yield* updateSession(id, (session) =>
            session.modes ? { ...session, modes: { ...session.modes, currentModeId: modeId } } : session,
          )
          const { connection, acpSessionId } = yield* withConnection(id)
          yield* connection.setMode(acpSessionId, modeId)
        },
        Effect.mapError(toWorkspaceError),
      )

      const respondPermission = Effect.fn("Workspace.respondPermission")(function* (
        id: string,
        optionId: string | null,
      ) {
        const response: acp.RequestPermissionResponse = optionId
          ? { outcome: { outcome: "selected", optionId } }
          : cancelled
        yield* resolveRequest(id, response)
      })

      const answerQuestions = Effect.fn("Workspace.answerQuestions")(function* (
        id: string,
        answers: ReadonlyArray<QuestionAnswer> | null,
      ) {
        yield* resolveRequest(
          id,
          answers ? { outcome: { outcome: "answered", answers } } : { outcome: { outcome: "skipped" } },
        )
      })

      const decidePlan = Effect.fn("Workspace.decidePlan")(function* (id: string, accepted: boolean) {
        yield* resolveRequest(id, { outcome: { outcome: accepted ? "accepted" : "rejected" } })
      })

      const deleteThread = Effect.fn("Workspace.deleteThread")(
        function* (id: string) {
          yield* discard(id)
          yield* db.deleteThread(id)
          yield* update((current) => ({
            ...current,
            threads: current.threads.filter((thread) => thread.id !== id),
            tabs: current.tabs.filter((tab) => tab.id !== id),
          }))
        },
        Effect.mapError(toWorkspaceError),
      )

      const fork = Effect.fn("Workspace.fork")(function* (id: string, agentId: AgentId, upTo?: string) {
        const source = yield* getSession(id)
        const cut = upTo ? source.items.findIndex((item) => item.id === upTo) : -1
        const whole = cut < 0 || cut === source.items.length - 1
        const items = settleTools(whole ? source.items : source.items.slice(0, cut + 1))
        const now = yield* Clock.currentTimeMillis
        const forkId = crypto.randomUUID()
        const session: Session = {
          ...makeSession({ id: forkId, projectId: source.projectId, cwd: source.cwd, agentId, now }),
          title: source.title,
          status: "starting",
          items: [
            ...items,
            {
              _tag: "Fork",
              id: crypto.randomUUID(),
              fromTitle: source.title,
              fromAgentId: source.agentId,
              fromAcpSessionId: source.acpSessionId,
              // The agent's own fork copies the whole session, so a partial fork needs the transcript.
              handoff: agentId === source.agentId && source.acpSessionId && whole ? "native" : "transcript",
            },
          ],
        }
        yield* update((current) => ({ ...current, sessions: { ...current.sessions, [forkId]: session } }))
        yield* persist(forkId)
        yield* ensureConnected(forkId).pipe(Effect.ignore, Effect.forkDetach)
        return forkId
      })

      const writeTabs = (tabs: ReadonlyArray<Tab>) =>
        Effect.sync(() => {
          try {
            localStorage.setItem(TABS_KEY, JSON.stringify(tabs))
          } catch {
            // Tabs just won't come back after a restart.
          }
        })

      const setTabs = (f: (tabs: ReadonlyArray<Tab>) => ReadonlyArray<Tab>) =>
        SubscriptionRef.modify(state, (current) => {
          const tabs = f(current.tabs)
          return [tabs, { ...current, tabs }] as const
        }).pipe(Effect.flatMap(writeTabs))

      const closeTab = Effect.fn("Workspace.closeTab")(function* (id: string) {
        yield* setTabs((tabs) => tabs.filter((tab) => tab.id !== id))
        const session = (yield* SubscriptionRef.get(state)).sessions[id]
        if (session && session.status !== "working") yield* discard(id)
      })

      const openTerminal = Effect.fn("Workspace.openTerminal")(function* (cwd: string, title: string) {
        const id = crypto.randomUUID()
        yield* setTabs((tabs) => [...tabs, { _tag: "Terminal", id, cwd, title }])
        return id
      })

      const setTerminalTitle = Effect.fn("Workspace.setTerminalTitle")(function* (id: string, title: string) {
        yield* setTabs((tabs) =>
          tabs.map((tab) => (tab.id === id && tab._tag === "Terminal" && tab.title !== title ? { ...tab, title } : tab)),
        )
      })

      // ── agent terminals ───────────────────────────────────────────────

      const emptyTerminal: TerminalOutput = { text: "", column: 0, exitCode: null, signal: null, exited: false }
      const updateTerminal = (id: string, f: (terminal: TerminalOutput) => TerminalOutput) =>
        Effect.runSync(
          update((current) => ({
            ...current,
            terminals: { ...current.terminals, [id]: f(current.terminals[id] ?? emptyTerminal) },
          })),
        )

      yield* tauri.listen<{ id: string; text: string }>("acp-terminal://output", ({ id, text }) =>
        updateTerminal(id, (terminal) => appendTerminalText(terminal, text)),
      )
      yield* tauri.listen<{ id: string; exitStatus: { exitCode: number | null; signal: string | null } }>(
        "acp-terminal://exit",
        ({ id, exitStatus }) =>
          updateTerminal(id, (terminal) => ({
            ...terminal,
            exited: true,
            exitCode: exitStatus.exitCode,
            signal: exitStatus.signal,
          })),
      )

      // ── boot ──────────────────────────────────────────────────────────

      yield* Effect.gen(function* () {
        const [projects, threads] = yield* Effect.all([db.listProjects(), db.listThreads()])
        const saved = yield* Effect.sync((): ReadonlyArray<Tab> => {
          try {
            const parsed = decodeTabs(JSON.parse(localStorage.getItem(TABS_KEY) ?? "[]"))
            return parsed._tag === "Some" ? parsed.value : []
          } catch {
            return []
          }
        })
        // Terminal tabs come back as fresh shells in the same folder.
        const tabs = saved.filter((tab) => tab._tag === "Terminal" || threads.some((thread) => thread.id === tab.id))
        yield* update((current) => ({ ...current, loaded: true, projects, threads, tabs }))
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logError("Couldn't load workspace", Cause.pretty(cause)).pipe(
            Effect.andThen(update((current) => ({ ...current, loaded: true }))),
          ),
        ),
      )

      yield* Effect.addFinalizer(() =>
        Effect.forEach([...live.keys()], disconnect, { discard: true }),
      )

      return Workspace.of({
        state,
        addProject,
        removeProject,
        createDraft,
        discard,
        open,
        send,
        cancel,
        retry,
        setConfigOption,
        setMode,
        respondPermission,
        deleteThread,
        fork,
        closeTab,
        openTerminal,
        setTerminalTitle,
        readFile: (path) =>
          tauri
            .invoke<string>("fs_read_text", { path, line: null, limit: null })
            .pipe(Effect.mapError(toWorkspaceError)),
        answerQuestions,
        decidePlan,
        searchThreads: (query) => db.searchThreads(query).pipe(Effect.mapError(toWorkspaceError)),
        loadImages: Effect.fn("Workspace.loadImages")(
          function* (paths?: ReadonlyArray<string>) {
            const chosen = paths ?? (yield* tauri.pickImages())
            return yield* Effect.forEach(chosen, (path) => tauri.invoke<ImageAttachment>("fs_read_image", { path }), {
              concurrency: 4,
            })
          },
          Effect.mapError(toWorkspaceError),
        ),
        gitBranch: (cwd) =>
          tauri.invoke<string | null>("git_branch", { cwd }).pipe(Effect.orElseSucceed(() => null)),
        listFiles: (cwd) =>
          tauri.invoke<ReadonlyArray<string>>("project_files", { cwd }).pipe(Effect.mapError(toWorkspaceError)),
        listSkills: (agentId, cwd) =>
          tauri
            .invoke<ReadonlyArray<Skill>>("skills_list", { agent: agentId, cwd })
            .pipe(Effect.mapError(toWorkspaceError)),
      })
    }),
  ).pipe(Layer.provide([Database.layer, AgentHost.layer, AcpClient.layer, Tauri.layer]))
}
