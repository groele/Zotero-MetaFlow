import { describe, expect, it } from "vitest";
import { sanitizeWebTitle, titlesAgree } from "../rules/tool-update-metadata/policy";
import { transformCrossrefWork } from "../rules/tool-update-metadata/services/crossref-service";
import { automaticSelection } from "./automatic-policy";
import { identityConflicts, isPlaceholderCreator } from "./policy";

describe("wiley paper end-to-end recovery pipeline", () => {
  it("successfully cleans and updates a web-scraped dirty item with DOI 10.1002/adma.202404734", () => {
    // 1. The original item as scraped from Wiley Online Library
    const original = {
      itemType: "journalArticle" as const,
      title: "Constructing slip stacking diversity in van der waals homobilayers - chen - 2024 - advanced materials - wiley online library",
      DOI: "10.1002/adma.202404734",
      publicationTitle: "Advanced Materials",
      date: "2024",
      pages: "2404734",
      creators: [{ lastName: "(姓)", firstName: "(名)", creatorType: "author" as const }],
      url: "https://advanced.onlinelibrary.wiley.com/doi/abs/10.1002/adma.202404734",
    };

    // 2. Crossref work payload for 10.1002/adma.202404734
    const crossrefMessage = {
      "DOI": "10.1002/adma.202404734",
      "type": "journal-article",
      "title": ["Constructing Slip Stacking Diversity in Van der Waals Homobilayers"],
      "author": [
        { given: "Yun", family: "Chen", sequence: "first" },
        { given: "Jinguo", family: "Lin", sequence: "additional" },
        { given: "Junjie", family: "Jiang", sequence: "additional" },
        { given: "Jin", family: "Zhang", sequence: "additional" },
      ],
      "container-title": ["Advanced Materials"],
      "volume": "36",
      "issue": "40",
      "page": "2404734",
      "ISSN": ["0935-9648"],
      "issued": { "date-parts": [[2024, 7, 28]] },
      "abstract": "<jats:title>Abstract</jats:title><jats:p>The van der Waals interface provides two important degrees of freedom...</jats:p>",
    };

    // 3. Transform via CrossrefService
    const candidate = transformCrossrefWork(crossrefMessage as any);

    // Assert candidate extracted cleanly
    expect(candidate.title).toBe("Constructing Slip Stacking Diversity in Van der Waals Homobilayers");
    expect(candidate.creators).toHaveLength(4);
    expect(candidate.volume).toBe("36");
    expect(candidate.issue).toBe("40");
    expect(candidate.abstractNote).toContain("The van der Waals interface");

    // 4. Assert Title Sanitization and Title Agreement
    const sanitizedTitle = sanitizeWebTitle(original.title);
    expect(sanitizedTitle).toBe("Constructing slip stacking diversity in van der waals homobilayers");
    expect(titlesAgree(original.title, candidate.title!)).toBe(true);

    // 5. Assert Placeholder Creator Detection
    expect(original.creators.every(isPlaceholderCreator)).toBe(true);

    // 6. Assert Conflicts are Zero
    const conflicts = identityConflicts(original, candidate);
    expect(conflicts).toEqual([]);

    // 7. Assert Automatic Selection (even with default overwrite = false)
    const proposal = {
      itemID: 101,
      original,
      candidate,
      identifier: { kind: "DOI" as const, value: "10.1002/adma.202404734", source: "item" },
      source: "Crossref",
      conflicts,
      blocked: false,
      changes: [
        { field: "title", before: original.title, after: candidate.title },
        { field: "creators", before: original.creators, after: candidate.creators },
        { field: "volume", before: "", after: candidate.volume },
        { field: "issue", before: "", after: candidate.issue },
        { field: "abstractNote", before: "", after: candidate.abstractNote },
        { field: "ISSN", before: "", after: candidate.ISSN },
      ],
    };

    const decision = automaticSelection(proposal as any, false, false);
    expect(decision.reason).toBeUndefined();
    expect(decision.selection).toBeDefined();

    const selectedFields = decision.selection!.fields;
    // Dirty title is updated to clean title!
    expect(selectedFields.has("title")).toBe(true);
    // Placeholder creators are updated to real authors!
    expect(selectedFields.has("creators")).toBe(true);
    // Missing volume, issue, abstract, and ISSN are populated!
    expect(selectedFields.has("volume")).toBe(true);
    expect(selectedFields.has("issue")).toBe(true);
    expect(selectedFields.has("abstractNote")).toBe(true);
    expect(selectedFields.has("ISSN")).toBe(true);
  });
});
