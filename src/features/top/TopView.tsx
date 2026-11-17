import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Link2,
  Star,
} from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  clampPage,
  defaultAsc,
  pageCount,
  rankTopRepos,
  TOP_PAGE_SIZES,
  type TopRow,
  type TopSortKey,
} from "@/features/top/rank";
import { useTopListStore } from "@/features/top/top-list-store";
import type { Cluster, RepoNode } from "@/lib/graph-schema";
import type { MessageKey } from "@/lib/i18n";
import { useT } from "@/lib/i18n/use-i18n";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";

// Top view: every repo, ranked by GitHub stars, by links in the similarity
// graph, by both combined (see rank.ts), by name or by when it was starred,
// a page at a time. Clicking a repo selects it and centres the camera on it.

const SORTS: readonly { id: TopSortKey; label: MessageKey }[] = [
  { id: "score", label: "top.sortScore" },
  { id: "stars", label: "top.sortStars" },
  { id: "links", label: "top.sortLinks" },
  { id: "starred", label: "top.sortStarred" },
  { id: "name", label: "top.sortName" },
];

interface TopViewProps {
  clusters: readonly Cluster[];
  nodes: readonly RepoNode[];
}

export function TopView({ clusters, nodes }: TopViewProps) {
  const t = useT();
  const { sort, page: storedPage, pageSize } = useTopListStore();
  const { setSort, setPage, setPageSize } = useTopListStore.getState();
  const rows = useMemo(() => rankTopRepos(nodes, sort), [nodes, sort]);
  const pages = pageCount(rows.length, pageSize);
  const page = clampPage(storedPage, rows.length, pageSize);
  const offset = page * pageSize;
  const pageRows = rows.slice(offset, offset + pageSize);
  const colorOf = useMemo(
    () => new Map(clusters.map((c) => [c.id, c.color])),
    [clusters],
  );
  const selected = useAppStore((s) => s.selectedNode);
  const numberFormat = useMemo(
    () => new Intl.NumberFormat(t.locale, { notation: "compact" }),
    [t.locale],
  );
  const countFormat = useMemo(
    () => new Intl.NumberFormat(t.locale),
    [t.locale],
  );

  // Back to the top of the list whenever the visible page changes.
  const sectionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    sectionRef.current?.scrollTo({ top: 0 });
  }, [page, pageSize, sort]);

  const showRepo = (repo: RepoNode) => {
    const { select, centerOn, setView } = useAppStore.getState();
    select(repo.id);
    setView("graph");
    // Let the canvas become visible before animating the camera.
    requestAnimationFrame(() => centerOn(repo.id));
  };

  // Clicking the active key flips its direction; a new key starts in its
  // natural direction (text A→Z, numbers biggest first).
  const pickSort = (key: TopSortKey) =>
    setSort(
      key === sort.key
        ? { key, asc: !sort.asc }
        : { key, asc: defaultAsc(key) },
    );

  return (
    <section
      ref={sectionRef}
      className="absolute inset-0 overflow-y-auto bg-background p-4"
      aria-labelledby="top-title"
    >
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="top-title" className="text-lg font-semibold">
          {t("top.title")}
        </h2>
        <div
          className="flex flex-wrap items-center gap-1"
          role="group"
          aria-label={t("top.rankBy")}
        >
          <span className="mr-1 text-sm text-muted-foreground">
            {t("top.rankBy")}
          </span>
          {SORTS.map((s) => {
            const active = sort.key === s.id;
            return (
              <Button
                key={s.id}
                variant={active ? "secondary" : "ghost"}
                size="sm"
                aria-pressed={active}
                title={
                  active
                    ? t(sort.asc ? "top.sortAscTitle" : "top.sortDescTitle")
                    : undefined
                }
                onClick={() => pickSort(s.id)}
              >
                {t(s.label)}
                {active &&
                  (sort.asc ? (
                    <ArrowUp aria-hidden="true" />
                  ) : (
                    <ArrowDown aria-hidden="true" />
                  ))}
              </Button>
            );
          })}
        </div>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">{t("top.intro")}</p>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("top.empty")}</p>
      ) : (
        <>
          <ol className="flex flex-col gap-2" start={offset + 1}>
            {pageRows.map((row, i) => (
              <li key={row.repo.id}>
                <TopItem
                  rank={offset + i + 1}
                  row={row}
                  color={colorOf.get(row.repo.cluster) ?? "#a3a3a3"}
                  format={numberFormat}
                  active={selected === row.repo.id}
                  onShow={() => showRepo(row.repo)}
                />
              </li>
            ))}
          </ol>
          <nav
            className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground"
            aria-label={t("top.pagination")}
          >
            <span className="tabular-nums">
              {t("top.range", {
                from: countFormat.format(offset + 1),
                to: countFormat.format(offset + pageRows.length),
                total: countFormat.format(rows.length),
              })}
            </span>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1.5">
                {t("top.pageSize")}
                <select
                  className="h-7 rounded-md border bg-background px-1.5 text-foreground"
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                >
                  {TOP_PAGE_SIZES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={page === 0}
                  onClick={() => setPage(0)}
                  aria-label={t("top.firstPage")}
                  title={t("top.firstPage")}
                >
                  <ChevronsLeft aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={page === 0}
                  onClick={() => setPage(page - 1)}
                  aria-label={t("top.prevPage")}
                  title={t("top.prevPage")}
                >
                  <ChevronLeft aria-hidden="true" />
                </Button>
                <span className="px-1 tabular-nums" aria-live="polite">
                  {t("top.pageOf", { page: page + 1, pages })}
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={page >= pages - 1}
                  onClick={() => setPage(page + 1)}
                  aria-label={t("top.nextPage")}
                  title={t("top.nextPage")}
                >
                  <ChevronRight aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={page >= pages - 1}
                  onClick={() => setPage(pages - 1)}
                  aria-label={t("top.lastPage")}
                  title={t("top.lastPage")}
                >
                  <ChevronsRight aria-hidden="true" />
                </Button>
              </div>
            </div>
          </nav>
        </>
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
      <span className="w-8 shrink-0 text-right text-sm text-muted-foreground tabular-nums">
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
