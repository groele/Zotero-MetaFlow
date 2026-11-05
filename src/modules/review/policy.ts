import type { TransformedData } from "../rules/tool-update-metadata/services/base-service";
import { getPinyin, getSurnamePinyin } from "../../utils/pinyin";
import { normalizeDOI, titlesAgree } from "../rules/tool-update-metadata/policy";

export const REVIEW_FIELDS = ["title", "creators", "date", "publicationTitle", "proceedingsTitle", "journalAbbreviation", "volume", "issue", "pages", "DOI", "ISSN", "ISBN", "publisher", "place", "edition", "language", "url", "abstractNote"] as const;
export type ReviewField = typeof REVIEW_FIELDS[number];
export interface IdentifierCandidate {
  kind: "DOI" | "arXiv" | "ISBN" | "Title" | "PMID" | "PMCID";
  value: string;
  source: string;
  excerpt?: string;
}
export interface ReviewChange {
  field: ReviewField | "itemType";
  before: unknown;
  after: unknown;
}
export interface ReviewProposal {
  itemID: number;
  original: TransformedData;
  candidate: TransformedData;
  identifier: IdentifierCandidate;
  source: string;
  conflicts: string[];
  blocked: boolean;
  changes: ReviewChange[];
  preprintURL?: string;
  excludedFields?: ReviewField[];
  revival?: { from: string; to: string; replaced: string[] };
}

export interface MetadataDecision {
  proposal: ReviewProposal;
  fields: Set<string>;
  acknowledged: boolean;
  action: "skip" | "update" | "related";
}

