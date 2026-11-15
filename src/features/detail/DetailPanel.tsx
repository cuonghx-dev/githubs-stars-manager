import {
  Archive,
  CalendarClock,
  Code,
  ExternalLink,
  GitCommitHorizontal,
  GitFork,
  Globe,
  Scale,
  Star,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  findCluster,
  formatCount,
  formatDate,
  homepageHref,
  homepageLabel,
  isOnlyCluster,
  toggleClusterFilter,
} from "@/features/detail/repo-details";
import type { Cluster, RepoNode } from "@/lib/graph-schema";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";

// Repo detail panel (T3.4): metadata and links (FR-40), README excerpt
// (FR-41) and a cluster chip that filters the graph to that cluster (FR-43).
// "Similar repos" (FR-42, T3.5) and enrichment (FR-44, T5.6) slot in below.

interface DetailPanelProps {
  repo: RepoNode;
  clusters: readonly Cluster[];
}

export function DetailPanel({ repo, clusters }: DetailPanelProps) {
  const homepage = homepageHref(repo.homepage);
  return (
    <article className="flex flex-col gap-4 text-sm" aria-label={repo.id}>
      <header className="flex flex-col gap-1">
        <h2 className="text-base leading-tight font-semibold break-words">
          <span className="font-normal text-muted-foreground">
            {repo.owner}/
          </span>
          {repo.name}
        </h2>
        {repo.description && (
          <p className="text-muted-foreground">{repo.description}</p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <ClusterChip clusters={clusters} id={repo.cluster} />
          {repo.isArchived && (
            <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300">
              <Archive className="size-3" aria-hidden="true" />
              Archived
            </span>
          )}
        </div>
      </header>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
        <Fact icon={Star} label="Stars">
          <span title={repo.stars.toLocaleString("en")}>
            {formatCount(repo.stars)}
          </span>
          <span className="text-muted-foreground">
            {" "}
            · <GitFork className="inline size-3" aria-label="Forks" />{" "}
            <span title={repo.forks.toLocaleString("en")}>
              {formatCount(repo.forks)}
            </span>
          </span>
        </Fact>
        {repo.language && (
          <Fact icon={Code} label="Language">
            {repo.language}
          </Fact>
        )}
        <Fact icon={GitCommitHorizontal} label="Last push">
          <time dateTime={repo.pushedAt}>{formatDate(repo.pushedAt)}</time>
        </Fact>
        <Fact icon={CalendarClock} label="Starred">
          <time dateTime={repo.starredAt}>{formatDate(repo.starredAt)}</time>
        </Fact>
        {repo.license && (
          <Fact icon={Scale} label="License">
            {repo.license}
          </Fact>
        )}
      </dl>

      {repo.topics.length > 0 && (
        <section aria-label="Topics">
          <ul className="flex flex-wrap gap-1">
            {repo.topics.map((topic) => (
              <li
                key={topic}
                className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
              >
                {topic}
              </li>
            ))}
          </ul>
        </section>
      )}

      <ul className="flex flex-col gap-1" aria-label="Links">
        <li>
          <ExternalAnchor href={repo.url} icon={ExternalLink}>
            View on GitHub
          </ExternalAnchor>
        </li>
        {homepage && (
          <li>
            <ExternalAnchor href={homepage} icon={Globe}>
              {homepageLabel(homepage)}
            </ExternalAnchor>
          </li>
        )}
      </ul>

      {repo.readmeExcerpt && (
        <section className="flex flex-col gap-1">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            README
          </h3>
          <p className="leading-relaxed break-words whitespace-pre-line">
            {repo.readmeExcerpt}
          </p>
        </section>
      )}
    </article>
  );
}

function ClusterChip({
  clusters,
  id,
}: {
  clusters: readonly Cluster[];
  id: number;
}) {
  const cluster = findCluster(clusters, id);
  const active = useAppStore((s) => isOnlyCluster(s.filters.clusters, id));
  const onClick = () => {
    const { filters, setFilters } = useAppStore.getState();
    setFilters({ clusters: toggleClusterFilter(filters.clusters, id) });
  };
  return (
    <button
      type="button"
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-xs font-medium transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
        active && "border-foreground/40 bg-muted",
      )}
      aria-pressed={active}
      title={
        active
          ? "Clear the cluster filter"
          : `Show only the “${cluster.label}” cluster`
      }
      onClick={onClick}
    >
      <span
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: cluster.color }}
        aria-hidden="true"
      />
      <span className="truncate">{cluster.label}</span>
    </button>
  );
}

function Fact({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: ReactNode;
}) {
  return (
    <>
      <dt className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="size-3.5" aria-hidden="true" />
        {label}
      </dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

function ExternalAnchor({
  href,
  icon: Icon,
  children,
}: {
  href: string;
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex max-w-full items-center gap-1.5 text-primary underline-offset-4 hover:underline"
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{children}</span>
    </a>
  );
}
