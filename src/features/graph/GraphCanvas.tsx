import "@react-sigma/core/lib/style.css";
import { SigmaContainer, useRegisterEvents, useSigma } from "@react-sigma/core";
import { useEffect, useMemo, useRef } from "react";
import type { SigmaOptions } from "sigma/types";
import { ClusterLabels } from "@/features/graph/ClusterLabels";
import { ConceptLayer } from "@/features/graph/ConceptLayer";
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
import {
  computePathHighlight,
  edgePathStyle,
  nodePathStyle,
  type PathHighlight,
} from "@/features/graph/path";
import {
  archivedNodeStyle,
  edgeKindStyle,
  GRAPH_PRIMITIVES,
  type HollowColors,
  type KindColors,
} from "@/features/graph/styles";
import type { Cluster, ConceptNode, RepoNode } from "@/lib/graph-schema";
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
// colour, 2-hop nodes are dimmed and the rest fade; Esc clears the selection
// (handled by the global shortcuts, T3.10).
// A hover highlight takes precedence over focus while the pointer is on a node.
//
// The concept layer (FR-73, T5.7) is an overlay toggled from the store; see
// ConceptLayer.tsx.

interface Palette extends FadeColors, FocusColors, KindColors, HollowColors {
  label: string;
}

// Fallbacks if the CSS tokens are missing; the real values live in
// src/index.css as --graph-* tokens (light in :root, dark in .dark).
const FALLBACK: Palette = {
  label: "#171717",
  edgeColor: "rgba(115, 115, 115, 0.35)",
  node: "#e5e5e5",
  edge: "rgba(115, 115, 115, 0.08)",
  dimEdge: "rgba(115, 115, 115, 0.18)",
  mentionEdge: "rgba(217, 119, 6, 0.6)",
  dependencyEdge: "rgba(37, 99, 235, 0.6)",
  hollow: "#ffffff",
};

/** Reads the sigma palette from the CSS tokens of the active theme. */
function currentPalette(): Palette {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) =>
    style.getPropertyValue(name).trim() || fallback;
  return {
    label: token("--graph-label", FALLBACK.label),
    edgeColor: token("--graph-edge", FALLBACK.edgeColor),
    node: token("--graph-node-faded", FALLBACK.node),
    edge: token("--graph-edge-faded", FALLBACK.edge),
    dimEdge: token("--graph-edge-dimmed", FALLBACK.dimEdge),
    mentionEdge: token("--graph-edge-mention", FALLBACK.mentionEdge),
    dependencyEdge: token("--graph-edge-dependency", FALLBACK.dependencyEdge),
    hollow: token("--graph-node-hollow", FALLBACK.hollow),
  };
}

/** Camera ratio used when centring a node from search (smaller = closer). */
const CENTER_ZOOM_RATIO = 0.35;

/** Margin around a fitted node set, as a factor of its extent. */
const FIT_PADDING = 1.25;
/** Closest zoom a fit may reach, so a tiny cluster is not blown up. */
const FIT_MIN_RATIO = 0.08;

type Options = Partial<SigmaOptions<NodeAttributes, EdgeAttributes>>;

// Edge kinds (FR-35) and hollow archived nodes (FR-36) come from styles.ts:
// the reducers apply the kind colour/path and the hollow ring first, so the
// hover, focus and filter fades still override the colour on top.

/** Mirror of the store slices the reducers read; mutated, never rendered. */
interface CanvasState {
  highlight: Highlight | null;
  selected: string | null;
  /** 1-hop / 2-hop rings around the selected node. */
  focus: Focus | null;
  /** Path finder route (T4.6); only while the Path view is open. */
  path: PathHighlight | null;
  /** Nodes that fail the filters; null when no filter is active. */
  filteredOut: ReadonlySet<string> | null;
  filterMode: FilterMode;
}

interface GraphCanvasProps {
  graph: RepoGraph;
  clusters: readonly Cluster[];
  nodes: readonly RepoNode[];
  /** Enrichment concept nodes (FR-73); empty when the graph has none. */
  concepts?: readonly ConceptNode[];
}

export function GraphCanvas({
  graph,
  clusters,
  nodes,
  concepts = [],
}: GraphCanvasProps) {
  const stateRef = useRef<CanvasState>({
    highlight: null,
    selected: null,
    focus: null,
    path: null,
    filteredOut: null,
    filterMode: "fade",
  });
  const paletteRef = useRef<Palette>(FALLBACK);

  const options = useMemo<Options>(
    () => ({
      primitives: GRAPH_PRIMITIVES,
      settings: {
        hideEdgesOnMove: graph.size > 2000,
        labelRenderedSizeThreshold: 8,
      },
      nodeReducer: (key, data, attrs) => {
        const palette = paletteRef.current;
        const { highlight, selected, focus, path, filteredOut, filterMode } =
          stateRef.current;
        const hollow = archivedNodeStyle(attrs.archived, palette);
        if (
          filteredOut?.has(key) &&
          key !== selected &&
          !path?.nodes.has(key)
        ) {
          return filterMode === "hide"
            ? { visibility: "hidden" }
            : { ...hollow, color: palette.node, labelVisibility: "hidden" };
        }
        return {
          ...hollow,
          labelColor: palette.label,
          ...(highlight !== null
            ? nodeHighlightStyle(key, highlight, palette)
            : path !== null
              ? nodePathStyle(key, path, palette)
              : nodeFocusStyle(key, data.color, focus, palette)),
          ...selectionStyle(key, selected),
        };
      },
      edgeReducer: (key, _data, attrs) => {
        const palette = paletteRef.current;
        const { highlight, focus, path, filteredOut, filterMode } =
          stateRef.current;
        const base = edgeKindStyle(attrs.kind, palette);
        if (
          filteredOut === null &&
          highlight === null &&
          focus === null &&
          path === null
        ) {
          return base;
        }
        const [source, target] = graph.extremities(key);
        if (
          !path?.edges.has(key) &&
          (filteredOut?.has(source) || filteredOut?.has(target))
        ) {
          return filterMode === "hide"
            ? { visibility: "hidden" }
            : { ...base, color: palette.edge };
        }
        return {
          ...base,
          ...(highlight !== null
            ? edgeHighlightStyle(key, highlight, palette)
            : path !== null
              ? edgePathStyle(key, path, palette)
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
      {concepts.length > 0 && (
        <ConceptLayer concepts={concepts} nodes={nodes} />
      )}
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
      if (
        prev === null ||
        state.view !== prev.view ||
        state.pathNodes !== prev.pathNodes
      ) {
        canvas.path = computePathHighlight(
          graph,
          state.view === "path" ? state.pathNodes : null,
        );
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

  // `f` (T3.10) asks to fit the whole graph: animate back to the default
  // camera state, which frames every node.
  useEffect(
    () =>
      useAppStore.subscribe((state, prev) => {
        if (state.fitGraphSeq === prev.fitGraphSeq) return;
        void sigma.getCamera().reset({ duration: 600 });
      }),
    [sigma],
  );

  // Re-read the palette whenever the `dark` class on <html> flips (NFR-8).
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
