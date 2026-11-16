import {
  ChevronDown,
  Copy,
  Footprints,
  Clock,
  Keyboard,
  Languages,
  Menu,
  Monitor,
  Moon,
  Network,
  PanelBottomOpen,
  Play,
  Route,
  Search,
  Shapes,
  Sun,
  Trophy,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useMediaQuery, WIDE_QUERY } from "@/hooks/use-media-query";
import {
  LOCALE_NAMES,
  LOCALE_SHORT,
  nextLocale,
  type MessageKey,
} from "@/lib/i18n";
import { useT } from "@/lib/i18n/use-i18n";
import { useAppStore, type ThemePreference, type ViewId } from "@/lib/store";
import { nextThemePreference } from "@/lib/theme";

// App shell from PRD §6 (T3.1): header (search, filters, theme, freshness),
// left views nav, sigma canvas, repo detail panel, timeline bar. Below the
// `lg` breakpoint the nav collapses into a menu sheet and the detail panel
// becomes a bottom sheet. Search comes in through the `search` slot; filters,
// views other than Graph, and the timeline are placeholders wired up by
// later M3/M4 tasks. Filters come in through the `filters` slot (T3.7) and
// the timeline slider through the `timeline` slot (T4.9). The Clusters
// (T3.8), Bridges (T4.5), Path (T4.6), Forgotten (T4.7) and Dupes (T4.8)
// views are rendered by App over the canvas.

export type { ViewId };

interface ViewItem {
  id: ViewId;
  label: MessageKey;
  icon: LucideIcon;
  /** False until the view ships (M3 T3.8, M4). */
  available: boolean;
}

const VIEWS: readonly ViewItem[] = [
  { id: "graph", label: "view.graph", icon: Network, available: true },
  { id: "clusters", label: "view.clusters", icon: Shapes, available: true },
  { id: "top", label: "view.top", icon: Trophy, available: true },
  { id: "bridges", label: "view.bridges", icon: Waypoints, available: true },
  { id: "forgotten", label: "view.forgotten", icon: Clock, available: true },
  { id: "dupes", label: "view.dupes", icon: Copy, available: true },
  { id: "path", label: "view.path", icon: Route, available: true },
];

const FILTERS: readonly MessageKey[] = [
  "filter.language",
  "filter.cluster",
  "filter.archived",
  "filter.starred",
];

interface AppShellProps {
  /** Header freshness line, e.g. "Generated 3 days ago · 812 repos" (FR-37). */
  freshness: string;
  freshnessTitle?: string;
  /** Header search box (T3.6); a disabled placeholder when omitted. */
  search?: ReactNode;
  /**
   * Filter controls (T3.7); rendered in the header on wide screens and in the
   * menu sheet on narrow ones. A disabled placeholder when omitted.
   */
  filters?: ReactNode;
  /** Footer timeline slider (T4.9); a disabled placeholder when omitted. */
  timeline?: ReactNode;
  /** The sigma canvas. */
  children: ReactNode;
  /** Detail panel body; null shows the empty hint. */
  detail?: ReactNode;
  /** Narrow screens: whether the detail bottom sheet is open. */
  detailOpen?: boolean;
  onDetailOpenChange?: (open: boolean) => void;
}

export function AppShell({
  freshness,
  freshnessTitle,
  search,
  filters,
  timeline,
  children,
  detail = null,
  detailOpen: detailOpenProp,
  onDetailOpenChange,
}: AppShellProps) {
  const t = useT();
  const wide = useMediaQuery(WIDE_QUERY);
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const [menuOpen, setMenuOpen] = useState(false);
  const [detailOpenLocal, setDetailOpenLocal] = useState(false);
  const detailOpen = detailOpenProp ?? detailOpenLocal;
  const setDetailOpen = onDetailOpenChange ?? setDetailOpenLocal;

  const selectView = (id: ViewId) => {
    setView(id);
    setMenuOpen(false);
  };

  return (
    <div className="flex h-svh flex-col bg-background text-foreground">
      <header className="flex items-center gap-2 border-b px-3 py-2">
        {!wide && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("shell.openMenu")}
            onClick={() => setMenuOpen(true)}
          >
            <Menu />
          </Button>
        )}
        <h1 className="shrink-0 text-base font-semibold">Stars Graph</h1>
        <div className="ml-2 max-w-sm min-w-0 flex-1">
          {search ?? <SearchPlaceholder />}
        </div>
        {wide && (filters ?? <FilterPlaceholder />)}
        <div className="ml-auto flex items-center gap-2">
          {wide && (
            <p
              className="text-sm whitespace-nowrap text-muted-foreground"
              title={freshnessTitle}
            >
              {freshness}
            </p>
          )}
          <ShortcutsButton />
          <LanguageToggle />
          <ThemeToggle />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {wide && (
          <aside
            className="w-44 shrink-0 border-r p-2"
            aria-label={t("nav.views")}
          >
            <ViewNav active={view} onSelect={selectView} />
          </aside>
        )}

        <main
          className="relative min-w-0 flex-1"
          aria-label={t("shell.graphRegion")}
        >
          {children}
          {!wide && (
            <Button
              variant="outline"
              size="sm"
              className="absolute right-3 bottom-3 shadow-sm"
              onClick={() => setDetailOpen(true)}
            >
              <PanelBottomOpen data-icon="inline-start" />
              {t("shell.details")}
            </Button>
          )}
        </main>

        {wide && (
          <aside
            className="w-80 shrink-0 overflow-y-auto border-l p-4"
            aria-label={t("shell.repoDetail")}
          >
            <DetailBody detail={detail} />
          </aside>
        )}
      </div>

      {timeline ?? <TimelineBar />}

      {!wide && (
        <>
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetContent side="left" className="w-72 gap-0">
              <SheetHeader>
                <SheetTitle>Stars Graph</SheetTitle>
                <SheetDescription title={freshnessTitle}>
                  {freshness}
                </SheetDescription>
              </SheetHeader>
              <nav className="px-2" aria-label={t("nav.views")}>
                <ViewNav active={view} onSelect={selectView} />
              </nav>
              <div className="mt-4 border-t px-4 pt-4">
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  {t("shell.filters")}
                </p>
                <div className="[&>div]:flex-wrap">
                  {filters ?? <FilterPlaceholder />}
                </div>
              </div>
            </SheetContent>
          </Sheet>

          <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
            <SheetContent side="bottom" className="max-h-[70svh] gap-0">
              <SheetHeader>
                <SheetTitle>{t("shell.repoDetail")}</SheetTitle>
                <SheetDescription className="sr-only">
                  {t("shell.repoDetailDesc")}
                </SheetDescription>
              </SheetHeader>
              <div className="overflow-y-auto px-4 pb-4">
                <DetailBody detail={detail} />
              </div>
            </SheetContent>
          </Sheet>
        </>
      )}
    </div>
  );
}

