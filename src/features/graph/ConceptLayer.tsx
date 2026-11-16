import { useSigma } from "@react-sigma/core";
import { useEffect, useMemo, useRef } from "react";
import { placeConcepts } from "@/features/graph/concept-positions";
import type { ConceptNode, RepoNode } from "@/lib/graph-schema";
import type { EdgeAttributes, NodeAttributes } from "@/lib/load-graph";
import { formatRepoCount } from "@/lib/format";
import { useT } from "@/lib/i18n/use-i18n";
import { useAppStore } from "@/lib/store";

// Concept layer (FR-73, T5.7). Enrichment concepts become extra nodes placed at
// the centroid of their repos, each linked to those repos. The layer is an
// overlay on the sigma canvas, not part of the graphology graph, so search,
// focus, path finding and the random walk keep working on repos only.
//
// Links are drawn on a 2D canvas and the concept nodes are DOM buttons; after
// every sigma render both are repositioned with `graphToViewport`, like the
// cluster labels, so pan and zoom never re-render React. Clicking a concept
// fits the camera to its repos. Hidden unless toggled on in the store.

const FALLBACK_LINK = "rgba(124, 58, 237, 0.35)";

export function ConceptLayer({
  concepts,
  nodes,
}: {
  concepts: readonly ConceptNode[];
  nodes: readonly RepoNode[];
}) {
  const t = useT();
  const sigma = useSigma<NodeAttributes, EdgeAttributes>();
  const show = useAppStore((s) => s.showConcepts);
  const fitNodes = useAppStore((s) => s.fitNodes);
  const placed = useMemo(
    () => placeConcepts(concepts, nodes),
    [concepts, nodes],
  );
  const repoPos = useMemo(
    () => new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y }])),
    [nodes],
  );
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!show || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const update = () => {
      const { width, height } = sigma.getDimensions();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(width * dpr);
      const h = Math.round(height * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle =
        getComputedStyle(document.documentElement)
          .getPropertyValue("--graph-edge-concept")
          .trim() || FALLBACK_LINK;
      ctx.lineWidth = 1;
      ctx.beginPath();
      placed.forEach((c, i) => {
        const centre = sigma.graphToViewport({ x: c.x, y: c.y });
        for (const id of c.repos) {
          const p = repoPos.get(id);
          if (!p) continue;
          const end = sigma.graphToViewport(p);
          ctx.moveTo(centre.x, centre.y);
          ctx.lineTo(end.x, end.y);
        }
        const el = labelRefs.current[i];
        if (el) {
          el.style.transform = `translate(${centre.x.toFixed(1)}px, ${centre.y.toFixed(1)}px) translate(-50%, -50%)`;
        }
      });
      ctx.stroke();
    };

    update();
    sigma.on("afterRender", update);
    return () => {
      sigma.off("afterRender", update);
    };
  }, [sigma, show, placed, repoPos]);

  if (!show || placed.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <canvas
        ref={canvasRef}
        className="absolute top-0 left-0"
        aria-hidden="true"
      />
      <ul aria-label={t("detail.concepts")}>
        {placed.map((c, i) => (
          <li key={c.id}>
            <button
              type="button"
              ref={(el) => {
                labelRefs.current[i] = el;
              }}
              className="pointer-events-auto absolute top-0 left-0 max-w-40 truncate rounded-full border border-violet-500/60 bg-background/85 px-2 py-0.5 text-[11px] font-medium text-violet-700 shadow-sm will-change-transform hover:bg-violet-500/15 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none dark:text-violet-300"
              title={t("concepts.nodeTitle", {
                label: c.label,
                repos: formatRepoCount(c.repos.length, t),
              })}
              onClick={() => fitNodes(c.repos)}
            >
              {c.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
