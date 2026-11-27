// autocorrect-disable
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EASYSCHOLAR_FIELD_DEFINITIONS } from "../../utils/easyscholar";
import { clearSelectedJournalExtra, mergeEasyScholarExtra, summarizeEasyScholarChanges, ToolUpdateEasyScholar } from "./easyscholar-rule";

const mocks = vi.hoisted(() => ({ fields: new Set<string>(), clear: false, writeToExtra: true, sessionOnly: false, index: new Map<string, string>(), fetch: vi.fn(), supplemental: vi.fn() }));
vi.mock("../../utils/prefs", () => ({ getPref: (key: string, fallback: unknown) => key === "easyscholar.clearExtraBeforeUpdate" ? mocks.clear : key === "easyscholar.writeToExtra" ? mocks.writeToExtra : key.startsWith("easyscholar.fields.") ? mocks.fields.has(key.slice("easyscholar.fields.".length)) : fallback }));
vi.mock("../../utils/locale", () => ({ getString: (key: string, options?: unknown) => `${key} ${JSON.stringify(options || {})}` }));
vi.mock("../../utils/easyscholar", async original => ({ ...await original<object>(), fetchEasyScholarRank: mocks.fetch }));
vi.mock("../../utils/supplemental-journals", () => ({ fetchSupplementalJournalRank: mocks.supplemental }));
vi.mock("../../utils/journal-ranking-index", () => ({
  readJournalRankingIndex: (_item: unknown, fallback?: ReadonlyMap<string, string>) => new Map([...fallback || [], ...mocks.index]),
  saveJournalRankingIndex: async (_item: unknown, data: Record<string, string>, selected: Set<string>, mode: string) => {
    for (const key of selected) {
      if (mode !== "blank" || !mocks.index.has(key)) {
        if (data[key])
          mocks.index.set(key, data[key]);
      }
    }
    return { sessionOnly: mocks.sessionOnly };
  },
}));

beforeEach(() => {
  vi.useFakeTimers();
  mocks.fields.clear();
  mocks.clear = false;
  mocks.writeToExtra = true;
  mocks.sessionOnly = false;
  mocks.index.clear();
  mocks.fetch.mockReset().mockResolvedValue({ status: "success", data: { impactFactor: "2.5" } });
  mocks.supplemental.mockReset().mockResolvedValue({ data: {}, errors: [] });
});
afterEach(() => vi.useRealTimers());

it("fills only blank ranking fields, including legacy aliases and negative membership values", () => {
  const existing = "JCR分区: Q3\nSCI: 是\n影响因子: \nManual note";
  const data = { jcr: "Q1", sci: "否", impactFactor: "8.4" };
  const fields = new Set(["jcr", "sci", "impactFactor"] as const);
  const blank = mergeEasyScholarExtra(existing, data, fields, "blank");
  expect(blank).toContain("JCR分区: Q3");
  expect(blank).toContain("SCI: 是");
  expect(blank).toContain("影响因子: 8.4");
  expect(blank).toContain("Manual note");
  const all = mergeEasyScholarExtra(existing, data, fields, "all");
  expect(all).toContain("JCR 分区: Q1");
  expect(all).not.toContain("JCR分区:");
  expect(all).not.toContain("SCI:");
});

function context() {
  let extra = "Manual note";
  const item = { getField: (key: string) => key === "extra" ? extra : "Journal QA", setField: (_key: string, value: string) => {
    extra = value;
  } };
  return { item: item as unknown as Zotero.Item, options: {}, debug: vi.fn(), report: vi.fn() };
}

it("makes zero source calls when every output field is disabled", async () => {
  const ctx = context();
  const pending = ToolUpdateEasyScholar.apply(ctx);
  await vi.runAllTimersAsync();
  await pending;
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(mocks.supplemental).not.toHaveBeenCalled();
  expect(ctx.item.getField("extra")).toBe("Manual note");
});

it("clears only selected managed rankings and preserves unselected fields and notes", () => {
  expect(clearSelectedJournalExtra("JCR分区: Q3\n影响因子：4.0\nCCF: A\nManual note\nCitation Key: retain", new Set(["impactFactor"])))
    .toBe("JCR分区: Q3\nCCF: A\nManual note\nCitation Key: retain");
});

