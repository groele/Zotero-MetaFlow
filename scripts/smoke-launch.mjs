import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const ADDON_ID = "metaflow@groele";
const RETRYABLE_RM_CODES = new Set(["EBUSY", "EPERM", "ENOTEMPTY", "EACCES"]);
const FATAL_PLUGIN_LINE_RE = /Exception calling bootstrap method \w+ on metaflow@groele|\[Zotero MetaFlow\] Error loading default prefs|(?:JavaScript Error|uncaught exception|SyntaxError|ReferenceError|TypeError|RangeError|URIError|EvalError|Unhandled rejection).*metaref\.js|metaref\.js.*(?:uncaught exception|SyntaxError|ReferenceError|TypeError)/i;

function delayMs(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function removeDirWithRetry(
  dirPath,
  { maxAttempts = 8, baseDelayMs = 150, rmSyncFn = fs.rmSync, sleepFn = delayMs } = {},
) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      rmSyncFn(dirPath, { recursive: true, force: true });
      return { removed: true, attempts: attempt, warning: null };
    }
    catch (err) {
      lastError = err;
      const code = err?.code;
      if (code === "ENOENT")
        return { removed: true, attempts: attempt, warning: null };
      if (!RETRYABLE_RM_CODES.has(code) || attempt === maxAttempts)
        break;
      await sleepFn(Math.min(1200, baseDelayMs * attempt));
    }
  }
  return {
    removed: false,
    attempts: maxAttempts,
    warning: lastError ? `Failed to remove temp profile (${lastError.code || "ERR"}): ${lastError.message}` : null,
  };
}

function killDirectChild(child) {
  try {
    child.kill("SIGKILL");
    return true;
  }
  catch {
    return false;
  }
}

export function terminateProcessTree(
  child,
  { platform = process.platform, spawnSyncFn = spawnSync, killFn = process.kill } = {},
) {
  if (!child || !child.pid)
    return false;
  if (platform === "win32") {
    try {
      const res = spawnSyncFn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
        timeout: 5000,
      });
      if (res && res.status === 0)
        return true;
    }
    catch {
      // Fall back to direct child.kill below.
    }
    return killDirectChild(child);
  }
  try {
    killFn(-child.pid, "SIGKILL");
    return true;
  }
  catch {
    return killDirectChild(child);
  }
}

export function resolveExtensionStage(repoRoot = REPO_ROOT, options = {}) {
  const opts = typeof options === "string" ? { profileDir: options } : (options ?? {});
  const existsFn = opts.existsFn ?? fs.existsSync;
  const unpackedDir = path.resolve(repoRoot, ".scaffold", "build", "addon");
  const unpackedManifest = path.join(unpackedDir, "manifest.json");
  const xpiPath = path.resolve(repoRoot, "dist", "zotero-metaflow.xpi");

  let stage;
  if (existsFn(unpackedManifest))
    stage = { addonId: ADDON_ID, mode: "proxy", sourcePath: unpackedDir };
  else if (existsFn(xpiPath))
    stage = { addonId: ADDON_ID, mode: "xpi", sourcePath: xpiPath };
  else
    throw new Error("MetaFlow build artifact not found (.scaffold/build/addon/manifest.json or dist/zotero-metaflow.xpi). Run `pnpm run build` first.");

  if (typeof opts.profileDir === "string" && opts.profileDir.length > 0) {
    const extDir = path.join(opts.profileDir, "extensions");
    fs.mkdirSync(extDir, { recursive: true });
    if (stage.mode === "proxy") {
      const targetPath = path.join(extDir, stage.addonId);
      fs.writeFileSync(targetPath, `${stage.sourcePath}\n`, "utf8");
      return { ...stage, targetPath };
    }
    const targetPath = path.join(extDir, `${stage.addonId}.xpi`);
    fs.copyFileSync(stage.sourcePath, targetPath);
    return { ...stage, targetPath };
  }
  return stage;
}

