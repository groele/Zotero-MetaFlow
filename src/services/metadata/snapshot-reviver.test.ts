// autocorrect-disable
import { describe, expect, it } from "vitest";
import {
  identifiersFromHTML,
  identifiersFromURL,
  isSnapshotItem,
  revivalExtra,
  revivalTarget,
  reviveProposal,
} from "./snapshot-reviver";

describe("snapshot-reviver", () => {
  it("identifies snapshot item types", () => {
    expect(isSnapshotItem({ itemType: "webpage" })).toBe(true);
    expect(isSnapshotItem({ itemType: "blogPost" })).toBe(true);
    expect(isSnapshotItem({ itemType: "journalArticle" })).toBe(false);
    expect(isSnapshotItem({ itemType: "book" })).toBe(false);
    expect(isSnapshotItem(undefined)).toBe(false);
  });

  describe("identifiersFromURL", () => {
    it("extracts DOI from publisher and direct DOI URLs", () => {
      const candidates1 = identifiersFromURL("https://doi.org/10.1038/s41586-020-2649-2", "URL");
      expect(candidates1).toEqual([{ kind: "DOI", value: "10.1038/s41586-020-2649-2", source: "URL" }]);

      const candidates2 = identifiersFromURL("https://link.springer.com/article/10.1007/s00222-020-00987-6?utm_source=test", "URL");
      expect(candidates2).toEqual([{ kind: "DOI", value: "10.1007/s00222-020-00987-6", source: "URL" }]);
    });

    it("extracts Nature and Nature News articles as 10.1038 DOIs", () => {
      const candidates = identifiersFromURL("https://www.nature.com/articles/d41586-024-00123-4", "URL");
      expect(candidates).toEqual([{ kind: "DOI", value: "10.1038/d41586-024-00123-4", source: "URL" }]);
    });

    it("extracts arXiv identifiers from abs and pdf URLs", () => {
      const candidates1 = identifiersFromURL("https://arxiv.org/abs/2301.00001", "URL");
      expect(candidates1).toEqual([{ kind: "arXiv", value: "2301.00001", source: "URL" }]);

      const candidates2 = identifiersFromURL("https://arxiv.org/pdf/2301.00001v2.pdf", "URL");
      expect(candidates2).toEqual([{ kind: "arXiv", value: "2301.00001v2", source: "URL" }]);
    });

    it("extracts PubMed and PMC IDs from URLs", () => {
      const pubmed = identifiersFromURL("https://pubmed.ncbi.nlm.nih.gov/33128080/", "URL");
      expect(pubmed).toEqual([{ kind: "PMID", value: "33128080", source: "URL" }]);

      const pmc = identifiersFromURL("https://pmc.ncbi.nlm.nih.gov/articles/PMC7608976/", "URL");
      expect(pmc).toEqual([{ kind: "PMCID", value: "PMC7608976", source: "URL" }]);

      const ar5iv = identifiersFromURL("https://ar5iv.labs.arxiv.org/html/2301.00001", "URL");
      expect(ar5iv).toEqual([{ kind: "arXiv", value: "2301.00001", source: "URL" }]);
    });

    it("returns empty array for non-academic or malformed URLs", () => {
      expect(identifiersFromURL("not-a-url", "URL")).toEqual([]);
      expect(identifiersFromURL("https://www.google.com/search?q=test", "URL")).toEqual([]);
    });
  });

  describe("identifiersFromHTML", () => {
    it("extracts meta tags from HTML head", () => {
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>A deep learning breakthrough</title>
          <meta name="citation_doi" content="10.1038/s41586-024-00001-1">
          <meta name="citation_arxiv_id" content="2401.12345">
          <meta name="citation_pmid" content="98765432">
          <meta name="citation_pmcid" content="PMC1234567">
        </head>
        <body>
          <p>Unrelated body containing 10.9999/ignore-this-reference</p>
        </body>
        </html>
      `;
      const result = identifiersFromHTML(html, "HTML");
      expect(result).toEqual([
        { kind: "DOI", value: "10.1038/s41586-024-00001-1", source: "HTML" },
        { kind: "arXiv", value: "2401.12345", source: "HTML" },
        { kind: "PMID", value: "98765432", source: "HTML" },
        { kind: "PMCID", value: "PMC1234567", source: "HTML" },
      ]);
    });

    it("extracts Dublin Core and OpenGraph canonical links", () => {
      const html = `
        <html>
        <head>
          <meta name="dc.identifier.doi" content="10.1145/3318464.3389700">
          <link rel="canonical" href="https://www.nature.com/articles/d41586-024-00567-8">
        </head>
        <body>Content</body>
        </html>
      `;
      const result = identifiersFromHTML(html, "HTML");
      expect(result).toEqual([
        { kind: "DOI", value: "10.1145/3318464.3389700", source: "HTML" },
        { kind: "DOI", value: "10.1038/d41586-024-00567-8", source: "HTML" },
      ]);
    });

    it("ignores body content and DOIs in references", () => {
      const html = `
        <html>
        <head><title>Blog post</title></head>
        <body>
          <h1>Discussion of recent paper</h1>
          <a href="https://doi.org/10.1038/body-doi-reference">Reference</a>
        </body>
        </html>
      `;
      expect(identifiersFromHTML(html, "HTML")).toEqual([]);
    });
  });

  describe("revivalTarget", () => {
    it("determines correct scholarly target type", () => {
      expect(revivalTarget("webpage", { itemType: "journalArticle" }, { kind: "DOI", value: "10.1000/1", source: "" }))
        .toBe("journalArticle");

      expect(revivalTarget("webpage", { publicationTitle: "Nature", volume: "600", pages: "1-10" }, { kind: "DOI", value: "10.1000/1", source: "" }))
        .toBe("journalArticle");

      expect(revivalTarget("webpage", { publicationTitle: "Nature Communications", DOI: "10.1038/s41467-024-00001-1" }, { kind: "DOI", value: "10.1038/s41467-024-00001-1", source: "" }))
        .toBe("journalArticle");

      expect(revivalTarget("webpage", {}, { kind: "arXiv", value: "2301.00001", source: "" }))
        .toBe("preprint");

      // Non-snapshot item returns undefined
      expect(revivalTarget("book", { itemType: "journalArticle" }, { kind: "DOI", value: "10.1000/1", source: "" }))
        .toBeUndefined();
    });
  });

  describe("reviveProposal and revivalExtra", () => {
    it("converts webpage proposal into revived journal article", () => {
      const original = {
        itemType: "webpage" as const,
        title: "Messy webpage capture title - 403 Forbidden",
        url: "https://www.nature.com/articles/d41586-024-00123-4",
      };
      const candidate = {
        itemType: "journalArticle" as const,
        title: "Clean Academic Paper Title",
        publicationTitle: "Nature",
        date: "2024",
      };
      const proposal = {
        itemID: 10,
        original,
        candidate,
        identifier: { kind: "DOI" as const, value: "10.1038/d41586-024-00123-4", source: "URL" },
        source: "Crossref",
        conflicts: ["title", "date"],
        blocked: false,
        changes: [
          { field: "title" as const, before: original.title, after: candidate.title },
          { field: "publicationTitle" as const, before: "", after: candidate.publicationTitle },
        ],
      };

      const revived = reviveProposal(proposal, "webpage");
      expect(revived.conflicts).toEqual([]);
      expect(revived.revival).toEqual({
        from: "webpage",
        to: "journalArticle",
        replaced: ["title", "date"],
      });
      expect(revived.candidate.itemType).toBe("journalArticle");
      expect(revived.changes.some(c => c.field === "itemType")).toBe(true);
    });

    it("generates provenance Extra fields for revived snapshot", () => {
      const mockItem = {
        itemType: "webpage",
        getField: (f: string) => f === "extra" ? "User notes" : "",
        toJSON: () => ({ websiteTitle: "Nature Online", title: "Raw Webpage" }),
      };
      (globalThis as any).Zotero = {
        ItemTypes: {
          getID: (t: string) => t === "journalArticle" ? 1 : 2,
        },
        ItemFields: {
          getID: (f: string) => f === "websiteTitle" ? 10 : null,
          isValidForType: (fieldID: number, _typeID: number) => fieldID !== 10,
        },
      };

      const proposal = {
        original: { title: "Raw Webpage" },
        candidate: { title: "True Journal Paper" },
        identifier: { kind: "DOI" as const, value: "10.1038/test" },
      } as any;

      const extra = revivalExtra(mockItem as any, proposal, "journalArticle");
      expect(extra).toContain("User notes");
      expect(extra).toContain("MetaFlow revived from: webpage");
      expect(extra).toContain("MetaFlow revival identifier: DOI 10.1038/test");
      expect(extra).toContain("MetaFlow snapshot title: \"Raw Webpage\"");
      expect(extra).toContain("MetaFlow snapshot websiteTitle: \"Nature Online\"");
    });
  });
});
