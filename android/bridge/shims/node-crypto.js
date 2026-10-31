// The slice of node:crypto that bridge/core/exchanges.js uses, on audited pure-JS libraries
// (@noble), so the desktop app's signing code runs unchanged inside the Android WebView.
// Synchronous like Node's API: HMAC-SHA256, ES256 (P-256, IEEE P1363 signatures), Ed25519, random bytes.

import { p256 } from "@noble/curves/nist.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes as nobleRandom } from "@noble/hashes/utils.js";
import { Buffer } from "buffer";

const bytes = (v) => (typeof v === "string" ? new TextEncoder().encode(v) : new Uint8Array(v));

/**
 * HMAC like `crypto.createHmac("sha256", key).update(data).digest(enc)`.
 * @param {string} alg only "sha256"
 * @param {string | Uint8Array} key
 */
function createHmac(alg, key) {
  if (alg !== "sha256") throw new Error(`Unsupported HMAC ${alg}`);
  const mac = hmac.create(sha256, bytes(key));
  const api = {
    update(data) {
      mac.update(bytes(data));
      return api;
    },
    digest(encoding) {
      const out = Buffer.from(mac.digest());
      return encoding ? out.toString(encoding) : out;
    },
  };
  return api;
}

// ── Minimal DER reading, enough for EC private keys ──

function derRead(buf, at) {
  const tag = buf[at];
  let len = buf[at + 1];
  let off = at + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let i = 0; i < n; i++) len = (len << 8) | buf[off + i];
    off += n;
  }
  return { tag, start: off, end: off + len };
}

/** Children of a constructed DER element. */
function derChildren(buf, el) {
  const out = [];
  for (let at = el.start; at < el.end; ) {
    const child = derRead(buf, at);
    out.push(child);
    at = child.end;
  }
  return out;
}

/** The 32-byte private scalar of a SEC1 ("EC PRIVATE KEY") structure. */
function sec1Scalar(buf, el) {
  const kids = derChildren(buf, el);
  const oct = kids.find((k) => k.tag === 0x04);
  if (!oct) throw new Error("Not an EC private key.");
  return buf.slice(oct.start, oct.end);
}

/**
 * Parse a private key like `crypto.createPrivateKey`: a PEM (SEC1 or PKCS#8, P-256) or a DER
 * PKCS#8 Ed25519 key. Returns a small key object `sign` understands.
 * @param {string | {key: Uint8Array, format: "der", type: "pkcs8"}} input
 */
function createPrivateKey(input) {
  if (typeof input === "string") {
    const m = /-----BEGIN ([A-Z ]+)-----([\s\S]+?)-----END \1-----/.exec(input);
    if (!m) throw new Error("Unreadable PEM key.");
    const der = new Uint8Array(Buffer.from(m[2].replace(/\s+/g, ""), "base64"));
    const top = derRead(der, 0);
    if (m[1] === "EC PRIVATE KEY") return { type: "p256", d: sec1Scalar(der, top) };
    if (m[1] === "PRIVATE KEY") {
      // PKCS#8: version, algorithm, OCTET STRING wrapping the SEC1 key.
      const kids = derChildren(der, top);
      const inner = kids.find((k) => k.tag === 0x04);
      const sec1 = derRead(der, inner.start);
      return { type: "p256", d: sec1Scalar(der, sec1) };
    }
    throw new Error(`Unsupported key type ${m[1]}.`);
  }
  const der = new Uint8Array(input.key);
  // PKCS#8 Ed25519: the last 32 bytes are the seed (OCTET STRING inside the OCTET STRING).
  return { type: "ed25519", d: der.slice(der.length - 32) };
}

/**
 * Sign like `crypto.sign(alg, data, key)`. ES256 gives the 64-byte r||s form (dsaEncoding
 * "ieee-p1363"); Ed25519 takes a null algorithm.
 */
function sign(alg, data, keyOrOpts) {
  const key = keyOrOpts && keyOrOpts.key && keyOrOpts.key.type ? keyOrOpts.key : keyOrOpts;
  const msg = bytes(data);
  if (key.type === "p256") {
    if (alg !== "sha256") throw new Error("ES256 needs sha256.");
    return Buffer.from(p256.sign(msg, key.d, { prehash: true, format: "compact" }));
  }
  if (key.type === "ed25519") return Buffer.from(ed25519.sign(msg, key.d));
  throw new Error("Unknown key.");
}

const randomBytes = (n) => Buffer.from(nobleRandom(n));

export { createHmac, createPrivateKey, sign, randomBytes };
export default { createHmac, createPrivateKey, sign, randomBytes };
