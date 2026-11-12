import type { DuplicateRecord } from "./duplicate-matching";
import { describe, expect, it } from "vitest";
import { sanitizeWebTitle, titlesAgree } from "../rules/tool-update-metadata/policy";
import { duplicatePairs } from "./duplicate-matching";
import { creatorsAgree, firstCreator, identifiersFromText, identityConflicts, isbnEquivalent, isPlaceholderCreator, normalizeArxiv, normalizeISBN, reviewChanges } from "./policy";

function record(id: number, overrides: Partial<DuplicateRecord["data"]> = {}, libraryID = 1, preprint = false): DuplicateRecord {
  return {
    id,
    libraryID,
    preprint,
    data: { itemType: "journalArticle", title: "Optical responses of two dimensional materials", date: "2026", creators: [{ creatorType: "author", firstName: "Jane", lastName: "Doe" }], ...overrides },
  };
}

describe("review identity policy", () => {
  it("sanitizes web scraping suffixes and agrees with clean titles", () => {
    const dirty = "Constructing slip stacking diversity in van der waals homobilayers - chen - 2024 - advanced materials - wiley online library";
    const clean = "Constructing Slip Stacking Diversity in Van der Waals Homobilayers";
    expect(sanitizeWebTitle(dirty)).toBe("Constructing slip stacking diversity in van der waals homobilayers");
    expect(titlesAgree(dirty, clean)).toBe(true);
  });

  it("detects placeholder creators like (姓), (名) and nullish/anonymous strings", () => {
    expect(isPlaceholderCreator({ lastName: "(姓)", firstName: "(名)" })).toBe(true);
    expect(isPlaceholderCreator({ name: "(姓), (名)" })).toBe(true);
    expect(isPlaceholderCreator({ lastName: "unknown" })).toBe(true);
    expect(isPlaceholderCreator({ lastName: "null", firstName: "undefined" })).toBe(true);
    expect(isPlaceholderCreator({ name: "N/A" })).toBe(true);
    expect(isPlaceholderCreator({ name: "et al." })).toBe(true);
    expect(isPlaceholderCreator({ name: "[Anonymous]" })).toBe(true);
    expect(isPlaceholderCreator({ lastName: "Chen", firstName: "Yun" })).toBe(false);
  });

  it("includes an ISSN returned by metadata providers in review changes", () => {
    expect(reviewChanges({ ISSN: "" }, { ISSN: "1530-6984" })).toContainEqual({ field: "ISSN", before: "", after: "1530-6984" });
  });
  it("extracts contextual DOI candidates without treating a reference as verified", () => {
    const candidates = identifiersFromText("Title DOI: 10.1000/abc(x)).\nReferences: 10.2000/other; arXiv:2403.12345v2", "cached PDF");
    expect(candidates.map(candidate => candidate.value)).toEqual(["10.1000/abc(x)", "10.2000/other", "2403.12345v2"]);
    expect(candidates[1].excerpt).toContain("References");
  });
  it("deduplicates identifiers and bounds PDF candidates", () => {
    const candidates = identifiersFromText(Array.from({ length: 30 }, (_, i) => `10.1000/a${i} 10.1000/a${i}`).join(" "), "PDF");
    expect(candidates).toHaveLength(20);
    expect(new Set(candidates.map(candidate => candidate.value)).size).toBe(20);
  });
  it.each(["https://arxiv.org/pdf/2403.12345v2.pdf", "arXiv:2403.12345v2", "10.48550/arXiv.2403.12345v2"])("preserves explicit versions in %s", (input) => {
    expect(normalizeArxiv(input)).toBe("2403.12345v2");
  });
  it("supports legacy arXiv IDs and rejects partial or invalid IDs", () => {
    expect(normalizeArxiv("https://arxiv.org/abs/cond-mat/0701234v1")).toBe("cond-mat/0701234v1");
    expect(normalizeArxiv("2403.12345v0")).toBe("");
    expect(normalizeArxiv("not an arxiv identifier")).toBe("");
  });
  it("validates ISBN check digits and equivalent ISBN-10/13 editions", () => {
    expect(normalizeISBN("0-306-40615-2")).toBe("0306406152");
    expect(normalizeISBN("978-0-306-40615-7")).toBe("9780306406157");
    expect(normalizeISBN("9780306406158")).toBe("");
    expect(isbnEquivalent("0306406152", "9780306406157")).toBe(true);
    expect(isbnEquivalent("0306406152", "9780131103627")).toBe(false);
    expect(isbnEquivalent("", "")).toBe(false);
  });
  it("reports title, year and creator conflicts even if a DOI resolves", () => {
    const original = record(1).data;
    const candidate = record(2, { title: "A different work", date: "2025", creators: [{ creatorType: "author", lastName: "Smith" }] }).data;
    expect(identityConflicts(original, candidate)).toEqual(["title", "date", "creators"]);
    expect(identityConflicts(original, candidate, true)).toEqual(["title", "creators"]);
  });
  it("does not propose empty values or accept arbitrary remote fields", () => {
    expect(reviewChanges({ title: "Keep", date: "2025" }, { title: "", date: "2026", extra: "remote extra", creators: [] })).toEqual([{ field: "date", before: "2025", after: "2026" }]);
    expect(reviewChanges({ itemType: "preprint" }, { itemType: "journalArticle" }, true)).toEqual([{ field: "itemType", before: "preprint", after: "journalArticle" }]);
  });

  it("matches creators across single-field, western, chinese, and pinyin representations", () => {
    expect(creatorsAgree(
      { creators: [{ creatorType: "author", lastName: "李", firstName: "明" }] },
      { creators: [{ creatorType: "author", lastName: "Li", firstName: "Ming" }] },
    )).toBe(true);

    expect(creatorsAgree(
      { creators: [{ creatorType: "author", lastName: "Smith" }, { creatorType: "author", lastName: "Johnson" }] },
      { creators: [{ creatorType: "author", lastName: "Johnson" }, { creatorType: "author", lastName: "Smith" }] },
    )).toBe(true);

    expect(firstCreator({ creators: [{ creatorType: "author", name: "Kaiming He" }] })).toBe("he");
    expect(firstCreator({ creators: [{ creatorType: "author", lastName: "He", firstName: "Kaiming" }] })).toBe("he");
    expect(firstCreator({ creators: [{ creatorType: "author", lastName: "张", firstName: "三" }] })).toBe("zhang");
  });

  it("matches CJK titles and subtitle variations in titlesAgree without conflating distinct works", () => {
    expect(titlesAgree("基于深度学习的图像去噪算法研究", "基于深度学习的图像去噪算法研究")).toBe(true);
    expect(titlesAgree("基于深度学习的图像去噪算法研究", "基于深度学习的图像去噪算法研究——以医学图像为例")).toBe(true);
    expect(titlesAgree("基于深度学习的图像识别方法研究", "基于深度学习的语音识别方法研究")).toBe(false);
    expect(titlesAgree("Quantum Computing: Principles and Applications", "Quantum Computing")).toBe(true);
  });
});

