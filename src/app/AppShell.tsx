import {
  ChevronDown,
  Copy,
  Footprints,
  Clock,
  Keyboard,
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
import { useAppStore, type ThemePreference, type ViewId } from "@/lib/store";
import { nextThemePreference } from "@/lib/theme";

// App shell from PRD §6 (T3.1): header (search, filters, theme, freshness),
// left views nav, sigma canvas, repo detail panel, timeline bar. Below the
// `lg` breakpoint the nav collapses into a menu sheet and the detail panel
// becomes a bottom sheet. Search comes in through the `search` slot; filters,
// views other than Graph, and the timeline are placeholders wired up by
// later M3/M4 tasks. Filters come in through the `filters` slot (T3.7). The
// Clusters (T3.8) and Bridges (T4.5) views are rendered by App over the
// canvas.

export type { ViewId };

interface ViewItem {
  id: ViewId;
  label: string;
  icon: LucideIcon;
  /** False until the view ships (M3 T3.8, M4). */
  available: boolean;
}

const VIEWS: readonly ViewItem[] = [
  { id: "graph", label: "Graph", icon: Network, available: true },
  { id: "clusters", label: "Clusters", icon: Shapes, available: true },
  { id: "bridges", label: "Bridges", icon: Waypoints, available: true },
  { id: "forgotten", label: "Forgotten", icon: Clock, available: false },
  { id: "dupes", label: "Dupes", icon: Copy, available: false },
  { id: "path", label: "Path", icon: Route, available: false },
];

const FILTERS = ["Language", "Cluster", "Archived", "Starred"] as const;

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
  children,
  detail = null,
  detailOpen: detailOpenProp,
  onDetailOpenChange,
}: AppShellProps) {
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
            aria-label="Open menu"
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
          <ThemeToggle />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {wide && (
          <aside className="w-44 shrink-0 border-r p-2" aria-label="Views">
            <ViewNav active={view} onSelect={selectView} />
          </aside>
        )}

        <main className="relative min-w-0 flex-1" aria-label="Repository graph">
          {children}
          {!wide && (
            <Button
              variant="outline"
              size="sm"
              className="absolute right-3 bottom-3 shadow-sm"
              onClick={() => setDetailOpen(true)}
            >
              <PanelBottomOpen data-icon="inline-start" />
              Details
            </Button>
          )}
        </main>

        {wide && (
          <aside
            className="w-80 shrink-0 overflow-y-auto border-l p-4"
            aria-label="Repo detail"
          >
            <DetailBody detail={detail} />
          </aside>
        )}
      </div>

      <TimelineBar />

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
              <nav className="px-2" aria-label="Views">
                <ViewNav active={view} onSelect={selectView} />
              </nav>
              <div className="mt-4 border-t px-4 pt-4">
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  Filters
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
                <SheetTitle>Repo detail</SheetTitle>
                <SheetDescription className="sr-only">
                  Details of the selected repository
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
  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        type="search"
        placeholder="Search…"
        aria-label="Search repositories"
        className="pl-8"
        disabled
      />
    </div>
  );
}

function FilterPlaceholder() {
  return (
    <div className="flex items-center gap-1.5">
      {FILTERS.map((label) => (
        <Button
          key={label}
          variant="outline"
          size="sm"
          disabled
          title="Coming soon"
        >
          {label}
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
  return (
    <ul className="flex flex-col gap-0.5">
      {VIEWS.map(({ id, label, icon: Icon, available }) => (
        <li key={id}>
          <Button
            variant={active === id ? "secondary" : "ghost"}
            className="w-full justify-start"
            aria-current={active === id ? "page" : undefined}
            disabled={!available}
            title={available ? undefined : "Coming soon"}
            onClick={() => onSelect(id)}
          >
            <Icon data-icon="inline-start" />
            {label}
          </Button>
        </li>
      ))}
    </ul>
  );
}

function DetailBody({ detail }: { detail: ReactNode }) {
  if (detail) return detail;
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
      <Footprints className="size-5" aria-hidden="true" />
      <p>Select a repo on the graph to see its details and similar repos.</p>
    </div>
  );
}

function TimelineBar() {
  return (
    <footer
      className="flex items-center gap-3 border-t px-3 py-2 text-sm text-muted-foreground"
      aria-label="Timeline"
    >
      <span className="shrink-0 font-medium">Timeline</span>
      <div
        className="h-1 min-w-0 flex-1 rounded-full bg-muted"
        aria-hidden="true"
      />
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Play timeline"
        title="Coming soon"
        disabled
      >
        <Play />
      </Button>
    </footer>
  );
}

const THEME_META: Record<ThemePreference, { label: string; icon: LucideIcon }> =
  {
    system: { label: "System", icon: Monitor },
    light: { label: "Light", icon: Sun },
    dark: { label: "Dark", icon: Moon },
  };

/** Cycles system → light → dark; the choice is persisted by the store. */
function ThemeToggle() {
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const { label, icon: Icon } = THEME_META[theme];
  const next = THEME_META[nextThemePreference(theme)].label;
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Theme: ${label}. Switch to ${next}`}
      title={`Theme: ${label} (click for ${next})`}
      onClick={() => setTheme(nextThemePreference(theme))}
    >
      <Icon />
    </Button>
  );
}

/** Opens the keyboard shortcut dialog (T3.10); same as pressing `?`. */
function ShortcutsButton() {
  const setOpen = useAppStore((s) => s.setShortcutsOpen);
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Keyboard shortcuts"
      aria-keyshortcuts="?"
      title="Keyboard shortcuts (?)"
      onClick={() => setOpen(true)}
    >
      <Keyboard />
    </Button>
  );
}
