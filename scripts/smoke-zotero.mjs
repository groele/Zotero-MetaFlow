import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { runHeadlessLaunchSmoke } from "./smoke-launch.mjs";

export {
  removeDirWithRetry,
  resolveExtensionStage,
  runHeadlessLaunchSmoke,
  terminateProcessTree,
} from "./smoke-launch.mjs";

const __filename = fileURLToPath(import.meta.url);
const ZIP_EOCD_SIG = 0x06054B50;
const ZIP_CD_SIG = 0x02014B50;
const ZIP_LOCAL_SIG = 0x04034B50;
const ZIP_EOCD_MIN_LEN = 22;

export const HOST_CONTRACTS = Object.freeze([
  { id: "itemTreeManager", entries: ["chrome/content/zotero/xpcom/pluginAPI/itemTreeManager.js"], symbols: ["registerColumn", "unregisterColumn", "isCustomColumn"] },
  { id: "itemPaneManager", entries: ["chrome/content/zotero/xpcom/pluginAPI/itemPaneManager.js"], symbols: ["registerSection", "unregisterSection", "registerInfoRow", "unregisterInfoRow", "refreshInfoRow"] },
  { id: "preferencePanes", entries: ["chrome/content/zotero/xpcom/preferencePanes.js"], symbols: ["pluginPanes", "register", "unregister"] },
  { id: "collectionTreeRow", entries: ["chrome/content/zotero/xpcom/collectionTreeRow.js"], symbols: ["getName", "isDuplicates"] },
  { id: "duplicatesMergePane", entries: ["chrome/content/zotero/elements/duplicatesMergePane.js"], symbols: ["zotero-duplicates-merge-button"] },
  { id: "editableText", entries: ["chrome/content/zotero/elements/editableText.js"], symbols: ["editable-text"] },
  { id: "progressWindow", entries: ["chrome/content/zotero/xpcom/progressWindow.js"], symbols: ["ProgressWindowSet", "tile"] },
]);

const PLATFORM_CANDIDATES = Object.freeze({
  win32: ["C:\\Program Files\\Zotero\\zotero.exe", "C:\\Program Files (x86)\\Zotero\\zotero.exe"],
  darwin: ["/Applications/Zotero.app/Contents/MacOS/zotero"],
  linux: ["/usr/bin/zotero", "/usr/lib/zotero/zotero"],
});

export function detectZoteroBinary(envPath = process.env.ZOTERO_PLUGIN_ZOTERO_BIN_PATH, platform = process.platform, existsFn = fs.existsSync) {
  if (typeof envPath === "string" && envPath.trim().length > 0) {
    const trimmed = envPath.trim();
    if (existsFn(trimmed))
      return trimmed;
    const joined = path.join(trimmed, platform === "win32" ? "zotero.exe" : "zotero");
    return existsFn(joined) ? joined : null;
  }
  return (PLATFORM_CANDIDATES[platform] ?? PLATFORM_CANDIDATES.linux).find(c => existsFn(c)) ?? null;
}

export function resolveZoteroHostPaths(binaryPath, existsFn = fs.existsSync) {
  let resolvedBinary = binaryPath;
  try {
    if (existsFn === fs.existsSync)
      resolvedBinary = fs.realpathSync(binaryPath);
  }
  catch {
    resolvedBinary = binaryPath;
  }
  const binDir = path.dirname(resolvedBinary);
  const baseDirs = [binDir];
  const macResourcesDir = path.resolve(binDir, "..", "Resources");
  if (existsFn(macResourcesDir))
    baseDirs.push(macResourcesDir);

  const pickFirst = (rels) => {
    for (const base of baseDirs) {
      for (const rel of rels) {
        const full = path.join(base, rel);
        if (existsFn(full))
          return full;
      }
    }
    return null;
  };

  return {
    binaryPath: resolvedBinary,
    omniJaPath: pickFirst(["app/omni.ja", "omni.ja"]),
    platformIniPath: pickFirst(["platform.ini"]),
    applicationIniPath: pickFirst(["app/application.ini", "application.ini"]),
  };
}

function findEocdOffset(buf) {
  const minOffset = Math.max(0, buf.length - (ZIP_EOCD_MIN_LEN + 65535));
  let fallback = -1;
  for (let offset = buf.length - ZIP_EOCD_MIN_LEN; offset >= minOffset; offset--) {
    if (buf.readUInt32LE(offset) !== ZIP_EOCD_SIG)
      continue;
    if (offset + ZIP_EOCD_MIN_LEN + buf.readUInt16LE(offset + 20) === buf.length)
      return offset;
    if (fallback === -1)
      fallback = offset;
  }
  return fallback;
}

