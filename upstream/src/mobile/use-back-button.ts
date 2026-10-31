import { useEffect } from "react";
import { mobileBridge } from "./is-mobile.ts";

/** While `active`, the Android back button calls `onBack` instead of leaving. */
export function useBackButton(active: boolean, onBack: () => void) {
  useEffect(() => {
    const bridge = mobileBridge();
    if (!active || !bridge) return;
    return bridge.onBack(() => {
      onBack();
      return true;
    });
  }, [active, onBack]);
}
