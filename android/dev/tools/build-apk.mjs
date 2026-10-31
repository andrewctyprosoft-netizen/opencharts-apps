// Builds the installable APK: the web bundle (www/), `cap sync`, then Gradle.
//   node dev/tools/build-apk.mjs            → dist/OpenCharts-<version>.apk (release, signed)
//   node dev/tools/build-apk.mjs --debug    → dist/OpenCharts-<version>-debug.apk (WebView debuggable)
//   --skip-web reuses the current www/.
// The release key is created on first use in android/release.keystore with a random password in
// android/keystore.properties (both git-ignored). Back them up: updates need the same key.

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const android = path.join(root, "android");
const debug = process.argv.includes("--debug");
const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
const win = process.platform === "win32";

function findJdk() {
  if (process.env.JAVA_HOME && fs.existsSync(process.env.JAVA_HOME)) return process.env.JAVA_HOME;
  const base = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Programs", "Temurin");
  const jdk = fs.existsSync(base) ? fs.readdirSync(base).find((d) => d.startsWith("jdk-21")) : null;
  if (!jdk) throw new Error("JDK 21 not found: set JAVA_HOME.");
  return path.join(base, jdk);
}

function findSdk() {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(process.env.LOCALAPPDATA || "", "Android", "Sdk");
  if (!fs.existsSync(path.join(sdk, "platforms"))) throw new Error(`Android SDK not found at ${sdk}: set ANDROID_HOME.`);
  return sdk;
}

const JAVA_HOME = findJdk();
const ANDROID_HOME = findSdk();
const env = { ...process.env, JAVA_HOME, ANDROID_HOME, PATH: `${path.join(JAVA_HOME, "bin")}${path.delimiter}${process.env.PATH}` };

function run(cmd, args, cwd = root) {
  const line = [cmd, ...args].join(" ");
  console.log(`> ${line}`);
  // One fixed command string: npx and gradlew are .cmd/.bat shims on Windows.
  const r = spawnSync(line, { cwd, stdio: "inherit", shell: true, env });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (!process.argv.includes("--skip-web")) run("node", [`"${path.join(root, "dev/tools/build-web.mjs")}"`]);
run("npx", ["cap", "sync", "android"]);

fs.writeFileSync(path.join(android, "local.properties"), `sdk.dir=${ANDROID_HOME.replace(/\\/g, "\\\\").replace(/:/g, "\\:")}\n`);

const props = path.join(android, "keystore.properties");
if (!debug && !fs.existsSync(props)) {
  const pass = crypto.randomBytes(24).toString("base64url");
  const keytool = path.join(JAVA_HOME, "bin", win ? "keytool.exe" : "keytool");
  const r = spawnSync(
    keytool,
    ["-genkeypair", "-keystore", path.join(android, "release.keystore"), "-alias", "opencharts", "-keyalg", "RSA", "-keysize", "3072",
      "-validity", "10000", "-storepass", pass, "-keypass", pass, "-dname", "CN=OpenCharts, O=ThriveLab"],
    { stdio: "inherit", env },
  );
  if (r.status !== 0) process.exit(r.status ?? 1);
  fs.writeFileSync(props, `storeFile=release.keystore\nstorePassword=${pass}\nkeyAlias=opencharts\nkeyPassword=${pass}\n`);
  console.log("Created android/release.keystore (keep it and keystore.properties safe; updates need them).");
}

run(`"${path.join(android, win ? "gradlew.bat" : "gradlew")}"`, [debug ? "assembleDebug" : "assembleRelease", "--console=plain"], android);

const built = path.join(android, "app", "build", "outputs", "apk", debug ? "debug" : "release", debug ? "app-debug.apk" : "app-release.apk");
const out = path.join(root, "dist", `OpenCharts-${version}${debug ? "-debug" : ""}.apk`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.copyFileSync(built, out);
console.log(`APK ready: ${out} (${(fs.statSync(out).size / 1048576).toFixed(1)} MB)`);
