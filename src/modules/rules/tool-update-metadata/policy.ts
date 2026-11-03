import type { Identifiers } from "./identifiers";
import type { TransformedData } from "./services/base-service";
import { extractDOIFromUrl } from "./identifiers";

export function normalizeDOI(value?: string): string {
  return (extractDOIFromUrl(value || "") || value?.trim().match(/^10\/\S+$/)?.[0] || "").toLowerCase();
}

export function sanitizeWebTitle(title?: string): string {
  if (!title || typeof title !== "string")
    return "";
  let clean = title.trim();
  // 1. Wiley compound pattern: ' - author - 2024 - Journal Title - Wiley Online Library'
  clean = clean.replace(/\s*-[^-]+-\s*(?:19|20)\d{2}\s*-[^-]+-\s*wiley\s+online\s+library\s*$/i, "");
  // 2. Known academic publisher / aggregator suffixes
  const publisherSuffixes = [
    /\s*[-|:]\s*wiley\s+online\s+library\s*$/i,
    /\s*[-|:]\s*sciencedirect\s*$/i,
    /\s*[-|:]\s*springerlink\s*$/i,
    /\s*[-|:]\s*ieee\s+xplore\s*$/i,
    /\s*[-|:]\s*acs\s+publications\s*$/i,
    /\s*[-|:]\s*oxford\s+academic\s*$/i,
    /\s*[-|:]\s*iopscience\s*$/i,
    /\s*[-|:]\s*frontiers\s*$/i,
    /\s*[-|:]\s*mdpi\s*$/i,
    /\s*[-|:]\s*nature(?:\s+\w+)*\s*$/i,
    /\s*[-|:]\s*pubmed\s*$/i,
    /\s*[-|:]\s*rsc\s+publishing\s*$/i,
    /\s*[-|:]\s*aip\s+publishing\s*$/i,
    /\s*[-|:]\s*taylor\s*&\s*francis(?:\s+online)?\s*$/i,
    /\s*[-|:]\s*plos\s*$/i,
    /\s*[-|:]\s*pnas\s*$/i,
    /\s*[-|:]\s*biorxiv\s*$/i,
    /\s*[-|:]\s*arxiv\s*$/i,
  ];
  for (const pattern of publisherSuffixes)
    clean = clean.replace(pattern, "");
  return clean.trim();
}

function normalizedTitle(value?: string): string {
  return (value || "").normalize("NFKC").replace(/<(?:[\w-]+:)?math\b[^>]*>[\s\S]*?<\/(?:[\w-]+:)?math\s*>/gi, math => math.replace(/<[^>]*>/g, "").replace(/\s+/g, "")).replace(/<(sub|sup)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_match, _tag, content: string) => content.replace(/<[^>]*>/g, "").trim()).replace(/<[^>]*>/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function titlesAgree(original: string, candidate: string): boolean {
  const a = normalizedTitle(original);
  const b = normalizedTitle(candidate);
  if (!a || !b)
    return false;
  if (a === b)
    return true;
  const left = new Set(a.split(" "));
  const right = new Set(b.split(" "));
  if (Math.min(left.size, right.size) < 5)
    return false;
  const common = [...left].filter(word => right.has(word)).length;
  if (common / Math.max(left.size, right.size) >= 0.9)
    return true;
  // Fall back to comparing sanitized title
  const sa = normalizedTitle(sanitizeWebTitle(original));
  if (sa && sa === b)
    return true;
  const sleft = new Set(sa.split(" "));
  if (Math.min(sleft.size, right.size) >= 5) {
    const scommon = [...sleft].filter(word => right.has(word)).length;
    if (scommon / Math.max(sleft.size, right.size) >= 0.85)
      return true;
  }
  return false;
}

export function metadataIdentity(
  original: { title?: string; date?: string },
  identifiers: Identifiers,
  candidate: TransformedData,
  lookup?: "identifier" | "url",
): "identifier" | "url" | "title" | false {
  const expected = normalizeDOI(identifiers.DOI);
  const returned = normalizeDOI(candidate.DOI);
  // A title match never overrides a contradictory DOI.
  if (expected && returned)
    return expected === returned ? "identifier" : false;
  if (lookup === "identifier" && [identifiers.DOI, identifiers.PMID, identifiers.PMCID, identifiers.SemanticScholarID, identifiers.arXiv].some(Boolean))
    return "identifier";
  if (lookup === "identifier" && identifiers.URL)
    return "url";
  if (lookup === "url" && identifiers.URL)
    return "url";
  if (!titlesAgree(original.title || "", candidate.title || ""))
    return false;
  const originalYear = original.date?.match(/\b\d{4}\b/)?.[0];
  const candidateYear = candidate.date?.match(/\b\d{4}\b/)?.[0];
  if (originalYear && candidateYear && Math.abs(Number(originalYear) - Number(candidateYear)) > 1)
    return false;
  return "title";
}

/** Earlier trusted services own conflicting fields; later services only fill gaps. */
export function mergeMetadata(current: TransformedData, incoming: TransformedData): TransformedData {
  const result = { ...current };
  for (const [field, value] of Object.entries(incoming)) {
    if (field === "creators") {
      if (!result.creators?.length && incoming.creators?.length)
        result.creators = incoming.creators;
    }
    else if (!result[field as keyof TransformedData] && value) {
      (result as Record<string, unknown>)[field] = value;
    }
  }
  return result;
}

export function metadataMissing(data: TransformedData, original: TransformedData, mode: "blank" | "all", itemType: string): string[] {
  const effective = mode === "blank" ? mergeMetadata(original, data) : mergeMetadata(data, original);
  const required = ["title", "date", "creators"];
  if (itemType === "journalArticle")
    required.push("publicationTitle");
  if (itemType === "conferencePaper")
    required.push("proceedingsTitle");
  return required.filter(field => field === "creators" ? !effective.creators?.length : !effective[field as keyof TransformedData]);
}

export function metadataValuesEqual(field: string, before: unknown, current: unknown): boolean {
  if (JSON.stringify(before ?? "") === JSON.stringify(current ?? ""))
    return true;
  if (field !== "accessDate" || typeof before !== "string" || typeof current !== "string")
    return false;
  const time = (value: string) => Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(" ", "T")}Z` : value);
  const previous = time(before);
  return Number.isFinite(previous) && previous === time(current);
}
