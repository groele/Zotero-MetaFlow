import { hasEnabledJournalMetrics } from "../../utils/journal-permissions";
import { getPref } from "../../utils/prefs";
import { normalizeArxiv } from "../review/policy";
import { isSnapshotItem } from "../review/snapshot-reviver";

export function extractArxivID(item?: Zotero.Item): string | undefined {
  if (!item || !item.isRegularItem())
    return undefined;
  const doi = String(item.getField("DOI") || "");
  const url = String(item.getField("url") || "");
  const extra = String(item.getField("extra") || "");
  let archiveID = "";
  try {
    archiveID = String(item.getField("archiveID" as any) || "");
  }
  catch {
    archiveID = "";
  }
  for (const candidate of [doi, url, archiveID]) {
    const norm = normalizeArxiv(candidate);
    if (norm)
      return norm;
  }
  const allText = `${doi}\n${url}\n${extra}\n${archiveID}`;
  const match = allText.match(/(?:arxiv\.org\/(?:abs|pdf|html)\/|(?:doi:|https?:\/\/doi\.org\/)?10\.48550\/arxiv\.|arxiv:\s*)((?:\d{4}\.\d{4,5}|[a-z.-]+\/\d{7})(?:v\d+)?)/i);
  if (match)
    return match[1].toLowerCase();
  if (archiveID && /^(?:\d{4}\.\d{4,5}|[a-z.-]+\/\d{7})(?:v\d+)?$/i.test(archiveID.trim()))
    return archiveID.trim().toLowerCase();
  return undefined;
}

export function extractPreprintDOI(item?: Zotero.Item): string | undefined {
  if (!item || !item.isRegularItem())
    return undefined;
  const doi = String(item.getField("DOI") || "");
  const url = String(item.getField("url") || "");
  const extra = String(item.getField("extra") || "");
  const allText = `${doi}\n${url}\n${extra}`;
  const match = allText.match(/\b(10\.1101\/(?:\d{4}\.\d{2}\.\d{2}\.)?\d{6,8})(?:v\d+)?\b/i);
  return match ? match[1].toLowerCase() : undefined;
}

export function isUnconvertedArxivPreprint(item?: Zotero.Item): boolean {
  if (!item || !item.isRegularItem())
    return false;
  const arxivID = extractArxivID(item);
  if (!arxivID)
    return false;
  const extra = String(item.getField("extra") || "");
  if (extra.includes("MetaFlow preprint"))
    return false;
  if (item.itemType === "preprint")
    return true;
  const doi = String(item.getField("DOI") || "");
  const publication = String(item.getField(item.itemType === "conferencePaper" ? "proceedingsTitle" : "publicationTitle") || "").trim();
  const isArxivDOI = /^10\.48550\/arxiv\./i.test(doi);
  const isArxivPub = !publication || /^(?:arxiv|corr)(?:\.org)?$/i.test(publication) || publication.toLowerCase().includes("arxiv preprint");
  return isArxivDOI || isArxivPub;
}

export function isUnconvertedBiorxivPreprint(item?: Zotero.Item): boolean {
  if (!item || !item.isRegularItem())
    return false;
  const preprintDOI = extractPreprintDOI(item);
  if (!preprintDOI)
    return false;
  const extra = String(item.getField("extra") || "");
  if (extra.includes("MetaFlow preprint"))
    return false;
  if (item.itemType === "preprint")
    return true;
  const doi = String(item.getField("DOI") || "");
  const publication = String(item.getField(item.itemType === "conferencePaper" ? "proceedingsTitle" : "publicationTitle") || "").trim();
  const isBiorxivDOI = /^10\.1101\//.test(doi);
  const isBiorxivPub = !publication || /^(?:biorxiv|medrxiv)(?:\.org)?$/i.test(publication);
  return isBiorxivDOI || isBiorxivPub;
}

export function isUnrevivedSnapshot(item?: Zotero.Item): boolean {
  if (!item || !isSnapshotItem(item))
    return false;
  if (!getPref("workflow.reviveSnapshots" as any, true))
    return false;
  if (typeof item.getField === "function") {
    const extra = String(item.getField("extra") || "");
    if (extra.includes("MetaFlow revived from"))
      return false;
    const url = String(item.getField("url") || "").trim();
    if (url)
      return true;
  }
  if (typeof item.getAttachments === "function") {
    const atts = item.getAttachments();
    if (Array.isArray(atts) && atts.length > 0)
      return true;
  }
  return false;
}

export function supportsRankings(item?: Zotero.Item) {
  return Boolean(item?.isRegularItem() && ["journalArticle", "conferencePaper"].includes(item.itemType));
}

export function supportsSection(item?: Zotero.Item): boolean {
  return Boolean(
    item && getPref("insights.showPane", true) && (
      isUnconvertedArxivPreprint(item)
      || isUnconvertedBiorxivPreprint(item)
      || isUnrevivedSnapshot(item)
      || (supportsRankings(item) && hasEnabledJournalMetrics())
    ),
  );
}
