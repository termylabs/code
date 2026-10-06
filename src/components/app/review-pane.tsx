import { MultiFileDiff } from "@pierre/diffs/react"
import { XIcon } from "lucide-react"
import type { CSSProperties, ReactNode } from "react"
import { type FileChange, totals } from "@/domain/changes"
import { relativePath } from "@/domain/timeline"
import { Diffstat } from "./primitives"

/** Pierre's dark theme, seated on the window's instrument black. */
const diffStyle = {
  "--diffs-bg": "var(--bg)",
  "--diffs-font-family": "'Geist Mono Variable', ui-monospace, monospace",
  "--diffs-header-font-family": "'Geist Variable', system-ui, sans-serif",
  "--diffs-font-size": "11.5px",
  "--diffs-line-height": "20px",
} as CSSProperties

const FileDiff = ({ change, cwd }: { change: FileChange; cwd: string }) => {
  const name = relativePath(change.path, cwd)
  return (
    <MultiFileDiff
      oldFile={{ name, contents: change.oldText, cacheKey: `${change.path}:old:${change.oldText.length}` }}
      newFile={{ name, contents: change.newText, cacheKey: `${change.path}:new:${change.newText.length}` }}
      options={{
        theme: "pierre-dark",
        themeType: "dark",
        diffStyle: "unified",
        overflow: "wrap",
        lineDiffType: "word",
        stickyHeader: true,
      }}
      style={diffStyle}
      className="selectable border-b border-white/5"
    />
  )
}

const ChangeList = ({ changes, cwd }: { changes: ReadonlyArray<FileChange>; cwd: string }) => (
  <div className="min-h-0 flex-1 overflow-y-auto">
    {changes.length === 0 ? (
      <p className="text-text-3 px-4 pt-2 text-[13px] leading-5">Files the agent edits in this thread show up here.</p>
    ) : (
      changes.map((change) => <FileDiff key={change.path} change={change} cwd={cwd} />)
    )}
  </div>
)

export const ReviewPane = ({
  changes,
  cwd,
  onClose,
  tabs,
  children,
}: {
  changes: ReadonlyArray<FileChange>
  cwd: string
  onClose: () => void
  /** Tab switcher rendered in the header. */
  tabs?: ReactNode
  /** Replaces the diff list, e.g. with the terminal. */
  children?: ReactNode
}) => {
  const sum = totals(changes)
  return (
    <aside className="surface animate-in fade-in-0 slide-in-from-right-2 flex h-full w-[548px] shrink-0 flex-col overflow-hidden rounded-xl duration-200">
      <header data-tauri-drag-region className="flex h-12 shrink-0 items-center gap-3 pr-2.5 pl-2.5">
        {tabs ?? <span className="text-text pl-1.5 text-[13px] font-semibold tracking-[-0.01em]">Changes</span>}
        <span className="flex-1" />
        {sum.files > 0 && (
          <>
            <span className="text-text-3 text-xs">
              {sum.files} {sum.files === 1 ? "file" : "files"}
            </span>
            <Diffstat additions={sum.additions} deletions={sum.deletions} />
          </>
        )}
        <button
          type="button"
          aria-label="Close panel"
          onClick={onClose}
          className="text-text-3 hover:text-text hover:bg-hover flex size-7 items-center justify-center rounded-lg"
        >
          <XIcon className="size-3.5" />
        </button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{children ?? <ChangeList changes={changes} cwd={cwd} />}</div>
    </aside>
  )
}

ReviewPane.Changes = ChangeList
