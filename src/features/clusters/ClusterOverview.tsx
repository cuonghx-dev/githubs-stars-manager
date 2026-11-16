import { Star, X } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  summarizeClusters,
  type ClusterSummary,
} from "@/features/clusters/summarize";
import { formatCount } from "@/features/detail/repo-details";
import { formatRepoCount } from "@/lib/format";
import type { Cluster, RepoNode } from "@/lib/graph-schema";
import { useT } from "@/lib/i18n/use-i18n";
import { EMPTY_FILTERS, useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";

// Cluster overview (FR-66, T3.8): one card per cluster with its size, label,
// top languages and top 5 repos by stars. Clicking a cluster narrows the
// filters to it, fits the camera to its members and returns to the graph;
// clicking a repo selects it and centres the camera on it.

interface ClusterOverviewProps {
  clusters: readonly Cluster[];
  nodes: readonly RepoNode[];
}

export function ClusterOverview({ clusters, nodes }: ClusterOverviewProps) {
  const t = useT();
  const summaries = useMemo(
    () => summarizeClusters(clusters, nodes, t),
    [clusters, nodes, t],
  );
  const activeClusters = useAppStore((s) => s.filters.clusters);

  const showCluster = (summary: ClusterSummary) => {
    const { setFilters, fitNodes, setView } = useAppStore.getState();
    setFilters({ clusters: [summary.id] });
    setView("graph");
    // Let the canvas become visible before animating the camera.
    requestAnimationFrame(() => fitNodes(summary.memberIds));
  };

  const showRepo = (repo: RepoNode) => {
    const { select, centerOn, setView } = useAppStore.getState();
    select(repo.id);
    setView("graph");
    requestAnimationFrame(() => centerOn(repo.id));
  };

  return (
    <section
      className="absolute inset-0 overflow-y-auto bg-background p-4"
      aria-labelledby="cluster-overview-title"
    >
      <div className="mb-4 flex items-baseline justify-between gap-2">
        <h2 id="cluster-overview-title" className="text-lg font-semibold">
          {t("clusters.title")}
        </h2>
        <div className="flex items-center gap-2">
          <p className="text-sm text-muted-foreground">
            {t("count.clusters", { count: summaries.length })} ·{" "}
            {formatRepoCount(nodes.length, t)}
          </p>
          {activeClusters.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                useAppStore
                  .getState()
                  .setFilters({ clusters: EMPTY_FILTERS.clusters })
              }
            >
              <X data-icon="inline-start" />
              {t("clusters.clearFilter")}
            </Button>
          )}
        </div>
      </div>

      {summaries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("clusters.empty")}</p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3">
          {summaries.map((summary) => (
            <li key={summary.id}>
              <ClusterCard
                summary={summary}
                active={activeClusters.includes(summary.id)}
                onShowCluster={() => showCluster(summary)}
                onShowRepo={showRepo}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ClusterCard({
  summary,
  active,
  onShowCluster,
  onShowRepo,
}: {
  summary: ClusterSummary;
  active: boolean;
  onShowCluster: () => void;
  onShowRepo: (repo: RepoNode) => void;
}) {
  const t = useT();
  return (
    <article
      className={cn(
        "flex h-full flex-col gap-2 rounded-lg border p-3",
        active && "border-primary ring-1 ring-primary",
      )}
    >
      <button
        type="button"
        className="-m-1 flex items-start gap-2 rounded-md p-1 text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        onClick={onShowCluster}
        title={t("clusters.cardTitle")}
      >
        <span
          className="mt-1.5 size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: summary.color }}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{summary.label}</span>
          <span className="block text-xs text-muted-foreground">
            {formatRepoCount(summary.size, t)}
          </span>
        </span>
      </button>

      {summary.languages.length > 0 && (
        <ul
          className="flex flex-wrap gap-1"
          aria-label={t("clusters.topLanguages")}
        >
          {summary.languages.map((lang) => (
            <li
              key={lang.name}
              className="rounded-sm bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
            >
              {lang.name} · {lang.count}
            </li>
          ))}
        </ul>
      )}

      <ol className="flex flex-col text-sm" aria-label={t("clusters.topRepos")}>
        {summary.topRepos.map((repo) => (
          <li key={repo.id}>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-sm px-1 py-0.5 text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              onClick={() => onShowRepo(repo)}
            >
              <span className="min-w-0 flex-1 truncate">{repo.id}</span>
              <span className="flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground tabular-nums">
                <Star className="size-3" aria-hidden="true" />
                {formatCount(repo.stars, t.locale)}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </article>
  );
}
