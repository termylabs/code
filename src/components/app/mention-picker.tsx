import type * as acp from "@agentclientprotocol/sdk"
import {
  BoxIcon,
  FileCodeIcon,
  FileIcon,
  FileJsonIcon,
  FileTerminalIcon,
  FileTextIcon,
  ImageIcon,
  type LucideIcon,
  SettingsIcon,
  SquareSlashIcon,
} from "lucide-react"
import { useEffect, useRef } from "react"
import type { AgentId } from "@/domain/agents"
import { type Mention, type QueryKind, rankByName, rankFiles, rankSkills, type Skill, skillTitle } from "@/domain/mentions"
import { cn } from "@/lib/utils"

const MAX_ROWS = 50

const extensionIcons: ReadonlyArray<readonly [RegExp, LucideIcon]> = [
  [/\.(toml|ya?ml|ini|env|lock|config)$|^\.|rc$/, SettingsIcon],
  [/\.json5?$/, FileJsonIcon],
  [/\.(md|mdx|txt|rst)$/, FileTextIcon],
  [/\.(png|jpe?g|gif|webp|svg|ico|icns)$/, ImageIcon],
  [/\.(sh|bash|zsh|fish)$/, FileTerminalIcon],
  [/\.(tsx?|jsx?|mjs|cjs|rs|go|py|rb|swift|kt|java|c|cc|cpp|h|hpp|cs|css|scss|html|vue|svelte|sql|lua|zig)$/, FileCodeIcon],
]

export const iconFor = (fileName: string) =>
  extensionIcons.find(([pattern]) => pattern.test(fileName.toLowerCase()))?.[1] ?? FileIcon

export interface PickerRow {
  readonly key: string
  readonly icon: LucideIcon
  readonly title: string
  readonly detail: string
  readonly trailing?: string
  /** Replaces the typed query, trigger included. */
  readonly insert: string
  /** Files and skills also go to the agent as links; commands are just text. */
  readonly mention?: Mention
}

/** Rows for the current query. Files are relative to `cwd`; mentions carry absolute paths. */
export const pickerRows = (
  kind: QueryKind,
  query: string,
  cwd: string,
  files: ReadonlyArray<string>,
  skills: ReadonlyArray<Skill>,
  commands: ReadonlyArray<acp.AvailableCommand>,
): ReadonlyArray<PickerRow> => {
  if (kind === "command") {
    return rankByName(commands, query, MAX_ROWS).map((command) => ({
      key: command.name,
      icon: SquareSlashIcon,
      title: `/${command.name}`,
      detail: command.description,
      trailing: command.input?.hint,
      insert: `/${command.name}`,
    }))
  }
  if (kind === "file") {
    return rankFiles(files, query, MAX_ROWS).map((file) => {
      const slash = file.lastIndexOf("/")
      const name = file.slice(slash + 1)
      return {
        key: file,
        icon: iconFor(name),
        title: name,
        detail: slash > 0 ? file.slice(0, slash) : "",
        insert: `@${file}`,
        mention: { kind, name, path: `${cwd}/${file}`, token: `@${file}` },
      }
    })
  }
  return rankSkills(skills, query, MAX_ROWS).map((skill) => ({
    key: skill.path,
    icon: BoxIcon,
    title: skillTitle(skill.name),
    detail: skill.description,
    trailing: skill.scope === "project" ? "Project" : "Global",
    insert: `$${skill.name}`,
    mention: { kind, name: skill.name, path: skill.path, token: `$${skill.name}` },
  }))
}

export const emptyText = (kind: QueryKind, agentId: AgentId | undefined, loading: boolean) => {
  if (kind === "command") return loading ? "Waiting for the agent's commands" : "No matching commands"
  if (loading) return kind === "file" ? "Loading files" : "Loading skills"
  if (kind === "file") return "No matching files"
  return agentId === "claude" ? "No matching skills in .claude/skills" : "No matching skills"
}

/** The list above the composer while typing an `@` or `$` mention. */
export const MentionPicker = ({
  rows,
  active,
  empty,
  onActiveChange,
  onSelect,
}: {
  rows: ReadonlyArray<PickerRow>
  active: number
  empty: string
  onActiveChange: (index: number) => void
  onSelect: (row: PickerRow) => void
}) => {
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    list.current?.children[active]?.scrollIntoView({ block: "nearest" })
  }, [active])

  return (
    <div className="animate-in fade-in-0 slide-in-from-bottom-1 bg-raised absolute inset-x-0 bottom-full z-20 mb-2 overflow-hidden rounded-2xl p-1 shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_0_0_1px_rgb(255_255_255/0.06),0_16px_40px_rgb(0_0_0/0.5)] duration-150">
      {rows.length === 0 ? (
        <p className="text-text-3 flex h-9 items-center px-3 text-[13px]">{empty}</p>
      ) : (
        <div ref={list} role="listbox" className="no-scrollbar flex max-h-[296px] flex-col overflow-y-auto">
          {rows.map((row, index) => {
            const Icon = row.icon
            return (
              <button
                key={row.key}
                type="button"
                role="option"
                aria-selected={index === active}
                // Keep focus (and the caret) in the textarea.
                onMouseDown={(event) => event.preventDefault()}
                onMouseMove={() => index !== active && onActiveChange(index)}
                onClick={() => onSelect(row)}
                className={cn(
                  "flex h-9 shrink-0 items-center gap-2.5 rounded-xl px-3 text-left",
                  index === active && "bg-white/6",
                )}
              >
                <Icon className={cn("size-4 shrink-0", index === active ? "text-text" : "text-text-2")} strokeWidth={1.6} />
                <span className={cn("shrink-0 text-[13px]", index === active ? "text-text" : "text-text-2")}>
                  {row.title}
                </span>
                <span className="text-text-3 min-w-0 flex-1 truncate text-[13px]">{row.detail}</span>
                {row.trailing && <span className="text-text-3 shrink-0 text-xs">{row.trailing}</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
