import { Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/lib/store";

// Show/hide the enrichment concept layer (FR-73, T5.7). Only rendered when
// graph.json carries concept nodes.

export function ConceptToggle({ count }: { count: number }) {
  const show = useAppStore((s) => s.showConcepts);
  const setShow = useAppStore((s) => s.setShowConcepts);
  return (
    <Button
      variant={show ? "secondary" : "outline"}
      size="sm"
      className="absolute top-3 left-3 z-10 shadow-sm"
      aria-pressed={show}
      title={`${show ? "Hide" : "Show"} ${count} concepts from enrichment`}
      onClick={() => setShow(!show)}
    >
      <Lightbulb data-icon="inline-start" />
      Concepts
    </Button>
  );
}
