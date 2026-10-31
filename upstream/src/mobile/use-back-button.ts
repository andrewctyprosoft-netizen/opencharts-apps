import { useEffect, useRef } from "react";
import { mobileBridge } from "./is-mobile.ts";

/**
 * While `active`, the Android back button calls `onBack` instead of leaving.
 *
 * The bridge tries handlers newest first, so a handler registers once per
 * activation and calls the latest `onBack` through a ref: re-registering on
 * every render (a new callback on each price tick) would move an older
 * handler, such as the drawing bar's, in front of a sheet opened above it.
 */
export function useBackButton(active: boolean, onBack: () => void) {
  const latest = useRef(onBack);
  useEffect(() => {
    latest.current = onBack;
  });
  useEffect(() => {
    const bridge = mobileBridge();
    if (!active || !bridge) return;
    return bridge.onBack(() => {
      latest.current();
      return true;
    });
  }, [active]);
}
