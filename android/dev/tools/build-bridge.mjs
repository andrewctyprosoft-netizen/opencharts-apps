// Bundles bridge/index.js into one classic script (bridge.js) for the WebView: node:crypto is
// swapped for the @noble shim, Buffer comes from the `buffer` package and process.env is empty.
// `--test` instead bundles bridge/core/exchanges.js with the same shim into dev/out/, so
// dev/tests/exchanges.test.mjs checks the Android signing against Node's own crypto.

import esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const shared = {
  bundle: true,
  alias: { "node:crypto": path.join(root, "bridge/shims/node-crypto.js") },
  inject: [path.join(root, "bridge/shims/buffer-global.js")],
  define: { "process.env": "{}" },
  target: ["chrome100"],
  logLevel: "warning",
};

/**
 * Build the bridge script.
 * @param {{ outfile?: string, minify?: boolean, write?: boolean }} [opts]
 * @returns {Promise<string>} the script text when write is false, else ""
 */
export async function buildBridge({ outfile = path.join(root, "www/bridge.js"), minify = true, write = true } = {}) {
  const r = await esbuild.build({
    ...shared,
    entryPoints: [path.join(root, "bridge/index.js")],
    format: "iife",
    platform: "browser",
    minify,
    sourcemap: minify ? false : "inline",
    outfile,
    write,
    legalComments: "eof",
  });
  return write ? "" : r.outputFiles[0].text;
}

/** The shimmed exchange module for the unit tests. */
export async function buildTestBundle() {
  await esbuild.build({
    ...shared,
    entryPoints: [path.join(root, "../desktop/electron/exchanges.js")],
    format: "esm",
    platform: "neutral",
    outfile: path.join(root, "dev/out/exchanges.bridge.mjs"),
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--test")) await buildTestBundle();
  else await buildBridge({ outfile: process.argv[2] ? path.resolve(process.argv[2]) : undefined });
}
