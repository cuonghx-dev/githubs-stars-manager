import { Pause, Play } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { RepoNode } from "@/lib/graph-schema";
import { formatRepoCount } from "@/lib/format";
import { useAppStore } from "@/lib/store";

// Timeline slider (FR-64, T4.9): show only repos starred up to day T, with
// play/animate. It has no state of its own: T *is* `filters.starredTo`, the
// same field the header "Starred" filter edits, so moving either one updates
// the other (FR-54). The lower bound stays `filters.starredFrom`; the slider
// never goes below it. The last position means "no upper bound" (null), so a
// slider parked at the end leaves the filter inactive.

/** Rough wall-clock length of a full play-through. */
const PLAY_DURATION_MS = 12_000;
const TICK_MS = 80;

interface TimelineSliderProps {
  nodes: readonly RepoNode[];
}

export function TimelineSlider({ nodes }: TimelineSliderProps) {
  const starredFrom = useAppStore((s) => s.filters.starredFrom);
  const starredTo = useAppStore((s) => s.filters.starredTo);
  const setFilters = useAppStore((s) => s.setFilters);
  const [playing, setPlaying] = useState(false);

  // Distinct starred days, ascending, with the cumulative repo count per day.
  const { days, cumulative } = useMemo(() => starDays(nodes), [nodes]);
  const last = days.length - 1;

  const fromDay = starredFrom?.slice(0, 10) ?? null;
  const toDay = starredTo?.slice(0, 10) ?? null;
  const minIndex =
    fromDay === null ? 0 : Math.min(last, lowerBound(days, fromDay));
  const index =
    toDay === null ? last : Math.max(minIndex, upperBound(days, toDay) - 1);

  // Called with a day index; the last index clears the upper bound.
  const setIndex = (i: number) => {
    const clamped = Math.min(last, Math.max(minIndex, i));
    setFilters({
      starredTo: clamped >= last ? null : (days[clamped] ?? null),
    });
  };

  // Play: step forward on a timer until the end, then stop. Reads the store
  // directly so the interval doesn't restart on every step.
  const daysRef = useRef(days);
  useEffect(() => {
    daysRef.current = days;
  }, [days]);
  useEffect(() => {
    if (!playing) return;
    const step = Math.max(
      1,
      Math.ceil(daysRef.current.length / (PLAY_DURATION_MS / TICK_MS)),
    );
    const id = window.setInterval(() => {
      const d = daysRef.current;
      const end = d.length - 1;
      const { starredFrom: from, starredTo: to } =
        useAppStore.getState().filters;
      const lo = from === null ? 0 : lowerBound(d, from.slice(0, 10));
      const cur =
        to === null ? end : Math.max(lo, upperBound(d, to.slice(0, 10)) - 1);
      const next = cur + step;
      if (next >= end) {
        useAppStore.getState().setFilters({ starredTo: null });
        setPlaying(false);
      } else {
        useAppStore.getState().setFilters({ starredTo: d[next] ?? null });
      }
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [playing]);

  if (days.length < 2) return null;

  const togglePlay = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    // Starting from the end replays from the first day in range.
    if (index >= last) setIndex(minIndex);
    setPlaying(true);
  };

  const shown =
    (cumulative[index] ?? 0) -
    (minIndex > 0 ? (cumulative[minIndex - 1] ?? 0) : 0);
  const atEnd = index >= last;

  return (
    <footer
      className="flex items-center gap-3 border-t px-3 py-2 text-sm"
      aria-label="Timeline"
    >
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={playing ? "Pause timeline" : "Play timeline"}
        title={playing ? "Pause" : "Play: grow the graph by starred date"}
        aria-pressed={playing}
        onClick={togglePlay}
      >
        {playing ? <Pause /> : <Play />}
      </Button>
      <span className="shrink-0 text-muted-foreground tabular-nums">
        {days[minIndex]}
      </span>
      <input
        type="range"
        className="h-1 min-w-0 flex-1 cursor-pointer accent-primary"
        min={minIndex}
        max={last}
        step={1}
        value={index}
        aria-label="Starred up to"
        aria-valuetext={atEnd ? "All dates" : `Up to ${days[index]}`}
        onChange={(e) => {
          setPlaying(false);
          setIndex(Number(e.target.value));
        }}
      />
      <span
        className="shrink-0 whitespace-nowrap tabular-nums"
        title="Repos starred up to this date"
      >
        <span className={atEnd ? "text-muted-foreground" : "font-medium"}>
          {atEnd ? "All" : `Up to ${days[index]}`}
        </span>
        <span className="text-muted-foreground">
          {" · "}
          {formatRepoCount(shown)}
        </span>
      </span>
    </footer>
  );
}

function starDays(nodes: readonly RepoNode[]): {
  days: string[];
  cumulative: number[];
} {
  const counts = new Map<string, number>();
  for (const n of nodes) {
    const day = n.starredAt.slice(0, 10);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  const days = [...counts.keys()].sort();
  const cumulative: number[] = [];
  let total = 0;
  for (const day of days) {
    total += counts.get(day) ?? 0;
    cumulative.push(total);
  }
  return { days, cumulative };
}

/** First index whose day is >= `day` (days ascending). */
function lowerBound(days: readonly string[], day: string): number {
  let lo = 0;
  let hi = days.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((days[mid] ?? "") < day) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First index whose day is > `day` (days ascending). */
function upperBound(days: readonly string[], day: string): number {
  let lo = 0;
  let hi = days.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((days[mid] ?? "") <= day) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
