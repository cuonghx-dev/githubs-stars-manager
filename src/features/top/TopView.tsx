import { Link2, Star } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  rankTopRepos,
  TOP_REPOS,
  type TopRow,
  type TopSort,
} from "@/features/top/rank";
import type { Cluster, RepoNode } from "@/lib/graph-schema";
import type { MessageKey } from "@/lib/i18n";
import { useT } from "@/lib/i18n/use-i18n";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";

// Top view: the repos most worth a look, ranked by GitHub stars, by links in
// the similarity graph, or by both combined (see rank.ts). Clicking a repo
// selects it and centres the camera on it.

const SORTS: readonly { id: TopSort; label: MessageKey }[] = [
  { id: "score", label: "top.sortScore" },
  { id: "stars", label: "top.sortStars" },
  { id: "links", label: "top.sortLinks" },
];

interface TopViewProps {
  clusters: readonly Cluster[];
  nodes: readonly RepoNode[];
}

export function TopView({ clusters, nodes }: TopViewProps) {
  const t = useT();
  const [sort, setSort] = useState<TopSort>("score");
  const rows = useMemo(() => rankTopRepos(nodes, sort), [nodes, sort]);
  const colorOf = useMemo(
    () => new Map(clusters.map((c) => [c.id, c.color])),
    [clusters],
  );
  const selected = useAppStore((s) => s.selectedNode);
  const numberFormat = useMemo(
    () => new Intl.NumberFormat(t.locale, { notation: "compact" }),
    [t.locale],
  );

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
      aria-labelledby="top-title"
    >
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="top-title" className="text-lg font-semibold">
          {t("top.title")}
        </h2>
        <div
          className="flex items-center gap-1"
          role="group"
          aria-label={t("top.rankBy")}
        >
          <span className="mr-1 text-sm text-muted-foreground">
            {t("top.rankBy")}
          </span>
          {SORTS.map((s) => (
            <Button
              key={s.id}
              variant={sort === s.id ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={sort === s.id}
              onClick={() => setSort(s.id)}
            >
              {t(s.label)}
            </Button>
          ))}
        </div>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        {t("top.intro", { count: TOP_REPOS })}
      </p>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("top.empty")}</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {rows.map((row, i) => (
            <li key={row.repo.id}>
              <TopItem
                rank={i + 1}
                row={row}
                color={colorOf.get(row.repo.cluster) ?? "#a3a3a3"}
                format={numberFormat}
                active={selected === row.repo.id}
                onShow={() => showRepo(row.repo)}
              />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function TopItem({
  rank,
  row,
  color,
  format,
  active,
  onShow,
}: {
  rank: number;
  row: TopRow;
  color: string;
  format: Intl.NumberFormat;
  active: boolean;
  onShow: () => void;
}) {
  const t = useT();
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-baseline gap-2 rounded-lg border p-3 text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        active && "border-primary ring-1 ring-primary",
      )}
      onClick={onShow}
      title={t("common.selectRepoTitle")}
    >
      <span className="w-6 shrink-0 text-right text-sm text-muted-foreground tabular-nums">
        {rank}
      </span>
      <span
        className="size-2 shrink-0 self-center rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{row.repo.id}</span>
        {row.repo.description && (
          <span className="block truncate text-xs text-muted-foreground">
            {row.repo.description}
          </span>
        )}
      </span>
      <span className="flex shrink-0 gap-3 text-xs text-muted-foreground tabular-nums">
        <span className="flex items-center gap-1" title={t("top.starsTitle")}>
          <Star className="size-3" aria-hidden="true" />
          {format.format(row.stars)}
        </span>
        <span className="flex items-center gap-1" title={t("top.linksTitle")}>
          <Link2 className="size-3" aria-hidden="true" />
          {row.links}
        </span>
        <span
          className="hidden w-8 text-right sm:inline"
          title={t("top.scoreTitle")}
        >
          {Math.round(row.score * 100)}
        </span>
      </span>
    </button>
  );
}
