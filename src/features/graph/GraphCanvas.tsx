import "@react-sigma/core/lib/style.css";
import { SigmaContainer, useRegisterEvents, useSigma } from "@react-sigma/core";
import { useEffect, useMemo, useRef } from "react";
import type { SigmaOptions } from "sigma/types";
import { ClusterLabels } from "@/features/graph/ClusterLabels";
import {
  computeFocus,
  edgeFocusStyle,
  nodeFocusStyle,
  type Focus,
  type FocusColors,
} from "@/features/graph/focus";
import {
  computeHighlight,
  edgeHighlightStyle,
  nodeHighlightStyle,
  selectionStyle,
  type FadeColors,
  type Highlight,
} from "@/features/graph/highlight";
import type { Cluster, RepoNode } from "@/lib/graph-schema";
import {
  filtersActive,
  matchesFilters,
  useAppStore,
  type AppState,
  type FilterMode,
  type Filters,
} from "@/lib/store";
import type {
  EdgeAttributes,
  NodeAttributes,
  RepoGraph,
} from "@/lib/load-graph";

// Sigma canvas (FR-30..FR-33). Positions and cluster colours come precomputed
// from build-graph; sigma only renders, pans and zooms. Hover, selection and
// filters live in the zustand store (T3.2); a store subscription mirrors them
// into a ref that the reducers read and calls sigma.refresh(), so none of it
// re-renders React. Node labels show once a node is large enough on screen
// (sigma's label threshold, i.e. on zoom), on hover, and on selection; cluster
// labels sit at centroids while zoomed out (FR-32).
//
// Focus mode (FR-34): the selected node and its 1-hop neighbours stay at full
// colour, 2-hop nodes are dimmed and the rest fade; Esc clears the selection.
// A hover highlight takes precedence over focus while the pointer is on a node.

interface Palette extends FadeColors, FocusColors {
  label: string;
  edgeColor: string;
}

const LIGHT: Palette = {
  label: "#171717",
  edgeColor: "rgba(115, 115, 115, 0.35)",
  node: "#e5e5e5",
  edge: "rgba(115, 115, 115, 0.08)",
  dimEdge: "rgba(115, 115, 115, 0.18)",
};

const DARK: Palette = {
  label: "#fafafa",
  edgeColor: "rgba(163, 163, 163, 0.3)",
  node: "#3f3f46",
  edge: "rgba(163, 163, 163, 0.06)",
  dimEdge: "rgba(163, 163, 163, 0.15)",
};

function currentPalette(): Palette {
  return document.documentElement.classList.contains("dark") ? DARK : LIGHT;
}

/** Camera ratio used when centring a node from search (smaller = closer). */
const CENTER_ZOOM_RATIO = 0.35;

/** Margin around a fitted node set, as a factor of its extent. */
const FIT_PADDING = 1.25;
/** Closest zoom a fit may reach, so a tiny cluster is not blown up. */
const FIT_MIN_RATIO = 0.08;

type Options = Partial<SigmaOptions<NodeAttributes, EdgeAttributes>>;

/** Mirror of the store slices the reducers read; mutated, never rendered. */
interface CanvasState {
  highlight: Highlight | null;
  selected: string | null;
  /** 1-hop / 2-hop rings around the selected node. */
  focus: Focus | null;
  /** Nodes that fail the filters; null when no filter is active. */
  filteredOut: ReadonlySet<string> | null;
  filterMode: FilterMode;
}

interface GraphCanvasProps {
  graph: RepoGraph;
  clusters: readonly Cluster[];
  nodes: readonly RepoNode[];
}

export function GraphCanvas({ graph, clusters, nodes }: GraphCanvasProps) {
  const stateRef = useRef<CanvasState>({
    highlight: null,
    selected: null,
    focus: null,
    filteredOut: null,
    filterMode: "fade",
  });
  const paletteRef = useRef<Palette>(LIGHT);

  const options = useMemo<Options>(
    () => ({
      settings: {
        hideEdgesOnMove: graph.size > 2000,
        labelRenderedSizeThreshold: 8,
      },
      nodeReducer: (key, data) => {
        const palette = paletteRef.current;
        const { highlight, selected, focus, filteredOut, filterMode } =
          stateRef.current;
        if (filteredOut?.has(key) && key !== selected) {
          return filterMode === "hide"
            ? { visibility: "hidden" }
            : { color: palette.node, labelVisibility: "hidden" };
        }
        return {
          labelColor: palette.label,
          ...(highlight !== null
            ? nodeHighlightStyle(key, highlight, palette)
            : nodeFocusStyle(key, data.color, focus, palette)),
          ...selectionStyle(key, selected),
        };
      },
      edgeReducer: (key) => {
        const palette = paletteRef.current;
        const { highlight, focus, filteredOut, filterMode } = stateRef.current;
        if (filteredOut === null && highlight === null && focus === null) {
          return { color: palette.edgeColor };
        }
        const [source, target] = graph.extremities(key);
        if (filteredOut?.has(source) || filteredOut?.has(target)) {
          return filterMode === "hide"
            ? { visibility: "hidden" }
            : { color: palette.edge };
        }
        return {
          color: palette.edgeColor,
          ...(highlight !== null
            ? edgeHighlightStyle(key, highlight, palette)
            : edgeFocusStyle(source, target, focus, palette)),
        };
      },
    }),
    [graph],
  );

  return (
    <SigmaContainer<NodeAttributes, EdgeAttributes>
      graph={graph}
      options={options}
      className="!h-full !w-full !bg-transparent"
    >
      <GraphEvents
        graph={graph}
        nodes={nodes}
        stateRef={stateRef}
        paletteRef={paletteRef}
      />
      <ClusterLabels clusters={clusters} nodes={nodes} />
    </SigmaContainer>
  );
}

