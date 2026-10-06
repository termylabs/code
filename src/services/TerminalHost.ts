import { Channel } from "@tauri-apps/api/core"
import { Context, Effect, Layer, type Scope } from "effect"
import { Tauri, type TauriError } from "./Tauri"

export interface TerminalSession {
  write(data: string): Effect.Effect<void, TauriError>
  resize(cols: number, rows: number): Effect.Effect<void, TauriError>
}

/** Shells backed by Termy's PTY. Output arrives as raw bytes for xterm.js. */
export class TerminalHost extends Context.Service<
  TerminalHost,
  {
    open(options: {
      cwd: string
      cols: number
      rows: number
      onOutput: (bytes: Uint8Array) => void
      onExit: () => void
    }): Effect.Effect<TerminalSession, TauriError, Scope.Scope>
  }
>()("termy/services/TerminalHost") {
  static readonly layer = Layer.effect(
    TerminalHost,
    Effect.gen(function* () {
      const tauri = yield* Tauri
      const exits = new Map<number, () => void>()

      yield* tauri.listen<{ id: number }>("term://exit", ({ id }) => {
        exits.get(id)?.()
        exits.delete(id)
      })

      const open = Effect.fn("TerminalHost.open")(function* (options: {
        cwd: string
        cols: number
        rows: number
        onOutput: (bytes: Uint8Array) => void
        onExit: () => void
      }) {
        const output = new Channel<ArrayBuffer>()
        output.onmessage = (buffer) => options.onOutput(new Uint8Array(buffer))

        const id = yield* Effect.acquireRelease(
          tauri.invoke<number>("term_open", { cwd: options.cwd, cols: options.cols, rows: options.rows, output }),
          (id) =>
            tauri.invoke("term_close", { id }).pipe(
              Effect.ignore,
              Effect.ensuring(Effect.sync(() => exits.delete(id))),
            ),
        )
        exits.set(id, options.onExit)

        return {
          write: (data) => tauri.invoke<void>("term_write", { id, data }),
          resize: (cols, rows) => tauri.invoke<void>("term_resize", { id, cols, rows }),
        } satisfies TerminalSession
      })

      return TerminalHost.of({ open })
    }),
  ).pipe(Layer.provide(Tauri.layer))
}
