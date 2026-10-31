// Builds the OpenCharts terminal from ../../upstream into ../../web for the Electron shell.
// Relative base ("./") so the bundle loads from app://opencharts/; live Binance prices by default.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const upstream = path.join(root, "..", "upstream");
const web = path.join(root, "web");

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

fs.rmSync(web, { recursive: true, force: true });
fs.cpSync(path.join(upstream, "dist"), web, { recursive: true });
for (const f of ["LICENSE", "NOTICE"]) fs.copyFileSync(path.join(upstream, f), path.join(root, f));
console.log(`web bundle ready: ${web}`);
