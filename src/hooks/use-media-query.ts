import { useSyncExternalStore } from "react";

/** Subscribes to a CSS media query; re-renders only when it flips. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Matches Tailwind's `lg` breakpoint: three-column shell at and above it. */
export const WIDE_QUERY = "(min-width: 1024px)";
