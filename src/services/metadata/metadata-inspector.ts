import type { IdentifierCandidate, ReviewProposal } from "./review-policy";
import type { Identifiers } from "./tool-update-metadata/identifiers";
import type { ArxivRecord } from "./tool-update-metadata/services/arxiv-service";
import type { TransformedData } from "./tool-update-metadata/services/base-service";
import { requestCachedGET } from "../../utils/http";
import { getString } from "../../utils/locale";
import { waitForOperation } from "../../utils/rule-execution";
import { isFieldValidForItemType } from "../../utils/zotero";
import { identifiersFromText, identityConflicts, isbnEquivalent, normalizeArxiv, normalizeISBN, reviewChanges } from "./review-policy";
import { discoverSnapshotIdentifiers, isSnapshotItem, reviveProposal } from "./snapshot-reviver";
import { normalizeMetadata } from "./tool-update-metadata";
import { extractIdentifiers } from "./tool-update-metadata/identifiers";
import { markISSNResolutionAttempted, resolveMissingISSN } from "./tool-update-metadata/issn-resolver";
import { mergeMetadata, metadataIdentity, normalizeDOI, titlesAgree } from "./tool-update-metadata/policy";
import * as serviceRegistry from "./tool-update-metadata/services";
import { ArxivService, parseArxiv } from "./tool-update-metadata/services/arxiv-service";
import { CrossrefService, extractCrossrefPublishedDOI, transformCrossrefWork } from "./tool-update-metadata/services/crossref-service";
import { OpenAlexService } from "./tool-update-metadata/services/openalex-service";
import { IdentifiersTranslateService, ItemTranslateService, URLTranslateService } from "./tool-update-metadata/services/translate-service";

export type { ArxivRecord };
export { parseArxiv };

