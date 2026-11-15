import { describe, expect, it } from "vitest";
import {
  isTypingTarget,
  resolveShortcut,
  SHORTCUTS,
  type KeyLike,
} from "@/features/shortcuts/shortcuts";

// Duck-typed stand-ins for elements; tests run without a DOM.
const fake = (tagName: string, isContentEditable = false) =>
  ({ tagName, isContentEditable }) as unknown as EventTarget;
const body = fake("BODY");
const input = fake("INPUT");
const editable = fake("DIV", true);

function press(key: string, extra: Partial<KeyLike> = {}): KeyLike {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    target: body,
    ...extra,
  };
}

describe("resolveShortcut", () => {
  it("maps the P0 keys", () => {
    expect(resolveShortcut(press("/"))).toBe("focus-search");
    expect(resolveShortcut(press("Escape"))).toBe("clear");
    expect(resolveShortcut(press("f"))).toBe("fit");
    expect(resolveShortcut(press("?"))).toBe("help");
    expect(resolveShortcut(press("x"))).toBeNull();
  });

  it("ignores keys typed into text fields, except Esc", () => {
    expect(resolveShortcut(press("/", { target: input }))).toBeNull();
    expect(resolveShortcut(press("f", { target: editable }))).toBeNull();
    expect(resolveShortcut(press("Escape", { target: input }))).toBe("clear");
  });

  it("ignores modified, composing and already-handled presses", () => {
    expect(resolveShortcut(press("f", { metaKey: true }))).toBeNull();
    expect(resolveShortcut(press("f", { ctrlKey: true }))).toBeNull();
    expect(resolveShortcut(press("/", { altKey: true }))).toBeNull();
    expect(resolveShortcut(press("f", { isComposing: true }))).toBeNull();
    expect(
      resolveShortcut(press("Escape", { defaultPrevented: true })),
    ).toBeNull();
  });
});

describe("isTypingTarget", () => {
  it("detects inputs and editable content", () => {
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(body)).toBe(false);
    expect(isTypingTarget(input)).toBe(true);
    expect(isTypingTarget(editable)).toBe(true);
  });
});

describe("SHORTCUTS", () => {
  it("lists every action once", () => {
    const actions = SHORTCUTS.map((s) => s.action);
    expect(new Set(actions).size).toBe(actions.length);
  });
});
