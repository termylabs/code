import type * as acp from "@agentclientprotocol/sdk"
import { Context, Deferred, Effect, Layer, Schema, Scope } from "effect"
import type { AgentSpec } from "@/domain/agents"
import { Tauri } from "./Tauri"

export class SpawnError extends Schema.TaggedError<SpawnError>()("SpawnError", {
  agent: Schema.String,
  message: Schema.String,
}) {}

/** A running agent process with its stdio exposed as an ACP message stream. */
export interface AgentProcess {
  readonly stream: acp.Stream
  /** Resolves with the exit code once the process ends. */
  readonly exited: Deferred.Deferred<number | null>
  /** The last lines the agent wrote to stderr, for error messages. */
  readonly stderrTail: () => string
}

interface Route {
  readonly stdout: (line: string) => void
  readonly stderr: (line: string) => void
  readonly exit: (code: number | null) => void
}

const STDERR_LINES = 20

const decodeMessage = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

export class AgentHost extends Context.Service<
  AgentHost,
  {
    /** Spawns the agent for the lifetime of the surrounding scope. */
    spawn(spec: AgentSpec, cwd: string): Effect.Effect<AgentProcess, SpawnError, Scope.Scope>
  }
>()("termy/services/AgentHost") {
  static readonly layer = Layer.effect(
    AgentHost,
    Effect.gen(function* () {
      const tauri = yield* Tauri
      const routes = new Map<number, Route>()
      // Lines that arrive before their route is registered are held here.
      const early = new Map<number, Array<(route: Route) => void>>()

      const dispatch = (id: number, deliver: (route: Route) => void) => {
        const route = routes.get(id)
        if (route) return deliver(route)
        early.set(id, [...(early.get(id) ?? []), deliver])
      }

      yield* tauri.listen<{ id: number; line: string }>("agent://stdout", ({ id, line }) =>
        dispatch(id, (route) => route.stdout(line)),
      )
      yield* tauri.listen<{ id: number; line: string }>("agent://stderr", ({ id, line }) =>
        dispatch(id, (route) => route.stderr(line)),
      )
      yield* tauri.listen<{ id: number; code: number | null }>("agent://exit", ({ id, code }) =>
        dispatch(id, (route) => route.exit(code)),
      )

      const spawn = Effect.fn("AgentHost.spawn")(function* (spec: AgentSpec, cwd: string) {
        const id = yield* Effect.acquireRelease(
          tauri
            .invoke<number>("agent_spawn", {
              request: { command: spec.command, args: spec.args, cwd, env: {} },
            })
            .pipe(Effect.mapError((error) => new SpawnError({ agent: spec.name, message: error.message }))),
          (id) =>
            tauri.invoke("agent_kill", { id }).pipe(
              Effect.ignore,
              Effect.ensuring(Effect.sync(() => routes.delete(id))),
            ),
        )

        const exited = yield* Deferred.make<number | null>()
        const stderr: Array<string> = []
        let push: (message: acp.AnyMessage) => void = () => {}
        let close: () => void = () => {}

        const readable = new ReadableStream<acp.AnyMessage>({
          start(controller) {
            push = (message) => controller.enqueue(message)
            close = () => controller.close()
          },
        })

        const writable = new WritableStream<acp.AnyMessage>({
          write: (message) =>
            Effect.runPromise(
              tauri.invoke<void>("agent_write", { id, line: JSON.stringify(message) }),
            ),
        })

        routes.set(id, {
          stdout: (line) => {
            const message = decodeMessage(line)
            // Agents sometimes log to stdout; anything that isn't JSON-RPC is noise.
            if (message._tag === "Some") push(message.value as acp.AnyMessage)
          },
          stderr: (line) => {
            stderr.push(line)
            if (stderr.length > STDERR_LINES) stderr.shift()
          },
          exit: (code) => {
            close()
            Deferred.doneUnsafe(exited, Effect.succeed(code))
          },
        })
        for (const deliver of early.get(id) ?? []) deliver(routes.get(id)!)
        early.delete(id)

        return {
          stream: { readable, writable },
          exited,
          stderrTail: () => stderr.join("\n"),
        } satisfies AgentProcess
      })

      return AgentHost.of({ spawn })
    }),
  ).pipe(Layer.provide(Tauri.layer))
}
