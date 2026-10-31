// Injected into every bridge module that mentions `Buffer` (the desktop modules use Node's global).
// The `buffer` package lacks Node's "base64url" encoding, which the Coinbase JWT needs; add it.
import { Buffer } from "buffer";

const toString = Buffer.prototype.toString;
Buffer.prototype.toString = function (encoding, ...rest) {
  if (encoding !== "base64url") return toString.call(this, encoding, ...rest);
  return toString.call(this, "base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const from = Buffer.from;
Buffer.from = function (value, encoding, ...rest) {
  if (encoding === "base64url" && typeof value === "string") {
    return from.call(Buffer, value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  }
  return from.call(Buffer, value, encoding, ...rest);
};

export { Buffer };
