import { ChevronLeft, ChevronRight, Dices } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WalkActions } from "@/features/shortcuts/useKeyboardShortcuts";
import { useAppStore } from "@/lib/store";

// Random walk controls (FR-65, T4.10): back, random step, forward. Each move
// selects the node and centres the camera on it. The same actions back the
// `[`, `r` and `]` shortcuts (FR-38) via `useRandomWalk`.

export function WalkControls({ walk }: { walk: WalkActions }) {
  const canBack = useAppStore(
    (s) => s.walkIndex > 0 || (s.selectedNode === null && s.walkIndex >= 0),
  );
  const canForward = useAppStore(
    (s) => s.walkIndex >= 0 && s.walkIndex < s.walkHistory.length - 1,
  );
  return (
    <div
      role="group"
      aria-label="Random walk"
      className="absolute right-3 bottom-3 z-10 flex items-center gap-0.5 rounded-lg border bg-background/90 p-0.5 shadow-sm backdrop-blur-sm"
    >
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={walk.back}
        disabled={!canBack}
        aria-label="Walk back"
        title="Walk back ( [ )"
      >
        <ChevronLeft />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={walk.step}
        title="Random walk step ( r )"
      >
        <Dices />
        Random walk
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={walk.forward}
        disabled={!canForward}
        aria-label="Walk forward"
        title="Walk forward ( ] )"
      >
        <ChevronRight />
      </Button>
    </div>
  );
}