function inspectExtensionsState(profileDir, addonId = ADDON_ID) {
  const extJsonPath = path.join(profileDir, "extensions.json");
  if (!fs.existsSync(extJsonPath))
    return { addonSeen: false, addonActive: false };
  try {
    const parsed = JSON.parse(fs.readFileSync(extJsonPath, "utf8"));
    const addons = Array.isArray(parsed?.addons) ? parsed.addons : [];
    const entry = addons.find(item => item?.id === addonId);
    return {
      addonSeen: Boolean(entry),
      addonActive: Boolean(entry?.active && !entry?.appDisabled && !entry?.userDisabled),
    };
  }
  catch {
    return { addonSeen: false, addonActive: false };
  }
}

function scanPluginErrors(output) {
  if (!output)
    return [];
  const errors = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line && FATAL_PLUGIN_LINE_RE.test(line))
      errors.push(line);
  }
  return errors;
}

export async function runHeadlessLaunchSmoke(binaryPath, timeoutMs = 12000, options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const stageCheck = resolveExtensionStage(repoRoot, { existsFn: options.existsFn });
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "zotero-metaflow-smoke-"));
  const platform = options.platform ?? process.platform;
  const spawnArgs = typeof options.buildArgs === "function"
    ? options.buildArgs(profileDir)
    : ["-profile", profileDir, "-headless", "-no-remote", "-ZoteroDebugText"];

  let child = null;
  let timedOut = false;
  let treeKilled = false;
  let spawnError = null;
  let exitCode = null;
  let signal = null;
  const chunks = [];
  const maxLogBytes = 65_536;
  let collectedBytes = 0;

  const pushChunk = (chunk) => {
    if (collectedBytes >= maxLogBytes)
      return;
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    const slice = text.slice(0, maxLogBytes - collectedBytes);
    chunks.push(slice);
    collectedBytes += slice.length;
  };

  try {
    resolveExtensionStage(repoRoot, { profileDir, existsFn: options.existsFn });
    fs.writeFileSync(
      path.join(profileDir, "prefs.js"),
      `${[
        "user_pref(\"extensions.autoDisableScopes\", 0);",
        "user_pref(\"extensions.enabledScopes\", 15);",
        "user_pref(\"xpinstall.signatures.required\", false);",
        "user_pref(\"app.update.enabled\", false);",
        "user_pref(\"extensions.zotero.firstRun2\", false);",
        "user_pref(\"extensions.zotero.retractions.enabled\", false);",
      ].join("\n")}\n`,
      "utf8",
    );

    await new Promise((resolve) => {
      let settled = false;
      let timer = null;
      let killWaitTimer = null;
      const finish = () => {
        if (settled)
          return;
        settled = true;
        if (timer !== null)
          clearTimeout(timer);
        if (killWaitTimer !== null)
          clearTimeout(killWaitTimer);
        resolve();
      };

      try {
        child = spawn(binaryPath, spawnArgs, {
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
          detached: platform !== "win32",
        });
      }
      catch (err) {
        spawnError = err;
        finish();
        return;
      }

      child.stdout?.on("data", pushChunk);
      child.stderr?.on("data", pushChunk);
      child.on("error", (err) => {
        spawnError = err;
        finish();
      });
      child.on("close", (code, sig) => {
        exitCode = code;
        signal = sig;
        finish();
      });
      timer = setTimeout(() => {
        timedOut = true;
        treeKilled = terminateProcessTree(child, { platform });
        killWaitTimer = setTimeout(finish, 3000);
      }, timeoutMs);
    });

    const combinedOutput = chunks.join("").trim();
    const { addonSeen, addonActive } = inspectExtensionsState(profileDir, stageCheck.addonId);
    const pluginErrors = scanPluginErrors(combinedOutput);
    const ok = !spawnError && (timedOut || exitCode === 0) && pluginErrors.length === 0 && (!addonSeen || addonActive);
    const cleanup = await removeDirWithRetry(profileDir, options.cleanupOptions);

    return {
      ok,
      stageMode: stageCheck.mode,
      addonSeen,
      addonActive,
      timedOut,
      treeKilled,
      exitCode,
      signal,
      error: spawnError ? spawnError.message : null,
      pluginErrors,
      cleanupRemoved: cleanup.removed,
      cleanupAttempts: cleanup.attempts,
      cleanupWarning: cleanup.warning,
      logExcerpt: combinedOutput.slice(0, 1000),
    };
  }
  catch (err) {
    await removeDirWithRetry(profileDir, options.cleanupOptions);
    throw err;
  }
}
