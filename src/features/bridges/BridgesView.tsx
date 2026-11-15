import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  hasBetweenness,
  rankBridges,
  TOP_BRIDGES,
  type BridgeRow,
  type BridgeSort,
  type ConnectedCluster,
} from "@/features/bridges/rank";
import type { Cluster, RepoEdge, RepoNode } from "@/lib/graph-schema";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";

// Bridges view (FR-60, T4.5): top 20 repos by betweenness or bridge score,
// each with the clusters it links. Clicking a repo selects it and centres the
// camera on it; clicking a cluster chip filters the graph to the repo's own
// cluster plus that one and fits the camera to both, so the bridge is visible.

const betweennessFormat = new Intl.NumberFormat("en", {
  maximumSignificantDigits: 3,
});

interface BridgesViewProps {
  clusters: readonly Cluster[];
  nodes: readonly RepoNode[];
  edges: readonly RepoEdge[];
}

export function BridgesView({ clusters, nodes, edges }: BridgesViewProps) {
  const precomputed = useMemo(() => hasBetweenness(nodes), [nodes]);
  const [sort, setSort] = useState<BridgeSort>(
    precomputed ? "betweenness" : "bridgeScore",
  );
  const rows = useMemo(
    () => rankBridges(nodes, edges, clusters, sort),
    [nodes, edges, clusters, sort],
  );
  const selected = useAppStore((s) => s.selectedNode);

  const showRepo = (repo: RepoNode) => {
    const { select, centerOn, setView } = useAppStore.getState();
    select(repo.id);
    setView("graph");
    // Let the canvas become visible before animating the camera.
    requestAnimationFrame(() => centerOn(repo.id));
  };

  const showLink = (row: BridgeRow, cluster: ConnectedCluster) => {
    const { setFilters, select, fitNodes, setView } = useAppStore.getState();
    const ids = [...new Set([row.repo.cluster, cluster.id])];
    setFilters({ clusters: ids });
    select(row.repo.id);
    setView("graph");
    const members = nodes
      .filter((n) => ids.includes(n.cluster))
      .map((n) => n.id);
    requestAnimationFrame(() => fitNodes(members));
  };

  return (
    <section
      className="absolute inset-0 overflow-y-auto bg-background p-4"
      aria-labelledby="bridges-title"
    >
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="bridges-title" className="text-lg font-semibold">
          Bridges
        </h2>
        <div
          className="flex items-center gap-1"
          role="group"
          aria-label="Rank by"
        >
          <span className="mr-1 text-sm text-muted-foreground">Rank by</span>
          <Button
            variant={sort === "betweenness" ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={sort === "betweenness"}
            disabled={!precomputed}
            title={
              precomputed
                ? undefined
                : "graph.json has no betweenness yet; rerun pnpm build-graph"
            }
            onClick={() => setSort("betweenness")}
          >
            Betweenness
          </Button>
          <Button
            variant={sort === "bridgeScore" ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={sort === "bridgeScore"}
            onClick={() => setSort("bridgeScore")}
          >
            Bridge score
          </Button>
        </div>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Top {TOP_BRIDGES} repos that link clusters. Bridge score counts the
        distinct clusters among a repo&apos;s neighbours.
      </p>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No repo links two clusters yet.
        </p>
      ) : (
        <ol className="flex flex-col gap-2">
          {rows.map((row, i) => (
            <li key={row.repo.id}>
              <BridgeItem
                rank={i + 1}
                row={row}
                showBetweenness={precomputed}
                active={selected === row.repo.id}
                onShowRepo={() => showRepo(row.repo)}
                onShowLink={(cluster) => showLink(row, cluster)}
              />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function BridgeItem({
  rank,
  row,
  showBetweenness,
  active,
  onShowRepo,
  onShowLink,
}: {
  rank: number;
  row: BridgeRow;
  showBetweenness: boolean;
  active: boolean;
  onShowRepo: () => void;
  onShowLink: (cluster: ConnectedCluster) => void;
}) {
  return (
    <article
      className={cn(
        "flex flex-col gap-2 rounded-lg border p-3",
        active && "border-primary ring-1 ring-primary",
      )}
    >
      <button
        type="button"
        className="-m-1 flex items-baseline gap-2 rounded-md p-1 text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        onClick={onShowRepo}
        title="Select this repo and centre the camera on it"
      >
        <span className="w-6 shrink-0 text-right text-sm text-muted-foreground tabular-nums">
          {rank}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{row.repo.id}</span>
          {row.repo.description && (
            <span className="block truncate text-xs text-muted-foreground">
              {row.repo.description}
            </span>
          )}
        </span>
        <span className="flex shrink-0 gap-3 text-xs text-muted-foreground tabular-nums">
          {showBetweenness && (
            <span title="Normalised betweenness centrality">
              btw {betweennessFormat.format(row.betweenness)}
            </span>
          )}
          <span title="Distinct neighbour clusters">
            {row.bridgeScore} {row.bridgeScore === 1 ? "cluster" : "clusters"}
          </span>
        </span>
      </button>

      {row.clusters.length > 0 && (
        <ul
          className="flex flex-wrap gap-1 pl-8"
          aria-label={`Clusters ${row.repo.id} connects`}
        >
          {row.clusters.map((cluster) => (
            <li key={cluster.id}>
              <button
                type="button"
                className={cn(
                  "flex items-center gap-1.5 rounded-sm bg-muted px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  cluster.own && "font-medium text-foreground",
                )}
                onClick={() => onShowLink(cluster)}
                title={
                  cluster.own
                    ? "Own cluster: filter to it"
                    : "Filter to this cluster and the repo's own"
                }
              >
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: cluster.color }}
                  aria-hidden="true"
                />
                <span className="max-w-48 truncate">{cluster.label}</span>
                <span className="tabular-nums">· {cluster.links}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
