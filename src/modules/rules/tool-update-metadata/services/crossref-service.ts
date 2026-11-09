import type { TransformedData } from "./base-service";
import { requestServiceGET } from "../../../../utils/http";
import { normalizeDOI } from "../policy";
import { defineService } from "./base-service";

export interface CrossrefWork {
  "DOI"?: string;
  "type"?: string;
  "title"?: string[];
  "author"?: {
    given?: string;
    family?: string;
    name?: string;
    sequence?: string;
  }[];
  "container-title"?: string[];
  "short-container-title"?: string[];
  "volume"?: string | number;
  "issue"?: string | number;
  "page"?: string;
  "ISSN"?: string[];
  "ISBN"?: string[];
  "issued"?: { "date-parts"?: number[][] };
  "published-print"?: { "date-parts"?: number[][] };
  "published-online"?: { "date-parts"?: number[][] };
  "publisher"?: string;
  "abstract"?: string;
  "update-to"?: {
    type?: string;
    label?: string;
    DOI?: string;
  }[];
  "relation"?: Record<string, {
    "id"?: string;
    "id-type"?: string;
  }[]>;
}

export function extractCrossrefEditorialNotice(work: CrossrefWork): { kind: "retracted" | "concern" | "correction"; label: string; doi?: string } | undefined {
  if (!work || typeof work !== "object")
    return undefined;
  const retractedBy = Array.isArray(work.relation?.["is-retracted-by"]) ? work.relation!["is-retracted-by"] : [];
  if (retractedBy.length > 0) {
    const doi = normalizeDOI(retractedBy[0]?.id) || undefined;
    return { kind: "retracted", label: "Retracted", doi };
  }
  const updates = Array.isArray(work["update-to"]) ? work["update-to"] : [];
  for (const entry of updates) {
    const text = `${entry?.type || ""} ${entry?.label || ""}`.trim();
    if (!text)
      continue;
    const doi = normalizeDOI(entry?.DOI) || undefined;
    if (/retract|withdrawal|removal/i.test(text))
      return { kind: "retracted", label: "Retracted", doi };
    if (/expression[\s_-]*of[\s_-]*concern/i.test(text))
      return { kind: "concern", label: "Expression of Concern", doi };
    if (/erratum|corrigendum|correction/i.test(text))
      return { kind: "correction", label: "Correction", doi };
  }
  return undefined;
}

export function extractCrossrefPublishedDOI(work: CrossrefWork): string | undefined {
  const relation = work?.relation?.["is-preprint-of"];
  if (!Array.isArray(relation))
    return undefined;
  for (const entry of relation) {
    const doi = normalizeDOI(entry?.id);
    if (doi && !/^10\.(?:48550\/arxiv\.|1101\/)/i.test(doi))
      return doi;
  }
  return undefined;
}

export interface CrossrefResponse {
  "status": string;
  "message-type"?: string;
  "message": CrossrefWork;
}

