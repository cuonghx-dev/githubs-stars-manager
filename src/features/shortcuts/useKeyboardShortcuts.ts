import { useEffect, useRef } from "react";
import { resolveShortcut } from "@/features/shortcuts/shortcuts";
import { useAppStore } from "@/lib/store";

/** Random-walk moves; they need the graph, so the caller supplies them. */
export interface WalkActions {
  step: () => void;
  back: () => void;
  forward: () => void;
}

/**
 * Global keyboard shortcuts (FR-38, T3.10). Actions only write to the store;
 * the search box, canvas and dialog react to it. Keys pressed inside an open
 * dialog or sheet are left to it, and an Esc another handler already used
 * (search box, dialog, sheet) is skipped so one press does one thing.
 */
export function useKeyboardShortcuts(walk?: WalkActions): void {
  const walkRef = useRef(walk);
  useEffect(() => {
    walkRef.current = walk;
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (insideDialog(event.target)) return;
      const action = resolveShortcut(event);
      if (action === null) return;
      const state = useAppStore.getState();
      switch (action) {
        case "focus-search":
          event.preventDefault(); // keep "/" out of the input
          state.focusSearch();
          break;
        case "fit":
          event.preventDefault();
          state.fitGraph();
          break;
        case "help":
          event.preventDefault();
          state.setShortcutsOpen(true);
          break;
        case "walk-step":
        case "walk-back":
        case "walk-forward": {
          const actions = walkRef.current;
          if (!actions) break;
          event.preventDefault();
          if (action === "walk-step") actions.step();
          else if (action === "walk-back") actions.back();
          else actions.forward();
          break;
        }
        case "clear":
          // Leave focus mode first (FR-34); a second Esc leaves a view
          // overlay such as the cluster overview.
          if (state.selectedNode !== null) state.select(null);
          else if (state.view !== "graph") state.setView("graph");
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

function insideDialog(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("[role=dialog]") !== null;
}
