// Keyboard shortcuts (FR-38, T3.10). Pure key → action mapping so it can be
// tested without a DOM; `useKeyboardShortcuts` wires it to `window`.
//
// `/` focus search, `Esc` clear selection / leave a view, `f` fit graph,
// `?` shortcut list, and the random-walk keys `r`, `[`, `]` (T4.10, FR-65).

export type ShortcutAction =
  | "focus-search"
  | "clear"
  | "fit"
  | "help"
  | "walk-step"
  | "walk-back"
  | "walk-forward";

export interface ShortcutInfo {
  action: ShortcutAction;
  /** Keys as shown in the dialog. */
  keys: readonly string[];
  description: string;
}

/** Shown in the shortcut dialog, in this order. */
export const SHORTCUTS: readonly ShortcutInfo[] = [
  { action: "focus-search", keys: ["/"], description: "Focus search" },
  {
    action: "clear",
    keys: ["Esc"],
    description: "Clear selection or go back to the graph",
  },
  { action: "fit", keys: ["f"], description: "Fit graph to screen" },
  { action: "walk-step", keys: ["r"], description: "Random walk step" },
  { action: "walk-back", keys: ["["], description: "Walk back" },
  { action: "walk-forward", keys: ["]"], description: "Walk forward" },
  { action: "help", keys: ["?"], description: "Show keyboard shortcuts" },
];

/** The parts of a KeyboardEvent the mapping reads. */
export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  isComposing?: boolean;
  defaultPrevented?: boolean;
  target: EventTarget | null;
}

const TEXT_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/** True when keys typed at `target` are text input, not shortcuts. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (target === null || typeof target !== "object") return false;
  const el = target as { tagName?: unknown; isContentEditable?: unknown };
  if (el.isContentEditable === true) return true;
  return typeof el.tagName === "string" && TEXT_TAGS.has(el.tagName);
}

/** Map a key press to a shortcut, or null when it is not one. */
export function resolveShortcut(event: KeyLike): ShortcutAction | null {
  if (event.defaultPrevented || event.isComposing) return null;
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  // Esc still works from inputs other than the search box (which handles
  // its own Esc and marks it handled); every other key is text there.
  if (event.key === "Escape") return "clear";
  if (isTypingTarget(event.target)) return null;
  switch (event.key) {
    case "/":
      return "focus-search";
    case "f":
    case "F":
      return "fit";
    case "?":
      return "help";
    case "r":
    case "R":
      return "walk-step";
    case "[":
      return "walk-back";
    case "]":
      return "walk-forward";
    default:
      return null;
  }
}
