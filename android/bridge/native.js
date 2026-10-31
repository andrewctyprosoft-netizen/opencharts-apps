// Capacitor plugins the bridge uses. In a desktop browser (dev) the native ones are absent and
// the bridge falls back to the Vite dev proxy and localStorage.

import { Capacitor, registerPlugin } from "@capacitor/core";

export const isNative = Capacitor.isNativePlatform();

/** The app's own plugin (android/app/src/main/java/…/OcNativePlugin.java). */
export const OcNative = registerPlugin("OcNative");

export { App } from "@capacitor/app";
export { LocalNotifications } from "@capacitor/local-notifications";
