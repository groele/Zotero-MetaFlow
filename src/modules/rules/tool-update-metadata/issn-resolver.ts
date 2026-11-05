import { requestCachedGET } from "../../../utils/http";
import { normalizeDOI } from "./policy";

function safeParseJSON(res: any): any {
  if (typeof res?.response === "object" && res.response !== null)
    return res.response;
  return JSON.parse(res?.response || res?.responseText || "{}");
}

/**
 * Normalizes a raw ISSN string or value into standard format: XXXX-XXXX (e.g. 1359-6454).
 * Returns undefined if the string does not represent a valid 8-character ISSN.
 */
export function normalizeISSN(raw?: unknown): string | undefined {
  if (!raw || typeof raw !== "string")
    return undefined;

  const cleaned = raw.trim().toUpperCase().replace(/-/g, "");
  if (!/^\d{7}[\dX]$/.test(cleaned) || [...cleaned].reduce((sum, char, index) => sum + (char === "X" ? 10 : Number(char)) * (8 - index), 0) % 11 !== 0)
    return undefined;

  return `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`;
}

export interface ResolveISSNOptions {
  doi?: string;
  publicationTitle?: string;
  signal?: AbortSignal;
  debug?: (msg: string) => void;
}

export interface ResolveISSNResult {
  issn: string;
  source: "OpenAlex" | "Crossref";
}

/**
 * Query OpenAlex for journal ISSN via DOI or publicationTitle.
 */
export async function fetchISSNFromOpenAlex(opts: ResolveISSNOptions): Promise<string | undefined> {
  const { doi, publicationTitle, signal, debug } = opts;
  const cleanDOI = normalizeDOI(doi);

  // 1. Query by DOI
  if (cleanDOI) {
    try {
      const url = `https://api.openalex.org/works/https://doi.org/${encodeURIComponent(cleanDOI)}?select=doi,primary_location`;
      debug?.(`[OpenAlex] Fetching work by DOI: ${cleanDOI}`);
      const res = await requestCachedGET(url, {
        timeout: 10_000,
      }, signal);
      if (res && (res.status === 200 || res.status === undefined)) {
        const body = safeParseJSON(res);
        const source = normalizeDOI(body.doi) === cleanDOI ? body.primary_location?.source : undefined;
        const candidate = source?.issn_l || source?.issn?.[0];
        const normalized = normalizeISSN(candidate);
        if (normalized) {
          debug?.(`[OpenAlex] Resolved ISSN via DOI: ${normalized}`);
          return normalized;
        }
      }
    }
    catch (e) {
      signal?.throwIfAborted();
      debug?.(`[OpenAlex] Work query failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 2. Query by publicationTitle
  if (publicationTitle?.trim()) {
    try {
      const url = `https://api.openalex.org/sources?search=${encodeURIComponent(publicationTitle.trim())}&per-page=5&select=display_name,issn_l,issn`;
      debug?.(`[OpenAlex] Searching source by publicationTitle: ${publicationTitle}`);
      const res = await requestCachedGET(url, {
        timeout: 10_000,
      }, signal);
      if (res && (res.status === 200 || res.status === undefined)) {
        const body = safeParseJSON(res);
        const source = body.results?.find((entry: any) => sameJournal(entry.display_name, publicationTitle));
        const candidate = source?.issn_l || source?.issn?.[0];
        const normalized = normalizeISSN(candidate);
        if (normalized) {
          debug?.(`[OpenAlex] Resolved ISSN via publicationTitle: ${normalized}`);
          return normalized;
        }
      }
    }
    catch (e) {
      signal?.throwIfAborted();
      debug?.(`[OpenAlex] Source search failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return undefined;
}

/**
 * Query Crossref for journal ISSN via DOI or publicationTitle.
 */
export async function fetchISSNFromCrossref(opts: ResolveISSNOptions): Promise<string | undefined> {
  const { doi, publicationTitle, signal, debug } = opts;
  const cleanDOI = normalizeDOI(doi);

  // 1. Query by DOI
  if (cleanDOI) {
    try {
      const url = `https://api.crossref.org/works/${encodeURIComponent(cleanDOI)}`;
      debug?.(`[Crossref] Fetching work by DOI: ${cleanDOI}`);
      const res = await requestCachedGET(url, {
        timeout: 10_000,
      }, signal);
      if (res && (res.status === 200 || res.status === undefined)) {
        const body = safeParseJSON(res);
        const message = normalizeDOI(body.message?.DOI) === cleanDOI ? body.message : undefined;
        const candidate = [...(message?.ISSN || []), ...(message?.["issn-type"] || []).map((entry: any) => entry.value)].find(value => normalizeISSN(value));
        const normalized = normalizeISSN(candidate);
        if (normalized) {
          debug?.(`[Crossref] Resolved ISSN via DOI: ${normalized}`);
          return normalized;
        }
      }
    }
    catch (e) {
      signal?.throwIfAborted();
      debug?.(`[Crossref] Work query failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 2. Query by publicationTitle
  if (publicationTitle?.trim()) {
    try {
      const url = `https://api.crossref.org/works?query.container-title=${encodeURIComponent(publicationTitle.trim())}&filter=type:journal-article&rows=5&select=container-title,ISSN,issn-type`;
      debug?.(`[Crossref] Searching journal by title: ${publicationTitle}`);
      const res = await requestCachedGET(url, {
        timeout: 10_000,
      }, signal);
      if (res && (res.status === 200 || res.status === undefined)) {
        const body = safeParseJSON(res);
        const journal = body.message?.items?.find((entry: any) => entry["container-title"]?.some((title: string) => sameJournal(title, publicationTitle)));
        const candidate = [...(journal?.ISSN || []), ...(journal?.["issn-type"] || []).map((entry: any) => entry.value)].find(value => normalizeISSN(value));
        const normalized = normalizeISSN(candidate);
        if (normalized) {
          debug?.(`[Crossref] Resolved ISSN via publicationTitle: ${normalized}`);
          return normalized;
        }
      }
    }
    catch (e) {
      signal?.throwIfAborted();
      debug?.(`[Crossref] Journal query failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return undefined;
}

function sameJournal(actual: unknown, expected: string | undefined) {
  const normalize = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  return typeof actual === "string" && Boolean(expected?.trim()) && normalize(actual) === normalize(expected!);
}

/** Prefer DOI evidence from either provider before searching journal names. */
export async function resolveMissingISSN(opts: ResolveISSNOptions): Promise<ResolveISSNResult | null> {
  opts.signal?.throwIfAborted();
  for (const query of [{ ...opts, publicationTitle: undefined }, { ...opts, doi: undefined }]) {
    if (!query.doi && !query.publicationTitle?.trim())
      continue;
    const crossref = await fetchISSNFromCrossref(query);
    if (crossref)
      return { issn: crossref, source: "Crossref" };
    opts.signal?.throwIfAborted();
    const openalex = await fetchISSNFromOpenAlex(query);
    if (openalex)
      return { issn: openalex, source: "OpenAlex" };
  }
  return null;
}
