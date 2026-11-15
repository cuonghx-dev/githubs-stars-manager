import { LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/app/AppShell";
import { BridgesView } from "@/features/bridges/BridgesView";
import { ClusterOverview } from "@/features/clusters/ClusterOverview";
import { DetailPanel } from "@/features/detail/DetailPanel";
import { FilterBar, NoResults } from "@/features/filters/FilterBar";
import { buildSimilarIndex } from "@/features/detail/reasons";
import { GraphCanvas } from "@/features/graph/GraphCanvas";
import { PathView } from "@/features/path/PathView";
import { SearchBox } from "@/features/search/SearchBox";
import { ShortcutDialog } from "@/features/shortcuts/ShortcutDialog";
import { useKeyboardShortcuts } from "@/features/shortcuts/useKeyboardShortcuts";
import { formatFreshness } from "@/lib/format";
import {
  loadGraph,
  type LoadedGraph,
  type LoadGraphResult,
} from "@/lib/load-graph";
import { applyTheme } from "@/lib/theme";
import { filtersActive, matchesFilters, useAppStore } from "@/lib/store";

// App entry: loading → graph inside the PRD §6 shell (T3.1), or the
// empty/error state when graph.json is missing or invalid (FR-37, PRD §6 states).

type State = { status: "loading" } | LoadGraphResult;

export function App() {
  const [state, setState] = useState<State>({ status: "loading" });
  const theme = useAppStore((s) => s.theme);

  // Apply the theme preference to <html> (NFR-8, T3.9); "system" keeps
  // following the OS scheme until the user picks light or dark.
  useEffect(() => applyTheme(theme), [theme]);

  useEffect(() => {
    let cancelled = false;
    void loadGraph().then((result) => {
      if (!cancelled) setState(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  switch (state.status) {
    case "loading":
      return <LoadingState />;
    case "ok":
      return <GraphView loaded={state.graph} />;
    default:
      return <EmptyState status={state.status} message={state.message} />;
  }
}

function GraphView({ loaded }: { loaded: LoadedGraph }) {
  const { data, graph } = loaded;
  const repoById = useMemo(
    () => new Map(data.nodes.map((n) => [n.id, n])),
    [data.nodes],
  );
  const similarIndex = useMemo(
    () => buildSimilarIndex(data.nodes, data.edges),
    [data.nodes, data.edges],
  );
  const selectedNode = useAppStore((s) => s.selectedNode);
  const view = useAppStore((s) => s.view);
  const filters = useAppStore((s) => s.filters);
  const matchCount = useMemo(
    () =>
      filtersActive(filters)
        ? data.nodes.filter((n) => matchesFilters(n, filters)).length
        : data.nodes.length,
    [data.nodes, filters],
  );
  const repo = selectedNode === null ? undefined : repoById.get(selectedNode);
  useKeyboardShortcuts(); // FR-38, T3.10

  // Narrow screens: selecting a node opens the detail bottom sheet (FR-34).
  const [detailOpen, setDetailOpen] = useState(false);
  useEffect(
    () =>
      useAppStore.subscribe((s, prev) => {
        if (s.selectedNode !== null && s.selectedNode !== prev.selectedNode) {
          setDetailOpen(true);
        }
      }),
    [],
  );

  return (
    <AppShell
      freshness={formatFreshness(data.generatedAt, data.nodes.length)}
      freshnessTitle={data.generatedAt}
      search={<SearchBox nodes={data.nodes} />}
      filters={<FilterBar nodes={data.nodes} clusters={data.clusters} />}
      detail={
        repo ? (
          <DetailPanel
            key={repo.id}
            repo={repo}
            clusters={data.clusters}
            similar={similarIndex.get(repo.id) ?? []}
          />
        ) : null
      }
      detailOpen={detailOpen}
      onDetailOpenChange={setDetailOpen}
    >
      <GraphCanvas graph={graph} clusters={data.clusters} nodes={data.nodes} />
      <NoResults matchCount={matchCount} />
      {view === "clusters" && (
        <ClusterOverview clusters={data.clusters} nodes={data.nodes} />
      )}
      {view === "bridges" && (
        <BridgesView
          clusters={data.clusters}
          nodes={data.nodes}
          edges={data.edges}
        />
      )}
      {view === "path" && (
        <PathView graph={graph} nodes={data.nodes} edges={data.edges} />
      )}
      <ShortcutDialog />
    </AppShell>
  );
}

function LoadingState() {
  return (
    <main
      className="flex min-h-svh items-center justify-center gap-2 bg-background text-muted-foreground"
      aria-busy="true"
    >
      <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
      <span>Loading graph…</span>
    </main>
  );
}

const EMPTY_TITLES: Record<Exclude<LoadGraphResult["status"], "ok">, string> = {
  missing: "No graph yet.",
  invalid: "graph.json is invalid.",
  "unsupported-version": "graph.json was built by a different version.",
};

function EmptyState({
  status,
  message,
}: {
  status: Exclude<LoadGraphResult["status"], "ok">;
  message: string;
}) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-3 bg-background p-6 text-center text-foreground">
      <h1 className="text-2xl font-semibold">Stars Graph</h1>
      <p className="text-muted-foreground">
        {EMPTY_TITLES[status]} Run{" "}
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm">
          pnpm data
        </code>{" "}
        to build it.
      </p>
      {status !== "missing" && (
        <pre className="max-h-64 max-w-full overflow-auto rounded-md bg-muted p-3 text-left font-mono text-xs whitespace-pre-wrap text-muted-foreground">
          {message}
        </pre>
      )}
    </main>
  );
}
