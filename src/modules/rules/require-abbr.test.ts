import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataLoader } from "../../utils/data-loader";
import { buildJournalMaps, lookupJournalAbbreviation } from "../../utils/journal-abbreviation";
import { inferJournalAbbreviation } from "../../utils/journal-abbreviation-iso";
import { CorrectConferenceAbbr, formatJournalAbbreviation, loadCustomAbbreviations, RequireJournalAbbr } from "./require-abbr";

vi.mock("../../utils/locale", () => ({ getString: (key: string) => key }));
vi.mock("../../utils/logger", () => ({ createLogger: () => ({ debug: vi.fn() }) }));
vi.mock("../../utils/journal-abbreviation-iso", () => ({ inferJournalAbbreviation: vi.fn(async () => "Inferred J.") }));

describe("journal abbreviation format", () => {
  it("keeps periods by default and can remove them when configured", () => {
    expect(formatJournalAbbreviation("J. Biol. Chem.", true)).toBe("J. Biol. Chem.");
    expect(formatJournalAbbreviation("J. Biol. Chem.", false)).toBe("J Biol Chem");
  });
});

describe("custom abbreviation data and rule integration", () => {
  const read = vi.fn();
  beforeEach(() => {
    DataLoader.clearCache();
    read.mockReset();
    vi.mocked(inferJournalAbbreviation).mockClear();
    vi.stubGlobal("Zotero", { File: { getContentsAsync: read } });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  const load = (content: string, path = "custom.json") => {
    read.mockResolvedValue(content);
    return loadCustomAbbreviations(path);
  };
  it("identifies a provenance audit without treating its count as journal mappings", async () => {
    await expect(load(JSON.stringify({ entries: 44304, conflicts: [], sources: [], revision: "fixture" })))
      .rejects
      .toThrow("settings-abbr-provenance-file");
  });
  const createContext = (title: string, current = "", options = {}) => {
    const fields: Record<string, string> = { publicationTitle: title, journalAbbreviation: current, language: "en" };
    const tags = new Set(["user-topic", "abbr"]);
    const item = {
      getField: (key: string) => fields[key] || "",
      setField: vi.fn((key: string, value: string) => { fields[key] = value; }),
      hasTag: (tag: string) => tags.has(tag),
      removeTag: (tag: string) => tags.delete(tag),
      addTag: (tag: string) => tags.add(tag),
    };
    const ctx = { item: item as unknown as Zotero.Item, options: { customDataPath: "", infer: false, usefull: false, usefullZh: false, withDots: true, ...options }, debug: vi.fn(), report: vi.fn() };
    return { fields, tags, ctx, item };
  };

  it.each(["json", "csv"])("retains punctuation-distinct titles in %s and skips only ambiguous relaxed queries", async (format) => {
    const content = format === "json" ? "{\"A-B Journal\":\"AB. J.\",\"A B Journal\":\"A. B. J.\"}" : "\"A-B Journal\",\"AB. J.\"\n\"A B Journal\",\"A. B. J.\"\n";
    const data = await load(content, `custom.${format}`);
    expect(data.size).toBe(2);
    expect(lookupJournalAbbreviation("A-B JOURNAL", data).abbr).toBe("AB. J.");
    expect(lookupJournalAbbreviation("A B Journal", data, true).abbr).toBe("A. B. J.");
    expect(lookupJournalAbbreviation("A:B Journal", data)).toEqual({});
    expect(lookupJournalAbbreviation("A:B Journal", data, true).ambiguous).toBe(true);
  });

  it.each([
    ["{\"Nature\":\"Nature\",\"NATURE\":\"Nat.\"}", "custom.json"],
    ["\"Nature\",\"Nature\"\n\"Nature\",\"Nat.\"\n", "custom.csv"],
    ["\"Ａ－Ｂ Journal\",\"AB. J.\"\n\"A-B Journal\",\"Other J.\"\n", "custom.csv"],
  ])("rejects genuine exact-name conflicts before a file can be activated", async (content, path) => {
    await expect(load(content, path)).rejects.toThrow("Conflicting abbreviations");
  });

  it("deduplicates identical exact mappings and supports BOM files and quoted delimiters", async () => {
    const data = await load("\uFEFF\"Special, Journal\";\"Spec. J.\"\n\"Special, Journal\";\"Spec. J.\"\n", "custom.CSV");
    expect(data.size).toBe(1);
    expect(lookupJournalAbbreviation("Special, Journal", data).abbr).toBe("Spec. J.");
  });

  it.each(["{}", "{\"Journal\":12}", "[]", "{\"\":\"\"}"])("rejects empty or malformed custom mappings", async (content) => {
    await expect(load(content)).rejects.toThrow();
  });

  it("uses the custom exact mapping ahead of built-in values and changes only managed tags", async () => {
    const customAbbr = await load("{\"Nano Research\":\"Custom Nano\"}");
    const builtin = vi.spyOn(DataLoader, "getJournalAbbrMaps");
    const { ctx, fields, tags } = createContext("Nano Research", "Old", { customAbbr, tagSource: true, letterCase: "upper" });
    await RequireJournalAbbr.apply(ctx);
    expect(fields.journalAbbreviation).toBe("CUSTOM NANO");
    expect(tags).toEqual(new Set(["user-topic", "abbr_user"]));
    expect(builtin).not.toHaveBeenCalled();
    expect(inferJournalAbbreviation).not.toHaveBeenCalled();
  });

  it("does not replace an ambiguous custom match with a lower-priority guess", async () => {
    const customAbbr = await load("{\"A-B Journal\":\"AB. J.\",\"A B Journal\":\"A. B. J.\"}");
    const builtin = vi.spyOn(DataLoader, "getJournalAbbrMaps");
    const { ctx, item } = createContext("A:B Journal", "Manual", { customAbbr, matchMode: "flexible", infer: true, existingPolicy: "replace" });
    await RequireJournalAbbr.apply(ctx);
    expect(item.setField).not.toHaveBeenCalled();
    expect(builtin).not.toHaveBeenCalled();
    expect(inferJournalAbbreviation).not.toHaveBeenCalled();
    expect(ctx.report).toHaveBeenCalledWith(expect.objectContaining({ level: "warning", message: "abbr-match-ambiguous" }));
  });

  it("keeps a nonempty value in blank-only mode even when a custom mapping exists", async () => {
    const customAbbr = await load("{\"Nano Research\":\"Custom Nano\"}");
    const { ctx, fields, item } = createContext("Nano Research", "Manual", { customAbbr, existingPolicy: "blank", tagSource: true });
    await RequireJournalAbbr.apply(ctx);
    expect(fields.journalAbbreviation).toBe("Manual");
    expect(item.setField).not.toHaveBeenCalled();
  });

  it("warns for a missing custom-only source and ignores custom errors in built-in-only mode", async () => {
    const missing = createContext("Nano Research", "Manual", { sourceMode: "custom", usefull: true });
    await RequireJournalAbbr.apply(missing.ctx);
    expect(missing.item.setField).not.toHaveBeenCalled();
    expect(missing.ctx.report).toHaveBeenCalledWith(expect.objectContaining({ message: "abbr-custom-required" }));
    vi.spyOn(DataLoader, "getJournalAbbrMaps").mockResolvedValue(buildJournalMaps({ "Nano Research": "Nano Res." }));
    const builtin = createContext("Nano Research", "", { sourceMode: "builtin", customDataError: "invalid unused file" });
    await RequireJournalAbbr.apply(builtin.ctx);
    expect(builtin.fields.journalAbbreviation).toBe("Nano Res.");
    expect(builtin.ctx.report.mock.calls.some(([report]) => report.level === "warning")).toBe(false);
  });

  it("does not remove and re-add an already correct source tag", async () => {
    const customAbbr = await load("{\"Nano Research\":\"Nano Res.\"}");
    const { ctx, tags, item } = createContext("Nano Research", "Nano Res.", { customAbbr, tagSource: true });
    tags.delete("abbr");
    tags.add("abbr_user");
    const remove = vi.spyOn(item, "removeTag");
    const add = vi.spyOn(item, "addTag");
    await RequireJournalAbbr.apply(ctx);
    expect(remove).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
    expect(item.setField).not.toHaveBeenCalled();
  });

  it("uses built-in maps after a custom miss and ISO 4 only after both miss", async () => {
    const customAbbr = await load("{\"Custom Journal\":\"Cust. J.\"}");
    vi.spyOn(DataLoader, "getJournalAbbrMaps").mockResolvedValue(buildJournalMaps({ "Nano Research": "Nano Res." }));
    const known = createContext("Nano Research", "", { customAbbr, infer: true });
    await RequireJournalAbbr.apply(known.ctx);
    expect(known.fields.journalAbbreviation).toBe("Nano Res.");
    expect(inferJournalAbbreviation).not.toHaveBeenCalled();
    const unknown = createContext("Unknown Journal", "", { customAbbr, infer: true });
    await RequireJournalAbbr.apply(unknown.ctx);
    expect(unknown.fields.journalAbbreviation).toBe("Inferred J.");
  });

  it("preserves manual values on a miss until replacement is explicitly allowed", async () => {
    const customAbbr = await load("{\"Custom Journal\":\"Cust. J.\"}");
    const protectedItem = createContext("Unknown Journal", "Manual", { customAbbr, sourceMode: "custom", usefull: true });
    await RequireJournalAbbr.apply(protectedItem.ctx);
    expect(protectedItem.fields.journalAbbreviation).toBe("Manual");
    const replaced = createContext("Unknown Journal", "Manual", { sourceMode: "iso4", existingPolicy: "replace", withDots: false });
    await RequireJournalAbbr.apply(replaced.ctx);
    expect(replaced.fields.journalAbbreviation).toBe("Inferred J");
  });

  it("keeps conference custom matching safe after removing the ordinal", async () => {
    const customAbbr = await load("{\"International Conference on Widgets\":\"ICW\"}");
    const setExtraField = vi.fn();
    vi.stubGlobal("ztoolkit", { ExtraField: { getExtraField: () => "", setExtraField } });
    vi.spyOn(DataLoader, "getConferenceAbbrMap").mockResolvedValue(new Map());
    const { ctx, fields } = createContext("", "", { customAbbr });
    fields.conferenceName = "32nd International Conference on Widgets";
    await CorrectConferenceAbbr.apply(ctx);
    expect(setExtraField).toHaveBeenCalledWith(ctx.item, "shortConferenceName", "ICW", { save: false });
  });

  it.each(["builtin", "iso4"])("does not read unused custom data in journal %s mode while retaining conference support", async (mode) => {
    read.mockResolvedValue("{\"Custom Conference\":\"CC\"}");
    vi.stubGlobal("Zotero", {
      File: { getContentsAsync: read },
      Prefs: { get: (key: string) => key.endsWith(".customDataPath") ? "unused.json" : key.endsWith(".sourceMode") ? mode : undefined },
    });
    const context = { items: [], debug: vi.fn() };
    await RequireJournalAbbr.prepare!(context);
    expect(read).not.toHaveBeenCalled();
    await CorrectConferenceAbbr.prepare!(context);
    expect(read).toHaveBeenCalledTimes(1);
  });
});
