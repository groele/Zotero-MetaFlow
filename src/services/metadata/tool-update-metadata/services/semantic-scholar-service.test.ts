import { afterEach, describe, expect, it, vi } from "vitest";
import { SemanticScholarService } from "./semantic-scholar-service";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("semantic Scholar identifier fallback", () => {
  it("transforms the returned author list instead of silently discarding it", () => {
    const cleanAuthor = vi.fn((name: string) => ({ firstName: name.split(" ")[0], lastName: name.split(" ").slice(1).join(" "), creatorType: "author" }));
    vi.stubGlobal("Zotero", { Utilities: { cleanAuthor } });
    const data = SemanticScholarService.transform!({ paperId: "author-fixture", authors: [{ name: "Ada Lovelace" }, { name: "Grace Hopper" }] });
    expect(data.creators).toEqual([{ firstName: "Ada", lastName: "Lovelace", creatorType: "author" }, { firstName: "Grace", lastName: "Hopper", creatorType: "author" }]);
    expect(SemanticScholarService.transform!({ paperId: "invalid", authors: [{ name: "" }] }).creators).toBeUndefined();
  });
  it("tries the next identifier after a rejected 404 and observes the cooldown", async () => {
    vi.useFakeTimers();
    const requests: string[] = [];
    vi.stubGlobal("Zotero", { Prefs: { get: () => undefined }, Utilities: { cleanDOI: (value: string) => value }, HTTP: { request: vi.fn(async (_method, url) => {
      requests.push(url);
      if (requests.length === 1)
        throw Object.assign(new Error("No match"), { status: 404 });
      return { status: 200, response: JSON.stringify({ paperId: "verified", externalIds: { DOI: "10.1234/result" } }) };
    }) } });
    const identifiers = { arXiv: "2401.12345", URL: "https://example.org/paper", DOI: undefined as string | undefined };
    const pending = SemanticScholarService.updateIdentifiers!({ item: { itemType: "preprint" } as Zotero.Item, identifiers, isPreprint: true, debug() {} });
    await vi.advanceTimersByTimeAsync(0);
    expect(requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await pending).toBe(true);
    expect(requests).toHaveLength(2);
    expect(identifiers.DOI).toBe("10.1234/result");
  });
});
