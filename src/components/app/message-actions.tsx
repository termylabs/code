import { CheckIcon, CopyIcon, RefreshCwIcon } from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

const COPIED_RESET_MS = 1500

const ActionButton = ({ label, onClick, children }: { label: string; onClick?: () => void; children: ReactNode }) => (
  <Tooltip>
    <TooltipTrigger
      aria-label={label}
      onClick={onClick}
      className="text-text-3 hover:text-text hover:bg-hover flex size-7 items-center justify-center rounded-lg transition-colors duration-150 [&_svg]:size-3.5"
    >
      {children}
    </TooltipTrigger>
    <TooltipContent side="bottom" sideOffset={6} className="rounded-md px-2 py-1 text-[11px] font-medium">
      {label}
    </TooltipContent>
  </Tooltip>
)

export const MessageActions = ({
  text,
  onRetry,
  className,
  children,
}: {
  text: string
  onRetry?: () => void
  className?: string
  /** More actions after copy and retry. */
  children?: ReactNode
}) => {
  const [copied, setCopied] = useState(false)
  const reset = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(reset.current), [])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      return
    }
    setCopied(true)
    window.clearTimeout(reset.current)
    reset.current = window.setTimeout(() => setCopied(false), COPIED_RESET_MS)
  }

  return (
    <div className={cn("-ml-1.5 flex items-center gap-0.5", className)}>
      <ActionButton label={copied ? "Copied" : "Copy"} onClick={() => void copy()}>
        {copied ? <CheckIcon /> : <CopyIcon />}
      </ActionButton>
      {onRetry && (
        <ActionButton label="Retry" onClick={onRetry}>
          <RefreshCwIcon />
        </ActionButton>
      )}
      {children}
    </div>
  )
}