function SearchPlaceholder() {
  const t = useT();
  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        type="search"
        placeholder={t("search.placeholder")}
        aria-label={t("search.label")}
        className="pl-8"
        disabled
      />
    </div>
  );
}

function FilterPlaceholder() {
  const t = useT();
  return (
    <div className="flex items-center gap-1.5">
      {FILTERS.map((label) => (
        <Button
          key={label}
          variant="outline"
          size="sm"
          disabled
          title={t("common.comingSoon")}
        >
          {t(label)}
          <ChevronDown data-icon="inline-end" />
        </Button>
      ))}
    </div>
  );
}

function ViewNav({
  active,
  onSelect,
}: {
  active: ViewId;
  onSelect: (id: ViewId) => void;
}) {
  const t = useT();
  return (
    <ul className="flex flex-col gap-0.5">
      {VIEWS.map(({ id, label, icon: Icon, available }) => (
        <li key={id}>
          <Button
            variant={active === id ? "secondary" : "ghost"}
            className="w-full justify-start"
            aria-current={active === id ? "page" : undefined}
            disabled={!available}
            title={available ? undefined : t("common.comingSoon")}
            onClick={() => onSelect(id)}
          >
            <Icon data-icon="inline-start" />
            {t(label)}
          </Button>
        </li>
      ))}
    </ul>
  );
}

function DetailBody({ detail }: { detail: ReactNode }) {
  const t = useT();
  if (detail) return detail;
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
      <Footprints className="size-5" aria-hidden="true" />
      <p>{t("shell.detailEmpty")}</p>
    </div>
  );
}

function TimelineBar() {
  const t = useT();
  return (
    <footer
      className="flex items-center gap-3 border-t px-3 py-2 text-sm text-muted-foreground"
      aria-label={t("timeline.label")}
    >
      <span className="shrink-0 font-medium">{t("timeline.label")}</span>
      <div
        className="h-1 min-w-0 flex-1 rounded-full bg-muted"
        aria-hidden="true"
      />
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t("timeline.play")}
        title={t("common.comingSoon")}
        disabled
      >
        <Play />
      </Button>
    </footer>
  );
}

const THEME_META: Record<
  ThemePreference,
  { label: MessageKey; icon: LucideIcon }
> = {
  system: { label: "theme.system", icon: Monitor },
  light: { label: "theme.light", icon: Sun },
  dark: { label: "theme.dark", icon: Moon },
};

/** Cycles system → light → dark; the choice is persisted by the store. */
function ThemeToggle() {
  const t = useT();
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const { label: labelKey, icon: Icon } = THEME_META[theme];
  const label = t(labelKey);
  const next = t(THEME_META[nextThemePreference(theme)].label);
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t("theme.aria", { label, next })}
      title={t("theme.title", { label, next })}
      onClick={() => setTheme(nextThemePreference(theme))}
    >
      <Icon />
    </Button>
  );
}

/** Cycles the UI language (English ↔ Vietnamese); persisted by the store. */
function LanguageToggle() {
  const t = useT();
  const locale = useAppStore((s) => s.locale);
  const setLocale = useAppStore((s) => s.setLocale);
  const next = nextLocale(locale);
  const vars = { label: LOCALE_NAMES[locale], next: LOCALE_NAMES[next] };
  return (
    <Button
      variant="ghost"
      size="sm"
      className="px-2"
      aria-label={t("language.aria", vars)}
      title={t("language.title", vars)}
      onClick={() => setLocale(next)}
    >
      <Languages data-icon="inline-start" />
      <span className="text-xs font-medium">{LOCALE_SHORT[locale]}</span>
    </Button>
  );
}

/** Opens the keyboard shortcut dialog (T3.10); same as pressing `?`. */
function ShortcutsButton() {
  const t = useT();
  const setOpen = useAppStore((s) => s.setShortcutsOpen);
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t("shortcuts.button")}
      aria-keyshortcuts="?"
      title={t("shortcuts.buttonTitle")}
      onClick={() => setOpen(true)}
    >
      <Keyboard />
    </Button>
  );
}
