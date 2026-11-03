// autocorrect-disable
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EASYSCHOLAR_FIELD_DEFINITIONS } from "../utils/easyscholar";
import { journalNumericDisplayValue } from "../utils/journal-column-sort";
import { resetJournalRankingIndex, saveJournalRankingIndex } from "../utils/journal-ranking-index";
import { registerEasyScholarColumns, registerExtraColumns, unregisterExtraColumns } from "./item-tree";

const mocks = vi.hoisted(() => ({ preferences: new Map<string, unknown>(), insights: vi.fn() }));
vi.mock("../utils/prefs", () => ({ getPref: (key: string, fallback: unknown) => mocks.preferences.get(key) ?? fallback }));
vi.mock("../utils/locale", () => ({ getString: (key: string) => key }));
vi.mock("../utils/logger", () => ({ logger: { error: vi.fn() }, createLogger: () => ({ error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) }));
vi.mock("../utils/journal-insights", () => ({ cachedJournalInsights: mocks.insights }));
const columns = new Map<string, any>();
beforeEach(() => {
  columns.clear();
  mocks.preferences.clear();
  mocks.insights.mockReset();
  vi.stubGlobal("addon", { data: { alive: true, config: { addonID: "test" } } });
  vi.stubGlobal("Zotero", { locale: "zh-CN", ItemTreeManager: {
    registerColumn: (column: any) => {
      columns.set(column.dataKey, column);
      return column.dataKey;
    },
    unregisterColumn: (key: string) => columns.delete(key),
    isCustomColumn: (key: string) => columns.has(key),
  } });
});
afterEach(() => {
  unregisterExtraColumns();
  resetJournalRankingIndex();
  vi.unstubAllGlobals();
});

it("makes all 61 ranking fields available without enabling writes or making API calls", () => {
  for (const field of EASYSCHOLAR_FIELD_DEFINITIONS)
    mocks.preferences.set(`easyscholar.fields.${field.key}`, true);
  registerExtraColumns();
  expect(columns.size).toBe(68);
  for (const field of EASYSCHOLAR_FIELD_DEFINITIONS)
    expect(columns.has(field.key === "esi" ? "esiDiscipline" : `easyScholar-${field.key}`), field.key).toBe(true);
  expect(columns.get("easyScholar-impactFactor").columnPickerSubMenu).toBe(true);
  mocks.preferences.set("easyscholar.columns.impactFactor", true);
  registerEasyScholarColumns();
  expect(columns.size).toBe(68);
  expect(columns.get("easyScholar-impactFactor").columnPickerSubMenu).toBe(false);
  mocks.preferences.set("easyscholar.columns.impactFactor", false);
  registerEasyScholarColumns();
  expect(columns.has("easyScholar-impactFactor")).toBe(true);
  expect(columns.get("easyScholar-impactFactor").columnPickerSubMenu).toBe(true);
});

it("treats the field switch as authoritative even with a saved value and a column shortcut", () => {
  mocks.preferences.set("easyscholar.fields.jcr", true);
  mocks.preferences.set("easyscholar.columns.jcr", true);
  registerExtraColumns();
  const provider = columns.get("easyScholar-jcr").dataProvider;
  const item = { itemType: "journalArticle", getField: () => "JCR 分区: Q1" } as unknown as Zotero.Item;
  expect(provider(item)).toBe("Q1");
  mocks.preferences.set("easyscholar.fields.jcr", false);
  registerExtraColumns();
  expect(columns.has("easyScholar-jcr")).toBe(false);
  expect(provider(item)).toBe("");
  expect(item.getField("extra")).toBe("JCR 分区: Q1");
  mocks.preferences.set("insights.natureEnabled", false);
  registerExtraColumns();
  expect(columns.has("natureIndex")).toBe(false);
  expect(columns.has("natureSource")).toBe(false);
});

it("matches pane values for canonical, legacy and fullwidth-colon Extra, and refreshes edits", () => {
  registerExtraColumns();
  let extra = "JCR分区: Q3\nJCR 分区：Q1\n影响因子：34.9\nSCI: 是";
  const item = { itemType: "journalArticle", getField: () => extra } as unknown as Zotero.Item;
  expect(columns.get("easyScholar-jcr").dataProvider(item)).toBe("Q1");
  expect(journalNumericDisplayValue(columns.get("easyScholar-impactFactor").dataProvider(item))).toBe("34.9");
  expect(columns.get("easyScholar-sci").dataProvider(item)).toBe("是");
  extra = "影响因子: 9.8";
  expect(journalNumericDisplayValue(columns.get("easyScholar-impactFactor").dataProvider(item))).toBe("9.8");
  expect(columns.get("easyScholar-jcr").dataProvider(item)).toBe("");
});

it("does not revive a removed SCI membership from Extra while preserving unrelated manual rankings", async () => {
  registerExtraColumns();
  const extra = "SCI: 是\nCCF: B\nManual note";
  const item = { itemType: "journalArticle", getField: (key: string) => key === "extra" ? extra : key === "publicationTitle" ? "Removed membership QA" : "" } as unknown as Zotero.Item;
  await saveJournalRankingIndex(item, { sci: "是" }, new Set(["sci"]));
  await saveJournalRankingIndex(item, { sci: "否" }, new Set(["sci"]));
  expect(columns.get("easyScholar-sci").dataProvider(item)).toBe("");
  expect(columns.get("easyScholar-ccf").dataProvider(item)).toBe("B");
  expect(item.getField("extra")).toBe(extra);
});

it("registers tldr (撷论) column and provides extracted TL;DR takeaway", () => {
  registerExtraColumns();
  expect(columns.has("tldr")).toBe(true);
  const tldrCol = columns.get("tldr");
  expect(tldrCol.label).toBe("field-tldr");
  expect(tldrCol.columnPickerSubMenu).toBeUndefined();
  const itemWithExtra = {
    isRegularItem: () => true,
    getField: (key: string) => key === "extra" ? "TLDR: Key insight discovered." : "",
  } as unknown as Zotero.Item;
  expect(tldrCol.dataProvider(itemWithExtra)).toBe("Key insight discovered.");

  const itemWithXielun = {
    isRegularItem: () => true,
    getField: (key: string) => key === "extra" ? "撷论：中文前缀核心论点" : "",
  } as unknown as Zotero.Item;
  expect(tldrCol.dataProvider(itemWithXielun)).toBe("中文前缀核心论点");

  const itemWithRemark = {
    isRegularItem: () => true,
    getField: (key: string) => key === "extra" ? "remark: 用户的个人简记" : "",
  } as unknown as Zotero.Item;
  // 撷论列只读取真正的 TLDR/撷论，绝不串扰用户的简记 (remark)
  expect(tldrCol.dataProvider(itemWithRemark)).toBe("");

  const itemWithBoth = {
    isRegularItem: () => true,
    getField: (key: string) => key === "extra" ? "remark: 用户的个人简记\nTLDR: 真正的文献核心论点" : "",
  } as unknown as Zotero.Item;
  expect(tldrCol.dataProvider(itemWithBoth)).toBe("真正的文献核心论点");
});