function computeFilteredOut(
  nodes: readonly RepoNode[],
  filters: Filters,
): ReadonlySet<string> | null {
  if (!filtersActive(filters)) return null;
  const out = new Set<string>();
  for (const repo of nodes) {
    if (!matchesFilters(repo, filters)) out.add(repo.id);
  }
  return out;
}

function GraphEvents({
  graph,
  nodes,
  stateRef,
  paletteRef,
}: {
  graph: RepoGraph;
  nodes: readonly RepoNode[];
  stateRef: React.RefObject<CanvasState>;
  paletteRef: React.RefObject<Palette>;
}) {
  const sigma = useSigma<NodeAttributes, EdgeAttributes>();
  const registerEvents = useRegisterEvents();

  // UI → store. Sigma events only write to the store; the subscription below
  // is the single path from state to the canvas.
  useEffect(() => {
    const { hover, toggleSelect, select } = useAppStore.getState();
    registerEvents({
      enterNode: ({ node }) => hover(node),
      leaveNode: () => hover(null),
      clickNode: ({ node }) => toggleSelect(node),
      clickStage: () => select(null),
    });
  }, [registerEvents]);

  // Esc leaves focus mode (FR-34). Skip when another handler already used it
  // (e.g. a dialog or sheet closing) so one press does one thing.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const { selectedNode, select } = useAppStore.getState();
      if (selectedNode !== null) select(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Store → refs → sigma.refresh(), without re-rendering React.
  useEffect(() => {
    const sync = (state: AppState, prev: AppState | null) => {
      const canvas = stateRef.current;
      let dirty = false;
      if (prev === null || state.hoveredNode !== prev.hoveredNode) {
        canvas.highlight = computeHighlight(graph, state.hoveredNode);
        dirty = true;
      }
      if (prev === null || state.selectedNode !== prev.selectedNode) {
        canvas.selected =
          state.selectedNode !== null && graph.hasNode(state.selectedNode)
            ? state.selectedNode
            : null;
        canvas.focus = computeFocus(graph, canvas.selected);
        dirty = true;
      }
      if (prev === null || state.filters !== prev.filters) {
        canvas.filteredOut = computeFilteredOut(nodes, state.filters);
        canvas.filterMode = state.filters.mode;
        dirty = true;
      }
      if (dirty) sigma.refresh({ skipIndexation: true });
    };
    sync(useAppStore.getState(), null);
    return useAppStore.subscribe(sync);
  }, [sigma, graph, nodes, stateRef]);

  // Search picks (T3.6) ask to centre a node: animate the camera there and
  // zoom in, but never zoom out if the user is already closer.
  useEffect(
    () =>
      useAppStore.subscribe((state, prev) => {
        const request = state.centerRequest;
        if (request === null || request === prev.centerRequest) return;
        const display = sigma.getNodeDisplayData(request.node);
        if (!display) return;
        const camera = sigma.getCamera();
        void camera.animate(
          {
            x: display.x,
            y: display.y,
            ratio: Math.min(camera.ratio, CENTER_ZOOM_RATIO),
          },
          { duration: 600 },
        );
      }),
    [sigma],
  );

  // Cluster overview (T3.8) asks to fit a node set: animate the camera to the
  // centre of their bounding box with a ratio that keeps them all in view.
  useEffect(
    () =>
      useAppStore.subscribe((state, prev) => {
        const request = state.fitRequest;
        if (request === null || request === prev.fitRequest) return;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const node of request.nodes) {
          const display = sigma.getNodeDisplayData(node);
          if (!display) continue;
          minX = Math.min(minX, display.x);
          minY = Math.min(minY, display.y);
          maxX = Math.max(maxX, display.x);
          maxY = Math.max(maxY, display.y);
        }
        if (minX === Infinity) return;
        const extent = Math.max(maxX - minX, maxY - minY) * FIT_PADDING;
        void sigma.getCamera().animate(
          {
            x: (minX + maxX) / 2,
            y: (minY + maxY) / 2,
            ratio: Math.min(1, Math.max(FIT_MIN_RATIO, extent)),
          },
          { duration: 600 },
        );
      }),
    [sigma],
  );

  // Follow the `dark` class on <html> (set from the system scheme, NFR-8).
  useEffect(() => {
    const apply = () => {
      paletteRef.current = currentPalette();
      sigma.refresh({ skipIndexation: true });
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, [sigma, paletteRef]);

  return null;
}
