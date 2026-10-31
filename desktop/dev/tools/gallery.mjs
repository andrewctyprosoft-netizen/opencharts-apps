// Bundles dev/tools/gallery.ts into dev/out/gallery.html (one cell per extra drawing tool).
// Uses the esbuild that ships with the terminal's Vite install.

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(path.join(root, "..", "upstream", "package.json"));
const esbuild = require("esbuild");

const { outputFiles } = await esbuild.build({
  entryPoints: [path.join(root, "dev", "tools", "gallery.ts")],
  bundle: true,
  write: false,
  format: "iife",
});
const out = path.join(root, "dev", "out", "gallery.html");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(
  out,
  `<!doctype html><meta charset="utf-8"><title>Drawing tools gallery</title>` +
    `<body style="margin:0;background:#131722"><script>${outputFiles[0].text}</script></body>`,
);
console.log(`gallery: ${out}`);
