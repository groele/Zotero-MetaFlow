import { describe, expect, it } from "vitest";
import { extractDOIFromUrl, extractIdentifiers } from "./identifiers";

// Mock Zotero item
function mockItem(fields: Record<string, string>) {
  return {
    getField: (key: string) => fields[key] || "",
  } as Zotero.Item;
}

// Mock ztoolkit ExtraField
(globalThis as any).ztoolkit = {
  ExtraField: {
    getExtraField: (item: Zotero.Item, field: string) =>
      (item as any)[`extra_${field}`] || "",
  },
};

describe("extractDOIFromUrl", () => {
  it("extracts DOI from URL", () => {
    expect(
      extractDOIFromUrl("https://example.com/10.1234/abcd.5678"),
    ).toBe("10.1234/abcd.5678");
  });

  it("returns null for invalid URL", () => {
    expect(extractDOIFromUrl("not-a-url")).toBeNull();
  });

  it("handles encoded DOI", () => {
    expect(
      extractDOIFromUrl("https://example.com/10.1234%2Fabcd.5678"),
    ).toBe("10.1234/abcd.5678");
  });

  it("handles URL with query", () => {
    expect(
      extractDOIFromUrl("https://example.com/10.1234/abcd.5678?abc=11"),
    ).toBe("10.1234/abcd.5678");
  });

  it("removes unmatched citation punctuation while preserving balanced DOI punctuation", () => {
    expect(extractDOIFromUrl("https://doi.org/10.1234/abc(foo)."))
      .toBe("10.1234/abc(foo)");
    expect(extractDOIFromUrl("https://doi.org/10.1234/abc(foo))"))
      .toBe("10.1234/abc(foo)");
  });
});

describe("extractIdentifiers", () => {
  it("extracts DOI, URL and arXiv", () => {
    const item = mockItem({
      DOI: "10.48550/arXiv.1234.5678",
      url: "https://arxiv.org/abs/1234.5678",
    });

    const result = extractIdentifiers(item);

    expect(result.DOI).toBe("10.48550/arXiv.1234.5678");
    expect(result.arXiv).toBe("1234.5678");
    expect(result.URL).toBe("https://arxiv.org/abs/1234.5678");
  });

  it("falls back to DOI from URL if missing", () => {
    const item = mockItem({
      url: "https://example.com/10.9999/xyz567",
    });

    const result = extractIdentifiers(item);
    expect(result.DOI).toBe("10.9999/xyz567");
  });

  it("extracts an unstructured DOI from Extra when it is not a parsed Extra field", () => {
    const item = mockItem({ extra: "See https://doi.org/10.1234/example)." });

    expect(extractIdentifiers(item).DOI).toBe("10.1234/example");
  });

  it("extracts extra fields like PMID and ISBN", () => {
    const item = mockItem({
      url: "https://example.com",
    });

    (item as any).extra_PMID = "99999";
    (item as any).extra_ISBN = "123-4567";

    const result = extractIdentifiers(item);

    expect(result.PMID).toBe("99999");
    expect(result.ISBN).toBe("123-4567");
  });
});

describe("oSF identifiers", () => {
  it.each([
    "https://osf.io/k2y3z/",
    "https://osf.io/k2y3z",
    "https://osf.io/k2y3z/?view_only=token",
    "https://osf.io/preprints/psyarxiv/k2y3z",
  ])("keeps the identifier from %s", (url) => {
    expect(extractIdentifiers(mockItem({ url })).OSF).toBe("k2y3z");
  });
  it("does not mistake another host or a lookalike URL for OSF", () => {
    expect(extractIdentifiers(mockItem({ url: "https://example.com/https://osf.io/k2y3z/" })).OSF).toBeUndefined();
  });
});
