import type { TransformedData } from "../rules/tool-update-metadata/services/base-service";
import type { IdentifierCandidate, MetadataDecision, ReviewProposal } from "./policy";

import { extractDOIFromUrl } from "../rules/tool-update-metadata/identifiers";
import { normalizeDOI, sanitizeWebTitle, titlesAgree } from "../rules/tool-update-metadata/policy";
import { creatorsAgree, firstCreator, isbnEquivalent, isPlaceholderCreator, normalizeArxiv } from "./policy";

export function hasLocalCorroboration(original: TransformedData, kind?: IdentifierCandidate["kind"]): boolean {
  if (!original.title?.trim())
    return false;
  if (kind === "Title")
    return Boolean(firstCreator(original));
  return Boolean(original.date?.match(/\b\d{4}\b/) || firstCreator(original));
}

/** PDF references and multiple editions are not resolved by candidate order. */
export function automaticIdentifier(candidates: IdentifierCandidate[]): IdentifierCandidate | undefined {
  const unique = [...new Map(candidates.map(candidate => [`${candidate.kind}:${candidate.value}`, candidate])).values()];
  const explicit = unique.filter(candidate => !candidate.excerpt);
  const source = explicit.length ? explicit : unique;
  for (const kind of ["DOI", "arXiv", "PMID", "PMCID", "ISBN", "Title"] as const) {
    const matches = source.filter(candidate => candidate.kind === kind);
    if (!matches.length)
      continue;
    const first = matches[0];
    const equivalent = (candidate: IdentifierCandidate) => kind === "ISBN" ? isbnEquivalent(first.value, candidate.value) : kind === "DOI" ? normalizeDOI(first.value) === normalizeDOI(candidate.value) : kind === "arXiv" ? normalizeArxiv(first.value) === normalizeArxiv(candidate.value) : first.value === candidate.value;
    return matches.every(equivalent) ? first : undefined;
  }
}

export function automaticSelection(proposal: ReviewProposal, overwrite = false, repairCreators = false): { selection?: MetadataDecision; reason?: "blocked" | "conflict" | "evidence" } {
  if (proposal.blocked)
    return { reason: "blocked" };
  const originalDOI = normalizeDOI(
    proposal.original.DOI
    || extractDOIFromUrl(proposal.original.url || "")
    || (typeof proposal.original.extra === "string" ? proposal.original.extra.match(/\b(?:doi:\s*|10\.)(10\.\d{4,9}\/[^\s?#&<>"]+)/i)?.[1] : ""),
  );
  const returnedDOI = normalizeDOI(proposal.candidate.DOI);
  if (!proposal.preprintURL && originalDOI && returnedDOI && !originalDOI.startsWith("10/") && originalDOI !== returnedDOI)
    return { reason: "conflict" };
  // User authority applies to field differences only after an explicit DOI is verified.
  const verifiedDOI = !proposal.preprintURL && proposal.identifier.kind === "DOI" && !proposal.identifier.excerpt
    && originalDOI && !originalDOI.startsWith("10/") && originalDOI === returnedDOI
    && originalDOI === normalizeDOI(proposal.identifier.value);

  const creatorsEmptyOrPlaceholder = !proposal.original.creators?.length || proposal.original.creators.every(isPlaceholderCreator);
  const titleContaminated = Boolean(proposal.original.title && sanitizeWebTitle(proposal.original.title) !== proposal.original.title && titlesAgree(proposal.original.title, proposal.candidate.title || ""));

  const beforeYear = proposal.original.date?.match(/\b\d{4}\b/)?.[0];
  const afterYear = proposal.candidate.date?.match(/\b\d{4}\b/)?.[0];
  const dateNear = Boolean(beforeYear && afterYear && Math.abs(Number(beforeYear) - Number(afterYear)) <= 1);

  const allowableConflicts = proposal.conflicts.every(field =>
    (field === "title" && titleContaminated)
    || (field === "creators" && creatorsEmptyOrPlaceholder)
    || (field === "date" && dateNear)
    || (overwrite && ["title", "date", "creators"].includes(field)),
  );

  const titleMismatch = proposal.conflicts.includes("title") && !titleContaminated;
  if (proposal.conflicts.length && !(verifiedDOI && (allowableConflicts || (!titleMismatch && !overwrite))))
    return { reason: "conflict" };
  // A title search needs first-author corroboration; a PDF excerpt needs year or author agreement.
  if (proposal.identifier.kind === "Title" || proposal.identifier.excerpt) {
    const beforeYear = proposal.original.date?.match(/\b\d{4}\b/)?.[0];
    const afterYear = proposal.candidate.date?.match(/\b\d{4}\b/)?.[0];
    const author = firstCreator(proposal.original);
    const candidateAuthor = firstCreator(proposal.candidate);
    const firstAuthorMatch = Boolean(author && candidateAuthor && author === candidateAuthor);
    const hasAuthors = Boolean((proposal.original.creators || []).some(c => c && !isPlaceholderCreator(c))
      && (proposal.candidate.creators || []).some(c => c && !isPlaceholderCreator(c)));
    const authorsMatch = hasAuthors && Boolean(firstAuthorMatch || creatorsAgree(proposal.original, proposal.candidate));
    const yearsMatch = Boolean(beforeYear && afterYear && beforeYear === afterYear);
    if (!proposal.original.title || !proposal.candidate.title || !titlesAgree(proposal.original.title, proposal.candidate.title))
      return { reason: "evidence" };
    if (proposal.identifier.kind === "Title" ? !firstAuthorMatch : (!yearsMatch && !authorsMatch))
      return { reason: "evidence" };
  }
  const related = !!proposal.preprintURL;
  // A revived snapshot's local title/date are capture artefacts: adopt the verified record.
  const revived = !!proposal.revival;
  const excluded = new Set<string>(proposal.excludedFields);
  const unallowedConflicts = new Set(allowableConflicts ? [] : proposal.conflicts);
  const fields = new Set(proposal.changes.filter((change) => {
    if (excluded.has(change.field))
      return false;
    // Guard against unwanted overwrites: unallowed conflict fields cannot be overwritten in blank mode.
    if (unallowedConflicts.has(change.field) && !overwrite) {
      if (change.field === "creators") {
        const beforeList = Array.isArray(change.before) ? change.before : proposal.original.creators || [];
        const hasBefore = beforeList.length > 0 && !beforeList.every(isPlaceholderCreator);
        if (hasBefore)
          return false;
      }
      else if (String(change.before ?? "").trim()) {
        return false;
      }
    }
    if (related || revived || overwrite)
      return true;
    if (change.field === "creators") {
      const beforeList = Array.isArray(change.before) ? change.before : proposal.original.creators || [];
      const hasBefore = beforeList.length > 0 && !beforeList.every(isPlaceholderCreator);
      return repairCreators || !hasBefore;
    }
    if (verifiedDOI && titleContaminated && change.field === "title")
      return true;
    return Array.isArray(change.before) ? !change.before.length : !String(change.before ?? "").trim();
  }).map(change => change.field));

  if (!fields.size && proposal.conflicts.length && !allowableConflicts)
    return { reason: "conflict" };

  return { selection: { proposal, action: related ? "related" : "update", acknowledged: true, fields } };
}
