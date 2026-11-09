import { describe, expect, it } from "vitest";
import { boundRuntimeRuns, normalizeRuntimeRun, RUNTIME_HISTORY_BYTES, RUNTIME_HISTORY_LIMIT, RUNTIME_HISTORY_TTL } from "./runtime-data-policy";

const run = (id = "fixture", at = Date.now()) => ({ id, at, kind: "metadata", total: 2, processed: 2, saved: 1, failed: 0, warnings: 1, cancelled: false, durationMs: 12.4, rules: ["tool-review-metadata"], reasons: ["metadata-auto-conflict"], items: [{ libraryID: 1, key: "ABCDEFGH", saved: true, fields: ["title"], reasons: ["info"] }], truncated: false });

describe("bounded runtime data", () => {
  it("persists only the whitelist and omits secrets and arbitrary values", () => {
    const value = { ...run(), secretKey: "private-key", title: "Private title", message: "token=secret", items: [{ ...run().items[0], before: "private-before", after: "private-after", source: "https://api.test?key=secret" }] };
    const text = JSON.stringify(normalizeRuntimeRun(value));
    for (const secret of ["private-key", "Private title", "token=secret", "private-before", "private-after", "https://"])
      expect(text).not.toContain(secret);
    expect(JSON.parse(text).items[0].fields).toEqual(["title"]);
  });
  it("upserts runs, expires old data and excludes invalid future timestamps", () => {
    const now = Date.now();
    const rows = boundRuntimeRuns([run("same", now - 1), { ...run("same", now), saved: 2 }, run("old", now - RUNTIME_HISTORY_TTL - 1), run("future", now + 600_000)], now);
    expect(rows).toHaveLength(1);
    expect(rows[0].saved).toBe(2);
  });
  it("limits history length and marks capped item inventories", () => {
    const now = Date.now();
    const rows = boundRuntimeRuns(Array.from({ length: 1000 }, (_, index) => run(`run-${index}`, now - 1000 + index)), now);
    expect(rows).toHaveLength(RUNTIME_HISTORY_LIMIT);
    const capped = normalizeRuntimeRun({ ...run(), items: Array.from({ length: 100 }, () => run().items[0]) })!;
    expect(capped.items).toHaveLength(50);
    expect(capped.truncated).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify({ version: 1, runs: rows })).byteLength).toBeLessThan(RUNTIME_HISTORY_BYTES);
  });
  it("enforces the byte cap even when every run contains many valid names", () => {
    const now = Date.now();
    const fields = Array.from({ length: 40 }, (_, index) => `field-${index}-${"x".repeat(85)}`);
    const rows = boundRuntimeRuns(Array.from({ length: 200 }, (_, index) => ({ ...run(`large-${index}`, now - 200 + index), items: Array.from({ length: 50 }, () => ({ ...run().items[0], fields })) })), now);
    expect(rows.length).toBeLessThan(200);
    expect(new TextEncoder().encode(JSON.stringify({ version: 1, updatedAt: now, runs: rows })).byteLength).toBeLessThanOrEqual(RUNTIME_HISTORY_BYTES);
  });
  it("rejects malformed identities and strips unknown structures", () => {
    expect(normalizeRuntimeRun(null)).toBeUndefined();
    expect(normalizeRuntimeRun({ id: "../escape", at: Date.now() })).toBeUndefined();
    const row = normalizeRuntimeRun({ ...run(), total: -1, saved: NaN, rules: ["valid", "https://secret"], items: [{ libraryID: 1, key: "bad" }] })!;
    expect(row.total).toBe(0);
    expect(row.saved).toBe(0);
    expect(row.items).toEqual([]);
    expect(row.rules).toEqual(["valid"]);
  });
  it("stores bounded stage checkpoints and converts an unfinished stage to an interrupted record", () => {
    const row = normalizeRuntimeRun({ ...run(), status: "running", stages: [{ name: "metadata", startedAt: Date.now(), status: "running", processed: 4, saved: 2, failed: 0, warnings: 1, rules: ["tool-review-metadata"], reasons: ["metadata-auto-conflict"], message: "private error" }] })!;
    expect(row.status).toBe("running");
    expect(row.stages[0]).toMatchObject({ name: "metadata", status: "running", processed: 4, saved: 2 });
    expect(JSON.stringify(row)).not.toContain("private error");
    expect(normalizeRuntimeRun({ ...row, status: "interrupted", stages: row.stages.map(stage => ({ ...stage, status: "interrupted" })) })?.stages[0].status).toBe("interrupted");
    expect(normalizeRuntimeRun({ ...row, stages: [{ name: "../escape", startedAt: Date.now() }] })?.stages).toEqual([]);
  });
  it("honors customized history retention days and record count limits", () => {
    const prefs = new Map<string, unknown>([
      ["extensions.zotero.metaref.cache.historyDays", 7],
      ["extensions.zotero.metaref.cache.historyLimit", 25],
    ]);
    (globalThis as any).Zotero = { Prefs: { get: (key: string) => prefs.get(key) } };
    (globalThis as any).addon = { data: { config: { prefsPrefix: "extensions.zotero.metaref" } } };
    try {
      const now = Date.now();
      const rows = boundRuntimeRuns([
        ...Array.from({ length: 40 }, (_, index) => run(`recent-${index}`, now - index * 1000)),
        run("expired-8d", now - 8 * 86_400_000),
      ], now);
      expect(rows).toHaveLength(25);
      expect(rows.some(item => item.id === "expired-8d")).toBe(false);
    }
    finally {
      delete (globalThis as any).Zotero;
      delete (globalThis as any).addon;
    }
  });
});
