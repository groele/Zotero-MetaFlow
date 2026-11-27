import type { TransformedData } from "../rules/tool-update-metadata/services/base-service";
import type { IdentifierCandidate, ReviewProposal } from "./policy";
import { requestGET } from "../../utils/http";
import { getString } from "../../utils/locale";
import { isFieldValidForItemType } from "../../utils/zotero";
import { normalizeDOI } from "../rules/tool-update-metadata/policy";
import { normalizeArxiv, reviewChanges } from "./policy";

/**
 * Web Snapshot Reviver.
 *
 * Browser clippings of papers, Nature News or scholarly blogs are often saved
 * as bare `webpage` items. When enabled, "Update Metadata" sniffs explicit
 * scholarly identifiers from the item URL, the stored HTML snapshot and (as a
 * last resort) the live page head, verifies them with the regular identifier
 * translators, and converts the item into its scholarly type.
 *
 * Only explicit, page-level evidence is accepted: `citation_*`/Dublin Core/
 * PRISM meta tags, canonical links and identifier-bearing URLs. DOIs merely
 * mentioned in the page body (references, related links) never trigger a type
 * conversion.
 */
export const SNAPSHOT_ITEM_TYPES = ["webpage", "blogPost"] as const;
export const REVIVAL_TARGET_TYPES = ["journalArticle", "preprint", "conferencePaper", "magazineArticle", "newspaperArticle", "report"] as const;

const HTML_READ_BYTES = 512_000;
const HEAD_SCAN_CHARS = 200_000;

export function isSnapshotItem(item?: { itemType?: string }): boolean {
  return !!item?.itemType && (SNAPSHOT_ITEM_TYPES as readonly string[]).includes(item.itemType);
}

