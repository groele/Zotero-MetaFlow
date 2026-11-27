import type { TransformedData } from "./base-service";
import { requestCachedGET } from "../../../../utils/http";
import { getString } from "../../../../utils/locale";
import { normalizeArxiv } from "../../../review/policy";
import { normalizeDOI } from "../policy";
import { defineService } from "./base-service";

export interface ArxivRecord {
  id: string;
  doi: string;
  data: TransformedData;
}

export function parseArxiv(xml: string, fallbackID?: string): TransformedData | null;
export function parseArxiv(xml: string, requested: string, latest: boolean): ArxivRecord;
export function parseArxiv(xml: string, requested = "", latest?: boolean): TransformedData | ArxivRecord | null {
  const Parser = ((typeof Zotero !== "undefined" && typeof Zotero.getMainWindow === "function" && (Zotero.getMainWindow() as any)?.DOMParser) || DOMParser) as typeof DOMParser;
  const doc = new Parser().parseFromString(xml, "text/xml");
  const entries = [...doc.getElementsByTagNameNS("http://www.w3.org/2005/Atom", "entry")];
  const expected = normalizeArxiv(requested);
  const entry = expected
    ? entries.find((element) => {
        const returned = normalizeArxiv(element.getElementsByTagNameNS("http://www.w3.org/2005/Atom", "id")[0]?.textContent || "");
        return returned && (latest || !/v\d+$/.test(expected) ? returned.replace(/v\d+$/, "") === expected.replace(/v\d+$/, "") : returned === expected);
      })
    : entries[0];
  if (!entry) {
    if (latest !== undefined)
      throw new Error(getString("review-arxiv-mismatch"));
    return null;
  }
  const atom = (name: string) => entry.getElementsByTagNameNS("http://www.w3.org/2005/Atom", name)[0]?.textContent?.trim().replace(/\s+/g, " ") || "";
  const id = normalizeArxiv(atom("id")) || expected;
  const doi = normalizeDOI(entry.getElementsByTagNameNS("http://arxiv.org/schemas/atom", "doi")[0]?.textContent || doc.querySelector("doi")?.textContent || "");
  const title = atom("title");
  if (!title || !id) {
    if (latest !== undefined)
      throw new Error(getString("review-no-data"));
    return doi ? { DOI: doi } : null;
  }
  const creators = [...entry.getElementsByTagNameNS("http://www.w3.org/2005/Atom", "author")].map(author => ({ creatorType: "author" as const, name: (author.getElementsByTagNameNS("http://www.w3.org/2005/Atom", "name")[0]?.textContent || "").trim().replace(/\s+/g, " ") })).filter(creator => creator.name);
  const data: TransformedData = { itemType: "preprint", title, abstractNote: atom("summary"), date: atom("published").slice(0, 10), url: `https://arxiv.org/abs/${id}`, creators, ...doi ? { DOI: doi } : {} };
  return latest !== undefined ? { id, doi, data } : data;
}

export const ArxivService = defineService<{ xml: string }>({
  id: "arxiv-service",
  name: "ArXiv Service",
  cooldown: 3_000,
  shouldApply: ({ identifiers }) => {
    return !!identifiers.arXiv;
  },
  async fetch({ identifiers, signal }) {
    const arxivId = identifiers.arXiv?.trim();
    if (!arxivId)
      return undefined;
    const response = await requestCachedGET(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`, {}, signal);
    return response?.response ? { xml: String(response.response) } : undefined;
  },
  async updateIdentifiers({ identifiers, debug, signal }) {
    const arxivId = identifiers.arXiv?.trim().toLowerCase();
    if (!arxivId) {
      return false;
    }

    const url = `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`;

    const res = await requestCachedGET(url, {}, signal);
    const result = res.response as string;
    if (!result) {
      debug("Failed to get DOI from arXiv");
      return false;
    }

    const parsed = parseArxiv(result, arxivId);
    const rawDoi = parsed?.DOI;
    if (!rawDoi) {
      debug("ArXiv did not return DOI");
      return false;
    }

    debug("Got DOI from Arxiv", rawDoi);
    const doi = typeof Zotero !== "undefined" && Zotero.Utilities?.cleanDOI ? Zotero.Utilities.cleanDOI(rawDoi) : normalizeDOI(rawDoi);
    if (!doi)
      return false;
    identifiers.DOI = doi;
    return true;
  },
});
