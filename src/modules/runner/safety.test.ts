import type { ApplyContext } from "../rules/rule-base";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LintRunner } from "../runner";

vi.mock("../../utils/runtime-data-storage", () => ({ recordRuntimeResult: vi.fn() }));
vi.mock("../rules", () => ({ Rules: {} }));
vi.mock("../reporter", () => ({ ProgressUI: class { async init() {} close() {} updateProgress() {} showFinished() {} } }));
vi.mock("../../utils/logger", () => ({ createLogger: () => ({ debug() {}, warn() {}, error() {} }) }));
vi.mock("../../utils/locale", () => ({ getString: (id: string) => id }));

function fixture() {
  const state = { title: "Original", extra: "User note", itemType: "journalArticle" };
  const item = {
    id: 1,
    itemType: "journalArticle",
    itemTypeID: 1,
    deleted: false,
    inTrash: false,
    editable: true,
    fields: { ...state },
    persisted: { ...state },
    isRegularItem: () => true,
    isEditable() { return this.editable; },
    getDisplayTitle() { return this.fields.title; },
    getField(key: string) { return (this.fields as any)[key] || ""; },
    setField(key: string, value: string) { (this.fields as any)[key] = value; },
    toJSON() { return { ...this.fields }; },
    fromJSON(fields: typeof state) { this.fields = { ...fields }; },
    hasChanged() { return JSON.stringify(this.fields) !== JSON.stringify(this.persisted); },
    save: vi.fn(async function (this: typeof item) { this.persisted = { ...this.fields }; }),
  };
  return item;
}

beforeEach(() => {
  vi.stubGlobal("addon", { data: { alive: true } });
  vi.stubGlobal("Zotero", { Prefs: { get: () => undefined }, getMainWindow: () => ({ AbortController }), DB: { executeTransaction: async (fn: () => Promise<void>) => fn() } });
});
afterEach(() => vi.unstubAllGlobals());

describe("runner write eligibility at asynchronous boundaries", () => {
  for (const boundary of ["deleted", "inTrash", "editable"] as const) {
    it(`rejects a late rule mutation after ${boundary} changes`, async () => {
      const item = fixture();
      const runner = new LintRunner();
      const result = await runner.add({ items: [item as unknown as Zotero.Item], silent: true, rules: [{ id: "local", scope: "item", async apply({ item: guarded }: ApplyContext) {
        await Promise.resolve();
        item[boundary] = boundary !== "editable";
        guarded.setField("title", "Late write");
      } }] as any });
      expect(item.fields.title).toBe("Original");
      expect(item.save).not.toHaveBeenCalled();
      expect(result?.failed).toBe(1);
    });

    it(`rechecks ${boundary} after waiting to enter the save transaction`, async () => {
      const item = fixture();
      const runner = new LintRunner();
      (Zotero.DB as any).executeTransaction = async (fn: () => Promise<void>) => {
        item[boundary] = boundary !== "editable";
        item.fields.extra = "Concurrent user note";
        await fn();
      };
      const result = await runner.add({ items: [item as unknown as Zotero.Item], silent: true, rules: [{ id: "local", scope: "item", apply({ item }: ApplyContext) {
        item.setField("title", "Formatted");
      } }] as any });
      expect(item.save).not.toHaveBeenCalled();
      expect(item.fields).toMatchObject({ title: "Original", extra: "Concurrent user note" });
      expect(result).toMatchObject({ saved: 0, failed: 1 });
    });
  }

  it("excludes inTrash items even when the deleted flag has not caught up", async () => {
    const item = fixture();
    item.inTrash = true;
    const apply = vi.fn();
    const result = await new LintRunner().add({ items: [item as unknown as Zotero.Item], silent: true, rules: [{ id: "local", scope: "item", apply }] as any });
    expect(apply).not.toHaveBeenCalled();
    expect(result?.total).toBe(0);
  });
});
