import type { TransformedData } from "./base-service";
import { parseResponseJSON, requestCachedGET } from "../../../../utils/http";
import { normalizeDOI } from "../policy";
import { defineService } from "./base-service";

export interface OpenAlexWork {
  id?: string;
  doi?: string;
  title?: string;
  display_name?: string;
  publication_year?: number;
  publication_date?: string;
  type?: string;
  biblio?: {
    volume?: string | number | null;
    issue?: string | number | null;
    first_page?: string | number | null;
    last_page?: string | number | null;
  };
  primary_location?: {
    source?: {
      display_name?: string | null;
      issn_l?: string | null;
      issn?: string[] | null;
      type?: string | null;
    } | null;
  } | null;
  authorships?: {
    author?: {
      display_name?: string | null;
    } | null;
  }[];
}

export function transformOpenAlexWork(work: OpenAlexWork): TransformedData {
  if (!work || typeof work !== "object")
    return {};

  const result: TransformedData = {};
  const sourceType = work.primary_location?.source?.type;
  if (work.type === "article" || sourceType === "journal")
    result.itemType = "journalArticle";
  else if (sourceType === "conference")
    result.itemType = "conferencePaper";
  else if (work.type === "preprint")
    result.itemType = "preprint";

  const title = String(work.title || work.display_name || "").trim();
  if (title)
    result.title = title;

  if (work.doi) {
    const doi = normalizeDOI(work.doi);
    if (doi)
      result.DOI = doi;
  }

  const volume = work.biblio?.volume !== undefined && work.biblio?.volume !== null ? String(work.biblio.volume).trim() : "";
  if (volume)
    result.volume = volume;

  const issue = work.biblio?.issue !== undefined && work.biblio?.issue !== null ? String(work.biblio.issue).trim() : "";
  if (issue)
    result.issue = issue;

  const firstPage = work.biblio?.first_page !== undefined && work.biblio?.first_page !== null ? String(work.biblio.first_page).trim() : "";
  const lastPage = work.biblio?.last_page !== undefined && work.biblio?.last_page !== null ? String(work.biblio.last_page).trim() : "";
  if (firstPage && lastPage)
    result.pages = firstPage === lastPage ? firstPage : `${firstPage}-${lastPage}`;
  else if (firstPage || lastPage)
    result.pages = firstPage || lastPage;

  const date = String(work.publication_date || work.publication_year || "").trim();
  if (date)
    result.date = date;

  const pubTitle = String(work.primary_location?.source?.display_name || "").trim();
  if (pubTitle) {
    if (result.itemType === "conferencePaper")
      result.proceedingsTitle = pubTitle;
    else
      result.publicationTitle = pubTitle;
  }

  const issn = String(work.primary_location?.source?.issn_l || work.primary_location?.source?.issn?.[0] || "").trim();
  if (issn)
    result.ISSN = issn;

  if (Array.isArray(work.authorships) && work.authorships.length > 0) {
    const creators = work.authorships.map((entry) => {
      const displayName = String(entry?.author?.display_name || "").trim();
      if (!displayName)
        return null;
      const parts = displayName.split(/\s+/);
      if (parts.length >= 2) {
        const lastName = parts.pop()!;
        const firstName = parts.join(" ");
        return { creatorType: "author" as const, firstName, lastName };
      }
      return { creatorType: "author" as const, name: displayName };
    }).filter(Boolean) as (_ZoteroTypes.Item.Creator | _ZoteroTypes.Item.CreatorJSON)[];
    if (creators.length)
      result.creators = creators;
  }

  result.libraryCatalog = "OpenAlex";
  return result;
}

export const OpenAlexService = defineService<OpenAlexWork>({
  id: "openalex-service",
  lookup: "identifier",
  name: "OpenAlex Service",
  cooldown: 50,
  shouldApply: ({ identifiers }) => Boolean(identifiers.DOI && normalizeDOI(identifiers.DOI)),

  async fetch({ identifiers, signal, debug }) {
    const doi = normalizeDOI(identifiers.DOI);
    if (!doi)
      return undefined;

    const url = `https://api.openalex.org/works/https://doi.org/${encodeURIComponent(doi)}`;
    debug(`Querying OpenAlex API: ${url}`);
    try {
      const res = await requestCachedGET(url, { responseType: "json" }, signal);
      if (res.status === 200 && res.response) {
        const parsed = parseResponseJSON<OpenAlexWork>(res);
        if (parsed && (parsed.id || parsed.title || parsed.display_name || parsed.biblio))
          return parsed;
      }
      return undefined;
    }
    catch (error) {
      signal?.throwIfAborted();
      const message = error instanceof Error ? error.message : String(error);
      debug(`OpenAlex query error: ${message}`);
      return undefined;
    }
  },

  transform: (response: OpenAlexWork): TransformedData => {
    return transformOpenAlexWork(response);
  },
});
