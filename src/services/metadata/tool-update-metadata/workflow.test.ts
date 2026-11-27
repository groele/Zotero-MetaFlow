import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToolUpdateMetadata } from "./index";
import { resolveMissingISSN } from "./issn-resolver";
import { services } from "./services";

vi.mock("./issn-resolver", () => ({ resolveMissingISSN: vi.fn() }));
vi.mock("./services", () => ({ services: [] }));
vi.mock("./identifiers", async importOriginal => ({ ...await importOriginal<typeof import("./identifiers")>(), extractIdentifiers: (item: any) => ({ DOI: item.getField("DOI") }), isPreprint: () => false }));
vi.mock("../../../utils/locale", () => ({ getString: (id: string) => id }));
vi.mock("../../../utils/zotero", () => ({ isFieldValidForItemType: (field: string, type: string | number) => ["ISSN", "title", "date", "publicationTitle", "DOI", ...type === 2 ? [] : ["volume"]].includes(field) }));

function createItem() {
  const fields: Record<string, any> = { itemType: "journalArticle", title: "Original title", DOI: "10.1234/original", creators: [] };
  return {
    itemType: "journalArticle",
    itemTypeID: 1,
    getField: (field: string) => fields[field] || "",
    setField: vi.fn((field: string, value: string) => { fields[field] = value; }),
    getCreators: () => fields.creators,
    setCreators: vi.fn((creators: unknown[]) => { fields.creators = creators; }),
    setType: vi.fn(),
    toJSON: () => structuredClone(fields),
  };
}
const response = (name: string, data: Record<string, any>, fetch = async () => data) => ({ id: name, name, lookup: "identifier" as const, cooldown: 0, shouldApply: () => true, fetch, transform: (data: any) => data });
function run(item: ReturnType<typeof createItem>, mode: "blank" | "all" = "blank", options: { repairCreators?: boolean; creatorsOnly?: boolean; allowTypeChanged?: boolean } = {}) {
  const report = vi.fn();
  return { report, pending: ToolUpdateMetadata.apply({ item: item as unknown as Zotero.Item, options: { mode, allowTypeChanged: false, ...options }, debug: vi.fn(), report }) };
}
beforeEach(() => {
  services.splice(0);
  vi.mocked(resolveMissingISSN).mockReset().mockResolvedValue(null);
  vi.stubGlobal("Zotero", { CreatorTypes: { getID: () => 1, isValidForItemType: () => true }, ItemTypes: { getID: (type: string) => type === "webpage" ? 2 : 1 }, ItemFields: { getID: (field: string) => ["ISSN", "title", "date", "publicationTitle", "DOI", "volume"].includes(field) ? 1 : false } });
});
afterEach(() => vi.unstubAllGlobals());

