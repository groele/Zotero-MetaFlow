import { describe, expect, it } from "vitest";
import { inspectItemDefects } from "./item-diagnostics";

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
});
