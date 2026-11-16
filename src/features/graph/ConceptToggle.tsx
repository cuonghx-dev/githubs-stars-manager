import { Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/use-i18n";
import { useAppStore } from "@/lib/store";

// Show/hide the enrichment concept layer (FR-73, T5.7). Only rendered when
// graph.json carries concept nodes.

export function ConceptToggle({ count }: { count: number }) {
  const t = useT();
  const show = useAppStore((s) => s.showConcepts);
  const setShow = useAppStore((s) => s.setShowConcepts);
  return (
    <Button
      variant={show ? "secondary" : "outline"}
      size="sm"
      className="absolute top-3 left-3 z-10 shadow-sm"
      aria-pressed={show}
      title={t(show ? "concepts.hideTitle" : "concepts.showTitle", { count })}
      onClick={() => setShow(!show)}
    >
      <Lightbulb data-icon="inline-start" />
      {t("concepts.toggle")}
    </Button>
  );
}