describe("trusted metadata update workflow", () => {
  it("fills blank ISSN even when no article metadata service succeeds", async () => {
    const item = createItem();
    item.setField("ISSN", "  ");
    vi.mocked(resolveMissingISSN).mockResolvedValue({ issn: "0028-0836", source: "Crossref" });
    await run(item).pending;
    expect(item.getField("ISSN")).toBe("0028-0836");
  });
  it("preserves ISSN edited during lookup", async () => {
    const item = createItem();
    vi.mocked(resolveMissingISSN).mockImplementation(async () => {
      item.setField("ISSN", "1359-6454");
      return { issn: "0028-0836", source: "Crossref" };
    });
    await run(item).pending;
    expect(item.getField("ISSN")).toBe("1359-6454");
  });
  it("does not query ISSN for existing values or creator-only updates", async () => {
    const item = createItem();
    item.setField("ISSN", "1359-6454");
    await run(item, "all").pending;
    await run(createItem(), "blank", { creatorsOnly: true }).pending;
    expect(resolveMissingISSN).not.toHaveBeenCalled();
  });
  const authors = [{ creatorType: "author", firstName: "Ada", lastName: "Lovelace" }, { creatorType: "author", firstName: "Grace", lastName: "Hopper" }];
  it.each([{ existing: [] }, { existing: [authors[0]] }, { existing: [{ creatorType: "author", lastName: "Incorrect" }] }])("repairs missing, partial and incorrect authors without overwriting ordinary fields", async ({ existing }) => {
    const item = createItem();
    item.setCreators(existing);
    services.push(response("verified", { DOI: "10.1234/original", title: "Server title", date: "2026", creators: authors }));
    await run(item, "blank", { repairCreators: true, creatorsOnly: true }).pending;
    expect(item.getCreators()).toEqual(authors);
    expect(item.getField("title")).toBe("Original title");
    expect(item.getField("date")).toBe("");
  });

  it("keeps editors while repairing authors in blank mode", async () => {
    const item = createItem();
    const editor = { creatorType: "editor", lastName: "Retained Editor" };
    item.setCreators([authors[0], editor]);
    services.push(response("verified", { DOI: "10.1234/original", creators: authors }));
    await run(item, "blank", { repairCreators: true }).pending;
    expect(item.getCreators()).toEqual([...authors, editor]);
  });

  it("continues past sources without authors even when ordinary fields are complete", async () => {
    const item = createItem();
    item.setField("date", "2025");
    item.setField("publicationTitle", "Journal");
    item.setCreators([authors[0]]);
    const second = vi.fn(async () => ({ DOI: "10.1234/original", creators: authors }));
    services.push(response("no-authors", { title: "Original title", date: "2025" }), response("authors", {}, second));
    await run(item, "blank", { repairCreators: true }).pending;
    expect(second).toHaveBeenCalledOnce();
    expect(item.getCreators()).toEqual(authors);
  });

  it("preserves authors edited while waiting and rejects mismatched article identities", async () => {
    const item = createItem();
    const manual = [{ creatorType: "author", lastName: "Live edit" }];
    services.push(response("editing", {}, async () => {
      item.setCreators(manual);
      return { DOI: "10.1234/original", creators: authors };
    }));
    await run(item, "blank", { repairCreators: true }).pending;
    expect(item.getCreators()).toEqual(manual);
    services.splice(0, services.length, response("wrong-paper", { DOI: "10.9999/wrong", creators: authors }));
    await run(item, "blank", { repairCreators: true }).pending;
    expect(item.getCreators()).toEqual(manual);
  });

  it("does not erase authors when a source returns an incomplete or invalid author payload", async () => {
    const item = createItem();
    item.setCreators(authors);
    services.push(response("invalid", { DOI: "10.1234/original", title: "Original title", creators: [{ firstName: "Only given name" }] }));
    await run(item, "blank", { repairCreators: true }).pending;
    expect(item.getCreators()).toEqual(authors);
  });
  it("rejects contradictory DOI results and tries the next source", async () => {
    services.push(response("wrong", { DOI: "10.9999/wrong", title: "Unrelated" }), response("right", { DOI: "10.1234/original", title: "Verified title" }));
    const item = createItem();
    const { report, pending } = run(item, "all");
    await pending;
    expect(item.getField("DOI")).toBe("10.1234/original");
    expect(item.getField("title")).toBe("Verified title");
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ message: "rule-tool-update-metadata-identity-conflict" }));
  });

  it("continues past an echoed DOI and fills gaps from a later response", async () => {
    const complete = vi.fn(async () => ({ title: "Server title", date: "2026", publicationTitle: "Journal", creators: [{ creatorType: "author", lastName: "Doe" }] }));
    services.push(response("sparse", { DOI: "10.1234/original" }), response("complete", {}, complete));
    const item = createItem();
    await run(item).pending;
    expect(complete).toHaveBeenCalledOnce();
    expect(item.getField("title")).toBe("Original title");
    expect(item.getField("date")).toBe("2026");
    expect(item.getCreators()[0].lastName).toBe("Doe");
  });

  it("merges missing fields while preserving the earlier trusted source's values", async () => {
    services.push(response("first", { title: "First title", volume: "10" }), response("second", { title: "Second title", volume: "20", date: "2026", publicationTitle: "Journal" }));
    const item = createItem();
    await run(item, "all").pending;
    expect(item.getField("title")).toBe("First title");
    expect(item.getField("volume")).toBe("10");
    expect(item.getField("date")).toBe("2026");
  });

  it("preserves a manual edit made while the network response is pending", async () => {
    const item = createItem();
    services.push(response("editing", {}, async () => {
      item.setField("title", "Edited while waiting");
      return { title: "Server title", date: "2026" };
    }));
    const { report, pending } = run(item, "all");
    await pending;
    expect(item.getField("title")).toBe("Edited while waiting");
    expect(item.getField("date")).toBe("2026");
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ message: "rule-tool-update-metadata-edited" }));
  });
  it("discards the old work's response if its DOI changes during the request", async () => {
    const item = createItem();
    services.push(response("old-work", {}, async () => {
      item.setField("DOI", "10.9999/new-work");
      return { DOI: "10.1234/original", title: "Old work's title", date: "2026" };
    }));
    const { report, pending } = run(item, "all");
    await pending;
    expect(item.getField("DOI")).toBe("10.9999/new-work");
    expect(item.getField("title")).toBe("Original title");
    expect(item.getField("date")).toBe("");
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ message: "rule-tool-update-metadata-edited" }));
  });

  it("preserves incompatible fields added while a type-changing response is pending", async () => {
    const item = createItem();
    services.push(response("type-change", {}, async () => {
      item.setField("volume", "Manual volume");
      return { itemType: "webpage", title: "Updated title", date: "2026" };
    }));
    await run(item, "all", { allowTypeChanged: true }).pending;
    expect(item.setType).not.toHaveBeenCalled();
    expect(item.getField("volume")).toBe("Manual volume");
  });
});
