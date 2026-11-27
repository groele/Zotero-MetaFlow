import { describe, expect, it, vi } from "vitest";
import { NoValueNullish } from "./no-value-nullish";

vi.mock("../../../utils/zotero", () => ({ getUsedItemFields: (item: any) => Object.keys(item.fields) }));
vi.mock("../../../utils/locale", () => ({ getString: (id: string) => id }));

describe("field-aware placeholder cleanup", () => {
  it("preserves literal titles, short titles and archive descriptions", async () => {
    for (const value of ["None", "null", "无", "N/A"]) {
      const fields = { title: value, shortTitle: value, archiveLocation: value, abstractNote: value };
      const setField = vi.fn();
      await NoValueNullish.apply({ item: { fields, getField: (key: keyof typeof fields) => fields[key], setField } as unknown as Zotero.Item, options: {}, debug: vi.fn(), report: vi.fn() });
      expect(setField).not.toHaveBeenCalled();
    }
  });

  it("clears explicit placeholders in numeric and identifier fields", async () => {
    const fields = { DOI: "null", volume: "N/A", pages: "none" };
    const setField = vi.fn();
    await NoValueNullish.apply({ item: { fields, getField: (key: keyof typeof fields) => fields[key], setField } as unknown as Zotero.Item, options: {}, debug: vi.fn(), report: vi.fn() });
    expect(setField.mock.calls).toEqual([["DOI", ""], ["volume", ""], ["pages", ""]]);
  });
});
