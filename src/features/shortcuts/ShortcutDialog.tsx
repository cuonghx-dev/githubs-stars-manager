import { XIcon } from "lucide-react";
import { Dialog } from "radix-ui";
import { Button } from "@/components/ui/button";
import { SHORTCUTS } from "@/features/shortcuts/shortcuts";
import { useAppStore } from "@/lib/store";

// Shortcut list (FR-38, T3.10), opened with `?` or the header keyboard
// button. Radix Dialog gives the focus trap, Esc to close and focus return.

export function ShortcutDialog() {
  const open = useAppStore((s) => s.shortcutsOpen);
  const setOpen = useAppStore((s) => s.setShortcutsOpen);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/10 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-popover p-4 text-popover-foreground shadow-lg data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
          <div className="mb-3 flex items-center justify-between gap-2">
            <Dialog.Title className="text-base font-medium">
              Keyboard shortcuts
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Close">
                <XIcon />
              </Button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            Keys that work anywhere outside text fields.
          </Dialog.Description>
          <dl className="flex flex-col gap-2 text-sm">
            {SHORTCUTS.map(({ action, keys, description }) => (
              <div
                key={action}
                className="flex items-center justify-between gap-4"
              >
                <dt className="text-muted-foreground">{description}</dt>
                <dd className="flex gap-1">
                  {keys.map((key) => (
                    <kbd
                      key={key}
                      className="min-w-6 rounded border bg-muted px-1.5 py-0.5 text-center font-mono text-xs"
                    >
                      {key}
                    </kbd>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
