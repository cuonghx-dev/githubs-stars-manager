import "@react-sigma/core/lib/style.css";
import { SigmaContainer, useRegisterEvents, useSigma } from "@react-sigma/core";
import { useEffect, useMemo, useRef } from "react";
import type { SigmaOptions } from "sigma/types";
import {
  computeHighlight,
  edgeHighlightStyle,
  nodeHighlightStyle,
  type FadeColors,
  type Highlight,
} from "@/features/graph/highlight";
import type {
  EdgeAttributes,
  NodeAttributes,
  RepoGraph,
} from "@/lib/load-graph";

// Sigma canvas (FR-30, FR-31, FR-33). Positions come precomputed from
// build-graph; sigma only renders, pans and zooms. Hover state lives in a ref
// and the reducers read it, so hovering does not re-render React.

interface Palette extends FadeColors {
  label: string;
  edgeColor: string;
}

const LIGHT: Palette = {
  label: "#171717",
  edgeColor: "rgba(115, 115, 115, 0.35)",
  node: "#e5e5e5",
  edge: "rgba(115, 115, 115, 0.08)",
};

const DARK: Palette = {
  label: "#fafafa",
  edgeColor: "rgba(163, 163, 163, 0.3)",
  node: "#3f3f46",
  edge: "rgba(163, 163, 163, 0.06)",
};

function currentPalette(): Palette {
  return document.documentElement.classList.contains("dark") ? DARK : LIGHT;
}

type Options = Partial<SigmaOptions<NodeAttributes, EdgeAttributes>>;

export function GraphCanvas({ graph }: { graph: RepoGraph }) {
  const highlightRef = useRef<Highlight | null>(null);
  const paletteRef = useRef<Palette>(LIGHT);

  const options = useMemo<Options>(
    () => ({
      settings: {
        hideEdgesOnMove: graph.size > 2000,
        labelRenderedSizeThreshold: 8,
      },
      nodeReducer: (key) => {
        const palette = paletteRef.current;
        return {
          labelColor: palette.label,
          ...nodeHighlightStyle(key, highlightRef.current, palette),
        };
      },
      edgeReducer: (key) => {
        const palette = paletteRef.current;
        return {
          color: palette.edgeColor,
          ...edgeHighlightStyle(key, highlightRef.current, palette),
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
        highlightRef={highlightRef}
        paletteRef={paletteRef}
      />
    </SigmaContainer>
  );
}

function GraphEvents({
  graph,
  highlightRef,
  paletteRef,
}: {
  graph: RepoGraph;
  highlightRef: React.RefObject<Highlight | null>;
  paletteRef: React.RefObject<Palette>;
}) {
  const sigma = useSigma<NodeAttributes, EdgeAttributes>();
  const registerEvents = useRegisterEvents();

  useEffect(() => {
    registerEvents({
      enterNode: ({ node }) => {
        highlightRef.current = computeHighlight(graph, node);
        sigma.refresh({ skipIndexation: true });
      },
      leaveNode: () => {
        highlightRef.current = null;
        sigma.refresh({ skipIndexation: true });
      },
    });
  }, [registerEvents, sigma, graph, highlightRef]);

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
