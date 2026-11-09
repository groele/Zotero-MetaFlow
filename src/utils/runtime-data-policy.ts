export const RUNTIME_HISTORY_LIMIT = 200;
export const RUNTIME_HISTORY_TTL = 30 * 24 * 60 * 60 * 1000;
export const RUNTIME_HISTORY_BYTES = 2 * 1024 * 1024;

function readIntPref(key: string, fallback: number, min: number, max: number): number {
  try {
    const value = (Zotero as any)?.Prefs?.get?.(`extensions.zotero.metaref.${key}`, true);
    const num = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
    return Number.isInteger(num) && num >= min && num <= max ? num : fallback;
  }
  catch {
    return fallback;
  }
}

export function runtimeHistoryDays(): number {
  return readIntPref("cache.historyDays", 30, 1, 365);
}

export function runtimeHistoryLimit(): number {
  return readIntPref("cache.historyLimit", RUNTIME_HISTORY_LIMIT, 20, 2000);
}

export function runtimeHistoryTTL(): number {
  return runtimeHistoryDays() * 24 * 60 * 60 * 1000;
}
export interface RuntimeItem {
  libraryID: number;
  key: string;
  saved: boolean;
  fields: string[];
  reasons: string[];
}
export interface RuntimeStage {
  name: string;
  startedAt: number;
  endedAt?: number;
  status: "running" | "completed" | "failed" | "interrupted" | "cancelled";
  processed: number;
  saved: number;
  failed: number;
  warnings: number;
  rules: string[];
  reasons: string[];
}
export interface RuntimeRun {
  id: string;
  at: number;
  kind: string;
  total: number;
  processed: number;
  saved: number;
  failed: number;
  warnings: number;
  cancelled: boolean;
  durationMs: number;
  rules: string[];
  reasons: string[];
  items: RuntimeItem[];
  status: "running" | "completed" | "failed" | "interrupted" | "cancelled";
  stages: RuntimeStage[];
  truncated: boolean;
}
export interface RuntimeData { version: 1; updatedAt: number; runs: RuntimeRun[] }
const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
const names = (value: unknown) => Array.isArray(value) ? [...new Set(value.filter((name): name is string => typeof name === "string" && /^[a-z][a-z0-9.-]{0,99}$/i.test(name)))].slice(0, 40) : [];

/** Whitelist the persisted schema: never retain titles, field values, URLs or error text. */
export function normalizeRuntimeRun(value: unknown): RuntimeRun | undefined {
  if (!value || typeof value !== "object")
    return;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || !/^[a-z0-9-]{1,100}$/i.test(row.id) || typeof row.at !== "number" || !Number.isFinite(row.at))
    return;
  const items: RuntimeItem[] = [];
  for (const raw of Array.isArray(row.items) ? row.items.slice(0, 50) : []) {
    if (!raw || typeof raw !== "object")
      continue;
    const item = raw as Record<string, unknown>;
    if (!count(item.libraryID) || typeof item.key !== "string" || !/^[A-Z0-9]{8}$/.test(item.key))
      continue;
    items.push({ libraryID: count(item.libraryID), key: item.key, saved: item.saved === true, fields: names(item.fields), reasons: names(item.reasons) });
  }
  const stages = (Array.isArray(row.stages) ? row.stages.slice(0, 20) : []).flatMap((raw): RuntimeStage[] => {
    if (!raw || typeof raw !== "object")
      return [];
    const stage = raw as Record<string, unknown>;
    if (typeof stage.name !== "string" || !/^[a-z][a-z0-9.-]{0,99}$/i.test(stage.name) || typeof stage.startedAt !== "number" || !Number.isFinite(stage.startedAt))
      return [];
    const status = ["running", "completed", "failed", "interrupted", "cancelled"].includes(stage.status as string) ? stage.status as RuntimeStage["status"] : "interrupted";
    return [{ name: stage.name, startedAt: stage.startedAt, endedAt: typeof stage.endedAt === "number" && Number.isFinite(stage.endedAt) ? stage.endedAt : undefined, status, processed: count(stage.processed), saved: count(stage.saved), failed: count(stage.failed), warnings: count(stage.warnings), rules: names(stage.rules), reasons: names(stage.reasons) }];
  });
  const status = ["running", "completed", "failed", "interrupted", "cancelled"].includes(row.status as string) ? row.status as RuntimeRun["status"] : "completed";
  return { id: row.id, at: row.at, kind: names([row.kind])[0] || "batch", total: count(row.total), processed: count(row.processed), saved: count(row.saved), failed: count(row.failed), warnings: count(row.warnings), cancelled: row.cancelled === true, durationMs: typeof row.durationMs === "number" && Number.isFinite(row.durationMs) ? Math.max(0, Math.round(row.durationMs)) : 0, rules: names(row.rules), reasons: names(row.reasons), items, status, stages, truncated: row.truncated === true || (Array.isArray(row.items) && row.items.length > 50) };
}

export function boundRuntimeRuns(values: unknown[], now = Date.now()): RuntimeRun[] {
  const ttl = runtimeHistoryTTL();
  const limit = runtimeHistoryLimit();
  const unique = new Map<string, RuntimeRun>();
  for (const value of values) {
    const row = normalizeRuntimeRun(value);
    if (row && row.at > now - ttl && row.at <= now + 300_000)
      unique.set(row.id, row);
  }
  const recent = [...unique.values()].sort((a, b) => a.at - b.at).slice(-limit);
  let bytes = 128;
  const kept: RuntimeRun[] = [];
  const encoder = new TextEncoder();
  for (const row of recent.reverse()) {
    bytes += encoder.encode(JSON.stringify(row)).byteLength + 1;
    if (bytes > RUNTIME_HISTORY_BYTES)
      break;
    kept.push(row);
  }
  return kept.reverse();
}
