import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/utils.ts";
import { useBackButton } from "./use-back-button.ts";

/**
 * OpenCharts Mobile addition: a bottom sheet over the app. The Android back
 * button and a tap on the backdrop close it.
 */
export function Sheet({
  open,
  title,
  onClose,
  children,
  full,
  testId,
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Take the whole screen height (lists, search). */
  full?: boolean;
  testId?: string;
}) {
  useBackButton(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex flex-col justify-end" data-testid={testId}>
      <div className="absolute inset-0 bg-black/60 oc-fade-in" onClick={onClose} />
      <div
        className={cn(
          "relative flex flex-col bg-card border-t border-border rounded-t-2xl shadow-2xl oc-slide-up",
          full ? "h-[calc(100%-var(--oc-safe-top)-12px)]" : "max-h-[85%]",
        )}
        style={{ paddingBottom: "var(--oc-safe-bottom)" }}
      >
        <div className="flex justify-center pt-2">
          <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
        </div>
        <div className="flex items-center gap-2 px-4 pb-2 pt-1">
          <div className="flex-1 min-w-0 text-base font-semibold truncate">{title}</div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="-mr-2 flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground active:bg-secondary"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </div>
  );
}
