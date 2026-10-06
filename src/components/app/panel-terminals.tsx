import { useNavigate } from "@tanstack/react-router"
import { PlusIcon, SquareArrowOutUpRightIcon, XIcon } from "lucide-react"
import { useState } from "react"
import { useRun, useWorkspace } from "@/lib/runtime"
import { cn } from "@/lib/utils"
import { TerminalView } from "./terminal-view"

interface Shell {
  readonly id: number
  readonly title: string | null
}

/** Several shells in the side panel, each kept alive while another one shows. */
export const PanelTerminals = ({ cwd, name, active }: { cwd: string; name: string; active: boolean }) => {
  const workspace = useWorkspace()
  const run = useRun()
  const navigate = useNavigate()
  const [shells, setShells] = useState<ReadonlyArray<Shell>>([{ id: 1, title: null }])
  const [current, setCurrent] = useState(1)

  const add = () => {
    const id = Math.max(0, ...shells.map((shell) => shell.id)) + 1
    setShells([...shells, { id, title: null }])
    setCurrent(id)
  }

  const remove = (id: number) => {
    const index = shells.findIndex((shell) => shell.id === id)
    const rest = shells.filter((shell) => shell.id !== id)
    if (rest.length === 0) {
      // Closing the last shell starts a fresh one rather than leaving the tab empty.
      const fresh = Math.max(...shells.map((shell) => shell.id)) + 1
      setShells([{ id: fresh, title: null }])
      setCurrent(fresh)
      return
    }
    setShells(rest)
    if (id === current) setCurrent((rest[index] ?? rest[index - 1])!.id)
  }

  const openInTab = async () => {
    const id = await run(workspace.openTerminal(cwd, name))
    if (id) await navigate({ to: "/terminal/$terminalId", params: { terminalId: id } })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="no-scrollbar flex h-9 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-white/5 px-2">
        {shells.map((shell, index) => (
          <div
            key={shell.id}
            className={cn(
              "group/shell flex h-6 shrink-0 items-center rounded-md pr-0.5 pl-2 transition-colors",
              shell.id === current ? "bg-hover text-text" : "text-text-3 hover:text-text-2",
            )}
          >
            <button type="button" onClick={() => setCurrent(shell.id)} className="max-w-36 truncate text-xs">
              {shell.title ?? `Shell ${index + 1}`}
            </button>
            <button
              type="button"
              aria-label="Close shell"
              onClick={() => remove(shell.id)}
              className={cn(
                "hover:text-text ml-1 flex size-4 items-center justify-center rounded",
                shell.id !== current && "opacity-0 group-hover/shell:opacity-100",
              )}
            >
              <XIcon className="size-3" />
            </button>
          </div>
        ))}
        <button
          type="button"
          aria-label="New shell"
          onClick={add}
          className="text-text-3 hover:text-text hover:bg-hover flex size-6 shrink-0 items-center justify-center rounded-md"
        >
          <PlusIcon className="size-3.5" />
        </button>
        <span className="flex-1" />
        <button
          type="button"
          aria-label="Open a terminal tab"
          title="Open a terminal tab"
          onClick={() => void openInTab()}
          className="text-text-3 hover:text-text hover:bg-hover flex size-6 shrink-0 items-center justify-center rounded-md"
        >
          <SquareArrowOutUpRightIcon className="size-3.5" />
        </button>
      </div>
      {shells.map((shell) => (
        <div key={shell.id} className={cn("min-h-0 flex-1 flex-col", shell.id === current ? "flex" : "hidden")}>
          <TerminalView
            cwd={cwd}
            active={active && shell.id === current}
            onTitleChange={(title) =>
              setShells((all) => all.map((other) => (other.id === shell.id ? { ...other, title: title || null } : other)))
            }
          />
        </div>
      ))}
    </div>
  )
}
