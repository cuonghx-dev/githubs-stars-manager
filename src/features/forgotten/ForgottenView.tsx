import { ArrowDown, ArrowUp, ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";
import config from "../../../config/graph.config";
import { Button } from "@/components/ui/button";
import {
  DEFAULT_FORGOTTEN_SORT,
  findForgotten,
  sortForgotten,
  type ForgottenReason,
  type ForgottenSort,
  type ForgottenSortKey,
} from "@/features/forgotten/rules";
import { formatCount } from "@/features/detail/repo-details";
import { formatRelativeTime } from "@/lib/format";
import type { RepoNode } from "@/lib/graph-schema";
import type { MessageKey, Translator } from "@/lib/i18n";
import { useT } from "@/lib/i18n/use-i18n";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";

// Forgotten stars view (FR-62, T4.7): repos matching any rule from
// config/graph.config.ts, in a sortable table. Reason chips narrow the list to
// one rule. Clicking a repo selects it and centres the camera on it.

const rules = config.forgotten;

const REASON_IDS: readonly ForgottenReason[] = [
  "lonely",
  ...(rules.includeArchived ? (["archived"] as const) : []),
  "stale",
];

const REASON_LABEL: Record<ForgottenReason, MessageKey> = {
  lonely: "forgotten.lonely",
  archived: "forgotten.archived",
  stale: "forgotten.stale",
};

/** Plain-language rule behind each reason, from config/graph.config.ts. */
function reasonTitle(id: ForgottenReason, t: Translator): string {
  switch (id) {
    case "lonely":
      return t("forgotten.lonelyTitle", {
        days: rules.starredOlderThanDays,
        count: rules.maxDegree,
      });
    case "archived":
      return t("forgotten.archivedTitle");
    case "stale":
      return t("forgotten.staleTitle", { days: rules.pushedOlderThanDays });
  }
}

const COLUMNS: readonly {
  key: ForgottenSortKey;
  label: MessageKey;
  numeric: boolean;
}[] = [
  { key: "repo", label: "forgotten.col.repo", numeric: false },
  { key: "reasons", label: "forgotten.col.reasons", numeric: false },
  { key: "starred", label: "forgotten.col.starred", numeric: true },
  { key: "pushed", label: "forgotten.col.pushed", numeric: true },
  { key: "degree", label: "forgotten.col.degree", numeric: true },
  { key: "stars", label: "forgotten.col.stars", numeric: true },
];

export function ForgottenView({ nodes }: { nodes: readonly RepoNode[] }) {
  const t = useT();
  const reasons = REASON_IDS.map((id) => ({
    id,
    label: t(REASON_LABEL[id]),
    title: reasonTitle(id, t),
  }));
  // Snapshot "now" once per mount so the list does not shift while open.
  const [now] = useState(() => Date.now());
  const all = useMemo(() => findForgotten(nodes, now), [nodes, now]);
  const [reason, setReason] = useState<ForgottenReason | null>(null);
  const [sort, setSort] = useState<ForgottenSort>(DEFAULT_FORGOTTEN_SORT);
  const rows = useMemo(
    () =>
      sortForgotten(
        reason === null ? all : all.filter((r) => r.reasons.includes(reason)),
        sort,
      ),
    [all, reason, sort],
  );
  const counts = useMemo(() => {
    const c: Record<ForgottenReason, number> = {
      lonely: 0,
      archived: 0,
      stale: 0,
    };
    for (const row of all) for (const r of row.reasons) c[r] += 1;
    return c;
  }, [all]);
  const selected = useAppStore((s) => s.selectedNode);

  const showRepo = (repo: RepoNode) => {
    const { select, centerOn, setView } = useAppStore.getState();
    select(repo.id);
    setView("graph");
    // Let the canvas become visible before animating the camera.
    requestAnimationFrame(() => centerOn(repo.id));
  };

  const toggleSort = (key: ForgottenSortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, asc: !s.asc }
        : // Text sorts A→Z first; numbers biggest first.
          { key, asc: key === "repo" },
    );

  return (
    <section
      className="absolute inset-0 overflow-y-auto bg-background p-4"
      aria-labelledby="forgotten-title"
    >
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="forgotten-title" className="text-lg font-semibold">
          {t("forgotten.title")}
        </h2>
        <div
          className="flex flex-wrap items-center gap-1"
          role="group"
          aria-label={t("forgotten.show")}
        >
          <Button
            variant={reason === null ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={reason === null}
            onClick={() => setReason(null)}
          >
            {t("common.all")} <span className="tabular-nums">{all.length}</span>
          </Button>
          {reasons.map((r) => (
            <Button
              key={r.id}
              variant={reason === r.id ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={reason === r.id}
              title={r.title}
              onClick={() => setReason(reason === r.id ? null : r.id)}
            >
              {r.label} <span className="tabular-nums">{counts[r.id]}</span>
            </Button>
          ))}
        </div>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        {reasons.map((r) => `${r.label}: ${r.title.toLowerCase()}`).join(". ")}.
      </p>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("forgotten.empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                {COLUMNS.map((col) => {
                  const active = sort.key === col.key;
                  return (
                    <th
                      key={col.key}
                      scope="col"
                      aria-sort={
                        active
                          ? sort.asc
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                      className={cn(
                        "px-3 py-2 font-medium whitespace-nowrap",
                        col.numeric && "text-right",
                      )}
                    >
                      <button
                        type="button"
                        className={cn(
                          "inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                          active && "text-foreground",
                        )}
                        onClick={() => toggleSort(col.key)}
                      >
                        {t(col.label)}
                        {active &&
                          (sort.asc ? (
                            <ArrowUp className="size-3" aria-hidden="true" />
                          ) : (
                            <ArrowDown className="size-3" aria-hidden="true" />
                          ))}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.repo.id}
                  className={cn(
                    "border-t",
                    selected === row.repo.id && "bg-primary/10",
                  )}
                >
                  <td className="max-w-80 px-3 py-2">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className="min-w-0 truncate rounded-sm text-left font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        onClick={() => showRepo(row.repo)}
                        title={t("common.selectRepoTitle")}
                      >
                        {row.repo.id}
                      </button>
                      <a
                        href={row.repo.url}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 rounded-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        aria-label={t("common.openOnGithub", {
                          id: row.repo.id,
                        })}
                      >
                        <ExternalLink className="size-3.5" aria-hidden="true" />
                      </a>
                    </div>
                    {row.repo.description && (
                      <div className="truncate text-xs text-muted-foreground">
                        {row.repo.description}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {row.reasons.map((r) => (
                        <span
                          key={r}
                          className="rounded-sm bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                        >
                          {t(REASON_LABEL[r])}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td
                    className="px-3 py-2 text-right whitespace-nowrap text-muted-foreground tabular-nums"
                    title={row.repo.starredAt}
                  >
                    {formatRelativeTime(row.repo.starredAt, new Date(now), t)}
                  </td>
                  <td
                    className="px-3 py-2 text-right whitespace-nowrap text-muted-foreground tabular-nums"
                    title={row.repo.pushedAt}
                  >
                    {formatRelativeTime(row.repo.pushedAt, new Date(now), t)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {row.repo.metrics.degree}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatCount(row.repo.stars, t.locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
