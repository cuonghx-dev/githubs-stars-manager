import { ChevronDown, Eye, EyeOff, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Cluster, RepoNode } from "@/lib/graph-schema";
import {
  filtersActive,
  useAppStore,
  type ArchivedFilter,
  type Filters,
} from "@/lib/store";
import { cn } from "@/lib/utils";

// Header filters (FR-51, T3.7): language and cluster multi-select, archived
// include/exclude/only, starred date range, and the hide/fade toggle for nodes
// that fail. All state lives in the store; GraphCanvas applies it in its
// reducers and NoResults (below) covers the empty case.

/** Label used for repos without a primary language. */
const NO_LANGUAGE = "";

interface Option<T> {
  value: T;
  label: string;
  count: number;
  color?: string;
}

interface FilterBarProps {
  nodes: readonly RepoNode[];
  clusters: readonly Cluster[];
  className?: string;
}

export function FilterBar({ nodes, clusters, className }: FilterBarProps) {
  const filters = useAppStore((s) => s.filters);
  const setFilters = useAppStore((s) => s.setFilters);
  const clearFilters = useAppStore((s) => s.clearFilters);

  const languageOptions = useMemo(() => languageOptionsOf(nodes), [nodes]);
  const clusterOptions = useMemo(
    () =>
      [...clusters]
        .sort((a, b) => b.size - a.size)
        .map<Option<number>>((c) => ({
          value: c.id,
          label: c.label,
          count: c.size,
          color: c.color,
        })),
    [clusters],
  );
  const active = filtersActive(filters);

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <MultiSelectFilter
        label="Language"
        options={languageOptions}
        selected={filters.languages}
        onChange={(languages) => setFilters({ languages })}
      />
      <MultiSelectFilter
        label="Cluster"
        options={clusterOptions}
        selected={filters.clusters}
        onChange={(ids) => setFilters({ clusters: ids })}
      />
      <ArchivedFilterButton
        value={filters.archived}
        onChange={(archived) => setFilters({ archived })}
      />
      <StarredFilterButton filters={filters} onChange={setFilters} />
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={
          filters.mode === "hide"
            ? "Unmatched repos hidden; show them faded"
            : "Unmatched repos faded; hide them"
        }
        title={
          filters.mode === "hide"
            ? "Hiding unmatched repos (click to fade)"
            : "Fading unmatched repos (click to hide)"
        }
        aria-pressed={filters.mode === "hide"}
        onClick={() =>
          setFilters({ mode: filters.mode === "hide" ? "fade" : "hide" })
        }
      >
        {filters.mode === "hide" ? <EyeOff /> : <Eye />}
      </Button>
      {active && (
        <Button variant="ghost" size="sm" onClick={clearFilters}>
          <X data-icon="inline-start" />
          Clear
        </Button>
      )}
    </div>
  );
}

function languageOptionsOf(nodes: readonly RepoNode[]): Option<string>[] {
  const counts = new Map<string, number>();
  for (const repo of nodes) {
    const lang = repo.language ?? NO_LANGUAGE;
    counts.set(lang, (counts.get(lang) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value, count]) => ({
      value,
      label: value === NO_LANGUAGE ? "No language" : value,
      count,
    }));
}

function FilterTrigger({
  label,
  badge,
  active,
}: {
  label: string;
  badge?: string;
  active: boolean;
}) {
  return (
    <PopoverTrigger asChild>
      <Button variant={active ? "secondary" : "outline"} size="sm">
        {label}
        {badge && (
          <span className="rounded-sm bg-background/70 px-1 text-xs tabular-nums">
            {badge}
          </span>
        )}
        <ChevronDown data-icon="inline-end" />
      </Button>
    </PopoverTrigger>
  );
}

