import { ChevronLeft, ChevronRight, Dices } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WalkActions } from "@/features/shortcuts/useKeyboardShortcuts";
import { useT } from "@/lib/i18n/use-i18n";
import { useAppStore } from "@/lib/store";

// Random walk controls (FR-65, T4.10): back, random step, forward. Each move
// selects the node and centres the camera on it. The same actions back the
// `[`, `r` and `]` shortcuts (FR-38) via `useRandomWalk`.

export function WalkControls({ walk }: { walk: WalkActions }) {
  const t = useT();
  const canBack = useAppStore(
    (s) => s.walkIndex > 0 || (s.selectedNode === null && s.walkIndex >= 0),
  );
  const canForward = useAppStore(
    (s) => s.walkIndex >= 0 && s.walkIndex < s.walkHistory.length - 1,
  );
  return (
    <div
      role="group"
      aria-label={t("walk.group")}
      className="absolute right-3 bottom-3 z-10 flex items-center gap-0.5 rounded-lg border bg-background/90 p-0.5 shadow-sm backdrop-blur-sm"
    >
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={walk.back}
        disabled={!canBack}
        aria-label={t("walk.back")}
        title={t("walk.backTitle")}
      >
        <ChevronLeft />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={walk.step}
        title={t("walk.stepTitle")}
      >
        <Dices />
        {t("walk.step")}
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={walk.forward}
        disabled={!canForward}
        aria-label={t("walk.forward")}
        title={t("walk.forwardTitle")}
      >
        <ChevronRight />
      </Button>
    </div>
  );
}
