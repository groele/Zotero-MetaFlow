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
  return (value || "").normalize("NFKC").replace(/<(?:[\w-]+:)?math\b[^>]*>[\s\S]*?<\/(?:[\w-]+:)?math\s*>/gi, math => math.replace(/<[^>]*>/g, "").replace(/\s+/g, "")).replace(/(\s*)<(sub|sup)\b[^>]*>([\s\S]*?)<\/\2>/gi, (_match, leading: string, _tag, content: string) => {
    const index = content.replace(/<[^>]*>/g, "").trim();
    return /^[\p{N}+.−-]+$/u.test(index) ? index : leading + index;
  }).replace(/<[^>]*>/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function extractMainTitle(str: string): string {
  const match = str.match(/^([^:—–?]+)[:—–?]/);
  return match ? match[1].trim() : str.trim();
}

export function titlesAgree(original: string, candidate: string): boolean {
  const a = normalizedTitle(original);
  const b = normalizedTitle(candidate);
  if (!a || !b)
    return false;
  if (a === b)
    return true;
  const sa = normalizedTitle(sanitizeWebTitle(original));
  const sb = normalizedTitle(sanitizeWebTitle(candidate));
  if ((sa && sa === b) || (sb && a === sb) || (sa && sb && sa === sb))
    return true;

  // Subtitle agreement before colon/dash (e.g. "Main Title: Subtitle" vs "Main Title")
  const mainA = normalizedTitle(extractMainTitle(original));
  const mainB = normalizedTitle(extractMainTitle(candidate));
  if (mainA && mainB && mainA.length >= 10 && mainB.length >= 10) {
    if (mainA === b || mainB === a)
      return true;
  }

  // CJK character sequence and overlap matching
  const cjkA = a.replace(/[^\u4E00-\u9FA5]/gu, "");
  const cjkB = b.replace(/[^\u4E00-\u9FA5]/gu, "");
  if (cjkA.length >= 6 && cjkB.length >= 6) {
    if (cjkA === cjkB)
      return true;
    if ((cjkA.startsWith(cjkB) || cjkB.startsWith(cjkA)) && (Math.min(cjkA.length, cjkB.length) >= 10 || Math.min(cjkA.length, cjkB.length) / Math.max(cjkA.length, cjkB.length) >= 0.6))
      return true;
    const charsA = new Set([...cjkA]);
    const charsB = new Set([...cjkB]);
    const commonChars = [...charsA].filter(c => charsB.has(c)).length;
    if (commonChars / Math.max(charsA.size, charsB.size) >= 0.8)
      return true;
  }

  const left = new Set(a.split(" "));
  const right = new Set(b.split(" "));
  if (Math.min(left.size, right.size) >= 5) {
    const common = [...left].filter(word => right.has(word)).length;
    if (common / Math.max(left.size, right.size) >= 0.9)
      return true;
  }

  const sleft = new Set((sa || a).split(" "));
  const sright = new Set((sb || b).split(" "));
  if (Math.min(sleft.size, sright.size) >= 5) {
    const scommon = [...sleft].filter(word => sright.has(word)).length;
    if (scommon / Math.max(sleft.size, sright.size) >= 0.85)
      return true;
  }

  // Prefix matching for subtitle differences (e.g. "Main Title: Subtitle" vs "Main Title")
  if (Math.min(left.size, right.size) >= 4) {
    if ((a.startsWith(`${b} `) || b.startsWith(`${a} `)) && Math.min(a.length, b.length) / Math.max(a.length, b.length) >= 0.6)
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
export function isPlaceholderCreator(creator: any): boolean {
  if (!creator)
    return true;
  const last = String(("lastName" in creator ? creator.lastName : "") || "").trim();
  const first = String(("firstName" in creator ? creator.firstName : "") || "").trim();
  const full = String(("name" in creator ? creator.name : "") || "").trim();

  if (!last && !first && !full)
    return true;

  const placeholderRegex = /^(?:\([姓名]\)|[姓名无]|\(last\s*name\)|last\s*name|\(first\s*name\)|first\s*name|unknown|anonymous|\[anonymous\]|未知|匿名|null|undefined|nan|n\/a|n\.a\.|n\/d|n\.d\.|no\s*value|none|et\s*al\.?|\?+|-+)$/i;
  if (full && (placeholderRegex.test(full) || /^\(姓\)[,\s]*\(名\)$/.test(full)))
    return true;
  if (last && placeholderRegex.test(last) && (!first || placeholderRegex.test(first)))
    return true;
  if (!last && first && placeholderRegex.test(first))
    return true;

  return false;
}
export function mergeMetadata(current: TransformedData, incoming: TransformedData): TransformedData {
  const result = { ...current };
  const placeholderAbstract = /^(?:abstract|no\s+abstract(?:\s+available)?|none|\[none\]|n\/a|摘要)$/i;
  for (const [field, value] of Object.entries(incoming)) {
    if (field === "creators") {
      if ((!result.creators?.length || result.creators.every(isPlaceholderCreator)) && incoming.creators?.some(c => !isPlaceholderCreator(c)))
        result.creators = incoming.creators;
    }
    else if (field === "abstractNote") {
      const existing = String(result.abstractNote || "").trim();
      const next = String(value || "").trim();
      if (!existing && next) {
        result.abstractNote = next;
      }
      else if (existing && placeholderAbstract.test(existing) && next && next.length > 20) {
        result.abstractNote = next;
      }
    }
    else {
      const existing = (result as Record<string, unknown>)[field];
      const isBlank = existing === undefined || existing === null || (typeof existing === "string" && !existing.trim());
      if (isBlank && value !== undefined && value !== null && (typeof value !== "string" || value.trim())) {
        (result as Record<string, unknown>)[field] = typeof value === "string" ? value.trim() : value;
      }
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
