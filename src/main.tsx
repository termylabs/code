import { createRouter, RouterProvider } from "@tanstack/react-router"
import { Effect } from "effect"
import React from "react"
import ReactDOM from "react-dom/client"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { runtime, WorkspaceProvider } from "@/lib/runtime"
import { Workspace } from "@/services/Workspace"
import { routeTree } from "./routeTree.gen"
import "./index.css"

const router = createRouter({ routeTree, defaultPreload: false })

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

window.addEventListener("beforeunload", () => void runtime.dispose())

void runtime
  .runPromise(Effect.gen(function* () {
    return yield* Workspace
  }))
  .then((workspace) =>
    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
      <React.StrictMode>
        <WorkspaceProvider workspace={workspace}>
          <TooltipProvider delay={300}>
            <RouterProvider router={router} />
            <Toaster position="bottom-right" />
          </TooltipProvider>
        </WorkspaceProvider>
      </React.StrictMode>,
    ),
  )