function MultiSelectFilter<T extends string | number>({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: readonly Option<T>[];
  selected: readonly T[];
  onChange: (next: T[]) => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const visible =
    q === ""
      ? options
      : options.filter((o) => o.label.toLowerCase().includes(q));
  const chosen = new Set<T>(selected);

  const toggle = (value: T) => {
    onChange(
      chosen.has(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value],
    );
  };

  return (
    <Popover onOpenChange={(open) => !open && setQuery("")}>
      <FilterTrigger
        label={label}
        badge={selected.length > 0 ? String(selected.length) : undefined}
        active={selected.length > 0}
      />
      <PopoverContent className="flex w-64 flex-col gap-2 p-2">
        {options.length > 8 && (
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Filter ${label.toLowerCase()}…`}
            aria-label={`Filter ${label.toLowerCase()} options`}
          />
        )}
        <ul
          className="flex max-h-64 flex-col overflow-y-auto"
          aria-label={label}
        >
          {visible.map((o) => (
            <li key={String(o.value)}>
              <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 hover:bg-muted">
                <input
                  type="checkbox"
                  className="size-3.5 accent-primary"
                  checked={chosen.has(o.value)}
                  onChange={() => toggle(o.value)}
                />
                {o.color && (
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: o.color }}
                    aria-hidden="true"
                  />
                )}
                <span className="min-w-0 flex-1 truncate" title={o.label}>
                  {o.label}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {o.count}
                </span>
              </label>
            </li>
          ))}
          {visible.length === 0 && (
            <li className="px-2 py-1 text-muted-foreground">No matches</li>
          )}
        </ul>
        {selected.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() => onChange([])}
          >
            Clear {label.toLowerCase()}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

const ARCHIVED_OPTIONS: readonly { value: ArchivedFilter; label: string }[] = [
  { value: "include", label: "Include archived" },
  { value: "exclude", label: "Exclude archived" },
  { value: "only", label: "Only archived" },
];

function ArchivedFilterButton({
  value,
  onChange,
}: {
  value: ArchivedFilter;
  onChange: (value: ArchivedFilter) => void;
}) {
  return (
    <Popover>
      <FilterTrigger
        label="Archived"
        badge={value === "include" ? undefined : value}
        active={value !== "include"}
      />
      <PopoverContent className="w-52 p-2">
        <fieldset className="flex flex-col">
          <legend className="sr-only">Archived repos</legend>
          {ARCHIVED_OPTIONS.map((o) => (
            <label
              key={o.value}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 hover:bg-muted"
            >
              <input
                type="radio"
                name="archived-filter"
                className="size-3.5 accent-primary"
                checked={value === o.value}
                onChange={() => onChange(o.value)}
              />
              {o.label}
            </label>
          ))}
        </fieldset>
      </PopoverContent>
    </Popover>
  );
}

function StarredFilterButton({
  filters,
  onChange,
}: {
  filters: Filters;
  onChange: (patch: Partial<Filters>) => void;
}) {
  const from = filters.starredFrom?.slice(0, 10) ?? "";
  const to = filters.starredTo?.slice(0, 10) ?? "";
  const active = from !== "" || to !== "";
  const badge = active ? `${from || "…"} – ${to || "…"}` : undefined;

  return (
    <Popover>
      <FilterTrigger label="Starred" badge={badge} active={active} />
      <PopoverContent className="flex w-60 flex-col gap-2">
        <DateField
          label="From"
          value={from}
          max={to || undefined}
          onChange={(v) => onChange({ starredFrom: v || null })}
        />
        <DateField
          label="To"
          value={to}
          min={from || undefined}
          onChange={(v) => onChange({ starredTo: v || null })}
        />
        {active && (
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() => onChange({ starredFrom: null, starredTo: null })}
          >
            Clear dates
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function DateField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: string;
  min?: string;
  max?: string;
  onChange: (value: string) => void;
}): ReactNode {
  return (
    <label className="flex items-center gap-2">
      <span className="w-10 text-muted-foreground">{label}</span>
      <Input
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

/**
 * Overlay shown on the canvas when the filters leave no repo (FR-51).
 * Renders nothing while at least one repo matches.
 */
export function NoResults({ matchCount }: { matchCount: number }) {
  const active = useAppStore((s) => filtersActive(s.filters));
  const clearFilters = useAppStore((s) => s.clearFilters);
  if (!active || matchCount > 0) return null;
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
      <div
        className="pointer-events-auto flex flex-col items-center gap-3 rounded-lg border bg-background/95 p-6 text-center shadow-sm"
        role="status"
      >
        <p className="font-medium">No repos match these filters.</p>
        <Button variant="outline" size="sm" onClick={clearFilters}>
          <X data-icon="inline-start" />
          Clear filters
        </Button>
      </div>
    </div>
  );
}
