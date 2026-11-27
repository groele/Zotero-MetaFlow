import { beforeEach, describe, expect, it, vi } from "vitest";
import { inspectMetadata, inspectPreprint } from "./metadata-inspector";
import * as serviceRegistry from "./tool-update-metadata/services";
import { CrossrefService } from "./tool-update-metadata/services/crossref-service";
import { IdentifiersTranslateService, URLTranslateService } from "./tool-update-metadata/services/translate-service";

vi.mock("../../utils/locale", () => ({ getString: (id: string) => id }));
vi.mock("../../utils/zotero", () => ({ isFieldValidForItemType: () => false }));

describe("metadata-inspector fallback and URL scheme validation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("Zotero", {
      getMainWindow: () => ({ AbortController }),
      HTTP: { processDocuments: vi.fn() },
    });
  });

  it("continues DOI fallback when translator omits DOI and retries S2 after a transient fetch failure", async () => {
    vi.spyOn(IdentifiersTranslateService, "fetch").mockResolvedValue({
      itemType: "journalArticle",
      title: "Layered Crystals",
    });
    vi.spyOn(CrossrefService, "fetch").mockResolvedValue(undefined as any);
    vi.spyOn(serviceRegistry, "hasConfiguredSemanticScholarAPI").mockReturnValue(true);

    const s2 = serviceRegistry.services.find(s => s.id === "semantic-scholar-service")!;
    let s2Calls = 0;
    vi.spyOn(s2, "fetch").mockImplementation(async () => {
      s2Calls++;
      if (s2Calls === 1)
        throw new Error("transient network error");
      return {
        paperId: "s2-1",
        title: "Layered Crystals",
        externalIds: { DOI: "10.1234/layered" },
        journal: { name: "Journal of Crystals", volume: "12", pages: "10-20" },
        publicationDate: "2026-01-01",
      } as any;
    });

    const item = {
      id: 1,
      itemType: "journalArticle",
      getField: () => "",
      toJSON: () => ({ itemType: "journalArticle", title: "Layered Crystals", DOI: "10.1234/layered" }),
    } as unknown as Zotero.Item;

    const proposal = await inspectMetadata(
      item,
      { kind: "DOI", value: "10.1234/layered", source: "item" },
      { itemType: "journalArticle", title: "Layered Crystals", DOI: "10.1234/layered" },
    );

    expect(s2Calls).toBe(2);
    expect(proposal.blocked).toBe(false);
    expect(proposal.candidate.DOI).toBe("10.1234/layered");
    expect(proposal.candidate.publicationTitle).toBe("Journal of Crystals");
    expect(proposal.candidate.volume).toBe("12");
  });

  it("continues to Crossref when translator returns a title without DOI", async () => {
    vi.spyOn(IdentifiersTranslateService, "fetch").mockResolvedValue({
      itemType: "journalArticle",
      title: "Partial Title",
    });
    vi.spyOn(CrossrefService, "fetch").mockResolvedValue({
      message: {
        "DOI": "10.1234/partial",
        "title": ["Partial Title"],
        "abstract": "Complete abstract",
        "container-title": ["Applied Physics"],
        "ISSN": ["1234-5678"],
        "volume": "8",
        "issue": "2",
        "page": "100-105",
        "issued": { "date-parts": [[2026, 3, 1]] },
        "type": "journal-article",
      },
    } as any);
    vi.spyOn(serviceRegistry, "hasConfiguredSemanticScholarAPI").mockReturnValue(false);
    const s2 = serviceRegistry.services.find(s => s.id === "semantic-scholar-service")!;
    const s2Spy = vi.spyOn(s2, "fetch").mockResolvedValue(undefined);

    const item = {
      id: 2,
      itemType: "journalArticle",
      getField: () => "",
      toJSON: () => ({ itemType: "journalArticle", title: "Partial Title", DOI: "10.1234/partial" }),
    } as unknown as Zotero.Item;

    const proposal = await inspectMetadata(
      item,
      { kind: "DOI", value: "10.1234/partial", source: "item" },
      { itemType: "journalArticle", title: "Partial Title", DOI: "10.1234/partial" },
    );

    expect(proposal.blocked).toBe(false);
    expect(proposal.candidate.DOI).toBe("10.1234/partial");
    expect(proposal.candidate.publicationTitle).toBe("Applied Physics");
    expect(proposal.candidate.volume).toBe("8");
    expect(s2Spy).not.toHaveBeenCalled();
  });

  it("isolates Semantic Scholar fallback errors in inspectPreprint", async () => {
    vi.spyOn(CrossrefService, "fetch")
      .mockResolvedValueOnce({
        message: {
          relation: { "is-preprint-of": [{ "id": "10.1234/published", "id-type": "doi" }] },
        },
      } as any)
      .mockRejectedValueOnce(new Error("crossref down"));
    vi.spyOn(IdentifiersTranslateService, "fetch").mockRejectedValue(new Error("translator down"));
    const s2 = serviceRegistry.services.find(s => s.id === "semantic-scholar-service")!;
    vi.spyOn(s2, "fetch").mockRejectedValue(new Error("raw S2 socket failure"));

    const item = {
      id: 3,
      itemType: "preprint",
      getField: () => "",
      toJSON: () => ({ itemType: "preprint", title: "Preprint Title", DOI: "10.1101/2026.01.01" }),
    } as unknown as Zotero.Item;

    await expect(inspectPreprint(
      item,
      { kind: "DOI", value: "10.1101/2026.01.01", source: "item" },
      { itemType: "preprint", title: "Preprint Title", DOI: "10.1101/2026.01.01" },
    )).rejects.toThrow("review-no-data");
  });

  it("rejects non-HTTP(S) URLs in URLTranslateService", async () => {
    const processDocuments = vi.fn().mockResolvedValue([]);
    vi.stubGlobal("Zotero", {
      getMainWindow: () => ({ AbortController }),
      HTTP: { processDocuments },
      Translate: { Web: vi.fn() },
    });

    for (const url of ["file:///etc/passwd", "chrome://zotero/content/zoteroPane.xhtml", "javascript:alert(1)", "not-a-url"]) {
      expect(URLTranslateService.shouldApply({
        item: {} as Zotero.Item,
        identifiers: { URL: url },
        isPreprint: false,
        debug: () => {},
      })).toBe(false);
      await expect(URLTranslateService.fetch!({
        item: {} as Zotero.Item,
        identifiers: { URL: url },
        isPreprint: false,
        debug: () => {},
      })).resolves.toBeUndefined();
    }
    expect(processDocuments).not.toHaveBeenCalled();
    expect(URLTranslateService.shouldApply({
      item: {} as Zotero.Item,
      identifiers: { URL: "https://example.org/paper" },
      isPreprint: false,
      debug: () => {},
    })).toBe(true);
  });
});
