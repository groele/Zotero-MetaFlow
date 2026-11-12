import type { IdentifierCandidate, ReviewProposal } from "./policy";
import { describe, expect, it } from "vitest";
import { automaticIdentifier, automaticSelection, hasLocalCorroboration } from "./automatic-policy";

const proposal = (extra: Partial<ReviewProposal> = {}): ReviewProposal => ({ itemID: 1, original: { itemType: "journalArticle", title: "Optical response of layered materials", DOI: "10.1234/test", date: "2026" }, candidate: { itemType: "journalArticle", title: "Optical response of layered materials", DOI: "10.1234/test", date: "2026", publicationTitle: "Journal" }, identifier: { kind: "DOI", value: "10.1234/test", source: "item" }, source: "Crossref", blocked: false, conflicts: [], changes: [{ field: "publicationTitle", before: "", after: "Journal" }, { field: "date", before: "2026", after: "2026-10" }], ...extra });
const identifier = (value: string, kind: IdentifierCandidate["kind"] = "DOI", excerpt?: string): IdentifierCandidate => ({ kind, value, source: "fixture", excerpt });

describe("automatic metadata decisions", () => {
  it("rejects impossible corroboration locally before spending a network request", () => {
    expect(hasLocalCorroboration({ title: "Generic title" })).toBe(false);
    expect(hasLocalCorroboration({ date: "2026" })).toBe(false);
    expect(hasLocalCorroboration({ title: " ", date: "2026" })).toBe(false);
    expect(hasLocalCorroboration({ title: "Generic title", date: "2026-10" })).toBe(true);
    expect(hasLocalCorroboration({ title: "Generic title", date: "2026-10" }, "Title")).toBe(false);
    expect(hasLocalCorroboration({ title: "Generic title", creators: [{ creatorType: "author", lastName: "Doe", firstName: "Jane" }] })).toBe(true);
    expect(hasLocalCorroboration({ title: "Generic title", creators: [{ creatorType: "author", lastName: "Doe", firstName: "Jane" }] }, "Title")).toBe(true);
  });
  it("prefers an explicit identifier and never picks an ambiguous DOI by array order", () => {
    expect(automaticIdentifier([identifier("10.1234/b", "DOI", "References"), identifier("10.1234/a")])?.value).toBe("10.1234/a");
    expect(automaticIdentifier([identifier("10.1234/a"), identifier("10.1234/b")])).toBeUndefined();
    expect(automaticIdentifier([identifier("10.1234/a"), identifier("10.1234/a")])?.value).toBe("10.1234/a");
    expect(automaticIdentifier([])).toBeUndefined();
  });
  it("recognizes equivalent ISBN editions but skips distinct editions", () => {
    expect(automaticIdentifier([identifier("9780131103627", "ISBN"), identifier("0131103628", "ISBN")])).toBeDefined();
    expect(automaticIdentifier([identifier("9780131103627", "ISBN"), identifier("9780262033848", "ISBN")])).toBeUndefined();
  });
  it("fills blanks by default and overwrites only when configured", () => {
    expect([...automaticSelection(proposal()).selection!.fields]).toEqual(["publicationTitle"]);
    expect([...automaticSelection(proposal(), true).selection!.fields]).toEqual(["publicationTitle", "date"]);
  });
  it("repairs an incomplete author list only when author repair is enabled", () => {
    const value = proposal({ changes: [{ field: "creators", before: [{ name: "Jane Doe" }], after: [{ name: "Jane Doe" }, { name: "John Roe" }] }] });
    expect(automaticSelection(value, false, true).selection!.fields.has("creators")).toBe(true);
    expect(automaticSelection(value, false, false).selection!.fields.has("creators")).toBe(false);
    expect(automaticSelection({ ...value, excludedFields: ["creators"] }, true, true).selection!.fields.has("creators")).toBe(false);
  });
  it("rejects blocked sources and contradictory identifiers even with cloud priority", () => {
    expect(automaticSelection(proposal({ blocked: true }), true).reason).toBe("blocked");
    expect(automaticSelection(proposal({ candidate: { DOI: "10.1234/other" } }), true).reason).toBe("conflict");
    expect(automaticSelection(proposal({ conflicts: ["DOI"] }), true).reason).toBe("conflict");
  });
  it("allows cloud field differences only after verifying the same explicit DOI", () => {
    const value = proposal({ conflicts: ["title", "date", "creators"] });
    expect(automaticSelection(value).reason).toBe("conflict");
    expect(automaticSelection(value, true).selection?.fields.has("date")).toBe(true);
    for (const extra of [
      { original: { title: "Local without a DOI" } },
      { candidate: { title: "Source without a DOI" } },
      { identifier: identifier("10.1234/other") },
      { identifier: identifier("10.1234/test", "DOI", "PDF excerpt") },
      { identifier: identifier("Local title", "Title") },
      { preprintURL: "https://arxiv.org/abs/2610.12345" },
    ]) {
      expect(automaticSelection({ ...value, ...extra }, true).reason).toBe("conflict");
    }
  });
  it("requires independent corroboration for a PDF or title lookup, including first-author agreement for title search", () => {
    const pdf = identifier("10.1234/test", "DOI", "PDF header");
    expect(automaticSelection(proposal({ identifier: pdf })).selection).toBeDefined();
    expect(automaticSelection(proposal({ identifier: pdf, original: { title: "Optical response of layered materials" } })).reason).toBe("evidence");
    expect(automaticSelection(proposal({ identifier: pdf, original: { title: "A different article", date: "2026" } })).reason).toBe("evidence");

    const titleId = identifier("Optical response of layered materials", "Title");
    const jane = [{ creatorType: "author" as const, firstName: "Jane", lastName: "Doe" }];
    const smith = [{ creatorType: "author" as const, firstName: "John", lastName: "Smith" }];
    expect(automaticSelection(proposal({ identifier: titleId })).reason).toBe("evidence");
    expect(automaticSelection(proposal({
      identifier: titleId,
      original: { title: "Optical response of layered materials", date: "2026", creators: [...smith, ...jane] },
      candidate: { itemType: "journalArticle", title: "Optical response of layered materials", DOI: "10.1234/test", date: "2026", publicationTitle: "Journal", creators: [...jane, ...smith] },
    })).reason).toBe("evidence");
    expect(automaticSelection(proposal({
      identifier: titleId,
      original: { itemType: "journalArticle", title: "Optical response of layered materials", date: "2026", creators: jane },
      candidate: { itemType: "journalArticle", title: "Optical response of layered materials", DOI: "10.1234/test", date: "2026", publicationTitle: "Journal", creators: jane },
    })).selection).toBeDefined();
  });
  it("accepts matching authors as corroboration when the year is absent", () => {
    const creators = [{ creatorType: "author" as const, firstName: "Jane", lastName: "Doe" }];
    const value = proposal();
    expect(automaticSelection(proposal({ identifier: identifier("title", "Title"), original: { title: value.original.title, creators }, candidate: { ...value.candidate, creators } })).selection).toBeDefined();
  });
  it("retains disabled fields and links a verified publication while preserving its preprint", () => {
    const value = proposal({ preprintURL: "https://arxiv.org/abs/2610.12345v1", excludedFields: ["creators"], changes: [{ field: "creators", before: [], after: [{ name: "Jane Doe" }] }, { field: "DOI", before: "10.48550/arxiv.2610.12345", after: "10.1234/test" }, { field: "itemType", before: "preprint", after: "journalArticle" }] });
    const result = automaticSelection(value).selection!;
    expect(result.action).toBe("related");
    expect(result.fields.has("creators")).toBe(false);
    expect([...result.fields]).toEqual(["DOI", "itemType"]);
  });
  it("fills missing blank fields (journal, volume, abstract, pages) even when existing authors or dates differ in blank mode", () => {
    const value = proposal({
      original: {
        itemType: "journalArticle",
        title: "Optical response of layered materials",
        DOI: "10.1234/test",
        date: "2020",
        creators: [{ creatorType: "author", name: "张三" }],
      },
      candidate: {
        itemType: "journalArticle",
        title: "Optical response of layered materials",
        DOI: "10.1234/test",
        date: "2026-10",
        publicationTitle: "Nature Physics",
        volume: "18",
        issue: "3",
        pages: "200-210",
        abstractNote: "Full abstract text",
        ISSN: "1745-2473",
        creators: [{ creatorType: "author", firstName: "San", lastName: "Zhang" }],
      },
      conflicts: ["date", "creators"],
      changes: [
        { field: "publicationTitle", before: "", after: "Nature Physics" },
        { field: "volume", before: "", after: "18" },
        { field: "issue", before: "", after: "3" },
        { field: "pages", before: "", after: "200-210" },
        { field: "abstractNote", before: "", after: "Full abstract text" },
        { field: "ISSN", before: "", after: "1745-2473" },
        { field: "date", before: "2020", after: "2026-10" },
        { field: "creators", before: [{ name: "张三" }], after: [{ firstName: "San", lastName: "Zhang" }] },
      ],
    });

    const result = automaticSelection(value, false, false);
    expect(result.reason).toBeUndefined();
    expect(result.selection).toBeDefined();

    const selectedFields = result.selection!.fields;
    expect(selectedFields.has("publicationTitle")).toBe(true);
    expect(selectedFields.has("volume")).toBe(true);
    expect(selectedFields.has("issue")).toBe(true);
    expect(selectedFields.has("pages")).toBe(true);
    expect(selectedFields.has("abstractNote")).toBe(true);
    expect(selectedFields.has("ISSN")).toBe(true);
    expect(selectedFields.has("date")).toBe(false);
    expect(selectedFields.has("creators")).toBe(false);
  });
});
