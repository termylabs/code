import { ChevronLeftIcon, ChevronRightIcon, FolderIcon, FolderOpenIcon, RotateCwIcon } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import type { FileChange } from "@/domain/changes"
import { Effect, Option } from "effect"
import { runtime, useRun, useWorkspace } from "@/lib/runtime"
import { cn } from "@/lib/utils"
import { iconFor } from "./mention-picker"

/** Lines shown in a preview; enough to read, cheap to render. */
const PREVIEW_LINES = 4000

interface Folder {
  readonly folders: Map<string, Folder>
  readonly files: Array<string>
}

const buildTree = (paths: ReadonlyArray<string>): Folder => {
  const root: Folder = { folders: new Map(), files: [] }
  for (const path of paths) {
    const parts = path.split("/")
    let folder = root
    for (const part of parts.slice(0, -1)) {
      let next = folder.folders.get(part)
      if (!next) {
        next = { folders: new Map(), files: [] }
        folder.folders.set(part, next)
      }
      folder = next
    }
    folder.files.push(parts.at(-1)!)
  }
  return root
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" })

const Row = ({
  depth,
  onClick,
  children,
  className,
}: {
  depth: number
  onClick: () => void
  children: React.ReactNode
  className?: string
}) => (
  <button
    type="button"
    onClick={onClick}
    style={{ paddingLeft: 10 + depth * 14 }}
    className={cn("hover:bg-hover/60 flex h-7 shrink-0 items-center gap-2 rounded-md pr-2.5 text-left", className)}
  >
    {children}
  </button>
)

const FolderRows = ({
  folder,
  path,
  depth,
  open,
  onToggle,
  onOpenFile,
  changed,
}: {
  folder: Folder
  path: string
  depth: number
  open: ReadonlySet<string>
  onToggle: (path: string) => void
  onOpenFile: (path: string) => void
  changed: ReadonlySet<string>
}) => (
  <>
    {[...folder.folders.keys()].sort(byName).map((name) => {
      const full = path ? `${path}/${name}` : name
      const expanded = open.has(full)
      const Icon = expanded ? FolderOpenIcon : FolderIcon
      const hasChanges = [...changed].some((file) => file.startsWith(`${full}/`))
      return (
        <div key={name} className="flex flex-col">
          <Row depth={depth} onClick={() => onToggle(full)}>
            <ChevronRightIcon
              className={cn("text-text-3 -ml-1 size-3 shrink-0 transition-transform duration-150", expanded && "rotate-90")}
            />
            <Icon className="text-text-3 size-3.5 shrink-0" strokeWidth={1.6} />
            <span className="text-text-2 min-w-0 flex-1 truncate text-[13px]">{name}</span>
            {hasChanges && <span className="bg-amber size-1.5 shrink-0 rounded-full" />}
          </Row>
          {expanded && (
            <FolderRows
              folder={folder.folders.get(name)!}
              path={full}
              depth={depth + 1}
              open={open}
              onToggle={onToggle}
              onOpenFile={onOpenFile}
              changed={changed}
            />
          )}
        </div>
      )
    })}
    {[...folder.files].sort(byName).map((name) => {
      const full = path ? `${path}/${name}` : name
      const Icon = iconFor(name)
      const isChanged = changed.has(full)
      return (
        <Row key={name} depth={depth} onClick={() => onOpenFile(full)}>
          {/* Lines up with folder names past the chevron. */}
          <span className="-ml-1 size-3 shrink-0" />
          <Icon className="text-text-3 size-3.5 shrink-0" strokeWidth={1.6} />
          <span className={cn("min-w-0 flex-1 truncate text-[13px]", isChanged ? "text-amber" : "text-text-2")}>
            {name}
          </span>
        </Row>
      )
    })}
  </>
)

const Preview = ({ cwd, path, onBack }: { cwd: string; path: string; onBack: () => void }) => {
  const workspace = useWorkspace()
  const [content, setContent] = useState<string | null | undefined>(undefined)

  // Binary files fail to read as text; that's a "can't preview", not an error toast.
  useEffect(() => {
    let current = true
    setContent(undefined)
    void runtime
      .runPromise(Effect.option(workspace.readFile(`${cwd}/${path}`)))
      .then((text) => current && setContent(Option.getOrNull(text)))
    return () => {
      current = false
    }
  }, [cwd, path, workspace])

  const lines = content?.split("\n") ?? []
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-white/5 px-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to files"
          className="text-text-3 hover:text-text hover:bg-hover flex size-6 items-center justify-center rounded-md"
        >
          <ChevronLeftIcon className="size-3.5" />
        </button>
        <span className="text-text-2 min-w-0 truncate text-xs">{path}</span>
      </div>
      {content === undefined ? null : content === null ? (
        <p className="text-text-3 px-4 pt-3 text-[13px]">This file can't be previewed.</p>
      ) : (
        <div className="selectable min-h-0 flex-1 overflow-auto py-2 font-mono text-[11.5px] leading-5">
          {lines.slice(0, PREVIEW_LINES).map((line, index) => (
            <div key={index} className="flex">
              <span className="text-text-3 w-12 shrink-0 pr-3 text-right select-none">{index + 1}</span>
              <span className="text-text-2 pr-4 whitespace-pre">{line}</span>
            </div>
          ))}
          {lines.length > PREVIEW_LINES && (
            <p className="text-text-3 px-4 pt-2 font-sans text-xs">Showing the first {PREVIEW_LINES} lines.</p>
          )}
        </div>
      )}
    </div>
  )
}

/** The project's files, minus anything gitignored. Files changed in this thread are highlighted. */
export const FileTree = ({
  cwd,
  changes,
  refreshKey,
}: {
  cwd: string
  changes: ReadonlyArray<FileChange>
  /** Reloads the listing when it changes, e.g. after each turn. */
  refreshKey: unknown
}) => {
  const workspace = useWorkspace()
  const run = useRun()
  const [files, setFiles] = useState<ReadonlyArray<string> | null>(null)
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set())
  const [preview, setPreview] = useState<string | null>(null)
  const [reloads, setReloads] = useState(0)

  useEffect(() => {
    let current = true
    void run(workspace.listFiles(cwd)).then((list) => current && list && setFiles(list))
    return () => {
      current = false
    }
  }, [cwd, refreshKey, reloads, run, workspace])

  const tree = useMemo(() => buildTree(files ?? []), [files])
  const changed = useMemo(
    () => new Set(changes.map((change) => (change.path.startsWith(`${cwd}/`) ? change.path.slice(cwd.length + 1) : change.path))),
    [changes, cwd],
  )

  if (preview) return <Preview cwd={cwd} path={preview} onBack={() => setPreview(null)} />

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-white/5 pr-2 pl-4">
        <span className="text-text-3 text-xs">{files ? `${files.length} files` : "Loading"}</span>
        <button
          type="button"
          onClick={() => setReloads((count) => count + 1)}
          aria-label="Reload files"
          className="text-text-3 hover:text-text hover:bg-hover flex size-6 items-center justify-center rounded-md"
        >
          <RotateCwIcon className="size-3" />
        </button>
      </div>
      <div className="no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto p-1.5">
        <FolderRows
          folder={tree}
          path=""
          depth={0}
          open={open}
          onToggle={(path) =>
            setOpen((current) => {
              const next = new Set(current)
              if (next.has(path)) next.delete(path)
              else next.add(path)
              return next
            })
          }
          onOpenFile={setPreview}
          changed={changed}
        />
      </div>
    </div>
  )
}
