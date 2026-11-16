import { Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  buildSearchIndex,
  searchRepos,
  type SearchHit,
} from "@/features/search/search-index";
import type { RepoNode } from "@/lib/graph-schema";
import { useT } from "@/lib/i18n/use-i18n";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";

// Header search box (FR-50, T3.6). ARIA combobox over the MiniSearch index:
// type to search, ↑/↓ to move, Enter or click to pick, Esc to close. Picking
// a result selects the node and asks the canvas to animate the camera to it.
// `/` anywhere focuses the box (T3.10).

interface SearchBoxProps {
  nodes: readonly RepoNode[];
  className?: string;
}

export function SearchBox({ nodes, className }: SearchBoxProps) {
  const t = useT();
  const index = useMemo(() => buildSearchIndex(nodes), [nodes]);
  const repoById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  // `/` (T3.10) asks the search box to take focus.
  useEffect(
    () =>
      useAppStore.subscribe((state, prev) => {
        if (state.focusSearchSeq === prev.focusSearchSeq) return;
        inputRef.current?.focus();
        inputRef.current?.select();
      }),
    [],
  );

  const hits = useMemo(
    () => searchRepos(index, repoById, query),
    [index, repoById, query],
  );
  const showList = open && query.trim() !== "";
  const activeIndex = Math.min(active, Math.max(hits.length - 1, 0));

  const pick = (hit: SearchHit) => {
    const { select, centerOn } = useAppStore.getState();
    select(hit.id);
    centerOn(hit.id);
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
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
        if (showList) {
          setOpen(false);
        } else {
          setQuery("");
          inputRef.current?.blur();
        }
        break;
    }
  };

  const optionId = (i: number) => `${listId}-opt-${i}`;

  return (
    <div className={cn("relative", className)}>
      <Search
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        ref={inputRef}
        type="search"
        role="combobox"
        placeholder={t("search.placeholder")}
        aria-label={t("search.label")}
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={
          showList && hits.length > 0 ? optionId(activeIndex) : undefined
        }
        autoComplete="off"
        spellCheck={false}
        className="pl-8"
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
          aria-label={t("search.results")}
          className="absolute top-full right-0 left-0 z-50 mt-1 max-h-80 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
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
                  <span className="text-muted-foreground">{hit.owner}/</span>
                  <span className="font-medium">{hit.name}</span>
                </p>
                {hit.description && (
                  <p className="truncate text-xs text-muted-foreground">
                    {hit.description}
                  </p>
                )}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
