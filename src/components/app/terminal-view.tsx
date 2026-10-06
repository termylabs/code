import { FitAddon } from "@xterm/addon-fit"
import { WebLinksAddon } from "@xterm/addon-web-links"
import { Terminal } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"
import { openUrl } from "@tauri-apps/plugin-opener"
import { Effect, Exit, Scope } from "effect"
import { useEffect, useRef, useState } from "react"
import { runtime } from "@/lib/runtime"
import { TerminalHost } from "@/services/TerminalHost"

const theme = {
  background: "#0c0c0d",
  foreground: "#ece9e4",
  cursor: "#ffb224",
  cursorAccent: "#0c0c0d",
  selectionBackground: "rgba(255, 178, 36, 0.25)",
  black: "#1b1b1e",
  red: "#f0605a",
  green: "#4cc38a",
  yellow: "#ffb224",
  blue: "#82a9e8",
  magenta: "#c79bf2",
  cyan: "#6cc7d4",
  white: "#ece9e4",
  brightBlack: "#66645f",
  brightRed: "#ff7b74",
  brightGreen: "#6fd8a4",
  brightYellow: "#ffc75c",
  brightBlue: "#a3c0f0",
  brightMagenta: "#d9b8f7",
  brightCyan: "#8fdbe5",
  brightWhite: "#ffffff",
}

const DEFAULT_FONT_SIZE = 12.5
const MIN_FONT_SIZE = 8
const MAX_FONT_SIZE = 28
const FONT_SIZE_KEY = "terminal.fontSize"

const storedFontSize = () => {
  try {
    const value = Number(localStorage.getItem(FONT_SIZE_KEY))
    return value >= MIN_FONT_SIZE && value <= MAX_FONT_SIZE ? value : DEFAULT_FONT_SIZE
  } catch {
    return DEFAULT_FONT_SIZE
  }
}

const storeFontSize = (size: number) => {
  try {
    localStorage.setItem(FONT_SIZE_KEY, String(size))
  } catch {
    // Zoom still applies for this session.
  }
}

/** ⌘= and ⌘- step the font size, ⌘0 resets it. `null` for any other key. */
const zoomed = (event: KeyboardEvent, size: number): number | null => {
  if (!event.metaKey || event.altKey || event.ctrlKey) return null
  if (event.key === "=" || event.key === "+") return Math.min(size + 1, MAX_FONT_SIZE)
  if (event.key === "-") return Math.max(size - 1, MIN_FONT_SIZE)
  if (event.key === "0") return DEFAULT_FONT_SIZE
  return null
}

/** A shell in the project folder: Termy runs the PTY, xterm.js draws it. */
export const TerminalView = ({
  cwd,
  active,
  onTitleChange,
}: {
  cwd: string
  active: boolean
  /** The shell's window title (OSC 0/2), e.g. the running command. */
  onTitleChange?: (title: string) => void
}) => {
  const container = useRef<HTMLDivElement>(null)
  const titleListener = useRef(onTitleChange)
  titleListener.current = onTitleChange
  const fitRef = useRef<FitAddon | null>(null)
  const xtermRef = useRef<Terminal | null>(null)
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    const element = container.current
    if (!element) return

    const xterm = new Terminal({
      theme,
      fontFamily: "'Geist Mono Variable', ui-monospace, monospace",
      fontSize: storedFontSize(),
      lineHeight: 1.25,
      cursorBlink: true,
      cursorStyle: "bar",
      allowProposedApi: true,
      scrollback: 5000,
      macOptionIsMeta: true,
    })
    const fit = new FitAddon()
    xterm.loadAddon(fit)
    xterm.loadAddon(new WebLinksAddon((_event, uri) => void openUrl(uri)))
    xterm.attachCustomKeyEventHandler((event) => {
      const size = zoomed(event, xterm.options.fontSize ?? DEFAULT_FONT_SIZE)
      if (size === null) return true
      if (event.type === "keydown") {
        event.preventDefault()
        xterm.options.fontSize = size
        storeFontSize(size)
        fit.fit()
      }
      return false
    })
    xterm.onTitleChange((title) => titleListener.current?.(title))
    xterm.open(element)
    fit.fit()
    // A restart comes from a keypress in this terminal, so keep typing here.
    if (generation > 0) xterm.focus()
    fitRef.current = fit
    xtermRef.current = xterm

    const scope = runtime.runSync(Scope.make())
    let disposed = false
    let ended = false

    void runtime
      .runPromise(
        Effect.gen(function* () {
          const host = yield* TerminalHost
          const session = yield* host.open({
            cwd,
            cols: xterm.cols,
            rows: xterm.rows,
            onOutput: (bytes) => xterm.write(bytes),
            onExit: () => {
              ended = true
              xterm.write("\r\n\x1b[2mShell exited. Press any key to start a new one.\x1b[0m\r\n")
            },
          })
          const typing = xterm.onData((data) => {
            if (ended) setGeneration((value) => value + 1)
            else void runtime.runPromise(Effect.ignore(session.write(data)))
          })
          const resizing = xterm.onResize(({ cols, rows }) =>
            void runtime.runPromise(Effect.ignore(session.resize(cols, rows))),
          )
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              typing.dispose()
              resizing.dispose()
            }),
          )
        }).pipe(Scope.provide(scope)),
      )
      .catch((error: unknown) => {
        if (!disposed) xterm.write(`\r\n\x1b[31m${error instanceof Error ? error.message : String(error)}\x1b[0m\r\n`)
      })

    const observer = new ResizeObserver(() => {
      if (element.offsetWidth > 0) fit.fit()
    })
    observer.observe(element)

    return () => {
      disposed = true
      observer.disconnect()
      void runtime.runPromise(Scope.close(scope, Exit.void))
      xterm.dispose()
      xtermRef.current = null
      fitRef.current = null
    }
  }, [cwd, generation])

  useEffect(() => {
    if (!active) return
    fitRef.current?.fit()
    xtermRef.current?.focus()
  }, [active])

  return <div ref={container} className="selectable min-h-0 flex-1 px-3 pt-1 pb-2" />
}
