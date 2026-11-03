import { describe, expect, it } from "vitest";
import { extractArxivID, isUnconvertedArxivPreprint, isUnrevivedSnapshot, supportsSection } from "./journal-pane";

function mockItem(fields: Record<string, string>, itemType = "preprint", regular = true): Zotero.Item {
  return {
    itemType,
    isRegularItem: () => regular,
    getField: (field: string) => fields[field] || "",
  } as unknown as Zotero.Item;
}

describe("extractArxivID", () => {
  it("extracts from arXiv abs/pdf/html URLs", () => {
    expect(extractArxivID(mockItem({ url: "https://arxiv.org/abs/2401.12345" }))).toBe("2401.12345");
    expect(extractArxivID(mockItem({ url: "https://arxiv.org/pdf/2401.12345.pdf" }))).toBe("2401.12345");
    expect(extractArxivID(mockItem({ url: "https://arxiv.org/html/2401.12345v2" }))).toBe("2401.12345v2");
  });

  it("extracts from arXiv DOI", () => {
    expect(extractArxivID(mockItem({ DOI: "10.48550/arXiv.2401.12345" }))).toBe("2401.12345");
    expect(extractArxivID(mockItem({ extra: "DOI: 10.48550/arXiv.2401.12345" }))).toBe("2401.12345");
  });

  it("extracts from extra field and archiveID", () => {
    expect(extractArxivID(mockItem({ extra: "arXiv: 2401.12345 [cs.CV]" }))).toBe("2401.12345");
    expect(extractArxivID(mockItem({ archiveID: "2401.12345v1" }))).toBe("2401.12345v1");
  });

  it("returns undefined for non-arXiv preprints or ordinary publications", () => {
    expect(extractArxivID(mockItem({ url: "https://www.biorxiv.org/content/10.1101/2024.01.01.573822v1", DOI: "10.1101/2024.01.01.573822" }))).toBeUndefined();
    expect(extractArxivID(mockItem({ DOI: "10.1038/s41586-024-00000-0", publicationTitle: "Nature" }))).toBeUndefined();
    expect(extractArxivID(mockItem({}, "attachment", false))).toBeUndefined();
  });
});

describe("isUnconvertedArxivPreprint", () => {
  it("recognizes unconverted preprints with arXiv ID", () => {
    const item = mockItem({ url: "https://arxiv.org/abs/2401.12345" }, "preprint");
    expect(isUnconvertedArxivPreprint(item)).toBe(true);
  });

  it("ignores non-arXiv preprints", () => {
    const item = mockItem({ url: "https://www.biorxiv.org/content/10.1101/123", DOI: "10.1101/123" }, "preprint");
    expect(isUnconvertedArxivPreprint(item)).toBe(false);
  });

  it("recognizes journalArticles that are actually unconverted arXiv entries", () => {
    const itemWithArxivDOI = mockItem({ DOI: "10.48550/arXiv.2401.12345" }, "journalArticle");
    expect(isUnconvertedArxivPreprint(itemWithArxivDOI)).toBe(true);

    const itemWithArxivPub = mockItem({ url: "https://arxiv.org/abs/2401.12345", publicationTitle: "arXiv" }, "journalArticle");
    expect(isUnconvertedArxivPreprint(itemWithArxivPub)).toBe(true);
  });

  it("does not treat established journal articles as unconverted even if they reference an arXiv preprint", () => {
    const publishedItem = mockItem({
      DOI: "10.1038/s41586-024-01234-5",
      publicationTitle: "Nature",
      extra: "arXiv: 2401.12345",
    }, "journalArticle");
    expect(isUnconvertedArxivPreprint(publishedItem)).toBe(false);
  });

  it("does not treat already converted items as unconverted", () => {
    const convertedItem = mockItem({
      DOI: "10.1145/1234567.8901234",
      publicationTitle: "Communications of the ACM",
      extra: "MetaFlow preprint identifier: 2401.12345\nMetaFlow preprint URL: https://arxiv.org/abs/2401.12345",
    }, "journalArticle");
    expect(isUnconvertedArxivPreprint(convertedItem)).toBe(false);
  });
});

describe("isUnrevivedSnapshot", () => {
  it("recognizes webpage snapshots with URL", () => {
    const item = mockItem({ url: "https://www.nature.com/articles/d41586-024-00000-0" }, "webpage");
    expect(isUnrevivedSnapshot(item)).toBe(true);
  });

  it("recognizes blogPost snapshots", () => {
    const item = mockItem({ url: "https://example.com/blog/post-1" }, "blogPost");
    expect(isUnrevivedSnapshot(item)).toBe(true);
  });

  it("ignores regular journal articles", () => {
    const item = mockItem({ DOI: "10.1038/s41586", url: "https://nature.com" }, "journalArticle");
    expect(isUnrevivedSnapshot(item)).toBe(false);
  });

  it("ignores already revived snapshots", () => {
    const item = mockItem({
      url: "https://nature.com",
      extra: "MetaFlow revived from: webpage\nMetaFlow revival identifier: DOI 10.1038/s41586",
    }, "webpage");
    expect(isUnrevivedSnapshot(item)).toBe(false);
  });

  it("recognizes snapshot with attachments even without URL", () => {
    const item = {
      itemType: "webpage",
      isRegularItem: () => true,
      getField: () => "",
      getAttachments: () => [123],
    } as unknown as Zotero.Item;
    expect(isUnrevivedSnapshot(item)).toBe(true);
  });
});

describe("supportsSection", () => {
  it("does not activate journal pane solely because item has paper-level TLDR", () => {
    const bookWithTLDR = mockItem({
      extra: "TLDR: This is a book takeaway summary.",
      title: "Some Academic Book",
    }, "book");
    expect(supportsSection(bookWithTLDR)).toBe(false);
  });

  it("activates journal pane for unconverted arXiv preprints", () => {
    const preprint = mockItem({ url: "https://arxiv.org/abs/2401.12345" }, "preprint");
    expect(supportsSection(preprint)).toBe(true);
  });

  it("activates journal pane for unrevived snapshots", () => {
    const snapshot = mockItem({ url: "https://example.com/page" }, "webpage");
    expect(supportsSection(snapshot)).toBe(true);
  });
});
