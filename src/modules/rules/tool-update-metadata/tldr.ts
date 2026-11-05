import type { ApplyContext } from "../rule-base";
import type { Identifiers } from "./identifiers";
import { redrawItemValues } from "../../../utils/item-value-refresh";
import { isTrashedItem } from "../../../utils/item-write-policy";
import { getString } from "../../../utils/locale";
import { createLogger } from "../../../utils/logger";
import { getPref } from "../../../utils/prefs";
import { fetchPaperTLDR } from "./services/semantic-scholar-service";

import { escapeHTML, extractTLDRFromNote, findExistingTLDRNote, resolvePaperIDForTLDR } from "./tldr-content";

export * from "./tldr-content";

const logger = createLogger("tldr");

export interface TLDRBackfillOptions {
  target?: "note" | "extra" | "both" | "abstract";
  extraFormat?: "remark" | "tldr";
  report?: ApplyContext["report"];
  debug?: ApplyContext["debug"];
  signal?: AbortSignal;
}

export async function saveTLDRToNote(item: Zotero.Item, tldr: string, signal?: AbortSignal): Promise<boolean> {
  signal?.throwIfAborted();
  if (!item || isTrashedItem(item))
    return false;
  if (typeof item.isEditable === "function" && !item.isEditable())
    return false;
  if (typeof item.getNotes !== "function")
    return false;
  if (typeof item.isRegularItem === "function" && !item.isRegularItem())
    return false;

  const noteHtml = `<div data-metaflow-tldr="true"><p><strong>💡 撷论 (Semantic Scholar TL;DR)</strong></p><blockquote style="margin:8px 0;padding:8px 12px;border-left:3px solid #245ac7;background:rgba(36,90,199,0.06);line-height:1.6;">${escapeHTML(tldr)}</blockquote></div>`;

  const existing = findExistingTLDRNote(item);
  if (existing) {
    if (existing.deleted || (existing as any).inTrash || (typeof existing.isEditable === "function" && !existing.isEditable()))
      return false;
    if (typeof existing.getNote === "function" && existing.getNote() === noteHtml)
      return false;
    if (typeof existing.setNote === "function") {
      const original = existing.getNote();
      existing.setNote(noteHtml);
      try {
        if (typeof existing.saveTx === "function")
          await existing.saveTx({ skipSelect: true });
      }
      catch (error) {
        if (existing.getNote() === noteHtml)
          existing.setNote(original);
        throw error;
      }
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
      await newNote.saveTx({ skipSelect: true });
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
  if (!item || isTrashedItem(item) || (typeof item.isRegularItem === "function" && !item.isRegularItem()))
    return false;
  if (typeof item.isEditable === "function" && !item.isEditable())
    return false;
  const cleanTLDR = value.replace(/<[^>]+>/g, "").replace(/[\r\n]+/g, " ").trim();
  const originalExtra = String(item.getField("extra") || "");
  let changed = false;

  if (!cleanTLDR) {
    const originalExtra = String(item.getField("extra") || "");
    const note = findExistingTLDRNote(item);
    if (note && (isTrashedItem(note) || (typeof note.isEditable === "function" && !note.isEditable())))
      return false;
    if (note && typeof note.eraseTx === "function") {
      await note.eraseTx();
      changed = true;
    }
    if (isTrashedItem(item) || (typeof item.isEditable === "function" && !item.isEditable()) || String(item.getField("extra") || "") !== originalExtra)
      return changed;
    changed = cleanseTLDRFromExtra(item) || changed;
  }
  else {
    const target = typeof getPref === "function" ? getPref("workflow.tldrTarget" as any, "note") : "note";
    const existing = findExistingTLDRNote(item);
    if (target !== "extra" && existing && (isTrashedItem(existing) || (typeof existing.isEditable === "function" && !existing.isEditable())))
      return false;
    if (target === "note" || target === "both" || target === "abstract") {
      const noteSaved = await saveTLDRToNote(item, cleanTLDR);
      if (noteSaved)
        changed = true;
    }
    if (isTrashedItem(item) || (typeof item.isEditable === "function" && !item.isEditable()))
      return changed;
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
    const stagedExtra = String(item.getField("extra") || "");
    try {
      await item.saveTx({ skipSelect: true });
    }
    catch (err) {
      if (String(item.getField("extra") || "") === stagedExtra)
        item.setField("extra", originalExtra);
      logger.error("Failed to saveTx in saveTLDRToItem:", err);
      throw err;
    }
  }

  if (changed) {
    try {
      await redrawItemValues([item.id]);
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
  if (!item || isTrashedItem(item) || (typeof item.isRegularItem === "function" && !item.isRegularItem()))
    return false;
  if (typeof item.isEditable === "function" && !item.isEditable())
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
    signal?.throwIfAborted();
  }
  catch (error) {
    signal?.throwIfAborted();
    debug(`Semantic Scholar TL;DR lookup error: ${error}`);
    return false;
  }

  if (isTrashedItem(item) || (typeof item.isEditable === "function" && !item.isEditable()))
    return false;

  if (!tldr) {
    debug(`No TL;DR summary available on Semantic Scholar for ${paperID}`);
    return false;
  }

  let saved = false;
  let durableNote = false;

  if (target === "note" || target === "both" || target === "abstract") {
    const noteSaved = await saveTLDRToNote(item, tldr, signal);
    signal?.throwIfAborted();
    const existing = findExistingTLDRNote(item);
    durableNote = noteSaved || Boolean(existing && extractTLDRFromNote(existing.getNote()) === tldr);
    if (noteSaved)
      saved = true;
  }

  signal?.throwIfAborted();
  if (isTrashedItem(item) || (typeof item.isEditable === "function" && !item.isEditable()))
    return saved;

  if (target === "extra" || target === "both") {
    const extraSaved = saveTLDRToExtra(item, tldr, options.extraFormat);
    if (extraSaved)
      saved = true;
  }
  else if (durableNote) {
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
      await redrawItemValues([item.id]);
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
