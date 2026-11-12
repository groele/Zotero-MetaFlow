import { describe, expect, it, vi } from "vitest";
import { inspectItemDefects } from "./item-diagnostics";

vi.mock("../utils/locale", () => ({
  getString: (id: string, options?: { args?: Record<string, string | number> }) => {
    if (!options?.args)
      return id;
    return `${id}:${JSON.stringify(options.args)}`;
  },
}));

describe("inspectItemDefects", () => {
  it("detects missing DOI, placeholder creators, and contaminated title on journal articles", () => {
    const fields: Record<string, string> = {
      title: "Constructing slip stacking diversity in van der waals homobilayers - chen - 2024 - advanced materials - wiley online library",
      DOI: "",
      publicationTitle: "Advanced Materials",
      date: "2024",
      pages: "2404734",
    };

    const mockItem = {
      isRegularItem: () => true,
      deleted: false,
      itemType: "journalArticle",
      getField: (f: string) => fields[f] || "",
      getCreators: () => [{ lastName: "(姓)", firstName: "(名)", creatorType: "author" }],
    } as unknown as Zotero.Item;

    const defects = inspectItemDefects(mockItem);
    const codes = defects.map(d => d.code);

    expect(codes).toContain("missing-doi");
    expect(codes).toContain("placeholder-creators");
    expect(codes).toContain("contaminated-title");
    expect(codes).toContain("missing-pagination");
    expect(codes).toContain("missing-abstract");
  });

  it("reports extractable DOI from URL when DOI field is empty", () => {
    const fields: Record<string, string> = {
      title: "Ferroelectricity in ReS2",
      DOI: "",
      url: "https://advanced.onlinelibrary.wiley.com/doi/abs/10.1002/adma.202404734",
      publicationTitle: "Advanced Materials",
      date: "2024",
      volume: "36",
      issue: "40",
      pages: "2404734",
      abstractNote: "Abstract",
    };
    const mockItem = {
      isRegularItem: () => true,
      deleted: false,
      itemType: "journalArticle",
      getField: (f: string) => fields[f] || "",
      getCreators: () => [{ lastName: "Chen", firstName: "Yun", creatorType: "author" }],
    } as unknown as Zotero.Item;
    const defects = inspectItemDefects(mockItem);
    expect(defects).toHaveLength(1);
    expect(defects[0].code).toBe("missing-doi");
    expect(defects[0].message).toContain("10.1002/adma.202404734");
  });

  it("returns no critical defects on a complete, clean item", () => {
    const fields: Record<string, string> = {
      title: "Constructing Slip Stacking Diversity in Van der Waals Homobilayers",
      DOI: "10.1002/adma.202404734",
      publicationTitle: "Advanced Materials",
      date: "2024-07-28",
      volume: "36",
      issue: "40",
      pages: "2404734",
      abstractNote: "A comprehensive study on vdW homobilayers.",
    };

    const mockItem = {
      isRegularItem: () => true,
      deleted: false,
      itemType: "journalArticle",
      getField: (f: string) => fields[f] || "",
      getCreators: () => [{ lastName: "Chen", firstName: "Yun", creatorType: "author" }],
    } as unknown as Zotero.Item;

    const defects = inspectItemDefects(mockItem);
    expect(defects).toHaveLength(0);
  });

  it("uses Fluent localization keys instead of hardcoded defect messages", () => {
    const fields: Record<string, string> = {
      title: "Trailing dot title.",
      DOI: "https://doi.org/10.1000/test",
    };

    const mockItem = {
      isRegularItem: () => true,
      deleted: false,
      itemType: "journalArticle",
      getField: (f: string) => fields[f] || "",
      getCreators: () => [],
    } as unknown as Zotero.Item;

    const defects = inspectItemDefects(mockItem);
    const byCode = Object.fromEntries(defects.map(defect => [defect.code, defect.message]));
    expect(byCode["non-standard-doi"]).toBe("diag-non-standard-doi");
    expect(byCode["missing-creators"]).toBe("diag-missing-creators");
    expect(byCode["trailing-dot-title"]).toBe("diag-trailing-dot-title");
    expect(byCode["missing-publication"]).toBe("diag-missing-publication");
    expect(byCode["missing-date"]).toBe("diag-missing-date");
    expect(byCode["missing-pagination"]).toContain("diag-missing-pagination");
    expect(byCode["missing-pagination"]).toContain("diag-field-volume");
    expect(byCode["missing-pagination"]).toContain("diag-field-issue");
    expect(byCode["missing-pagination"]).toContain("diag-field-pages");
    expect(byCode["missing-abstract"]).toBe("diag-missing-abstract");
    for (const defect of defects) {
      expect(defect.message).not.toMatch(/[\u4E00-\u9FFF]/);
    }
  });
});
