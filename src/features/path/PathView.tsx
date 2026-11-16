import { ArrowDownUp } from "lucide-react";
import { useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  findPath,
  indexEdges,
  pathSteps,
  type PathStep,
} from "@/features/path/find-path";
import { RepoPicker } from "@/features/path/RepoPicker";
import { edgeReason } from "@/features/detail/reasons";
import { buildSearchIndex } from "@/features/search/search-index";
import type { RepoEdge, RepoNode } from "@/lib/graph-schema";
import { useT } from "@/lib/i18n/use-i18n";
import type { RepoGraph } from "@/lib/load-graph";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";

// Path finder (FR-61, T4.6): pick two repos, get the cheapest route between
// them (Dijkstra, hop cost `1 − w + 1e-6`). The route is highlighted on the
// canvas, which stays visible behind this floating panel, and listed step by
// step with the reason each pair is linked. Disconnected repos get a message.

interface PathViewProps {
  graph: RepoGraph;
  nodes: readonly RepoNode[];
  edges: readonly RepoEdge[];
}

export function PathView({ graph, nodes, edges }: PathViewProps) {
  const t = useT();
  const index = useMemo(() => buildSearchIndex(nodes), [nodes]);
  const repoById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const edgeByPair = useMemo(() => indexEdges(edges), [edges]);
  const from = useAppStore((s) => s.pathFrom);
  const to = useAppStore((s) => s.pathTo);
  const selected = useAppStore((s) => s.selectedNode);

  // Opening the view with a selected repo and no start uses it as the start.
  useEffect(() => {
    const { pathFrom, pathTo, selectedNode, setPathEnds } =
      useAppStore.getState();
    if (pathFrom === null && selectedNode !== null && selectedNode !== pathTo) {
      setPathEnds({ from: selectedNode });
    }
  }, []);

  const path = useMemo(
    () => (from !== null && to !== null ? findPath(graph, from, to) : null),
    [graph, from, to],
  );
  const steps = useMemo(
    () => (path ? pathSteps(path, repoById, edgeByPair) : []),
    [path, repoById, edgeByPair],
  );

  // Publish the route for the canvas and frame it.
  useEffect(() => {
    const { setPathNodes, fitNodes } = useAppStore.getState();
    setPathNodes(path);
    if (path && path.length > 1) fitNodes(path);
  }, [path]);

  const setEnds = useAppStore((s) => s.setPathEnds);
  const showStep = (step: PathStep) => {
    const { select, centerOn } = useAppStore.getState();
    select(step.repo.id);
    centerOn(step.repo.id);
  };

  return (
    <section
      className="absolute top-3 left-3 z-10 flex max-h-[calc(100%-1.5rem)] w-[min(24rem,calc(100%-1.5rem))] flex-col gap-3 overflow-y-auto rounded-lg border bg-background/95 p-3 shadow-md backdrop-blur-sm"
      aria-labelledby="path-title"
    >
      <h2 id="path-title" className="text-base font-semibold">
        {t("path.title")}
      </h2>

      <div className="flex items-end gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <RepoPicker
            label={t("path.from")}
            value={from}
            onChange={(id) => setEnds({ from: id })}
            index={index}
            repoById={repoById}
          />
          <RepoPicker
            label={t("path.to")}
            value={to}
            onChange={(id) => setEnds({ to: id })}
            index={index}
            repoById={repoById}
          />
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("path.swap")}
          title={t("path.swapTitle")}
          disabled={from === null && to === null}
          onClick={() => setEnds({ from: to, to: from })}
        >
          <ArrowDownUp />
        </Button>
      </div>

      {from === null || to === null ? (
        <p className="text-sm text-muted-foreground">{t("path.pickTwo")}</p>
      ) : from === to ? (
        <p className="text-sm text-muted-foreground">
          {t("path.pickDifferent")}
        </p>
      ) : path === null ? (
        <p className="text-sm" role="status">
          <span className="font-medium">{t("path.notConnected")}</span>{" "}
          <span className="text-muted-foreground">{t("path.noChain")}</span>
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground" role="status">
            {t("count.hops", { count: steps.length - 1 })}
          </p>
          <ol className="flex flex-col">
            {steps.map((step, i) => (
              <li key={step.repo.id} className="flex gap-2">
                <div className="flex w-4 shrink-0 flex-col items-center">
                  <span
                    className={cn(
                      "mt-2 size-2 shrink-0 rounded-full bg-muted-foreground",
                      (i === 0 || i === steps.length - 1) && "bg-primary",
                    )}
                    aria-hidden="true"
                  />
                  {i < steps.length - 1 && (
                    <span
                      className="w-px flex-1 bg-border"
                      aria-hidden="true"
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1 pb-2">
                  {step.link && (
                    <p className="mb-0.5 text-xs text-muted-foreground">
                      {edgeReason(step.link.signals, t)} · w{" "}
                      {step.link.weight.toFixed(2)}
                    </p>
                  )}
                  <button
                    type="button"
                    className={cn(
                      "-mx-1 block max-w-full truncate rounded-sm px-1 text-left text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                      selected === step.repo.id && "font-medium text-primary",
                    )}
                    onClick={() => showStep(step)}
                    title={t("path.stepTitle")}
                  >
                    {step.repo.id}
                  </button>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
