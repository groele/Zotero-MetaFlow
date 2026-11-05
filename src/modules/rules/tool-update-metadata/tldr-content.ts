import type { Identifiers } from "./identifiers";
import { extractArxivID } from "../../journal-pane";
import { extractIdentifiers } from "./identifiers";
import { parsePaperID } from "./services/semantic-scholar-service";

export function escapeHTML(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function unescapeHTML(str: string): string {
  return str
    .replace(/&quot;/g, "\"")
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function extractTLDRFromExtra(extra: string): string | undefined {
  if (!extra)
    return undefined;
  for (const line of extra.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (/^(?:💡\s*)?(?:TL;?DR|撷论)\s*[:：]/i.test(trimmed)) {
      const colonMatch = trimmed.match(/[:：]/);
      if (colonMatch && typeof colonMatch.index === "number") {
        const val = trimmed.slice(colonMatch.index + 1).trim();
        if (val)
          return val;
      }
    }
  }
  return undefined;
}

export function extractTLDRFromNote(noteContent: string): string | undefined {
  if (!noteContent)
    return undefined;
  if (
    !noteContent.includes("data-metaflow-tldr")
    && !noteContent.includes("TL;DR (Semantic Scholar)")
    && !noteContent.includes("TL;DR 核心论点")
    && !noteContent.includes("撷论")
    && !/<(?:h[1-6]|strong|b|p)[^>]*>\s*(?:💡\s*)?(?:TL;?DR|撷论)/i.test(noteContent)
    && !/^(?:💡\s*)?(?:TL;?DR|撷论)\s*[:：]/i.test(noteContent.trim())
  ) {
    return undefined;
  }

  const bqMatch = noteContent.match(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/i);
  if (bqMatch)
    return unescapeHTML(bqMatch[1].replace(/<[^>]+>/g, "").trim());

  const pMatch = noteContent.match(/<p[^>]*>([\s\S]*?)<\/p>/gi);
  if (pMatch && pMatch.length > 1)
    return unescapeHTML(pMatch[pMatch.length - 1].replace(/<[^>]+>/g, "").trim());

  const plain = noteContent.replace(/<[^>]+>/g, "").replace(/(?:💡\s*)?(?:TL;?DR|撷论)[^\n:：]*[:：]\s*/i, "").trim();
  return unescapeHTML(plain);
}

export function extractTLDRFromItem(item: Zotero.Item): string | undefined {
  if (!item)
    return undefined;
  if (typeof item.isRegularItem === "function" && !item.isRegularItem())
    return undefined;
  if (typeof item.getNotes === "function" && typeof Zotero !== "undefined" && Zotero.Items?.get) {
    const noteIDs = item.getNotes();
    let fallbackNote: string | undefined;
    for (const id of noteIDs) {
      const note = Zotero.Items.get(id);
      if (note && !note.deleted && typeof note.getNote === "function") {
        const rawNote = note.getNote();
        if (rawNote.includes("data-metaflow-tldr") || rawNote.includes("Semantic Scholar")) {
          const fromNote = extractTLDRFromNote(rawNote);
          if (fromNote)
            return fromNote;
        }
        else if (!fallbackNote) {
          const fromNote = extractTLDRFromNote(rawNote);
          if (fromNote)
            fallbackNote = fromNote;
        }
      }
    }
    if (fallbackNote)
      return fallbackNote;
  }
  if (typeof item.getField === "function") {
    const extra = String(item.getField("extra") || "");
    const fromExtra = extractTLDRFromExtra(extra);
    if (fromExtra)
      return fromExtra;
  }
  return undefined;
}

export function resolvePaperIDForTLDR(item: Zotero.Item, identifiers?: Partial<Identifiers>): string | undefined {
  if (identifiers?.SemanticScholarID)
    return parsePaperID("SemanticScholarID", identifiers.SemanticScholarID);
  if (identifiers?.DOI)
    return parsePaperID("DOI", identifiers.DOI);
  if (identifiers?.arXiv)
    return parsePaperID("arXiv", identifiers.arXiv);
  if (identifiers?.PMID)
    return parsePaperID("PMID", identifiers.PMID);
  if (identifiers?.PMCID)
    return parsePaperID("PMCID", identifiers.PMCID);

  if (item && typeof item.getField === "function") {
    try {
      const extracted = extractIdentifiers(item);
      if (extracted.SemanticScholarID)
        return parsePaperID("SemanticScholarID", extracted.SemanticScholarID);
      if (extracted.DOI)
        return parsePaperID("DOI", extracted.DOI);
      if (extracted.arXiv)
        return parsePaperID("arXiv", extracted.arXiv);
      if (extracted.PMID)
        return parsePaperID("PMID", extracted.PMID);
      if (extracted.PMCID)
        return parsePaperID("PMCID", extracted.PMCID);
    }
    catch {
      // Fallback to basic field access if extractIdentifiers throws
    }

    const doi = String(item.getField("DOI") || "").trim();
    if (doi)
      return parsePaperID("DOI", doi);

    const arxiv = extractArxivID(item);
    if (arxiv)
      return parsePaperID("arXiv", arxiv);
  }

  return undefined;
}

export function findExistingTLDRNote(item: Zotero.Item): Zotero.Item | null {
  if (typeof item.getNotes !== "function" || typeof Zotero === "undefined" || !Zotero.Items?.get)
    return null;
  const noteIDs = item.getNotes();
  for (const id of noteIDs) {
    const note = Zotero.Items.get(id);
    if (note && !note.deleted && typeof note.getNote === "function") {
      const content = String(note.getNote() || "");
      if (
        content.includes("data-metaflow-tldr")
        || content.includes("TL;DR (Semantic Scholar)")
        || content.includes("TL;DR 核心论点")
        || content.includes("撷论")
        || /<(?:h[1-6]|strong|b|p)[^>]*>\s*(?:💡\s*)?(?:TL;?DR|撷论)(?:\s*\([^)]*\))?\s*[:：<]/i.test(content)
      ) {
        return note;
      }
    }
  }
  return null;
}
