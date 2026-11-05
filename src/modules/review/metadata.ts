import type { Identifiers } from "../rules/tool-update-metadata/identifiers";
import type { TransformedData } from "../rules/tool-update-metadata/services/base-service";
import type { IdentifierCandidate, ReviewProposal } from "./policy";
import { requestCachedGET } from "../../utils/http";
import { getString } from "../../utils/locale";
import { waitForOperation } from "../../utils/rule-execution";
import { isFieldValidForItemType } from "../../utils/zotero";
import { normalizeMetadata } from "../rules/tool-update-metadata";
import { extractIdentifiers } from "../rules/tool-update-metadata/identifiers";
import { resolveMissingISSN } from "../rules/tool-update-metadata/issn-resolver";
import { mergeMetadata, metadataIdentity, normalizeDOI } from "../rules/tool-update-metadata/policy";
import { services } from "../rules/tool-update-metadata/services";
import { defineService } from "../rules/tool-update-metadata/services/base-service";
import { CrossrefService } from "../rules/tool-update-metadata/services/crossref-service";
import { IdentifiersTranslateService } from "../rules/tool-update-metadata/services/translate-service";
import { identifiersFromText, identityConflicts, isbnEquivalent, normalizeArxiv, normalizeISBN, reviewChanges } from "./policy";
import { discoverSnapshotIdentifiers, isSnapshotItem, reviveProposal } from "./snapshot-reviver";

