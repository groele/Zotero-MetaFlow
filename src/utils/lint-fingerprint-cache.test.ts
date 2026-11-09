import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineRule } from "../modules/rules/rule-base";
import { LintRunner } from "../modules/runner";
import {
  bumpLintPrefsRevision,
  clearLintFingerprintCache,
  getLintFingerprintStats,
} from "./lint-fingerprint-cache";

function createMockItem(id: number, title: string) {
  const fields: Record<string, string> = { title, dateModified: "2026-11-09 14:00:00" };
  let changed = false;
  return {
    id,
    version: 1,
    itemType: "journalArticle",
    deleted: false,
    isRegularItem: () => true,
    isEditable: () => true,
    getDisplayTitle: () => fields.title,
    getField: (k: string) => fields[k] || "",
    setField: (k: string, v: string) => {
      if (fields[k] !== v) {
        fields[k] = v;
        changed = true;
      }
    },
    getCreators: () => [],
    setCreators: () => {},
    getAttachments: () => [],
    hasChanged: () => changed,
    toJSON: () => ({ itemType: "journalArticle", ...fields }),
    fromJSON: (data: Record<string, string>) => {
      Object.assign(fields, data);
    },
    save: vi.fn(async () => {
      changed = false;
    }),
    saveTx: vi.fn(async () => {
      changed = false;
    }),
    reload: vi.fn(async () => {}),
  } as unknown as Zotero.Item;
}

describe("lint fingerprint cache (Incremental Dirty-Checking)", () => {
  beforeEach(() => {
    clearLintFingerprintCache();
    (globalThis as any).addon = {
      data: {
        alive: true,
        config: { prefsPrefix: "extensions.zotero.metaref" },
      },
    };
    (globalThis as any).Zotero = {
      debug: () => {},
      logError: () => {},
      DB: {
        executeTransaction: async (fn: () => Promise<void>) => await fn(),
      },
      ItemFields: {
        isValidForType: () => true,
        getBaseIDFromTypeAndField: () => false,
      },
      Prefs: {
        get: () => undefined,
      },
    };
  });

  it("skips unmodified clean items on subsequent local lint batches and re-runs when item changes", async () => {
    let applyCount = 0;
    const rule = defineRule({
      id: "correct-title-trailing-dot" as any,
      scope: "item",
      category: "rule",
      apply({ item }) {
        applyCount++;
        const t = String(item.getField("title") || "");
        if (t.endsWith("."))
          item.setField("title", t.slice(0, -1));
      },
    });

    const runner = new LintRunner();
    const item1 = createMockItem(101, "Clean Title Without Dot");
    const item2 = createMockItem(102, "Another Clean Title");

    // First batch: both items evaluated and cached as clean
    await runner.add({ items: [item1, item2], rules: [rule], silent: true, history: false });
    expect(applyCount).toBe(2);
    expect(getLintFingerprintStats().size).toBe(2);
    expect(getLintFingerprintStats().hits).toBe(0);

    // Second batch with identical items and rule: both skipped via fingerprint hit
    await runner.add({ items: [item1, item2], rules: [rule], silent: true, history: false });
    expect(applyCount).toBe(2);
    expect(getLintFingerprintStats().hits).toBe(2);

    // Modify item1: item1 must be re-evaluated while item2 still hits cache
    item1.setField("title", "Modified Title.");
    await runner.add({ items: [item1, item2], rules: [rule], silent: true, history: false });
    expect(applyCount).toBe(3);
    expect(item1.getField("title")).toBe("Modified Title");
    expect(getLintFingerprintStats().hits).toBe(3);

    // Bumping preferences revision invalidates all cached fingerprints
    bumpLintPrefsRevision();
    expect(getLintFingerprintStats().size).toBe(0);
  });

  it("never skips tool-category rules", async () => {
    let toolCalls = 0;
    const toolRule = defineRule({
      id: "tool-update-easyscholar" as any,
      scope: "item",
      category: "tool",
      apply() {
        toolCalls++;
      },
    });

    const runner = new LintRunner();
    const item = createMockItem(201, "Journal Paper");
    await runner.add({ items: [item], rules: [toolRule], silent: true, history: false });
    await runner.add({ items: [item], rules: [toolRule], silent: true, history: false });
    expect(toolCalls).toBe(2);
  });
});
