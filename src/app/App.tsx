import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { AppShell } from "@/app/AppShell";
import { GraphCanvas } from "@/features/graph/GraphCanvas";
import { formatFreshness } from "@/lib/format";
import {
  loadGraph,
  type LoadedGraph,
  type LoadGraphResult,
} from "@/lib/load-graph";

// App entry: loading → graph inside the PRD §6 shell (T3.1), or the
// empty/error state when graph.json is missing or invalid (FR-37, PRD §6 states).

type State = { status: "loading" } | LoadGraphResult;

export function App() {
  const [state, setState] = useState<State>({ status: "loading" });

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
  return (
    <AppShell
      freshness={formatFreshness(data.generatedAt, data.nodes.length)}
      freshnessTitle={data.generatedAt}
    >
      <GraphCanvas graph={graph} clusters={data.clusters} nodes={data.nodes} />
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
