import { describe, expect, it, vi } from "vitest";
import { NoFieldMisuse } from "./no-field-misuse";

vi.mock("../../../utils/zotero", () => ({ getUsedItemFields: () => ["archiveLocation"] }));
vi.mock("../../../utils/locale", () => ({ getString: (id: string) => id }));

describe("numeric field misuse detection", () => {
  it("preserves archive identifiers that start with decimals", async () => {
    const setField = vi.fn();
    await NoFieldMisuse.apply({ item: { getField: () => "69.504/collection-A", setField } as unknown as Zotero.Item, options: {}, debug: vi.fn(), report: vi.fn() });
    expect(setField).not.toHaveBeenCalled();
  });
  it("reports ambiguous numeric and archive values without clearing them", async () => {
    for (const value of ["69.504", "0.75 (SQ3)", "Q1"]) {
      const setField = vi.fn();
      const report = vi.fn();
      await NoFieldMisuse.apply({ item: { getField: () => value, setField } as unknown as Zotero.Item, options: {}, debug: vi.fn(), report });
      expect(setField).not.toHaveBeenCalled();
      expect(report).toHaveBeenCalledWith(expect.objectContaining({ level: "warning" }));
    }
  });
});
