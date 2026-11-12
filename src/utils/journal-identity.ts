import { extractISSNs } from "./esi";

const TITLE_KEYS = ["publicationName", "journalName", "publicationTitle", "journalTitle", "title", "name", "qikanName", "qikanname", "cnName", "enName"] as const;
const ISSN_KEYS = ["issn", "ISSN", "eissn", "eISSN", "pissn", "pISSN"] as const;

export function normalizeJournalTitle(value: unknown): string {
  return String(value || "").normalize("NFKC").trim().toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

export function extractValidISSNs(value: unknown): string[] {
  return [...new Set(extractISSNs(String(value || "")).filter(issn => /^\d{7}[\dX]$/.test(issn)))];
}

export function extractResponseJournalIdentity(records: unknown[]): { titles: string[]; issns: string[] } {
  const titles = new Set<string>();
  const issns = new Set<string>();
  for (const raw of records) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      continue;
    const record = raw as Record<string, unknown>;
    for (const key of TITLE_KEYS) {
      if (typeof record[key] === "string" && record[key].trim())
        titles.add(record[key].trim());
    }
    for (const key of ISSN_KEYS) {
      const value = record[key];
      const list = Array.isArray(value) ? value.join(" ") : typeof value === "string" ? value : "";
      for (const issn of extractValidISSNs(list))
        issns.add(issn);
    }
  }
  return { titles: [...titles], issns: [...issns] };
}

export function matchesJournalIdentity(expectedTitle: string, expectedISSNs: readonly string[] | undefined, records: unknown[]): boolean {
  const { titles, issns } = extractResponseJournalIdentity(records);
  const expectedNormalized = normalizeJournalTitle(expectedTitle);
  const hasExpectedISSNs = Boolean(expectedISSNs?.length);
  const issnMismatch = Boolean(hasExpectedISSNs && issns.length && !issns.some(issn => expectedISSNs!.includes(issn)));
  if (issnMismatch)
    return false;
  const issnConfirmed = Boolean(hasExpectedISSNs && issns.length && issns.some(issn => expectedISSNs!.includes(issn)));
  if (!issnConfirmed && expectedNormalized && titles.length)
    return titles.some(title => normalizeJournalTitle(title) === expectedNormalized);
  return true;
}
