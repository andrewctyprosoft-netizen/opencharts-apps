// Android stand-in for Electron's safeStorage (Windows DPAPI). A random 256-bit data key is kept
// wrapped by an Android Keystore key that never leaves the device's secure hardware; the
// OcNative plugin unwraps it once at start. Secrets are then sealed with AES-256-GCM, so the
// synchronous safeStorage API the core modules call keeps working.

import { gcm } from "@noble/ciphers/aes.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { Buffer } from "buffer";
import { OcNative, isNative } from "./native.js";

let dataKey = null;

const DEV_KEY = "oc-dev-data-key";

/** Unwrap (or create) the data key. Dev builds keep a throwaway key in localStorage. */
export async function initSecure() {
  if (isNative) {
    const { key } = await OcNative.dataKey();
    dataKey = new Uint8Array(Buffer.from(key, "base64"));
    return;
  }
  let saved = null;
  try {
    saved = localStorage.getItem(DEV_KEY);
  } catch {
    // storage blocked: a key for this session only
  }
  if (!saved) {
    saved = Buffer.from(randomBytes(32)).toString("base64");
    try {
      localStorage.setItem(DEV_KEY, saved);
    } catch {
      // ignore
    }
  }
  dataKey = new Uint8Array(Buffer.from(saved, "base64"));
}

/** Same shape as Electron's safeStorage. */
export const safeStorage = {
  isEncryptionAvailable: () => dataKey !== null,
  /** @param {string} text */
  encryptString(text) {
    if (!dataKey) throw new Error("Secure storage is not ready.");
    const nonce = randomBytes(12);
    const sealed = gcm(dataKey, nonce).encrypt(new TextEncoder().encode(String(text)));
    return Buffer.concat([Buffer.from(nonce), Buffer.from(sealed)]);
  },
  /** @param {Uint8Array} blob */
  decryptString(blob) {
    if (!dataKey) throw new Error("Secure storage is not ready.");
    const b = new Uint8Array(blob);
    const plain = gcm(dataKey, b.subarray(0, 12)).decrypt(b.subarray(12));
    return new TextDecoder().decode(plain);
  },
};