describe("explainable duplicate candidates", () => {
  it("finds candidates outside the selection but never across libraries", () => {
    const pairs = duplicatePairs(new Set([1]), [record(1, { DOI: "10.1000/a" }), record(2, { DOI: "10.1000/A" }), record(3, { DOI: "10.1000/a" }, 2)]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ reason: "doi", mergeable: true, right: { id: 2 } });
  });
  it("requires corroborating year and creator for title matches", () => {
    expect(duplicatePairs(new Set([1]), [record(1, { date: "" }), record(2, { date: "" })])).toHaveLength(0);
    expect(duplicatePairs(new Set([1]), [record(1), record(2)])).toHaveLength(1);
    expect(duplicatePairs(new Set([1]), [record(1), record(2, { creators: [{ creatorType: "author", lastName: "Smith" }] })])).toHaveLength(0);
  });
  it("does not allow merging conflicting DOIs or different item types", () => {
    expect(duplicatePairs(new Set([1]), [record(1, { DOI: "10.1000/a" }), record(2, { DOI: "10.1000/b" })])[0].mergeable).toBe(false);
    expect(duplicatePairs(new Set([1]), [record(1), record(2, { itemType: "conferencePaper" })])[0].mergeable).toBe(false);
  });
  it("does not allow merging distinct preprint versions", () => {
    const pairs = duplicatePairs(new Set([1]), [record(1, { url: "https://arxiv.org/abs/2403.12345v1" }, 1, true), record(2, { url: "https://arxiv.org/abs/2403.12345v2" }, 1, true)]);
    expect(pairs[0]).toMatchObject({ reason: "title", mergeable: false });
  });
  it("finds arXiv versions whose titles have changed and does not merge them", () => {
    const pairs = duplicatePairs(new Set([1]), [record(1, { title: "Old title", url: "https://arxiv.org/abs/2403.12345v1" }, 1, true), record(2, { title: "Completely new title", url: "https://arxiv.org/abs/2403.12345v2" }, 1, true)]);
    expect(pairs[0]).toMatchObject({ reason: "arxiv", mergeable: false });
  });
  it("deduplicates a pair selected from both ends and avoids transitive DOI conflation", () => {
    const pairs = duplicatePairs(new Set([1, 2, 3]), [record(1, { DOI: "10.1000/a" }), record(2), record(3, { DOI: "10.1000/c" })]);
    expect(pairs).toHaveLength(3);
    expect(pairs.find(pair => pair.left.id === 1 && pair.right.id === 3)?.mergeable).toBe(false);
  });
});