export async function discoverIdentifiers(item: Zotero.Item, signal?: AbortSignal, scanPDF = true, reviveSnapshots = true): Promise<IdentifierCandidate[]> {
  const existing = extractIdentifiers(item);
  const candidates: IdentifierCandidate[] = [];
  const sourceItem = getString("review-source-item");
  if (existing.DOI)
    candidates.push({ kind: "DOI", value: normalizeDOI(existing.DOI), source: sourceItem });
  if (!existing.DOI) {
    const match = String(item.getField("extra") || "").match(/\b(?:doi:\s*|https?:\/\/doi\.org\/)?(10\.\d{4,9}\/[^\s?#&<>"]+)/i);
    const extracted = match ? normalizeDOI(match[1]) : "";
    if (extracted) {
      existing.DOI = extracted;
      candidates.push({ kind: "DOI", value: extracted, source: sourceItem });
    }
  }
  if (existing.arXiv && normalizeArxiv(existing.arXiv))
    candidates.push({ kind: "arXiv", value: normalizeArxiv(existing.arXiv), source: sourceItem });
  if (existing.PMID && /^\d+$/.test(existing.PMID.trim()))
    candidates.push({ kind: "PMID", value: existing.PMID.trim(), source: sourceItem });
  if (existing.PMCID && /^PMC\d+$/i.test(existing.PMCID.trim()))
    candidates.push({ kind: "PMCID", value: existing.PMCID.trim().toUpperCase(), source: sourceItem });
  if (item.itemType === "book" && existing.ISBN) {
    for (const value of existing.ISBN.match(/(?:97[89][ -]?)?(?:\d[ -]?){9}[\dX]/gi) || []) {
      if (normalizeISBN(value))
        candidates.push({ kind: "ISBN", value: normalizeISBN(value), source: sourceItem });
    }
  }
  if (reviveSnapshots && isSnapshotItem(item))
    candidates.push(...await discoverSnapshotIdentifiers(item, signal));
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
    const text = new TextDecoder().decode(await IOUtils.read(path, { maxBytes: 32_000 }));
    candidates.push(...identifiersFromText(text, `${getString("review-source-pdf")}: ${attachment.getDisplayTitle()}`));
  }
  signal?.throwIfAborted();
  return [...new Map(candidates.map(candidate => [`${candidate.kind}:${candidate.value}`, candidate])).values()].slice(0, 20);
}

function createAbortController(): AbortController {
  const Controller = (typeof Zotero !== "undefined" && typeof Zotero.getMainWindow === "function" && (Zotero.getMainWindow() as any)?.AbortController) || AbortController;
  return new Controller();
}

async function arxivRecord(item: Zotero.Item, value: string, latest: boolean, signal?: AbortSignal) {
  const requested = latest ? value.replace(/v\d+$/, "") : value;
  const result = await ArxivService.fetch!({ item, identifiers: { arXiv: requested }, isPreprint: true, debug: () => {}, signal });
  return parseArxiv(result?.xml || "", value, latest);
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

function lacksJournalKeyFields(matched: TransformedData | undefined, original: TransformedData): boolean {
  return (["abstractNote", "volume", "issue", "pages", "date", "publicationTitle", "ISSN"] as const)
    .some(f => !matched?.[f] && !original[f]);
}

async function searchCrossrefByTitle(original: TransformedData, signal?: AbortSignal): Promise<TransformedData | undefined> {
  const title = String(original.title || "").trim();
  if (!title)
    return undefined;
  const query = [title, original.publicationTitle || ""].filter(Boolean).join(" ");
  const res = await requestCachedGET(`https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(query)}&rows=3`, { responseType: "json" }, signal);
  const items = (res.response as any)?.message?.items;
  if (!Array.isArray(items))
    return undefined;
  for (const work of items) {
    const transformed = normalizeMetadata(transformCrossrefWork(work));
    if (transformed?.title && metadataIdentity(original, {}, transformed))
      return transformed;
  }
  return undefined;
}

export async function inspectMetadata(item: Zotero.Item, identifier: IdentifierCandidate, original: TransformedData, signal?: AbortSignal, reviveSnapshots = true): Promise<ReviewProposal> {
  let candidate: TransformedData;
  let source: string;
  let blocked = false;
  if (identifier.kind === "Title") {
    const controller = createAbortController();
    const url = String(original.url || item.getField("url") || "").trim();
    const ctx = { item, identifiers: url ? { URL: url } : {}, isPreprint: false, debug: () => {}, signal: signal || controller.signal };
    let matched: TransformedData | undefined;
    let matchedSource = "";
    const ordered = "getOrderedMetadataServices" in serviceRegistry && typeof serviceRegistry.getOrderedMetadataServices === "function"
      ? serviceRegistry.getOrderedMetadataServices(serviceRegistry.services)
      : serviceRegistry.services;
    for (const service of ordered.filter(s => (!s.lookup || (s.lookup === "url" && url)) && s.fetch && (!s.supportedItemTypes || s.supportedItemTypes.includes(item.itemType)))) {
      if (!service.shouldApply(ctx))
        continue;
      try {
        const response = await waitForOperation(() => service.fetch!(ctx), ctx.signal, 30_000);
        const result = normalizeMetadata(response && service.transform?.(response));
        if (result?.title && metadataIdentity(original, {}, result)) {
          matched = matched ? mergeMetadata(matched, result) : result;
          matchedSource ||= service.name;
          if (!lacksJournalKeyFields(matched, original))
            break;
        }
      }
      catch {
        signal?.throwIfAborted();
      }
    }
    if (!matched || lacksJournalKeyFields(matched, original)) {
      try {
        const crMatch = await searchCrossrefByTitle(original, ctx.signal);
        if (crMatch) {
          matched = matched ? mergeMetadata(matched, crMatch) : crMatch;
          matchedSource ||= "Crossref";
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
    const hasApi = "hasConfiguredSemanticScholarAPI" in serviceRegistry && typeof serviceRegistry.hasConfiguredSemanticScholarAPI === "function" && serviceRegistry.hasConfiguredSemanticScholarAPI();
    const s2Service = serviceRegistry.services.find(s => s.id === "semantic-scholar-service");
    const openAlexService = serviceRegistry.services.find(s => s.id === "openalex-service") || OpenAlexService;
    const itemUrl = String(original.url || item.getField("url") || "").trim();
    let matched: TransformedData | undefined;
    let matchedSource = "";
    let lastError: unknown;

    const tryMerge = (incoming: TransformedData | null | undefined, label: string) => {
      if (!incoming?.title || (incoming.DOI && normalizeDOI(incoming.DOI) !== value.toLowerCase()))
        return;
      matched = matched ? mergeMetadata(matched, incoming) : incoming;
      matchedSource ||= label;
    };
    const fetchService = async (svc: any, label?: string, checkTitle = false, extraIds: Identifiers = {}) => {
      if (!svc?.fetch)
        return;
      const res = await svc.fetch({ item, identifiers: { DOI: value, ...extraIds }, isPreprint: false, debug: () => {}, signal });
      const data = normalizeMetadata(res && svc.transform?.(res));
      if (data?.title && (!checkTitle || (data.DOI && normalizeDOI(data.DOI) === value.toLowerCase()) || titlesAgree(original.title || matched?.title || "", data.title)))
        tryMerge(data, label || data.libraryCatalog || getString("review-source-translator"));
    };
    const runTranslator = async () => {
      const data = await translateIdentifier(item, { DOI: value }, signal);
      tryMerge(data, data.libraryCatalog || getString("review-source-translator"));
    };
    const pipeline = hasApi
      ? [() => fetchService(s2Service, "Semantic Scholar"), runTranslator, () => fetchService(CrossrefService, "Crossref"), () => fetchService(ItemTranslateService, undefined, true), () => fetchService(openAlexService, "OpenAlex"), () => itemUrl ? fetchService(URLTranslateService, undefined, true, { URL: itemUrl }) : Promise.resolve()]
      : [runTranslator, () => fetchService(CrossrefService, "Crossref"), () => fetchService(ItemTranslateService, undefined, true), () => fetchService(openAlexService, "OpenAlex"), () => itemUrl ? fetchService(URLTranslateService, undefined, true, { URL: itemUrl }) : Promise.resolve(), () => fetchService(s2Service, "Semantic Scholar")];
    for (const step of pipeline) {
      if (matched?.title && !lacksJournalKeyFields(matched, original))
        break;
      try {
        await step();
      }
      catch (err) {
        signal?.throwIfAborted();
        lastError = err;
      }
    }
    if (!matched?.title)
      throw lastError instanceof Error ? lastError : new Error(getString("review-no-data"));
    if (!matched.ISSN && !original.ISSN && isFieldValidForItemType("ISSN", item.itemType)) {
      const pubTitle = String(original.publicationTitle || matched.publicationTitle || "");
      const resolved = await resolveMissingISSN({ doi: value, publicationTitle: pubTitle, signal }).catch(() => {
        signal?.throwIfAborted();
        return null;
      });
      if (resolved) {
        matched.ISSN = resolved.issn;
      }
      else {
        markISSNResolutionAttempted(item, value, pubTitle);
        markISSNResolutionAttempted(item, extractIdentifiers(item).DOI, String(original.publicationTitle || ""));
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
  let publishedDOI = "";
  let preprintLabel = "";
  let preprintURL = "";
  if (identifier.kind === "DOI" && /^10\.1101\//.test(identifier.value)) {
    const preprintDOI = normalizeDOI(identifier.value);
    const preRes = await CrossrefService.fetch!({ item, identifiers: { DOI: preprintDOI }, isPreprint: true, debug: () => {}, signal });
    publishedDOI = (preRes?.message && extractCrossrefPublishedDOI(preRes.message)) || "";
    preprintLabel = `bioRxiv ${preprintDOI}`;
    preprintURL = `https://doi.org/${preprintDOI}`;
    const unpublishedData = normalizeMetadata(preRes && CrossrefService.transform!(preRes)) || undefined;
    if (!publishedDOI && allowUnpublished && unpublishedData?.title)
      return { itemID: item.id, original, candidate: unpublishedData, identifier, source: preprintLabel, conflicts: identityConflicts(original, unpublishedData, true), blocked: false, changes: reviewChanges(original, unpublishedData) };
    if (!publishedDOI)
      throw new Error(getString("review-preprint-unpublished", { args: { version: preprintDOI } }));
  }
  else {
    const record = await arxivRecord(item, identifier.value, true, signal);
    if ((!record.doi || /10\.48550\/arxiv\./i.test(record.doi)) && allowUnpublished)
      return { itemID: item.id, original, candidate: record.data, identifier, source: `arXiv ${record.id}`, conflicts: identityConflicts(original, record.data, true), blocked: false, changes: reviewChanges(original, record.data) };
    if (!record.doi || /10\.48550\/arxiv\./i.test(record.doi))
      throw new Error(getString("review-preprint-unpublished", { args: { version: record.id } }));
    publishedDOI = record.doi;
    preprintLabel = `arXiv ${record.id}`;
    preprintURL = `https://arxiv.org/abs/${normalizeArxiv(identifier.value)}`;
  }
  let candidate: TransformedData | undefined;
  let candidateSource = "";
  try {
    const response = await CrossrefService.fetch!({ item, identifiers: { DOI: publishedDOI }, isPreprint: false, debug: () => {}, signal });
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
    candidate = await translateIdentifier(item, { DOI: publishedDOI }, signal);
    candidateSource = candidate.libraryCatalog || getString("review-source-translator");
  }
  const blocked = normalizeDOI(candidate.DOI) !== publishedDOI || !["journalArticle", "conferencePaper"].includes(candidate.itemType || "");
  const conflicts = identityConflicts(original, candidate, true);
  if (blocked)
    conflicts.unshift("DOI / itemType");
  return { itemID: item.id, original, candidate, identifier, source: `${preprintLabel} → ${candidateSource}`, conflicts, blocked, changes: reviewChanges(original, candidate, true), preprintURL };
}
