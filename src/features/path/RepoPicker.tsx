import { X } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  searchRepos,
  type RepoSearchIndex,
  type SearchHit,
} from "@/features/search/search-index";
import type { RepoNode } from "@/lib/graph-schema";
import { useT } from "@/lib/i18n/use-i18n";
import { cn } from "@/lib/utils";

// Repo picker for the path finder (T4.6): the same MiniSearch combobox as the
// header search (T3.6), but picking sets a value instead of selecting a node.
// A picked repo shows as a chip with a clear button.

interface RepoPickerProps {
  label: string;
  value: string | null;
  onChange: (id: string | null) => void;
  index: RepoSearchIndex;
  repoById: ReadonlyMap<string, RepoNode>;
}

export function RepoPicker({
  label,
  value,
  onChange,
  index,
  repoById,
}: RepoPickerProps) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const labelId = useId();

  const hits = useMemo(
    () => searchRepos(index, repoById, query),
    [index, repoById, query],
  );
  const showList = open && query.trim() !== "";
  const activeIndex = Math.min(active, Math.max(hits.length - 1, 0));
  const optionId = (i: number) => `${listId}-opt-${i}`;

  const pick = (hit: SearchHit) => {
    onChange(hit.id);
    setQuery("");
    setOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setOpen(true);
        if (hits.length > 0) setActive((activeIndex + 1) % hits.length);
        break;
      case "ArrowUp":
        event.preventDefault();
        if (hits.length > 0) {
          setActive((activeIndex - 1 + hits.length) % hits.length);
        }
        break;
      case "Enter": {
        const hit = hits[activeIndex];
        if (showList && hit) {
          event.preventDefault();
          pick(hit);
        }
        break;
      }
      case "Escape":
        // Mark handled so the canvas Esc (clear focus) does not also fire.
        event.preventDefault();
        if (showList) setOpen(false);
        else inputRef.current?.blur();
        break;
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <span id={labelId} className="text-xs font-medium text-muted-foreground">
        {label}
      </span>
      {value !== null ? (
        <div className="flex h-8 items-center gap-1 rounded-md border bg-muted/50 pr-0.5 pl-2.5">
          <span className="min-w-0 flex-1 truncate text-sm" title={value}>
            {value}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t("picker.clear", { label: label.toLowerCase() })}
            onClick={() => {
              onChange(null);
              requestAnimationFrame(() => inputRef.current?.focus());
            }}
          >
            <X />
          </Button>
        </div>
      ) : (
        <div className="relative">
          <Input
            ref={inputRef}
            type="search"
            role="combobox"
            placeholder={t("picker.placeholder")}
            aria-labelledby={labelId}
            aria-autocomplete="list"
            aria-expanded={showList}
            aria-controls={listId}
            aria-activedescendant={
              showList && hits.length > 0 ? optionId(activeIndex) : undefined
            }
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={onKeyDown}
          />
          {showList && (
            <ul
              id={listId}
              role="listbox"
              aria-label={t("picker.results", { label })}
              className="absolute top-full right-0 left-0 z-50 mt-1 max-h-64 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
            >
              {hits.length === 0 ? (
                <li className="px-2 py-1.5 text-sm text-muted-foreground">
                  {t("common.noMatches")}
                </li>
              ) : (
                hits.map((hit, i) => (
                  <li
                    key={hit.id}
                    id={optionId(i)}
                    role="option"
                    aria-selected={i === activeIndex}
                    className={cn(
                      "cursor-pointer rounded-md px-2 py-1.5",
                      i === activeIndex && "bg-accent text-accent-foreground",
                    )}
                    // Keep focus in the input so blur does not close the list first.
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(hit)}
                  >
                    <p className="truncate text-sm">
                      <span className="text-muted-foreground">
                        {hit.owner}/
                      </span>
                      <span className="font-medium">{hit.name}</span>
                    </p>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
