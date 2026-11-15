import { useSigma } from "@react-sigma/core";
import { useEffect, useMemo, useRef } from "react";
import {
  CLUSTER_LABEL_MIN_RATIO,
  clusterCentroids,
} from "@/features/graph/cluster-centroids";
import type { Cluster, RepoNode } from "@/lib/graph-schema";
import type { EdgeAttributes, NodeAttributes } from "@/lib/load-graph";

// Cluster labels at their centroids (FR-32). The labels are plain DOM nodes
// over the canvas; after every sigma render their positions are recomputed
// with `graphToViewport` and written straight to `style.transform`, so pan and
// zoom never re-render React. Labels only show while zoomed out: once the
// camera is close enough, sigma's own node labels take over.

export function ClusterLabels({
  clusters,
  nodes,
}: {
  clusters: readonly Cluster[];
  nodes: readonly RepoNode[];
}) {
  const sigma = useSigma<NodeAttributes, EdgeAttributes>();
  const centroids = useMemo(
    () => clusterCentroids(clusters, nodes),
    [clusters, nodes],
  );
  const layerRef = useRef<HTMLDivElement>(null);
  const labelRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;

    const update = () => {
      const visible = sigma.getCamera().ratio >= CLUSTER_LABEL_MIN_RATIO;
      layer.style.visibility = visible ? "visible" : "hidden";
      if (!visible) return;
      centroids.forEach((c, i) => {
        const el = labelRefs.current[i];
        if (!el) return;
        const { x, y } = sigma.graphToViewport({ x: c.x, y: c.y });
        el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
      });
    };

    update();
    sigma.on("afterRender", update);
    return () => {
      sigma.off("afterRender", update);
    };
  }, [sigma, centroids]);

  return (
    <div
      ref={layerRef}
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden="true"
    >
      {centroids.map((c, i) => (
        <div
          key={c.id}
          ref={(el) => {
            labelRefs.current[i] = el;
          }}
          className="absolute top-0 left-0 max-w-48 truncate rounded-sm bg-background/75 px-1.5 py-0.5 text-xs font-semibold text-foreground shadow-sm will-change-transform"
          style={{ borderLeft: `3px solid ${c.color}` }}
          title={c.label}
        >
          {c.label}
        </div>
      ))}
    </div>
  );
}
