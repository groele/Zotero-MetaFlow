import type { ApplyContext } from "../rule-base";
import type { Identifiers } from "./identifiers";
import { getString } from "../../../utils/locale";
import { createLogger } from "../../../utils/logger";
import { getPref } from "../../../utils/prefs";
import { extractArxivID } from "../../journal-pane";
import { extractIdentifiers } from "./identifiers";
import { fetchPaperTLDR, parsePaperID } from "./services/semantic-scholar-service";

const logger = createLogger("tldr");

export interface TLDRBackfillOptions {
  target?: "note" | "extra" | "both" | "abstract";
  extraFormat?: "remark" | "tldr";
  report?: ApplyContext["report"];
  debug?: ApplyContext["debug"];
  signal?: AbortSignal;
}

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

export async function saveTLDRToNote(item: Zotero.Item, tldr: string): Promise<boolean> {
  if (typeof item.getNotes !== "function")
    return false;
  if (typeof item.isRegularItem === "function" && !item.isRegularItem())
    return false;

  const noteHtml = `<div data-metaflow-tldr="true"><p><strong>💡 撷论 (Semantic Scholar TL;DR)</strong></p><blockquote style="margin:8px 0;padding:8px 12px;border-left:3px solid #245ac7;background:rgba(36,90,199,0.06);line-height:1.6;">${escapeHTML(tldr)}</blockquote></div>`;

  const existing = findExistingTLDRNote(item);
  if (existing) {
    if (typeof existing.getNote === "function" && existing.getNote() === noteHtml)
      return false;
    if (typeof existing.setNote === "function") {
      existing.setNote(noteHtml);
      if (typeof existing.saveTx === "function")
        await existing.saveTx();
      return true;
    }
  }
  else if (typeof Zotero !== "undefined" && typeof Zotero.Item === "function") {
    const newNote = new Zotero.Item("note");
    newNote.libraryID = typeof item.libraryID === "number" ? item.libraryID : (Zotero.Libraries?.userLibraryID || 1);
    newNote.parentID = item.id;
    if ("parentItemID" in newNote)
      (newNote as any).parentItemID = item.id;
    newNote.setNote(noteHtml);
    if (typeof newNote.saveTx === "function")
      await newNote.saveTx();
    return true;
  }
  return false;
}

export function cleanseTLDRFromExtra(item: Zotero.Item): boolean {
  if (!item || typeof item.getField !== "function" || typeof item.setField !== "function")
    return false;
  const currentExtra = String(item.getField("extra") || "");
  const lines = currentExtra.split(/\r?\n/);
  const isMatch = (line: string) => /^(?:💡\s*)?(?:TL;?DR|撷论)\s*[:：]/i.test(line.trim());
  if (lines.some(isMatch)) {
    const filtered = lines.filter(line => !isMatch(line));
    item.setField("extra", filtered.join("\n"));
    return true;
  }
  return false;
}

export function saveTLDRToExtra(item: Zotero.Item, tldr: string, _format?: "remark" | "tldr"): boolean {
  if (typeof item.getField !== "function" || typeof item.setField !== "function")
    return false;
  const cleanTLDR = tldr.replace(/<[^>]+>/g, "").replace(/[\r\n]+/g, " ").trim();
  if (!cleanTLDR)
    return false;
  const currentExtra = String(item.getField("extra") || "");
  const lines = currentExtra.split(/\r?\n/);
  // 必须固定使用 TLDR: 前缀，与用户的个人简记 (remark:) 彻底解耦隔离
  const tldrLine = `TLDR: ${cleanTLDR}`;
  const isMatch = (line: string) => /^(?:💡\s*)?(?:TL;?DR|撷论)\s*[:：]/i.test(line.trim());
  const existingIndex = lines.findIndex(isMatch);
  let updatedExtra: string;
  if (existingIndex >= 0) {
    if (lines[existingIndex] === tldrLine && !lines.slice(existingIndex + 1).some(isMatch))
      return false;
    lines[existingIndex] = tldrLine;
    const deduplicated = lines.filter((line, idx) => idx === existingIndex || !isMatch(line));
    updatedExtra = deduplicated.join("\n");
  }
  else {
    updatedExtra = currentExtra.trim() ? `${tldrLine}\n${currentExtra.trim()}` : tldrLine;
  }
  item.setField("extra", updatedExtra);
  return true;
}

export function saveTLDRToAbstract(item: Zotero.Item, tldr: string): boolean {
  if (typeof item.getField !== "function" || typeof item.setField !== "function")
    return false;
  if (typeof item.isRegularItem === "function" && !item.isRegularItem())
    return false;
  const cleanTLDR = tldr.replace(/<[^>]+>/g, "").trim();
  if (!cleanTLDR)
    return false;
  const currentAbstract = String(item.getField("abstractNote") || "").trim();
  if (currentAbstract)
    return false;
  item.setField("abstractNote", cleanTLDR);
  return true;
}

