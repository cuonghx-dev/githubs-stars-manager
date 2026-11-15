import { ExternalLink } from "lucide-react";
import { useMemo } from "react";
import config from "../../../config/graph.config";
import type { Cluster, Duplicate, RepoNode } from "@/lib/graph-schema";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";

// Duplicates view (FR-63, T4.8): repo pairs whose README/description
// embeddings have cosine >= config.duplicateThreshold, computed at build time
// over all pairs (T4.2). Highest cosine first. Clicking either side selects
// that repo and centres the camera on it.

interface DuplicatesViewProps {
  duplicates: readonly Duplicate[];
  nodes: readonly RepoNode[];
  clusters: readonly Cluster[];
}

interface DuplicateRow {
  key: string;
  a: RepoNode;
  b: RepoNode;
  cosine: number;
}

const percent = new Intl.NumberFormat("en", {
  style: "percent",
  maximumFractionDigits: 1,
});

export function DuplicatesView({
  duplicates,
  nodes,
  clusters,
}: DuplicatesViewProps) {
  const repoById = useMemo(
    () => new Map(nodes.map((n) => [n.id, n])),
    [nodes],
  );
  const clusterById = useMemo(
    () => new Map(clusters.map((c) => [c.id, c])),
    [clusters],
  );
  // Pairs whose repos are missing from nodes are skipped; ties keep a stable
  // order by repo id.
  const rows = useMemo(() => {
    const out: DuplicateRow[] = [];
    for (const [idA, idB, cosine] of duplicates) {
      const a = repoById.get(idA);
      const b = repoById.get(idB);
      if (!a || !b) continue;
      out.push({ key: `${idA}\u0000${idB}`, a, b, cosine });
    }
    return out.sort(
      (x, y) =>
        y.cosine - x.cosine ||
        x.a.id.localeCompare(y.a.id) ||
        x.b.id.localeCompare(y.b.id),
    );
  }, [duplicates, repoById]);
  const selected = useAppStore((s) => s.selectedNode);

  const showRepo = (repo: RepoNode) => {
    const { select, centerOn, setView } = useAppStore.getState();
    select(repo.id);
    setView("graph");
    // Let the canvas become visible before animating the camera.
    requestAnimationFrame(() => centerOn(repo.id));
  };

  return (
    <section
      className="absolute inset-0 overflow-y-auto bg-background p-4"
      aria-labelledby="duplicates-title"
    >
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="duplicates-title" className="text-lg font-semibold">
          Possible duplicates
        </h2>
        <span className="text-sm text-muted-foreground tabular-nums">
          {rows.length} {rows.length === 1 ? "pair" : "pairs"}
        </span>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Pairs whose descriptions and READMEs overlap, with semantic similarity
        of at least {percent.format(config.duplicateThreshold)}. Click either
        side to select it on the graph.
      </p>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No overlapping pairs. Every star covers its own ground.
        </p>
      ) : (
        <ol className="space-y-2">
          {rows.map((row) => (
            <li
              key={row.key}
              className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center"
            >
              <RepoSide
                repo={row.a}
                cluster={clusterById.get(row.a.cluster)}
                selected={selected === row.a.id}
                onSelect={() => showRepo(row.a)}
              />
              <div
                className="shrink-0 self-start rounded-sm bg-muted px-2 py-1 text-xs font-medium tabular-nums sm:self-center"
                title={`Cosine similarity ${row.cosine.toFixed(4)}`}
              >
                {percent.format(row.cosine)}
              </div>
              <RepoSide
                repo={row.b}
                cluster={clusterById.get(row.b.cluster)}
                selected={selected === row.b.id}
                onSelect={() => showRepo(row.b)}
                alignEnd
              />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function RepoSide({
  repo,
  cluster,
  selected,
  onSelect,
  alignEnd = false,
}: {
  repo: RepoNode;
  cluster: Cluster | undefined;
  selected: boolean;
  onSelect: () => void;
  alignEnd?: boolean;
}) {
  return (
    <div
      className={cn(
        "min-w-0 flex-1 rounded-md px-2 py-1",
        alignEnd && "sm:text-right",
        selected && "bg-primary/10",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-1",
          alignEnd && "sm:flex-row-reverse",
        )}
      >
        <button
          type="button"
          className="min-w-0 truncate rounded-sm text-left font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          onClick={onSelect}
          title="Select this repo and centre the camera on it"
        >
          {repo.id}
        </button>
        <a
          href={repo.url}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 rounded-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          aria-label={`Open ${repo.id} on GitHub`}
        >
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </a>
      </div>
      {repo.description && (
        <div className="truncate text-xs text-muted-foreground">
          {repo.description}
        </div>
      )}
      {cluster && (
        <div
          className={cn(
            "mt-1 flex items-center gap-1 text-xs text-muted-foreground",
            alignEnd && "sm:justify-end",
          )}
        >
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: cluster.color }}
            aria-hidden="true"
          />
          <span className="truncate">{cluster.label}</span>
        </div>
      )}
    </div>
  );
}