it("preserves rankings from failed sources when replacement clearing is enabled", async () => {
  mocks.clear = true;
  mocks.fields.add("impactFactor");
  mocks.fields.add("njauQuality");
  for (const failed of ["main", "supplemental"]) {
    const ctx = context();
    ctx.item.setField("extra", "影响因子: 4.0\n南农高质量: old\nManual note");
    mocks.fetch.mockResolvedValue(failed === "main" ? { status: "error", message: "unavailable" } : { status: "success", data: { impactFactor: "8.4" } });
    mocks.supplemental.mockResolvedValue(failed === "supplemental" ? { data: {}, errors: ["unavailable"] } : { data: { njauQuality: "new" }, errors: [] });
    await ToolUpdateEasyScholar.apply(ctx);
    expect(ctx.item.getField("extra")).toContain(failed === "main" ? "影响因子: 4.0" : "南农高质量: old");
    expect(ctx.item.getField("extra")).toContain(failed === "main" ? "new" : "8.4");
    expect(ctx.item.getField("extra")).toContain("Manual note");
  }
});

it("discards a response if the journal was changed while waiting", async () => {
  mocks.fields.add("impactFactor");
  const fields: Record<string, string> = { publicationTitle: "Original journal", extra: "Manual note" };
  const ctx = { item: {
    itemType: "journalArticle",
    getField: (key: string) => fields[key] || "",
    setField: (key: string, value: string) => { fields[key] = value; },
  } as unknown as Zotero.Item, options: {}, debug: vi.fn(), report: vi.fn() };
  mocks.fetch.mockImplementation(async () => {
    fields.publicationTitle = "Different journal";
    return { status: "success", data: { impactFactor: "34.9" } };
  });
  await ToolUpdateEasyScholar.apply(ctx);
  expect(fields.extra).toBe("Manual note");
  expect(ctx.report.mock.calls.some(([info]) => info.level === "warning")).toBe(true);
});

it("preserves a ranking edited while waiting and still updates untouched rankings", async () => {
  mocks.fields.add("impactFactor");
  mocks.fields.add("jcr");
  const fields: Record<string, string> = { publicationTitle: "Journal QA", extra: "影响因子: 4.0\nJCR 分区: Q3" };
  const ctx = { item: {
    itemType: "journalArticle",
    getField: (key: string) => fields[key] || "",
    setField: (key: string, value: string) => { fields[key] = value; },
  } as unknown as Zotero.Item, options: {}, debug: vi.fn(), report: vi.fn() };
  mocks.fetch.mockImplementation(async () => {
    fields.extra = "影响因子: 5.0\nJCR 分区: Q3\nManual note";
    return { status: "success", data: { impactFactor: "34.9", jcr: "Q1" } };
  });
  await ToolUpdateEasyScholar.apply(ctx);
  expect(fields.extra).toContain("影响因子: 5.0");
  expect(fields.extra).toContain("JCR 分区: Q1");
  expect(fields.extra).toContain("Manual note");
});

it("does not write a field disabled while its response was pending", async () => {
  mocks.fields.add("impactFactor");
  const ctx = context();
  mocks.fetch.mockImplementation(async () => {
    mocks.fields.delete("impactFactor");
    return { status: "success", data: { impactFactor: "34.9" } };
  });
  await ToolUpdateEasyScholar.apply(ctx);
  expect(ctx.item.getField("extra")).toBe("Manual note");
});

it("does not query EasyScholar when only a supplemental field is selected", async () => {
  mocks.fields.add("njauCore");
  mocks.supplemental.mockResolvedValue({ data: { njauCore: "local rank" }, errors: [] });
  const ctx = context();
  const pending = ToolUpdateEasyScholar.apply(ctx);
  await vi.runAllTimersAsync();
  await pending;
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(ctx.item.getField("extra")).toContain("local rank");
});

