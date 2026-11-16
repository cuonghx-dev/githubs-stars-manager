import { translator, type Translator } from "@/lib/i18n";
import { useAppStore } from "@/lib/store";

/**
 * Translator for the active UI locale; re-renders the caller when the user
 * switches language. `t.locale` doubles as the Intl locale for numbers and
 * dates.
 */
export function useT(): Translator {
  return translator(useAppStore((s) => s.locale));
}
