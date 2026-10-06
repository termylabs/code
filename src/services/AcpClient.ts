import * as acp from "@agentclientprotocol/sdk"
import { Context, Effect, Layer, Schema, type Scope } from "effect"
import type { ImageAttachment } from "@/domain/session"
import type { AgentProcess } from "./AgentHost"
import { Tauri } from "./Tauri"

export class AcpError extends Schema.TaggedError<AcpError>()("AcpError", {
  method: Schema.String,
  code: Schema.Number,
  message: Schema.String,
}) {
  /** ACP's `auth_required` error code. */
  get needsAuth() {
    return this.code === -32000
  }
}

const toAcpError = (method: string) => (cause: unknown) =>
  cause instanceof acp.RequestError
    ? new AcpError({ method, code: cause.code, message: cause.message })
    : new AcpError({ method, code: -1, message: cause instanceof Error ? cause.message : String(cause) })

/** What the client does when the agent talks to it. */
export interface ClientHandlers {
  readonly onUpdate: (notification: acp.SessionNotification) => Effect.Effect<void>
  readonly onPermission: (request: acp.RequestPermissionRequest) => Effect.Effect<acp.RequestPermissionResponse>
  /** Vendor extension requests. `null` means the method isn't supported. */
  readonly onExtension: (method: string, params: Record<string, unknown>) => Effect.Effect<Record<string, unknown> | null>
  readonly onExtensionNotification: (method: string, params: Record<string, unknown>) => Effect.Effect<void>
}

export interface Prompt {
  readonly text: string
  readonly images: ReadonlyArray<ImageAttachment>
}

const toContentBlocks = (prompt: Prompt): Array<acp.ContentBlock> => [
  ...(prompt.text ? [{ type: "text" as const, text: prompt.text }] : []),
  ...prompt.images.map((image) => ({ type: "image" as const, data: image.data, mimeType: image.mimeType })),
]

export interface AcpConnection {
  readonly info: acp.InitializeResponse
  readonly canResume: boolean
  readonly canLoad: boolean
  newSession(cwd: string): Effect.Effect<acp.NewSessionResponse, AcpError>
  resumeSession(sessionId: string, cwd: string): Effect.Effect<acp.ResumeSessionResponse, AcpError>
  loadSession(sessionId: string, cwd: string): Effect.Effect<acp.LoadSessionResponse, AcpError>
  authenticate(methodId: string): Effect.Effect<void, AcpError>
  prompt(sessionId: string, prompt: Prompt): Effect.Effect<acp.PromptResponse, AcpError>
  cancel(sessionId: string): Effect.Effect<void, AcpError>
  setConfigOption(
    sessionId: string,
    configId: string,
    value: string,
  ): Effect.Effect<ReadonlyArray<acp.SessionConfigOption>, AcpError>
  setMode(sessionId: string, modeId: string): Effect.Effect<void, AcpError>
}

export class AcpClient extends Context.Service<
  AcpClient,
  {
    /** Terminals the agent opens are released when the surrounding scope closes. */
    connect(process: AgentProcess, handlers: ClientHandlers): Effect.Effect<AcpConnection, AcpError, Scope.Scope>
  }
>()("termy/services/AcpClient") {
  static readonly layer = Layer.effect(
    AcpClient,
    Effect.gen(function* () {
      const tauri = yield* Tauri

      const connect = Effect.fn("AcpClient.connect")(function* (process: AgentProcess, handlers: ClientHandlers) {
        const context = yield* Effect.context<never>()
        const run = Effect.runPromiseWith(context)

        const terminals = new Set<string>()
        const releaseTerminal = (id: string) =>
          tauri.invoke<void>("acp_terminal_release", { id }).pipe(
            Effect.ensuring(Effect.sync(() => terminals.delete(id))),
          )
        yield* Effect.addFinalizer(() =>
          Effect.forEach([...terminals], (id) => Effect.ignore(releaseTerminal(id)), { discard: true }),
        )

        const client: acp.Client = {
          sessionUpdate: (params) => run(handlers.onUpdate(params)),
          requestPermission: (params) => run(handlers.onPermission(params)),
          extMethod: (method, params) =>
            run(handlers.onExtension(method, params)).then((result) => {
              if (result === null) throw acp.RequestError.methodNotFound(method)
              return result
            }),
          extNotification: (method, params) => run(handlers.onExtensionNotification(method, params)),
          createTerminal: (params) =>
            run(
              tauri.invoke<string>("acp_terminal_create", {
                request: {
                  command: params.command,
                  args: params.args ?? [],
                  env: params.env ?? [],
                  cwd: params.cwd ?? null,
                  outputByteLimit: params.outputByteLimit ?? null,
                },
              }),
            ).then((terminalId) => {
              terminals.add(terminalId)
              return { terminalId }
            }),
          terminalOutput: (params) =>
            run(
              tauri.invoke<acp.TerminalOutputResponse>("acp_terminal_output", { id: params.terminalId }),
            ),
          waitForTerminalExit: (params) =>
            run(tauri.invoke<acp.WaitForTerminalExitResponse>("acp_terminal_wait", { id: params.terminalId })),
          killTerminal: (params) => run(tauri.invoke<void>("acp_terminal_kill", { id: params.terminalId })).then(() => ({})),
          releaseTerminal: (params) => run(releaseTerminal(params.terminalId)).then(() => ({})),
          readTextFile: (params) =>
            run(
              tauri.invoke<string>("fs_read_text", {
                path: params.path,
                line: params.line ?? null,
                limit: params.limit ?? null,
              }),
            ).then((content) => ({ content })),
          writeTextFile: (params) =>
            run(tauri.invoke<void>("fs_write_text", { path: params.path, content: params.content })).then(() => ({})),
        }

        const connection = new acp.ClientSideConnection(() => client, process.stream)
        const call = <A>(method: string, request: () => Promise<A>) =>
          Effect.tryPromise({ try: request, catch: toAcpError(method) })

        const info = yield* call("initialize", () =>
          connection.initialize({
            protocolVersion: acp.PROTOCOL_VERSION,
            clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
            clientInfo: { name: "termy-code", title: "Termy Code", version: "0.1.0" },
          }),
        )

        return {
          info,
          canResume: Boolean(info.agentCapabilities?.sessionCapabilities?.resume),
          canLoad: Boolean(info.agentCapabilities?.loadSession),
          newSession: (cwd) => call("session/new", () => connection.newSession({ cwd, mcpServers: [] })),
          resumeSession: (sessionId, cwd) =>
            call("session/resume", () => connection.resumeSession({ sessionId, cwd, mcpServers: [] })),
          loadSession: (sessionId, cwd) =>
            call("session/load", () => connection.loadSession({ sessionId, cwd, mcpServers: [] })),
          authenticate: (methodId) => call("authenticate", () => connection.authenticate({ methodId })).pipe(Effect.asVoid),
          prompt: (sessionId, prompt) =>
            call("session/prompt", () => connection.prompt({ sessionId, prompt: toContentBlocks(prompt) })),
          cancel: (sessionId) => call("session/cancel", () => connection.cancel({ sessionId })),
          setConfigOption: (sessionId, configId, value) =>
            call("session/set_config_option", () =>
              connection.setSessionConfigOption({ sessionId, configId, value }),
            ).pipe(Effect.map((response) => response.configOptions)),
          setMode: (sessionId, modeId) =>
            call("session/set_mode", () => connection.setSessionMode({ sessionId, modeId })).pipe(Effect.asVoid),
        } satisfies AcpConnection
      })

      return AcpClient.of({ connect })
    }),
  ).pipe(Layer.provide(Tauri.layer))
}