it("saves selected lookup values to the MetaFlow index without changing Extra when configured", async () => {
  mocks.writeToExtra = false;
  mocks.fields.add("impactFactor");
  const ctx = context();
  await ToolUpdateEasyScholar.apply(ctx);
  expect(ctx.item.getField("extra")).toBe("Manual note");
  expect(mocks.index.get("impactFactor")).toBe("2.5");
});

it("keeps existing Extra rankings in blank mode when saving to the MetaFlow index", async () => {
  mocks.writeToExtra = false;
  mocks.fields.add("jcr");
  const fields: Record<string, string> = { publicationTitle: "Journal QA", extra: "JCR 分区: Q3" };
  const item = {
    itemType: "journalArticle",
    getField: (key: string) => fields[key] || "",
    setField: (key: string, value: string) => { fields[key] = value; },
  } as unknown as Zotero.Item;
  const ctx = { item, options: { mode: "blank" as const }, debug: vi.fn(), report: vi.fn() };
  mocks.fetch.mockResolvedValue({ status: "success", data: { jcr: "Q1" } });
  await ToolUpdateEasyScholar.apply(ctx);
  expect(fields.extra).toBe("JCR 分区: Q3");
  expect(mocks.index.has("jcr")).toBe(false);
});

it("keeps supplemental results when EasyScholar ignores cancellation and times out", async () => {
  mocks.fields.add("impactFactor");
  mocks.fields.add("njauCore");
  mocks.fetch.mockImplementation(() => new Promise(() => {}));
  mocks.supplemental.mockResolvedValue({ data: { njauCore: "local rank" }, errors: [] });
  const ctx = context();
  const pending = ToolUpdateEasyScholar.apply(ctx);
  await vi.runAllTimersAsync();
  await pending;
  expect(ctx.item.getField("extra")).toContain("local rank");
  expect(ctx.report.mock.calls.some(([report]) => report.level === "warning")).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it("counts actual key differences rather than returned values", () => {
  expect(summarizeEasyScholarChanges("CCF: A\nEI: 是\nManual note", "CCF: A\nJCI: 1.2\nManual note"))
    .toEqual({ added: 1, updated: 0, removed: 1 });
  expect(summarizeEasyScholarChanges("CCF: A", "CCF: B"))
    .toEqual({ added: 0, updated: 1, removed: 0 });
  expect(summarizeEasyScholarChanges("CCF: A", "CCF: A"))
    .toEqual({ added: 0, updated: 0, removed: 0 });
});

it("reports when updated rankings are available only for the current session", async () => {
  mocks.fields.add("impactFactor");
  mocks.sessionOnly = true;
  mocks.writeToExtra = false;
  const ctx = context();
  await ToolUpdateEasyScholar.apply(ctx);
  expect(ctx.report).toHaveBeenCalledWith(expect.objectContaining({ level: "warning", code: "journal-index-session-only", message: expect.stringContaining("rule-tool-update-easyscholar-session-only") }));
  expect(ctx.item.getField("extra")).toBe("Manual note");
  expect(mocks.index.get("impactFactor")).toBe("2.5");
});

it("each of the 61 field switches writes only its selected result and preserves notes", async () => {
  expect(EASYSCHOLAR_FIELD_DEFINITIONS).toHaveLength(61);
  const data = Object.fromEntries(EASYSCHOLAR_FIELD_DEFINITIONS.map(field => [field.key, "QA-A"]));
  mocks.fetch.mockResolvedValue({ status: "success", data });
  mocks.supplemental.mockResolvedValue({ data, errors: [] });
  for (const field of EASYSCHOLAR_FIELD_DEFINITIONS) {
    mocks.fields.clear();
    mocks.fields.add(field.key);
    const ctx = context();
    const pending = ToolUpdateEasyScholar.apply(ctx);
    await vi.runAllTimersAsync();
    await pending;
    const extra = String(ctx.item.getField("extra"));
    expect(extra, field.key).toContain(`${field.extraKey}: QA-A`);
    expect(extra).toContain("Manual note");
    for (const other of EASYSCHOLAR_FIELD_DEFINITIONS) {
      if (other.key !== field.key)
        expect(extra.split("\n"), `${field.key} must not write ${other.key}`).not.toContain(`${other.extraKey}: QA-A`);
    }
  }
});