export async function saveTLDRToItem(item: Zotero.Item, value: string): Promise<boolean> {
  if (!item || (typeof item.isRegularItem === "function" && !item.isRegularItem()))
    return false;
  const cleanTLDR = value.replace(/<[^>]+>/g, "").replace(/[\r\n]+/g, " ").trim();
  let changed = false;

  if (!cleanTLDR) {
    if (typeof item.getField === "function" && typeof item.setField === "function") {
      const currentExtra = String(item.getField("extra") || "");
      const lines = currentExtra.split(/\r?\n/);
      const isMatch = (line: string) => /^(?:💡\s*)?(?:TL;?DR|撷论)\s*[:：]/i.test(line.trim());
      if (lines.some(isMatch)) {
        const filtered = lines.filter(line => !isMatch(line));
        item.setField("extra", filtered.join("\n"));
        changed = true;
      }
    }
    const note = findExistingTLDRNote(item);
    if (note && typeof note.eraseTx === "function") {
      try {
        await note.eraseTx();
        changed = true;
      }
      catch (err) {
        logger.error("Failed to erase TLDR note:", err);
      }
    }
  }
  else {
    const target = typeof getPref === "function" ? getPref("workflow.tldrTarget" as any, "note") : "note";
    if (target === "note" || target === "both" || target === "abstract") {
      const noteSaved = await saveTLDRToNote(item, cleanTLDR);
      if (noteSaved)
        changed = true;
    }
    if (target === "extra" || target === "both") {
      const extraSaved = saveTLDRToExtra(item, cleanTLDR);
      if (extraSaved)
        changed = true;
    }
    else {
      const cleansed = cleanseTLDRFromExtra(item);
      if (cleansed)
        changed = true;
    }
  }

  if (changed && typeof item.saveTx === "function") {
    try {
      await item.saveTx();
    }
    catch (err) {
      logger.error("Failed to saveTx in saveTLDRToItem:", err);
    }
  }

  if (changed) {
    try {
      if (typeof Zotero !== "undefined" && Zotero.ItemTreeManager?.refreshColumns)
        Zotero.ItemTreeManager.refreshColumns();
      if (typeof Zotero !== "undefined" && Zotero.ItemPaneManager?.refreshInfoRow)
        Zotero.ItemPaneManager.refreshInfoRow("tldr");
    }
    catch {
      // Ignore in headless test contexts
    }
  }

  return changed;
}

export async function backfillItemTLDR(
  item: Zotero.Item,
  identifiers: Partial<Identifiers> = {},
  options: TLDRBackfillOptions = {},
): Promise<boolean> {
  if (typeof item.isRegularItem === "function" && !item.isRegularItem())
    return false;
  const target = options.target || "note";
  const debug = options.debug || (() => {});
  const report = options.report || (() => {});
  const signal = options.signal;

  const paperID = resolvePaperIDForTLDR(item, identifiers);
  if (!paperID) {
    debug("No valid identifier (DOI/arXiv/PMID) found for Semantic Scholar TL;DR lookup.");
    return false;
  }

  debug(`Fetching Semantic Scholar TL;DR for paper: ${paperID}`);
  let tldr: string | undefined;
  try {
    tldr = await fetchPaperTLDR(paperID, signal);
  }
  catch (error) {
    signal?.throwIfAborted();
    debug(`Semantic Scholar TL;DR lookup error: ${error}`);
    return false;
  }

  if (!tldr) {
    debug(`No TL;DR summary available on Semantic Scholar for ${paperID}`);
    return false;
  }

  let saved = false;

  if (target === "note" || target === "both" || target === "abstract") {
    const noteSaved = await saveTLDRToNote(item, tldr);
    if (noteSaved)
      saved = true;
  }

  if (target === "extra" || target === "both") {
    const extraSaved = saveTLDRToExtra(item, tldr, options.extraFormat);
    if (extraSaved)
      saved = true;
  }
  else {
    const cleansed = cleanseTLDRFromExtra(item);
    if (cleansed)
      saved = true;
  }

  if (target === "abstract") {
    const abstractSaved = saveTLDRToAbstract(item, tldr);
    if (abstractSaved)
      saved = true;
  }

  if (saved) {
    try {
      if (typeof Zotero !== "undefined" && Zotero.ItemTreeManager?.refreshColumns)
        Zotero.ItemTreeManager.refreshColumns();
      if (typeof Zotero !== "undefined" && Zotero.ItemPaneManager?.refreshInfoRow)
        Zotero.ItemPaneManager.refreshInfoRow("tldr");
    }
    catch {
      // Ignore in headless test contexts
    }
    const targetLabel = getString(`metadata-tldr-target-${target}` as any) || target;
    report({
      level: "info",
      code: "metadata-tldr-extracted",
      message: getString("rule-tool-update-metadata-tldr-saved", { args: { target: targetLabel } }) || `已提取并回填 Semantic Scholar TL;DR 核心论点（${targetLabel}）`,
    });
  }

  return saved;
}
