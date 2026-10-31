// Builds what the Android app ships in its WebView (www/): the OpenCharts terminal from
// ../upstream (relative base so it loads from https://localhost/), the bridge script, and the
// API keys and OANDA token pages. `npx cap sync android` then copies www/ into the APK.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildBridge } from "./build-bridge.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const upstream = path.join(root, "..", "upstream");
const www = path.join(root, "www");

function run(cmd, args) {
  const line = `${cmd} ${args.join(" ")}`;
  console.log(`> ${line}`);
  // One command string (fixed, no user input) because npm/npx are .cmd shims on Windows.
  const r = spawnSync(line, {
    cwd: upstream,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, BASE_PATH: "./", VITE_ADAPTER: "binance" },
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (!fs.existsSync(path.join(upstream, "node_modules"))) run("npm", ["ci", "--no-audit", "--no-fund"]);
run("npx", ["vite", "build"]);

fs.rmSync(www, { recursive: true, force: true });
fs.cpSync(path.join(upstream, "dist"), www, { recursive: true });
await buildBridge({ outfile: path.join(www, "bridge.js") });
// The bridge (window.ocDesktop / window.ocMobile) must run before the terminal's module script.
const index = path.join(www, "index.html");
const html = fs.readFileSync(index, "utf8");
if (!html.includes("<head>")) throw new Error("www/index.html has no <head> to load the bridge in.");
fs.writeFileSync(index, html.replace("<head>", '<head>\n    <script src="./bridge.js"></script>'));
for (const page of ["keys.html", "oanda-token.html"]) fs.copyFileSync(path.join(root, "bridge", page), path.join(www, page));
for (const f of ["LICENSE", "NOTICE"]) fs.copyFileSync(path.join(upstream, f), path.join(www, f));
console.log(`web bundle ready: ${www}`);
