import {
  Archive,
  CalendarClock,
  Code,
  ExternalLink,
  GitCommitHorizontal,
  GitFork,
  Globe,
  Scale,
  Sparkles,
  Star,
  Tag,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  categoryLabel,
  findCluster,
  formatCount,
  formatDate,
  homepageHref,
  homepageLabel,
  isOnlyCluster,
  toggleClusterFilter,
} from "@/features/detail/repo-details";
import type { SimilarRepo } from "@/features/detail/reasons";
import { SimilarList } from "@/features/detail/SimilarList";
import type { Cluster, Enrichment, RepoNode } from "@/lib/graph-schema";
import { useT } from "@/lib/i18n/use-i18n";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";

// Repo detail panel (T3.4): metadata and links (FR-40), README excerpt
// (FR-41), user tags from data/manual.yaml (FR-9), a cluster chip that filters
// the graph to that cluster (FR-43), "Similar repos" (FR-42, T3.5) and, when
// data/enrichment.json covers the repo, its summary, category and concepts
// (FR-44, T5.6).

interface DetailPanelProps {
  repo: RepoNode;
  clusters: readonly Cluster[];
  similar?: readonly SimilarRepo[];
}

export function DetailPanel({
  repo,
  clusters,
  similar = [],
}: DetailPanelProps) {
  const t = useT();
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
              {t("detail.archived")}
            </span>
          )}
        </div>
      </header>

      {repo.enrichment && <EnrichmentSection enrichment={repo.enrichment} />}

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
        <Fact icon={Star} label={t("detail.stars")}>
          <span title={repo.stars.toLocaleString(t.locale)}>
            {formatCount(repo.stars, t.locale)}
          </span>
          <span className="text-muted-foreground">
            {" "}
            ·{" "}
            <GitFork
              className="inline size-3"
              aria-label={t("detail.forks")}
            />{" "}
            <span title={repo.forks.toLocaleString(t.locale)}>
              {formatCount(repo.forks, t.locale)}
            </span>
          </span>
        </Fact>
        {repo.language && (
          <Fact icon={Code} label={t("detail.language")}>
            {repo.language}
          </Fact>
        )}
        <Fact icon={GitCommitHorizontal} label={t("detail.lastPush")}>
          <time dateTime={repo.pushedAt}>{formatDate(repo.pushedAt, t)}</time>
        </Fact>
        <Fact icon={CalendarClock} label={t("detail.starred")}>
          <time dateTime={repo.starredAt}>{formatDate(repo.starredAt, t)}</time>
        </Fact>
        {repo.license && (
          <Fact icon={Scale} label={t("detail.license")}>
            {repo.license}
          </Fact>
        )}
      </dl>

      {repo.tags && repo.tags.length > 0 && (
        <section aria-label={t("detail.tags")}>
          <ul className="flex flex-wrap gap-1">
            {repo.tags.map((tag) => (
              <li
                key={tag}
                className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-foreground"
              >
                <Tag className="size-3" aria-hidden="true" />
                {tag}
              </li>
            ))}
          </ul>
        </section>
      )}

      {repo.topics.length > 0 && (
        <section aria-label={t("detail.topics")}>
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

      <ul className="flex flex-col gap-1" aria-label={t("detail.links")}>
        <li>
          <ExternalAnchor href={repo.url} icon={ExternalLink}>
            {t("detail.viewOnGithub")}
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

      <SimilarList items={similar} />
    </article>
  );
}

function EnrichmentSection({ enrichment }: { enrichment: Enrichment }) {
  const t = useT();
  const summary = enrichment.summary.trim();
  return (
    <section
      className="flex flex-col gap-2 rounded-md border bg-muted/40 p-2.5"
      aria-label={t("detail.enrichment")}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <h3 className="flex items-center gap-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          <Sparkles className="size-3" aria-hidden="true" />
          {t("detail.summary")}
        </h3>
        <span
          className="rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-xs font-medium"
          title={t("detail.category")}
        >
          {categoryLabel(enrichment.category, t)}
        </span>
      </div>
      {summary && <p className="leading-relaxed break-words">{summary}</p>}
      {enrichment.concepts.length > 0 && (
        <ul className="flex flex-wrap gap-1" aria-label={t("detail.concepts")}>
          {enrichment.concepts.map((concept) => (
            <li
              key={concept}
              className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
            >
              {concept}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ClusterChip({
  clusters,
  id,
}: {
  clusters: readonly Cluster[];
  id: number;
}) {
  const t = useT();
  const cluster = findCluster(clusters, id, t);
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
          ? t("detail.clearCluster")
          : t("detail.onlyCluster", { label: cluster.label })
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
