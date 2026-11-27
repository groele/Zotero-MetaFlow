import { describe, expect, it, vi } from "vitest";
import { duplicatePairs } from "./domains/review-duplicates/review/duplicate-matching";
import { extractTLDRFromItem } from "./services/metadata/tool-update-metadata/tldr-content";
import { ItemMutationJournal } from "./utils/item-mutation-journal";
import { cachedJournalInsights, clearJournalInsights, loadJournalInsights } from "./utils/journal-insights";
import { computeBatchRuleSignature, computeItemLintSignature } from "./utils/lint-fingerprint-cache";

describe("systematic performance & optimization benchmarks", () => {
  it("reduces item.toJSON() calls by 60%+ via precomputedJSON and ItemMutationJournal snapshot reuse", () => {
    const rawData = { title: "Initial Title", volume: "10", issue: "2", pages: "100-110", DOI: "10.1038/s41586-024-00001-1" };
    const toJSON = vi.fn(() => ({ ...rawData }));
    const item = {
      id: 101,
      version: 5,
      itemType: "journalArticle",
      getField: (f: string) => (rawData as Record<string, string>)[f] || "",
      getAttachmentIDs: () => [],
      toJSON,
      fromJSON: (next: Record<string, string>) => Object.assign(rawData, next),
    } as unknown as Zotero.Item;

    const rules = [{ id: "correct-date-format", scope: "field", targetFields: ["date"], apply: () => {} }] as any[];
    const optionsMap = new Map<string, any>([["correct-date-format", true]]);
    const batchRuleSig = computeBatchRuleSignature(rules, optionsMap);

    // 1. Clean item signature path: 1 baseline toJSON reused across preSignature and postSignature
    const baseline = item.toJSON() as Record<string, unknown>;
    const preSig = computeItemLintSignature(item, rules, optionsMap, batchRuleSig, baseline);
    const postSig = computeItemLintSignature(item, rules, optionsMap, batchRuleSig, baseline);
    expect(preSig).toBe(postSig);
    expect(toJSON).toHaveBeenCalledTimes(1); // Previously 3-4 calls per clean item

    // 2. Consecutive mutations inside ItemMutationJournal: N writes take N+1 toJSON calls instead of 2N+1
    toJSON.mockClear();
    const journal = new ItemMutationJournal(item);
    journal.capture(() => {
      rawData.title = "Updated Title";
    });
    journal.capture(() => {
      rawData.volume = "11";
    });
    journal.capture(() => {
      rawData.issue = "3";
    });
    journal.capture(() => {
      rawData.pages = "100–110";
    });
    const changes = journal.changes();
    expect(changes).toHaveLength(4);
    expect(toJSON).toHaveBeenCalledTimes(5); // 1 initial before + 4 afters (previously 4*2 + 1 = 9 calls)
  });

  it("memoizes cachedJournalInsights and extractTLDRFromItem to O(1) on repeated virtual table scroll reads", async () => {
    await loadJournalInsights();
    const getField = vi.fn((field: string) => {
      if (field === "ISSN")
        return "0028-0836";
      if (field === "publicationTitle")
        return "Nature";
      if (field === "extra")
        return "TLDR: Single-atom catalysis on oxide supports";
      return "";
    });
    const getNote = vi.fn(() => "<div data-metaflow-tldr=\"true\"><blockquote>Cached note TLDR summary</blockquote></div>");
    vi.stubGlobal("Zotero", {
      ...(globalThis as any).Zotero,
      debug: () => {},
      Items: {
        get: (id: number) => (id === 9001 ? { id: 9001, version: 1, deleted: false, getNote } : false),
      },
    });

    const item = {
      id: 501,
      itemType: "journalArticle",
      isRegularItem: () => true,
      getField,
      getNotes: () => [9001],
    } as unknown as Zotero.Item;

    // Warm up once
    const firstInsight = cachedJournalInsights(item);
    const firstTldr = extractTLDRFromItem(item);
    expect(firstInsight).toBeDefined();
    expect(firstTldr).toBe("Cached note TLDR summary");
    const callsAfterWarmup = getNote.mock.calls.length;

    // Simulate 200 virtual table scroll frames across multiple columns
    const start = performance.now();
    for (let i = 0; i < 200; i++) {
      expect(cachedJournalInsights(item)?.esi).toBe(firstInsight?.esi);
      expect(extractTLDRFromItem(item)).toBe("Cached note TLDR summary");
    }
    const elapsedMs = performance.now() - start;

    // getNote() content is only inspected asynchronously via lightweight length/version check, never re-parsed via regex
    expect(getNote.mock.calls.length).toBe(callsAfterWarmup + 200);
    expect(elapsedMs).toBeLessThan(50);
    clearJournalInsights();
  });

  it("pre-filters non-selected library items during duplicate matching to skip expensive author normalization", () => {
    const records = Array.from({ length: 500 }, (_, index) => ({
      id: index + 1,
      libraryID: 1,
      preprint: false,
      data: {
        itemType: "journalArticle" as const,
        title: index === 0 || index === 499 ? "Deep Learning for Automated Metadata Curation" : `Unrelated Paper Topic Number ${index}`,
        date: index === 0 || index === 499 ? "2025-03-15" : "2021-01-01",
        creators: [{ creatorType: "author" as const, firstName: "San", lastName: index === 0 || index === 499 ? "张三" : `李四 ${index}` }],
      },
    }));

    const start = performance.now();
    const pairs = duplicatePairs(new Set([1]), records);
    const elapsedMs = performance.now() - start;

    expect(pairs).toHaveLength(1);
    expect(pairs[0].left.id).toBe(1);
    expect(pairs[0].right.id).toBe(500);
    expect(elapsedMs).toBeLessThan(100);
  });
});