export function readZipEntries(zipBuffer, targetNames) {
  const buf = Buffer.isBuffer(zipBuffer)
    ? zipBuffer
    : Buffer.from(zipBuffer.buffer, zipBuffer.byteOffset, zipBuffer.byteLength);
  const eocdOffset = buf.length >= ZIP_EOCD_MIN_LEN ? findEocdOffset(buf) : -1;
  if (eocdOffset === -1)
    throw new Error("Invalid ZIP buffer: EOCD signature not found");

  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  const cdSize = buf.readUInt32LE(eocdOffset + 12);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  if (cdOffset + cdSize > buf.length)
    throw new Error(`Invalid ZIP central directory bounds (offset=${cdOffset}, size=${cdSize})`);

  const targets = new Set(Array.from(targetNames, n => String(n).replace(/\\/g, "/").replace(/^\/+/, "")));
  const results = new Map();
  if (targets.size === 0)
    return results;

  let pos = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== ZIP_CD_SIG)
      throw new Error(`Invalid central directory entry at offset ${pos}`);
    const compressionMethod = buf.readUInt16LE(pos + 10);
    const compressedSize = buf.readUInt32LE(pos + 20);
    const fileNameLength = buf.readUInt16LE(pos + 28);
    const extraFieldLength = buf.readUInt16LE(pos + 30);
    const fileCommentLength = buf.readUInt16LE(pos + 32);
    const localHeaderOffset = buf.readUInt32LE(pos + 42);
    const entryName = buf.subarray(pos + 46, pos + 46 + fileNameLength).toString("utf8");
    pos += 46 + fileNameLength + extraFieldLength + fileCommentLength;

    if (!targets.has(entryName))
      continue;
    if (localHeaderOffset + 30 > buf.length || buf.readUInt32LE(localHeaderOffset) !== ZIP_LOCAL_SIG)
      throw new Error(`Invalid local file header for "${entryName}"`);

    const dataStart = localHeaderOffset + 30 + buf.readUInt16LE(localHeaderOffset + 26) + buf.readUInt16LE(localHeaderOffset + 28);
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buf.length)
      throw new Error(`Truncated entry payload for "${entryName}"`);

    const rawSlice = buf.subarray(dataStart, dataEnd);
    if (compressionMethod !== 0 && compressionMethod !== 8)
      throw new Error(`Unsupported ZIP compression method ${compressionMethod} for "${entryName}"`);
    results.set(entryName, (compressionMethod === 0 ? rawSlice : zlib.inflateRawSync(rawSlice)).toString("utf8"));
    if (results.size === targets.size)
      break;
  }
  return results;
}

export function parseIniText(iniText) {
  const sections = {};
  if (!iniText || typeof iniText !== "string")
    return sections;
  let current = "";
  for (const rawLine of iniText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";") || line.startsWith("#"))
      continue;
    if (line.startsWith("[") && line.endsWith("]")) {
      current = line.slice(1, -1).trim();
      sections[current] ??= {};
      continue;
    }
    const eqIndex = line.indexOf("=");
    if (eqIndex !== -1) {
      sections[current] ??= {};
      sections[current][line.slice(0, eqIndex).trim()] = line.slice(eqIndex + 1).trim();
    }
  }
  return sections;
}

export function verifyZoteroOmniContracts(entriesMap, platformIniText = null, applicationIniText = null) {
  const platformIni = parseIniText(platformIniText);
  const appIni = parseIniText(applicationIniText);
  const hostInfo = { zoteroVersion: appIni.App?.Version ?? null, geckoMilestone: platformIni.Build?.Milestone ?? null };
  const contracts = HOST_CONTRACTS.map((spec) => {
    const matchedEntry = spec.entries.find(c => entriesMap.has(c)) ?? null;
    const entry = matchedEntry ?? spec.entries[0];
    const sourceText = matchedEntry ? entriesMap.get(matchedEntry) : null;
    const matchedSymbols = [];
    const missingSymbols = [];
    if (typeof sourceText === "string") {
      for (const symbol of spec.symbols)
        (sourceText.includes(symbol) ? matchedSymbols : missingSymbols).push(symbol);
    }
    else {
      missingSymbols.push(...spec.symbols);
    }
    return { id: spec.id, entry, foundEntry: matchedEntry !== null, ok: matchedEntry !== null && missingSymbols.length === 0, requiredSymbols: [...spec.symbols], matchedSymbols, missingSymbols };
  });
  const passedCount = contracts.filter(c => c.ok).length;
  return { ok: passedCount === contracts.length, passedCount, failedCount: contracts.length - passedCount, hostInfo, contracts };
}

