import { useState } from "react";
import { edgeReason, type SimilarRepo } from "@/features/detail/reasons";
import { useT } from "@/lib/i18n/use-i18n";
import { useAppStore } from "@/lib/store";

// "Similar repos" list (FR-42): neighbours by weight with the reason from the
// edge signals. Clicking one selects it (continues the random walk).

/** Rows shown before "Show all". */
const INITIAL_LIMIT = 10;

export function SimilarList({ items }: { items: readonly SimilarRepo[] }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const select = useAppStore((s) => s.select);
  if (items.length === 0) return null;
  const shown = expanded ? items : items.slice(0, INITIAL_LIMIT);

  return (
    <section className="flex flex-col gap-1" aria-labelledby="similar-heading">
      <h3
        id="similar-heading"
        className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
      >
        {t("similar.heading", { count: items.length })}
      </h3>
      <ul className="flex flex-col">
        {shown.map(({ repo, weight, signals }) => (
          <li key={repo.id}>
            <button
              type="button"
              className="flex w-full flex-col items-start gap-0.5 rounded-md px-1.5 py-1 text-left transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
              title={t("similar.weight", { weight: weight.toFixed(2) })}
              onClick={() => select(repo.id)}
            >
              <span className="flex w-full min-w-0 items-baseline justify-between gap-2">
                <span className="truncate font-medium">
                  <span className="font-normal text-muted-foreground">
                    {repo.owner}/
                  </span>
                  {repo.name}
                </span>
                <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
                  {weight.toFixed(2)}
                </span>
              </span>
              <span className="text-xs text-muted-foreground">
                {edgeReason(signals, t)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {items.length > INITIAL_LIMIT && (
        <button
          type="button"
          className="self-start px-1.5 text-xs text-primary underline-offset-4 outline-none hover:underline focus-visible:underline"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded
            ? t("similar.showFewer")
            : t("similar.showAll", { count: items.length })}
        </button>
      )}
    </section>
  );
}