/** Identifiers that are structurally encoded in a page URL. */
export function identifiersFromURL(value: string, source: string): IdentifierCandidate[] {
  const result: IdentifierCandidate[] = [];
  let url: URL;
  try {
    url = new URL(value.trim());
  }
  catch {
    return result;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    return result;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const path = decodeURIComponent(url.pathname);
  const doi = normalizeDOI(url.href);
  if (doi)
    result.push({ kind: "DOI", value: doi, source });
  const arxiv = (host.endsWith("arxiv.org") || host.endsWith("ar5iv.org")) ? normalizeArxiv(url.href.replace(/^http:/, "https:")) : "";
  if (arxiv)
    result.push({ kind: "arXiv", value: arxiv, source });
  const pmid = (host === "pubmed.ncbi.nlm.nih.gov" ? path.match(/^\/(\d{1,9})\/?$/) : host === "ncbi.nlm.nih.gov" ? path.match(/^\/pubmed\/(\d{1,9})\/?$/) : null)?.[1];
  if (pmid)
    result.push({ kind: "PMID", value: pmid, source });
  const pmcid = (host === "pmc.ncbi.nlm.nih.gov" || host === "ncbi.nlm.nih.gov" || host === "europepmc.org") ? path.match(/\/(PMC\d{3,10})\b/i)?.[1] : undefined;
  if (pmcid)
    result.push({ kind: "PMCID", value: pmcid.toUpperCase(), source });
  // Nature article identifiers are the DOI suffix under the 10.1038 prefix (incl. Nature News "d41586-…").
  const nature = !doi && (host === "nature.com" || host.endsWith(".nature.com")) ? path.match(/^\/articles\/([a-z0-9][\w.-]+)\/?$/i)?.[1] : undefined;
  if (nature && /\d/.test(nature))
    result.push({ kind: "DOI", value: normalizeDOI(`10.1038/${nature}`), source });
  return result;
}

function attribute(tag: string, name: string): string {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i"));
  const value = match ? (match[1] ?? match[2] ?? match[3] ?? "") : "";
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
}

const DOI_META = new Set(["citation_doi", "dc.identifier.doi", "prism.doi", "bepress_citation_doi", "rft_id", "eprints.doi", "wkhealth_doi"]);
const GENERIC_IDENTIFIER_META = new Set(["dc.identifier", "dcterms.identifier", "citation_identifier"]);

/**
 * Page-level identifiers from an HTML document head. Body text is ignored on
 * purpose: references and "related article" links are not the page's identity.
 */
export function identifiersFromHTML(html: string, source: string): IdentifierCandidate[] {
  if (!html)
    return [];
  const headEnd = html.search(/<\/head\s*>|<body[\s>]/i);
  const head = html.slice(0, headEnd > 0 ? headEnd : HEAD_SCAN_CHARS);
  const result: IdentifierCandidate[] = [];
  const add = (kind: IdentifierCandidate["kind"], value: string) => {
    if (value && !result.some(candidate => candidate.kind === kind && candidate.value === value))
      result.push({ kind, value, source });
  };
  for (const [tag] of head.matchAll(/<meta\b[^>]*>/gi)) {
    const name = (attribute(tag, "name") || attribute(tag, "property")).toLowerCase();
    const content = attribute(tag, "content");
    if (!name || !content)
      continue;
    if (DOI_META.has(name)) {
      add("DOI", normalizeDOI(content));
    }
    else if (GENERIC_IDENTIFIER_META.has(name)) {
      if (/^(?:doi:|https?:\/\/(?:dx\.)?doi\.org\/|10\.\d{4,9}\/)/i.test(content))
        add("DOI", normalizeDOI(content));
    }
    else if (name === "citation_arxiv_id") {
      add("arXiv", normalizeArxiv(content));
    }
    else if (name === "citation_pmid" || name === "dc.identifier.pmid") {
      if (/^\d{1,9}$/.test(content))
        add("PMID", content);
    }
    else if (name === "citation_pmcid") {
      if (/^PMC\d{3,10}$/i.test(content))
        add("PMCID", content.toUpperCase());
    }
    else if (name === "og:url") {
      for (const candidate of identifiersFromURL(content, source))
        add(candidate.kind, candidate.value);
    }
  }
  for (const [tag] of head.matchAll(/<link\b[^>]*>/gi)) {
    if (!/\brel\s*=\s*["']?canonical\b/i.test(tag))
      continue;
    for (const candidate of identifiersFromURL(attribute(tag, "href"), source))
      add(candidate.kind, candidate.value);
  }
  return result;
}

async function readSnapshotHTML(item: Zotero.Item, signal?: AbortSignal): Promise<{ html: string; title: string }[]> {
  const pages: { html: string; title: string }[] = [];
  for (const id of item.getAttachments()) {
    signal?.throwIfAborted();
    const attachment = await Zotero.Items.getAsync(id);
    if (!attachment || attachment.deleted || attachment.attachmentContentType !== "text/html")
      continue;
    try {
      const path = await attachment.getFilePathAsync();
      if (!path || !await IOUtils.exists(path))
        continue;
      const html = new TextDecoder("utf-8").decode(await IOUtils.read(path, { maxBytes: HTML_READ_BYTES }));
      pages.push({ html, title: attachment.getDisplayTitle() });
    }
    catch {
      signal?.throwIfAborted();
    }
  }
  return pages;
}

async function readLiveHTML(url: string, signal?: AbortSignal): Promise<string> {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
      return "";
    const response = await requestGET(parsed.href, { responseType: "text", timeout: 15_000, headers: { Accept: "text/html,application/xhtml+xml" } } as any, signal);
    return String(response?.response || response?.responseText || "").slice(0, HTML_READ_BYTES);
  }
  catch {
    signal?.throwIfAborted();
    return "";
  }
}

function unique(candidates: IdentifierCandidate[]): IdentifierCandidate[] {
  return [...new Map(candidates.filter(candidate => candidate.value).map(candidate => [`${candidate.kind}:${candidate.value}`, candidate])).values()];
}

/**
 * Sniff explicit identifiers for a bare web snapshot: URL → stored HTML
 * snapshot → live page head. Stops at the first source that yields evidence.
 */
export async function discoverSnapshotIdentifiers(item: Zotero.Item, signal?: AbortSignal, options: { live?: boolean } = {}): Promise<IdentifierCandidate[]> {
  if (!isSnapshotItem(item))
    return [];
  const url = String(item.getField("url") || "").trim();
  const fromURL = url ? identifiersFromURL(url, getString("review-source-snapshot-url")) : [];
  if (fromURL.length)
    return unique(fromURL);
  const fromSnapshot: IdentifierCandidate[] = [];
  for (const page of await readSnapshotHTML(item, signal))
    fromSnapshot.push(...identifiersFromHTML(page.html, `${getString("review-source-snapshot-html")}: ${page.title}`));
  if (fromSnapshot.length)
    return unique(fromSnapshot);
  if (!url || options.live === false)
    return [];
  signal?.throwIfAborted();
  return unique(identifiersFromHTML(await readLiveHTML(url, signal), getString("review-source-snapshot-live")));
}

/** Decide the scholarly type a verified snapshot should become, if any. */
export function revivalTarget(itemType: string, candidate: TransformedData, identifier: IdentifierCandidate): _ZoteroTypes.Item.ItemType | undefined {
  if (!isSnapshotItem({ itemType }) || identifier.kind === "Title" || identifier.kind === "ISBN" || identifier.excerpt)
    return undefined;
  let type: string | undefined = candidate.itemType;
  if (!type || isSnapshotItem({ itemType: type })) {
    if (identifier.kind === "arXiv")
      type = "preprint";
    else if (candidate.publicationTitle && (candidate.volume || candidate.issue || candidate.pages || candidate.ISSN || candidate.DOI))
      type = "journalArticle";
    else
      return undefined;
  }
  return (REVIVAL_TARGET_TYPES as readonly string[]).includes(type) ? type as _ZoteroTypes.Item.ItemType : undefined;
}

/**
 * Turn a verified metadata proposal for a snapshot into a revival proposal.
 * Snapshot titles/dates are unreliable (encoding garbage, access dates), so
 * identity conflicts on those fields are recorded instead of blocking; a
 * contradictory identifier (`blocked`) still prevents any change.
 */
export function reviveProposal(proposal: ReviewProposal, itemType: string): ReviewProposal {
  if (proposal.blocked || proposal.preprintURL)
    return proposal;
  const target = revivalTarget(itemType, proposal.candidate, proposal.identifier);
  if (!target)
    return proposal;
  const candidate = { ...proposal.candidate, itemType: target };
  // Keep the captured page address: it is where the user actually found the work.
  const changes = reviewChanges(proposal.original, candidate, true)
    .filter(change => !(change.field === "url" && String(change.before ?? "").trim()));
  return { ...proposal, candidate, changes, conflicts: [], revival: { from: itemType, to: target, replaced: proposal.conflicts } };
}

/** Preserve every snapshot value that the target type cannot hold, plus provenance. */
export function revivalExtra(item: Zotero.Item, proposal: ReviewProposal, targetType: _ZoteroTypes.Item.ItemType): string {
  let extra = String(item.getField("extra") || "");
  const add = (line: string) => {
    if (!extra.split(/\r?\n/).includes(line))
      extra += `${extra ? "\n" : ""}${line}`;
  };
  add(`MetaFlow revived from: ${item.itemType}`);
  add(`MetaFlow revival identifier: ${proposal.identifier.kind} ${proposal.identifier.value}`);
  const original = String(proposal.original.title || "").trim();
  if (original && proposal.candidate.title && original !== proposal.candidate.title)
    add(`MetaFlow snapshot title: ${JSON.stringify(original)}`);
  for (const [field, value] of Object.entries(item.toJSON())) {
    if (typeof value === "string" && value && field !== "extra" && Zotero.ItemFields.getID(field) && !isFieldValidForItemType(field as _ZoteroTypes.Item.ItemField, targetType))
      add(`MetaFlow snapshot ${field}: ${JSON.stringify(value)}`);
  }
  return extra;
}