export async function discoverIdentifiers(item: Zotero.Item, signal?: AbortSignal, scanPDF = true, reviveSnapshots = true): Promise<IdentifierCandidate[]> {
  const existing = extractIdentifiers(item);
  const candidates: IdentifierCandidate[] = [];
  if (existing.DOI)
    candidates.push({ kind: "DOI", value: normalizeDOI(existing.DOI), source: getString("review-source-item") });
  if (!existing.DOI) {
    const extra = String(item.getField("extra") || "");
    const match = extra.match(/\b(?:doi:\s*|https?:\/\/doi\.org\/)?(10\.\d{4,9}\/[^\s?#&<>"]+)/i);
    if (match) {
      const extracted = normalizeDOI(match[1]);
      if (extracted) {
        existing.DOI = extracted;
        candidates.push({ kind: "DOI", value: extracted, source: getString("review-source-item") });
      }
    }
  }
  if (existing.arXiv && normalizeArxiv(existing.arXiv))
    candidates.push({ kind: "arXiv", value: normalizeArxiv(existing.arXiv), source: getString("review-source-item") });
  if (existing.PMID && /^\d+$/.test(existing.PMID.trim()))
    candidates.push({ kind: "PMID", value: existing.PMID.trim(), source: getString("review-source-item") });
  if (existing.PMCID && /^PMC\d+$/i.test(existing.PMCID.trim()))
    candidates.push({ kind: "PMCID", value: existing.PMCID.trim().toUpperCase(), source: getString("review-source-item") });
  if (item.itemType === "book" && existing.ISBN) {
    const isbn = existing.ISBN.match(/(?:97[89][ -]?)?(?:\d[ -]?){9}[\dX]/gi) || [];
    for (const value of isbn) {
      if (normalizeISBN(value))
        candidates.push({ kind: "ISBN", value: normalizeISBN(value), source: getString("review-source-item") });
    }
  }
  if (reviveSnapshots && isSnapshotItem(item)) {
    const snapshotCandidates = await discoverSnapshotIdentifiers(item, signal);
    if (snapshotCandidates.length)
      candidates.push(...snapshotCandidates);
  }
  if (candidates.length || !scanPDF)
    return candidates;
  for (const id of item.getAttachments()) {
    signal?.throwIfAborted();
    const attachment = await Zotero.Items.getAsync(id);
    if (!attachment || attachment.deleted || attachment.attachmentContentType !== "application/pdf")
      continue;
    const path = Zotero.Fulltext.getItemCacheFile(attachment).path;
    if (!await IOUtils.exists(path))
      continue;
    // The opening pages are more useful than references; never scan or upload the full PDF.
    const text = new TextDecoder().decode(await IOUtils.read(path, { maxBytes: 32_000 }));
    candidates.push(...identifiersFromText(text, `${getString("review-source-pdf")}: ${attachment.getDisplayTitle()}`));
  }
  signal?.throwIfAborted();
  return [...new Map(candidates.map(candidate => [`${candidate.kind}:${candidate.value}`, candidate])).values()].slice(0, 20);
}

export interface ArxivRecord {
  id: string;
  doi: string;
  data: TransformedData;
}

function createAbortController(): AbortController {
  const Controller = (typeof Zotero !== "undefined" && typeof Zotero.getMainWindow === "function" && (Zotero.getMainWindow() as any)?.AbortController) || AbortController;
  return new Controller();
}

export function parseArxiv(xml: string, requested: string, latest: boolean): ArxivRecord {
  const Parser = ((typeof Zotero !== "undefined" && typeof Zotero.getMainWindow === "function" && (Zotero.getMainWindow() as any)?.DOMParser) || DOMParser) as typeof DOMParser;
  const doc = new Parser().parseFromString(xml, "text/xml");
  const entries = [...doc.getElementsByTagNameNS("http://www.w3.org/2005/Atom", "entry")];
  const expected = normalizeArxiv(requested);
  const entry = entries.find((element) => {
    const returned = normalizeArxiv(element.getElementsByTagNameNS("http://www.w3.org/2005/Atom", "id")[0]?.textContent || "");
    return returned && (latest || !/v\d+$/.test(expected) ? returned.replace(/v\d+$/, "") === expected.replace(/v\d+$/, "") : returned === expected);
  });
  if (!entry)
    throw new Error(getString("review-arxiv-mismatch"));
  const atom = (name: string) => entry.getElementsByTagNameNS("http://www.w3.org/2005/Atom", name)[0]?.textContent?.trim().replace(/\s+/g, " ") || "";
  const id = normalizeArxiv(atom("id"));
  const doi = normalizeDOI(entry.getElementsByTagNameNS("http://arxiv.org/schemas/atom", "doi")[0]?.textContent || "");
  const title = atom("title");
  if (!title || !id)
    throw new Error(getString("review-no-data"));
  return {
    id,
    doi,
    data: {
      itemType: "preprint",
      title,
      abstractNote: atom("summary"),
      date: atom("published").slice(0, 10),
      url: `https://arxiv.org/abs/${id}`,
      // arXiv only supplies full names: do not guess which words are family names.
      creators: [...entry.getElementsByTagNameNS("http://www.w3.org/2005/Atom", "author")].map(author => ({ creatorType: "author" as const, name: (author.getElementsByTagNameNS("http://www.w3.org/2005/Atom", "name")[0]?.textContent || "").trim().replace(/\s+/g, " ") })).filter(creator => creator.name),
    },
  };
}

const arxivReviewService = defineService({
  id: "arxiv-review-service",
  name: "arXiv",
  cooldown: 3000,
  shouldApply: () => true,
  async fetch({ identifiers, signal }) {
    const response = await requestCachedGET(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(identifiers.arXiv!)}`, {}, signal);
    return { xml: String(response.response) };
  },
});

async function arxivRecord(item: Zotero.Item, value: string, latest: boolean, signal?: AbortSignal) {
  const requested = latest ? value.replace(/v\d+$/, "") : value;
  const result = await arxivReviewService.fetch!({ item, identifiers: { arXiv: requested }, isPreprint: true, debug: () => {}, signal });
  return parseArxiv(result!.xml, value, latest);
}

async function resolveDOI(value: string, signal?: AbortSignal): Promise<string> {
  if (!/^10\//.test(value))
    return value;
  const response = await requestCachedGET(`https://doi.org/api/handles/${encodeURIComponent(value)}`, { responseType: "json" }, signal);
  const result = response.response as { responseCode?: number; values?: { type: string; data: { value: string } }[] };
  const resolved = normalizeDOI(result?.values?.find(entry => entry.type === "HS_ALIAS")?.data.value);
  if (result?.responseCode !== 1 || !resolved || /^10\//.test(resolved))
    throw new Error(getString("review-doi-unresolved"));
  return resolved;
}

async function translateIdentifier(item: Zotero.Item, identifiers: Identifiers, signal?: AbortSignal) {
  const controller = createAbortController();
  const response = await waitForOperation(() => IdentifiersTranslateService.fetch!({ item, identifiers, isPreprint: false, debug: () => {}, signal }), signal || controller.signal, 60_000);
  signal?.throwIfAborted();
  const data = normalizeMetadata(response && IdentifiersTranslateService.transform!(response));
  if (!data?.title)
    throw new Error(getString("review-no-data"));
  return data;
}

export async function inspectMetadata(item: Zotero.Item, identifier: IdentifierCandidate, original: TransformedData, signal?: AbortSignal, reviveSnapshots = true): Promise<ReviewProposal> {
  let candidate: TransformedData;
  let source: string;
  let blocked = false;
  if (identifier.kind === "Title") {
    const controller = createAbortController();
    const ctx = { item, identifiers: {}, isPreprint: false, debug: () => {}, signal: signal || controller.signal };
    let matched: TransformedData | undefined;
    let matchedSource = "";
    for (const service of services.filter(service => !service.lookup && service.fetch && (!service.supportedItemTypes || service.supportedItemTypes.includes(item.itemType)))) {
      if (!service.shouldApply(ctx))
        continue;
      try {
        const response = await waitForOperation(() => service.fetch!(ctx), ctx.signal, 30_000);
        const result = normalizeMetadata(response && service.transform?.(response));
        if (result?.title && metadataIdentity(original, {}, result)) {
          matched = result;
          matchedSource = service.name;
          break;
        }
      }
      catch {
        signal?.throwIfAborted();
      }
    }
    if (!matched)
      throw new Error(getString("review-no-data"));
    candidate = matched;
    source = matchedSource;
  }
  else if (identifier.kind === "arXiv") {
    candidate = (await arxivRecord(item, identifier.value, false, signal)).data;
    source = "arXiv";
  }
  else if (identifier.kind === "DOI") {
    const value = await resolveDOI(identifier.value, signal);
    let matched: TransformedData | undefined;
    let matchedSource = "";
    // 1. Try direct authoritative Crossref API first
    try {
      const response = await CrossrefService.fetch!({ item, identifiers: { DOI: value }, isPreprint: false, debug: () => {}, signal });
      const transformed = normalizeMetadata(response && CrossrefService.transform!(response));
      if (transformed?.title) {
        matched = transformed;
        matchedSource = "Crossref";
      }
    }
    catch {
      signal?.throwIfAborted();
    }
    // 2. Fall back to Zotero search translator
    if (!matched?.title) {
      try {
        matched = await translateIdentifier(item, { DOI: value }, signal);
        matchedSource = matched.libraryCatalog || getString("review-source-translator");
      }
      catch (error) {
        signal?.throwIfAborted();
        // 3. Fall back to Semantic Scholar
        const s2Service = services.find(s => s.id === "semantic-scholar-service");
        if (s2Service?.fetch) {
          try {
            const s2Res = await s2Service.fetch({ item, identifiers: { DOI: value }, isPreprint: false, debug: () => {}, signal });
            const s2Data = normalizeMetadata(s2Res && s2Service.transform?.(s2Res));
            if (s2Data?.title) {
              matched = s2Data;
              matchedSource = "Semantic Scholar";
            }
          }
          catch {
            signal?.throwIfAborted();
          }
        }
        if (!matched?.title)
          throw error;
      }
    }
    // 4. Supplemental gap-fill: if Crossref/Translator succeeded but lacks key fields (e.g. abstractNote, volume, issue, pages, publicationTitle, ISSN)
    // and local item also lacks them, merge missing fields from Semantic Scholar without overwriting primary fields.
    const lacksKeyFields = Boolean(
      (!matched?.abstractNote && !original.abstractNote)
      || (!matched?.volume && !original.volume)
      || (!matched?.issue && !original.issue)
      || (!matched?.pages && !original.pages)
      || (!matched?.publicationTitle && !original.publicationTitle)
      || (!matched?.ISSN && !original.ISSN),
    );
    if (matched?.title && lacksKeyFields && matchedSource !== "Semantic Scholar") {
      const s2Service = services.find(s => s.id === "semantic-scholar-service");
      if (s2Service?.fetch) {
        try {
          const s2Res = await s2Service.fetch({ item, identifiers: { DOI: value }, isPreprint: false, debug: () => {}, signal });
          const s2Data = normalizeMetadata(s2Res && s2Service.transform?.(s2Res));
          if (s2Data && (!s2Data.DOI || normalizeDOI(s2Data.DOI) === value.toLowerCase())) {
            matched = mergeMetadata(matched, s2Data);
          }
        }
        catch {
          signal?.throwIfAborted();
        }
      }
    }
    if (matched?.title && !matched.ISSN && !original.ISSN && isFieldValidForItemType("ISSN", item.itemType)) {
      try {
        const resolved = await resolveMissingISSN({
          doi: value,
          publicationTitle: String(original.publicationTitle || matched.publicationTitle || ""),
          signal,
        });
        if (resolved) {
          matched.ISSN = resolved.issn;
        }
      }
      catch {
        signal?.throwIfAborted();
      }
    }
    candidate = matched;
    source = matchedSource;
    blocked = normalizeDOI(candidate.DOI) !== value.toLowerCase();
  }
  else {
    const value = identifier.value;
    candidate = await translateIdentifier(item, { [identifier.kind]: value }, signal);
    source = candidate.libraryCatalog || getString("review-source-translator");
    if (identifier.kind === "ISBN") {
      blocked = !(candidate.ISBN?.match(/(?:97[89][ -]?)?(?:\d[ -]?){9}[\dX]/gi) || []).some(isbn => isbnEquivalent(value, isbn));
    }
    else {
      const pattern = identifier.kind === "PMID" ? /^PMID:\s*(\d+)\s*$/im : /^PMCID:\s*(PMC\d+)\s*$/im;
      const returned = String((candidate as Record<string, unknown>)[identifier.kind] || candidate.extra?.match(pattern)?.[1] || "");
      blocked = returned.toUpperCase() !== identifier.value.toUpperCase();
    }
  }
  const conflicts = identityConflicts(original, candidate);
  if (blocked)
    conflicts.unshift(identifier.kind);
  const proposal: ReviewProposal = { itemID: item.id, original, candidate, identifier, source, conflicts, blocked, changes: reviewChanges(original, candidate) };
  return (reviveSnapshots && isSnapshotItem(item)) ? reviveProposal(proposal, item.itemType) : proposal;
}

export async function inspectPreprint(item: Zotero.Item, identifier: IdentifierCandidate, original: TransformedData, signal?: AbortSignal, allowUnpublished = false): Promise<ReviewProposal> {
  const record = await arxivRecord(item, identifier.value, true, signal);
  if ((!record.doi || /10\.48550\/arxiv\./i.test(record.doi)) && allowUnpublished) {
    return { itemID: item.id, original, candidate: record.data, identifier, source: `arXiv ${record.id}`, conflicts: identityConflicts(original, record.data, true), blocked: false, changes: reviewChanges(original, record.data) };
  }
  if (!record.doi || /10\.48550\/arxiv\./i.test(record.doi))
    throw new Error(getString("review-preprint-unpublished", { args: { version: record.id } }));
  let candidate: TransformedData | undefined;
  let candidateSource = "";
  try {
    const response = await CrossrefService.fetch!({ item, identifiers: { DOI: record.doi }, isPreprint: false, debug: () => {}, signal });
    const transformed = normalizeMetadata(response && CrossrefService.transform!(response));
    if (transformed?.title) {
      candidate = transformed;
      candidateSource = "Crossref";
    }
  }
  catch {
    signal?.throwIfAborted();
  }
  if (!candidate?.title) {
    candidate = await translateIdentifier(item, { DOI: record.doi }, signal);
    candidateSource = candidate.libraryCatalog || getString("review-source-translator");
  }
  const blocked = normalizeDOI(candidate.DOI) !== record.doi || !["journalArticle", "conferencePaper"].includes(candidate.itemType || "");
  const conflicts = identityConflicts(original, candidate, true);
  if (blocked)
    conflicts.unshift("DOI / itemType");
  return {
    itemID: item.id,
    original,
    candidate,
    identifier,
    source: `arXiv ${record.id} → ${candidateSource}`,
    conflicts,
    blocked,
    changes: reviewChanges(original, candidate, true),
    preprintURL: `https://arxiv.org/abs/${normalizeArxiv(identifier.value)}`,
  };
}