export function transformCrossrefWork(work: CrossrefWork): TransformedData {
  if (!work || typeof work !== "object")
    return {};

  const result: TransformedData = {};

  // 1. itemType mapping
  const typeMap: Partial<Record<string, _ZoteroTypes.Item.ItemType>> = {
    "journal-article": "journalArticle",
    "proceedings-article": "conferencePaper",
    "book-chapter": "bookSection",
    "book": "book",
    "monograph": "book",
    "posted-content": "preprint",
    "report": "report",
    "dataset": "document",
  };
  if (work.type && typeMap[work.type]) {
    result.itemType = typeMap[work.type];
  }

  // 2. Title
  const rawTitle = Array.isArray(work.title) ? work.title[0] : (work.title as unknown as string);
  if (rawTitle && typeof rawTitle === "string") {
    result.title = rawTitle.trim();
  }

  // 3. Creators / Authors
  if (Array.isArray(work.author) && work.author.length > 0) {
    result.creators = work.author.map((author) => {
      const family = String(author.family || "").trim();
      const given = String(author.given || "").trim();
      if (family) {
        return {
          firstName: given,
          lastName: family,
          creatorType: "author" as const,
        };
      }
      const singleName = String(author.name || given || "").trim();
      if (singleName) {
        return {
          name: singleName,
          creatorType: "author" as const,
        };
      }
      return null;
    }).filter(Boolean) as (_ZoteroTypes.Item.Creator | _ZoteroTypes.Item.CreatorJSON)[];
  }

  // 4. Publication title / Proceedings title
  const container = Array.isArray(work["container-title"]) ? work["container-title"][0] : (work["container-title"] as unknown as string);
  if (container && typeof container === "string") {
    if (result.itemType === "conferencePaper")
      result.proceedingsTitle = container.trim();
    else
      result.publicationTitle = container.trim();
  }

  // 5. Journal abbreviation
  const shortContainer = Array.isArray(work["short-container-title"]) ? work["short-container-title"][0] : (work["short-container-title"] as unknown as string);
  if (shortContainer && typeof shortContainer === "string") {
    result.journalAbbreviation = shortContainer.trim();
  }

  // 6. Volume / Issue / Pages
  if (work.volume !== undefined && work.volume !== null)
    result.volume = String(work.volume).trim();
  if (work.issue !== undefined && work.issue !== null)
    result.issue = String(work.issue).trim();
  if (work.page)
    result.pages = String(work.page).trim();

  // 7. DOI
  if (work.DOI)
    result.DOI = normalizeDOI(work.DOI);

  // 8. ISSN / ISBN
  if (Array.isArray(work.ISSN) && work.ISSN.length > 0)
    result.ISSN = String(work.ISSN[0]).trim();
  if (Array.isArray(work.ISBN) && work.ISBN.length > 0)
    result.ISBN = String(work.ISBN[0]).trim();

  // 9. Publication Date
  const dateParts = work["published-print"]?.["date-parts"]?.[0]
    || work["published-online"]?.["date-parts"]?.[0]
    || work.issued?.["date-parts"]?.[0];
  if (Array.isArray(dateParts) && dateParts.length > 0) {
    const [year, month, day] = dateParts;
    if (year && month && day)
      result.date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    else if (year && month)
      result.date = `${year}-${String(month).padStart(2, "0")}`;
    else if (year)
      result.date = String(year);
  }

  // 10. Publisher
  if (work.publisher)
    result.publisher = String(work.publisher).trim();

  // 11. Abstract (Clean JATS XML tags & decode XML entities)
  if (work.abstract && typeof work.abstract === "string") {
    const cleanAbstract = work.abstract
      .replace(/<jats:title\b[^>]*>[\s\S]*?<\/jats:title>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, "\"")
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
      .replace(/\s+/g, " ")
      .trim();
    if (cleanAbstract)
      result.abstractNote = cleanAbstract;
  }

  const notice = extractCrossrefEditorialNotice(work);
  if (notice)
    result.extra = `Editorial Notice: ${notice.label}${notice.doi ? ` (${notice.doi})` : ""}`;

  result.libraryCatalog = "Crossref";
  return result;
}

export const CrossrefService = defineService<CrossrefResponse>({
  id: "crossref-service",
  lookup: "identifier",
  name: "Crossref Service",
  cooldown: 50,
  shouldApply: ({ identifiers }) => Boolean(identifiers.DOI && normalizeDOI(identifiers.DOI)),

  async fetch({ identifiers, signal, debug }) {
    const doi = normalizeDOI(identifiers.DOI);
    if (!doi)
      return undefined;

    const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;
    const options = {
      timeout: 15_000,
      headers: {
        "User-Agent": "Zotero MetaFlow (https://github.com/groele/Zotero-MetaFlow; mailto:gro_ele@163.com)",
        "Accept": "application/json",
      },
    };

    debug(`Querying Crossref API: ${url}`);
    try {
      const res = await requestServiceGET("crossref", url, options, signal);
      if (res.status === 200 && res.response) {
        const parsed = typeof res.response === "object" && res.response !== null ? res.response : JSON.parse(typeof res.response === "string" ? res.response : res.responseText || "{}");
        if (parsed.status === "ok" && parsed.message)
          return parsed as CrossrefResponse;
      }
      debug(`Crossref returned status ${res.status}`);
      return undefined;
    }
    catch (error) {
      signal?.throwIfAborted();
      const message = error instanceof Error ? error.message : String(error);
      debug(`Crossref query error: ${message}`);
      return undefined;
    }
  },

  transform: (response: CrossrefResponse): TransformedData => {
    return transformCrossrefWork(response.message);
  },
});