export function parseCliArgs(argv) {
  const args = { checkOnly: false, launch: false, timeoutMs: 12000, json: false, requireHost: false, zoteroBin: null };
  for (const token of argv) {
    if (token === "--check-only") {
      args.checkOnly = true;
    }
    else if (token === "--launch") {
      args.launch = true;
    }
    else if (token === "--json") {
      args.json = true;
    }
    else if (token === "--require-host") {
      args.requireHost = true;
    }
    else if (token.startsWith("--timeout=")) {
      const parsed = Number.parseInt(token.slice("--timeout=".length), 10);
      if (Number.isFinite(parsed) && parsed > 0)
        args.timeoutMs = parsed;
    }
    else if (token.startsWith("--zotero-bin=")) {
      args.zoteroBin = token.slice("--zotero-bin=".length).trim() || null;
    }
  }
  if (args.checkOnly)
    args.launch = false;
  return args;
}

async function runCli() {
  const args = parseCliArgs(process.argv.slice(2));
  const binaryPath = detectZoteroBinary(args.zoteroBin ?? process.env.ZOTERO_PLUGIN_ZOTERO_BIN_PATH);
  if (!binaryPath) {
    const message = "Zotero binary not found (set --zotero-bin=<path> or ZOTERO_PLUGIN_ZOTERO_BIN_PATH)";
    if (args.json)
      console.log(JSON.stringify({ status: args.requireHost ? "fail" : "skip", message }, null, 2));
    else
      console[args.requireHost ? "error" : "log"](`[${args.requireHost ? "FAIL" : "SKIP"}] ${message}`);
    process.exit(args.requireHost ? 1 : 0);
  }

  const paths = resolveZoteroHostPaths(binaryPath);
  if (!paths.omniJaPath) {
    const message = `Zotero omni.ja not found near ${binaryPath}`;
    if (args.json)
      console.log(JSON.stringify({ status: "fail", message, binaryPath }, null, 2));
    else
      console.error(`[FAIL] ${message}`);
    process.exit(1);
  }

  const entriesMap = readZipEntries(fs.readFileSync(paths.omniJaPath), HOST_CONTRACTS.flatMap(s => s.entries));
  const report = verifyZoteroOmniContracts(
    entriesMap,
    paths.platformIniPath ? fs.readFileSync(paths.platformIniPath, "utf8") : null,
    paths.applicationIniPath ? fs.readFileSync(paths.applicationIniPath, "utf8") : null,
  );
  const launch = args.launch ? await runHeadlessLaunchSmoke(paths.binaryPath, args.timeoutMs) : null;
  const overallOk = report.ok && (!launch || launch.ok);

  if (args.json) {
    console.log(JSON.stringify({ status: overallOk ? "pass" : "fail", ...paths, ...report, launch }, null, 2));
    process.exit(overallOk ? 0 : 1);
  }

  console.log(`Zotero MetaFlow Host Contract Smoke Check\n  Binary : ${paths.binaryPath}\n  Archive: ${paths.omniJaPath}\n  Version: Zotero ${report.hostInfo.zoteroVersion ?? "unknown"} (Gecko ${report.hostInfo.geckoMilestone ?? "unknown"})\n`);
  for (const c of report.contracts) {
    const counts = `${c.matchedSymbols.length}/${c.requiredSymbols.length} symbols`;
    console[c.ok ? "log" : "error"](`[${c.ok ? "PASS" : "FAIL"}] ${c.id.padEnd(20)} ${c.entry} (${counts}${c.ok ? "" : `; ${c.foundEntry ? `missing: ${c.missingSymbols.join(", ")}` : "entry not found"}`})`);
  }
  if (launch) {
    const detail = launch.timedOut
      ? `alive through ${args.timeoutMs}ms window (stage=${launch.stageMode}, addonSeen=${launch.addonSeen}, addonActive=${launch.addonActive}, treeKilled=${launch.treeKilled}, cleaned=${launch.cleanupRemoved})`
      : `exit=${launch.exitCode} (stage=${launch.stageMode}, addonSeen=${launch.addonSeen}, addonActive=${launch.addonActive}, cleaned=${launch.cleanupRemoved})`;
    console[launch.ok ? "log" : "error"](`[${launch.ok ? "PASS" : "FAIL"}] ${"headlessLaunch".padEnd(20)} isolated profile (${detail})`);
    for (const errLine of launch.pluginErrors)
      console.error(`       pluginError: ${errLine}`);
    if (launch.cleanupWarning)
      console.warn(`[WARN] ${launch.cleanupWarning}`);
  }
  console.log(`\nSummary: ${report.passedCount}/${report.contracts.length} host contracts passed.`);
  process.exit(overallOk ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename))
  void runCli();
