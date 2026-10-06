import { createRootRoute, Outlet } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { CommandPalette } from "@/components/app/command-palette"
import { Sidebar } from "@/components/app/sidebar"
import { TabStrip } from "@/components/app/tab-strip"
import { TerminalTabs } from "@/components/app/terminal-tabs"

const RootLayout = () => {
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setSearching((open) => !open)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return (
    <div className="bg-panel text-text flex h-full">
      <Sidebar onSearch={() => setSearching(true)} />
      <main className="flex min-w-0 flex-1 flex-col py-2 pr-2">
        <TabStrip />
        <div className="flex min-h-0 flex-1 gap-2">
          <Outlet />
          <TerminalTabs />
        </div>
      </main>
      <CommandPalette open={searching} onOpenChange={setSearching} />
    </div>
  )
}

export const Route = createRootRoute({ component: RootLayout })
