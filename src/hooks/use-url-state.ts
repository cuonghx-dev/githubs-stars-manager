import { useEffect } from "react";
import { useAppStore, type AppState } from "@/lib/store";
import { decodeUrlState, encodeUrlState } from "@/lib/url-state";

// URL state (FR-52, T4.11): restore filters, selection and view from the
// query string once the graph is loaded, then mirror every change back with
// `history.replaceState` (no new history entries, no reloads).

/**
 * Apply the current URL to the store. Call once, before the graph view
 * mounts, so the canvas's first sync already sees the restored state.
 * A `node` that is not in the graph is ignored.
 */
export function restoreUrlState(hasNode: (id: string) => boolean): void {
  const state = decodeUrlState(window.location.search);
  const store = useAppStore.getState();
  useAppStore.setState({ view: state.view, filters: state.filters });
  if (state.selectedNode !== null && hasNode(state.selectedNode)) {
    store.select(state.selectedNode);
  }
}

/** Keep the query string in sync with the store while mounted. */
export function useUrlStateSync(): void {
  useEffect(() => {
    const write = (s: AppState) => {
      const { pathname, search, hash } = window.location;
      const next = encodeUrlState(
        { view: s.view, selectedNode: s.selectedNode, filters: s.filters },
        search,
      );
      if (next !== search) {
        window.history.replaceState(
          window.history.state,
          "",
          `${pathname}${next}${hash}`,
        );
      }
    };
    write(useAppStore.getState());
    return useAppStore.subscribe((s, prev) => {
      if (
        s.view !== prev.view ||
        s.selectedNode !== prev.selectedNode ||
        s.filters !== prev.filters
      ) {
        write(s);
      }
    });
  }, []);
}
