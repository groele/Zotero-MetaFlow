import { afterEach, describe, expect, it, vi } from "vitest";
import * as http from "../../../utils/http";
import { fetchISSNFromCrossref, fetchISSNFromOpenAlex, normalizeISSN, resolveMissingISSN } from "./issn-resolver";

afterEach(() => vi.restoreAllMocks());

describe("issn-resolver", () => {
  describe("normalizeISSN", () => {
    it("normalizes unhyphenated 8-digit ISSN", () => {
      expect(normalizeISSN("13596454")).toBe("1359-6454");
    });

    it("keeps already hyphenated valid ISSN", () => {
      expect(normalizeISSN("1359-6454")).toBe("1359-6454");
    });

    it("uppercases check character X", () => {
      expect(normalizeISSN("2434561x")).toBe("2434-561X");
      expect(normalizeISSN("2434-561x")).toBe("2434-561X");
    });

    it("handles surrounding whitespaces", () => {
      expect(normalizeISSN("  1359-6454  ")).toBe("1359-6454");
    });

    it("returns undefined for invalid ISSN values", () => {
      expect(normalizeISSN("")).toBeUndefined();
      expect(normalizeISSN(undefined)).toBeUndefined();
      expect(normalizeISSN(12345678 as any)).toBeUndefined();
      expect(normalizeISSN("1234")).toBeUndefined();
      expect(normalizeISSN("123456789")).toBeUndefined();
      expect(normalizeISSN("not-an-issn")).toBeUndefined();
    });
  });

  describe("aPI resolvers", () => {
    it("fetches ISSN from OpenAlex via DOI", async () => {
      vi.spyOn(http, "requestCachedGET").mockResolvedValueOnce({
        status: 200,
        response: JSON.stringify({
          doi: "https://doi.org/10.1016/j.actamat.2023.118944",
          primary_location: {
            source: {
              issn_l: "1359-6454",
              issn: ["1359-6454", "1873-2453"],
            },
          },
        }),
      } as any);

      const issn = await fetchISSNFromOpenAlex({ doi: "10.1016/j.actamat.2023.118944" });
      expect(issn).toBe("1359-6454");
    });

    it("fetches ISSN from OpenAlex via publicationTitle when DOI is absent", async () => {
      vi.spyOn(http, "requestCachedGET").mockResolvedValueOnce({
        status: 200,
        response: JSON.stringify({
          results: [
            {
              display_name: "Nature",
              issn_l: "0028-0836",
              issn: ["0028-0836", "1476-4687"],
            },
          ],
        }),
      } as any);

      const issn = await fetchISSNFromOpenAlex({ publicationTitle: "Nature" });
      expect(issn).toBe("0028-0836");
    });

    it("fetches ISSN from Crossref via DOI", async () => {
      vi.spyOn(http, "requestCachedGET").mockResolvedValueOnce({
        status: 200,
        response: JSON.stringify({
          message: {
            DOI: "10.1016/j.actamat.2023.118944",
            ISSN: ["1359-6454"],
          },
        }),
      } as any);

      const issn = await fetchISSNFromCrossref({ doi: "10.1016/j.actamat.2023.118944" });
      expect(issn).toBe("1359-6454");
    });

    it("prefers Crossref DOI evidence and uses a valid singleton URL", async () => {
      const request = vi.spyOn(http, "requestCachedGET").mockResolvedValueOnce({ status: 200, response: JSON.stringify({ message: { DOI: "10.1038/nature12345", ISSN: ["0028-0836"] } }) } as any);
      expect(await resolveMissingISSN({ doi: "10.1038/nature12345" })).toEqual({ issn: "0028-0836", source: "Crossref" });
      expect(request).toHaveBeenLastCalledWith(expect.not.stringContaining("?select"), expect.anything(), undefined);
    });

    it.each([undefined, "10.1234/unrelated"])("rejects Crossref ISSN without matching DOI evidence: %s", async (doi) => {
      vi.spyOn(http, "requestCachedGET").mockResolvedValueOnce({ status: 200, response: JSON.stringify({ message: { DOI: doi, ISSN: ["0028-0836"] } }) } as any);
      expect(await fetchISSNFromCrossref({ doi: "10.1038/test" })).toBeUndefined();
    });

    it.each([undefined, "https://doi.org/10.1234/unrelated"])("rejects OpenAlex ISSN without matching DOI evidence: %s", async (doi) => {
      vi.spyOn(http, "requestCachedGET").mockResolvedValueOnce({ status: 200, response: JSON.stringify({ doi, primary_location: { source: { issn_l: "0028-0836" } } }) } as any);
      expect(await fetchISSNFromOpenAlex({ doi: "10.1038/test" })).toBeUndefined();
    });

    it("rejects an unrelated top journal search hit", async () => {
      vi.spyOn(http, "requestCachedGET").mockResolvedValueOnce({ status: 200, response: JSON.stringify({ message: { items: [{ "container-title": ["Nature Medicine"], "ISSN": ["0028-0836"] }] } }) } as any);
      expect(await fetchISSNFromCrossref({ publicationTitle: "Nature" })).toBeUndefined();
    });

    it("finds an exact container match after a similar journal", async () => {
      vi.spyOn(http, "requestCachedGET").mockResolvedValueOnce({ status: 200, response: JSON.stringify({ message: { items: [
        { "container-title": ["Nature Medicine"], "ISSN": ["0028-0836"] },
        { "container-title": ["Nature"], "ISSN": ["invalid", "0028-0836"] },
      ] } }) } as any);
      expect(await fetchISSNFromCrossref({ publicationTitle: "Nature" })).toBe("0028-0836");
    });

    it("propagates cancellation rather than falling back", async () => {
      const controller = new AbortController();
      vi.spyOn(http, "requestCachedGET").mockImplementationOnce(async () => {
        controller.abort();
        throw new Error("cancelled");
      });
      await expect(resolveMissingISSN({ doi: "10.1038/test", signal: controller.signal })).rejects.toThrow();
    });
  });
});
