import type { Rule } from "../modules/rules/rule-base";
import { getPref } from "./prefs";

const MAX_FINGERPRINTS = 20_000;
const cleanFingerprints = new Map<string, number>();
const ruleFnIds = new WeakMap<(...args: any[]) => any, number>();
let nextRuleFnId = 1;
let cacheHits = 0;
let cacheMisses = 0;
let prefsRevision = 0;

function fnv1a64(input: string): string {
  let h1 = 0x811C9DC5;
  let h2 = 0xC9DC5118;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= code ^ (i & 0xFF);
    h2 = Math.imul(h2, 0x01000193);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, "0")}${(h2 >>> 0).toString(16).padStart(8, "0")}`;
}

function getRuleFnId(fn: (...args: any[]) => any): number {
  let id = ruleFnIds.get(fn);
  if (!id) {
    id = nextRuleFnId++;
    ruleFnIds.set(fn, id);
  }
  return id;
}

function safeSerialize(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  }
  catch {
    return String(value);
  }
}

function attachmentSnapshot(item: Zotero.Item): string {
  try {
    if (typeof item.getAttachments !== "function")
      return "";
    const ids = item.getAttachments();
    if (!Array.isArray(ids) || !ids.length)
      return "";
    if (typeof Zotero !== "undefined" && typeof Zotero.Items?.get === "function") {
      return ids.map((id) => {
        const att = Zotero.Items.get(id);
        return att && typeof att.getField === "function"
          ? `${id}:${att.version ?? 0}:${att.getField("title") || ""}:${(att as any).attachmentPath || ""}`
          : String(id);
      }).join("|");
    }
    return ids.join(",");
  }
  catch {
    return "";
  }
}

function relevantRulePrefsSnapshot(): string {
  const keys = [
    "rule.require-journal-abbr.usefull",
    "rule.require-journal-abbr.usefullZh",
    "rule.require-journal-abbr.customDataPath",
    "rule.correct-attachment-roles.renameFiles",
    "rule.correct-attachment-roles.renameTemplate",
    "rule.correct-attachment-roles.syncTitle",
  ];
  return keys.map(key => `${key}=${String(getPref(key as any, ""))}`).join("&");
}

export function isEligibleForLintFingerprint(rules: Rule<any>[], optionsMap: Map<string, any>): boolean {
  const active = rules.filter(rule => optionsMap.has(rule.id) && optionsMap.get(rule.id) !== false);
  if (!active.length)
    return false;
  return active.every(rule => rule.category !== "tool");
}

export function computeBatchRuleSignature(rules: Rule<any>[], optionsMap: Map<string, any>): string {
  const parts: string[] = [`rev:${prefsRevision}`, relevantRulePrefsSnapshot()];
  for (const rule of rules) {
    if (!optionsMap.has(rule.id) || optionsMap.get(rule.id) === false)
      continue;
    parts.push(`${rule.id}#${getRuleFnId(rule.apply)}:${safeSerialize(optionsMap.get(rule.id))}`);
  }
  return fnv1a64(parts.join("|"));
}

export function computeItemLintSignature(
  item: Zotero.Item,
  rules: Rule<any>[],
  optionsMap: Map<string, any>,
  batchRuleSig?: string,
): string {
  const ruleSig = batchRuleSig ?? computeBatchRuleSignature(rules, optionsMap);
  const itemID = item.id || 0;
  const version = item.version || 0;
  const dateModified = typeof item.getField === "function" ? String(item.getField("dateModified" as any) || "") : "";
  const jsonText = safeSerialize(typeof item.toJSON === "function" ? item.toJSON() : {});
  const attachments = attachmentSnapshot(item);
  const stateHash = fnv1a64(`${version}|${dateModified}|${jsonText}|${attachments}`);
  return `${itemID}:${ruleSig}:${stateHash}`;
}

export function hasCleanLintFingerprint(signature: string): boolean {
  if (!signature || signature.startsWith("0:")) {
    cacheMisses++;
    return false;
  }
  const existing = cleanFingerprints.get(signature);
  if (existing === undefined) {
    cacheMisses++;
    return false;
  }
  cleanFingerprints.delete(signature);
  cleanFingerprints.set(signature, Date.now());
  cacheHits++;
  return true;
}

export function recordCleanLintFingerprint(signature: string): void {
  if (!signature || signature.startsWith("0:"))
    return;
  cleanFingerprints.delete(signature);
  while (cleanFingerprints.size >= MAX_FINGERPRINTS) {
    const oldest = cleanFingerprints.keys().next().value;
    if (oldest === undefined)
      break;
    cleanFingerprints.delete(oldest);
  }
  cleanFingerprints.set(signature, Date.now());
}

export function invalidateItemLintFingerprint(itemID?: number): void {
  if (itemID === undefined) {
    cleanFingerprints.clear();
    return;
  }
  const prefix = `${itemID}:`;
  for (const key of cleanFingerprints.keys()) {
    if (key.startsWith(prefix))
      cleanFingerprints.delete(key);
  }
}

export function bumpLintPrefsRevision(): void {
  prefsRevision++;
  cleanFingerprints.clear();
}

export function clearLintFingerprintCache(): void {
  cleanFingerprints.clear();
  cacheHits = 0;
  cacheMisses = 0;
}

export function getLintFingerprintStats(): { size: number; hits: number; misses: number } {
  return {
    size: cleanFingerprints.size,
    hits: cacheHits,
    misses: cacheMisses,
  };
}
