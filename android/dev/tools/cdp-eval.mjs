// Debug helper: evaluate a JavaScript expression in the running app's WebView (debug APK) and
// print the result. Usage: node dev/tools/cdp-eval.mjs "window.__ocDesktop.selected()"

import { execFileSync } from "node:child_process";
import path from "node:path";

const SDK = process.env.ANDROID_HOME || path.join(process.env.LOCALAPPDATA || "", "Android", "Sdk");
const ADB = process.env.OC_ADB || path.join(SDK, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb");
const PORT = 9334;
const adb = (...a) => execFileSync(ADB, a, { encoding: "utf8" }).trim();

const pid = adb("shell", "pidof", "com.thrivelab.opencharts").split(/\s+/)[0];
const sock = pid && adb("shell", "cat", "/proc/net/unix").includes(`@webview_devtools_remote_${pid}`) ? `webview_devtools_remote_${pid}` : null;
if (!sock) throw new Error("No WebView devtools socket: is the debug app running?");
adb("forward", `tcp:${PORT}`, `localabstract:${sock}`);
const pages = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const page = pages.find((p) => p.type === "page" && /localhost/.test(p.url));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id !== 1) return;
  const r = msg.result;
  console.log(r.exceptionDetails ? `ERROR ${r.exceptionDetails.exception?.description}` : JSON.stringify(r.result.value, null, 2));
  ws.close();
};
ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: process.argv[2], awaitPromise: true, returnByValue: true } }));
