import { useCallback, useMemo } from "react";
import type { WalkActions } from "@/features/shortcuts/useKeyboardShortcuts";
import { pickWalkStep } from "@/features/walk/random-walk";
import type { RepoNode } from "@/lib/graph-schema";
import type { RepoGraph } from "@/lib/load-graph";
import { useAppStore } from "@/lib/store";

// Random walk moves (FR-65, T4.10) for the walk controls and the `r`, `[`,
// `]` shortcuts. Each move selects the node and centres the camera on it.
// `step` picks a weighted-random neighbour, or a random repo when nothing
// is selected.

export function useRandomWalk(
  graph: RepoGraph,
  nodes: readonly RepoNode[],
): WalkActions {
  const repoById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const step = useCallback(() => {
    const s = useAppStore.getState();
    const next = pickWalkStep({
      graph,
      repoById,
      filters: s.filters,
      current: s.selectedNode,
      previous:
        s.selectedNode !== null && s.walkHistory[s.walkIndex] === s.selectedNode
          ? (s.walkHistory[s.walkIndex - 1] ?? null)
          : null,
    });
    if (next === null) return;
    s.select(next);
    s.centerOn(next);
  }, [graph, repoById]);
  const back = useCallback(() => {
    const s = useAppStore.getState();
    const node = s.walkBack();
    if (node !== null) s.centerOn(node);
  }, []);
  const forward = useCallback(() => {
    const s = useAppStore.getState();
    const node = s.walkForward();
    if (node !== null) s.centerOn(node);
  }, []);
  return { step, back, forward };
}