export function normalizeArxiv(value: string): string {
  return value.trim().match(/^(?:https?:\/\/(?:export\.|ar5iv\.labs\.)?ar(?:x|5)iv\.org\/(?:abs|pdf|html)\/|(?:doi:|https?:\/\/doi\.org\/)?10\.48550\/arxiv\.|arxiv:\s*)?((?:\d{4}\.\d{4,5}|[a-z.-]+\/\d{7})(?:v[1-9]\d*)?)(?:\.pdf)?(?:[?#].*)?$/i)?.[1].toLowerCase() || "";
}

export function normalizeISBN(value: string): string {
  const isbn = value.replace(/[\s-]/g, "").toUpperCase();
  if (/^\d{9}[\dX]$/.test(isbn)) {
    const sum = [...isbn].reduce((total, digit, index) => total + (digit === "X" ? 10 : Number(digit)) * (10 - index), 0);
    return sum % 11 === 0 ? isbn : "";
  }
  if (/^97[89]\d{10}$/.test(isbn)) {
    const sum = [...isbn].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0);
    return sum % 10 === 0 ? isbn : "";
  }
  return "";
}

export function isbnEquivalent(a: string, b: string): boolean {
  const canonical = (value: string) => {
    const normalized = normalizeISBN(value);
    return normalized.length === 10 ? `978${normalized.slice(0, 9)}` : normalized.slice(0, 12);
  };
  return !!normalizeISBN(a) && !!normalizeISBN(b) && canonical(a) === canonical(b);
}

/** Cached PDF text is evidence for a candidate, never authority to overwrite an item. */
export function identifiersFromText(text: string, source: string): IdentifierCandidate[] {
  const result: IdentifierCandidate[] = [];
  const seen = new Set<string>();
  const add = (kind: IdentifierCandidate["kind"], value: string, offset: number) => {
    const key = `${kind}:${value}`;
    if (!value || seen.has(key) || result.length >= 20)
      return;
    seen.add(key);
    result.push({ kind, value, source, excerpt: text.slice(Math.max(0, offset - 50), offset + value.length + 70).replace(/\s+/g, " ") });
  };
  for (const match of text.matchAll(/\b10\.\d{4,9}\/[^\s<>"?#]+/g)) {
    let doi = match[0].replace(/[.,;:]+$/, "");
    while (doi.endsWith(")") && (doi.match(/\)/g)?.length || 0) > (doi.match(/\(/g)?.length || 0))
      doi = doi.slice(0, -1);
    add("DOI", normalizeDOI(doi), match.index!);
  }
  for (const match of text.matchAll(/(?:arxiv\s*:\s*|arxiv\.org\/(?:abs|pdf)\/)((?:\d{4}\.\d{4,5}|[a-z.-]+\/\d{7})(?:v[1-9]\d*)?)/gi))
    add("arXiv", normalizeArxiv(match[1]), match.index!);
  return result;
}

export function reviewChanges(original: TransformedData, candidate: TransformedData, includeType = false): ReviewChange[] {
  const fields: (ReviewField | "itemType")[] = [...REVIEW_FIELDS, ...includeType ? ["itemType" as const] : []];
  return fields.flatMap((field) => {
    const after = candidate[field as keyof TransformedData];
    const before = original[field as keyof TransformedData];
    if (!after || (Array.isArray(after) && !after.length) || JSON.stringify(before ?? "") === JSON.stringify(after))
      return [];
    return [{ field, before: before ?? "", after }];
  });
}

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

export function creatorTokens(creator?: any): string[] {
  if (!creator || isPlaceholderCreator(creator))
    return [];
  const parts: string[] = [];
  if ("lastName" in creator && creator.lastName)
    parts.push(creator.lastName);
  if ("firstName" in creator && creator.firstName)
    parts.push(creator.firstName);
  if ("name" in creator && creator.name)
    parts.push(...creator.name.split(/[\s,]+/));

  const tokens = new Set<string>();
  for (const part of parts) {
    const raw = String(part || "").trim();
    if (!raw)
      continue;
    const clean = raw.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    if (clean)
      tokens.add(clean);
    // If the token contains Chinese characters, include its pinyin representation
    if (/[\u4E00-\u9FA5]/.test(raw)) {
      try {
        const py = getPinyin(raw);
        for (const word of py.toLowerCase().split(/\s+/)) {
          const cleanPy = word.replace(/[^\p{L}\p{N}]/gu, "");
          if (cleanPy.length >= 2)
            tokens.add(cleanPy);
        }
      }
      catch {
        // Fallback to raw token
      }
    }
  }
  return [...tokens];
}

export function creatorsAgree(original: TransformedData, candidate: TransformedData): boolean {
  const origList = (original.creators || []).filter(c => c && !isPlaceholderCreator(c));
  const candList = (candidate.creators || []).filter(c => c && !isPlaceholderCreator(c));
  if (!origList.length || !candList.length)
    return true;

  // Cross-author match: if any author from original matches any author from candidate
  for (const orig of origList) {
    const aTokens = creatorTokens(orig);
    if (!aTokens.length)
      continue;
    for (const cand of candList) {
      const bTokens = creatorTokens(cand);
      if (aTokens.some(token => token.length >= 2 && bTokens.includes(token)))
        return true;
    }
  }
  return false;
}

export function firstCreator(data: TransformedData): string {
  const creator = data.creators?.find(c => c && !isPlaceholderCreator(c));
  if (!creator)
    return "";
  let family = "";
  if ("lastName" in creator && creator.lastName) {
    family = String(creator.lastName).trim();
  }
  else if ("name" in creator && creator.name) {
    const raw = String(creator.name).trim();
    if (typeof Zotero !== "undefined" && Zotero.Utilities?.cleanAuthor) {
      const cleaned = Zotero.Utilities.cleanAuthor(raw, "author");
      if (cleaned.lastName)
        family = cleaned.lastName;
    }
    if (!family) {
      if (raw.includes(",")) {
        family = raw.split(",")[0].trim();
      }
      else {
        const words = raw.split(/\s+/);
        family = words[words.length - 1] || raw;
      }
    }
  }
  if (!family)
    return "";
  if (/^[\u4E00-\u9FA5]+$/.test(family)) {
    try {
      const py = getSurnamePinyin(family);
      if (py)
        return py.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    }
    catch {
      // Fallback to normalized family
    }
  }
  return family.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

export function identityConflicts(original: TransformedData, candidate: TransformedData, allowYearChange = false): string[] {
  const conflicts: string[] = [];
  if (original.title && candidate.title && !titlesAgree(original.title, candidate.title))
    conflicts.push("title");
  const beforeYear = original.date?.match(/\b\d{4}\b/)?.[0];
  const afterYear = candidate.date?.match(/\b\d{4}\b/)?.[0];
  if (!allowYearChange && beforeYear && afterYear && beforeYear !== afterYear)
    conflicts.push("date");
  if (!creatorsAgree(original, candidate))
    conflicts.push("creators");
  return conflicts;
}
