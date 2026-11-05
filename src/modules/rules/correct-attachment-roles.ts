import { getString } from "../../utils/locale";
import { getPref } from "../../utils/prefs";
import { classifyAttachment, extractParentItemMetadata, formatAttachmentFilename, formatAttachmentItemTitle } from "./attachment-role-policy";

import { defineRule } from "./rule-base";

export * from "./attachment-role-policy";

export const CorrectAttachmentRoles = defineRule({
  id: "correct-attachment-roles",
  scope: "item",
  category: "rule",

  async apply({ item, report, debug, signal }) {
    signal?.throwIfAborted();
    // Check master switch in preferences
    const isEnabled = getPref("rule.correct-attachment-roles" as any, false);
    if (!isEnabled)
      return;

    // Read-only / Trash safety guard
    if (item.deleted || (typeof item.isEditable === "function" && !item.isEditable())) {
      debug("Skipping deleted or read-only item in correct-attachment-roles");
      return;
    }

    if (typeof item.isRegularItem === "function" && !item.isRegularItem())
      return;

    if (typeof item.getAttachments !== "function")
      return;

    const attachmentIDs = item.getAttachments();
    if (!Array.isArray(attachmentIDs) || attachmentIDs.length === 0)
      return;

    const parentMeta = extractParentItemMetadata(item);
    const renamePdf = getPref("rule.correct-attachment-roles.renamePdf" as any, true);
    const syncTitle = getPref("rule.correct-attachment-roles.syncTitle" as any, true);

    const attachments: Zotero.Item[] = [];
    for (const id of attachmentIDs) {
      signal?.throwIfAborted();
      try {
        const att = typeof Zotero.Items.getAsync === "function"
          ? await Zotero.Items.getAsync(id)
          : Zotero.Items.get(id);
        signal?.throwIfAborted();
        if (
          att
          && !att.deleted
          && (typeof att.isEditable !== "function" || att.isEditable())
          && typeof att.isAttachment === "function"
          && att.isAttachment()
        ) {
          // Check if PDF
          const ct = (att.attachmentContentType || "").toLowerCase();
          const fn = (att.attachmentFilename || "").toLowerCase();
          if (ct === "application/pdf" || fn.endsWith(".pdf")) {
            attachments.push(att);
          }
        }
      }
      catch (e) {
        debug(`Failed to retrieve attachment ${id}:`, e);
      }
    }

    if (attachments.length === 0)
      return;

    let mainIndex = 0;
    let supplementIndex = 0;
    const modifiedSummaries: string[] = [];

    for (const att of attachments) {
      signal?.throwIfAborted();
      const writable = () => !item.deleted && !(item as any).inTrash
        && (typeof item.isEditable !== "function" || item.isEditable())
        && !att.deleted && !(att as any).inTrash
        && (typeof att.isEditable !== "function" || att.isEditable());
      if (!writable())
        continue;
      const filename = att.attachmentFilename || "";
      let headText = "";

      // 1. Try Zotero.PDFWorker (page-accurate extraction in Zotero 7+)
      try {
        if (typeof (Zotero as any).PDFWorker?.getFullText === "function") {
          const res = await (Zotero as any).PDFWorker.getFullText(att.id, 2);
          signal?.throwIfAborted();
          if (res?.text)
            headText = String(res.text);
        }
      }
      catch {
        // Fall back to attachmentText
      }

      // 2. Fallback to indexed full text
      if (!headText) {
        try {
          if ("attachmentText" in att) {
            const indexed = await (att as any).attachmentText;
            signal?.throwIfAborted();
            if (indexed)
              headText = String(indexed).slice(0, 4000);
          }
        }
        catch {
          // Ignore
        }
      }

      signal?.throwIfAborted();
      if (!writable())
        continue;
      const classification = classifyAttachment(filename, headText, parentMeta);
      if (classification.role === "other")
        continue;

      if (classification.role === "main_pdf")
        mainIndex += 1;
      else if (classification.role === "supplement")
        supplementIndex += 1;

      const roleIndex = classification.role === "main_pdf" ? mainIndex : supplementIndex;

      let changed = false;

      // Rename the file before mutating the title so cancellation cannot leave a staged title behind.
      if (renamePdf) {
        try {
          const template = getPref("rule.correct-attachment-roles.template" as any, "{author}_{year}_{title}_{role}");
          const newFilename = formatAttachmentFilename(
            parentMeta,
            classification.role,
            roleIndex,
            template,
          );
          if (newFilename && newFilename !== filename && typeof (att as any).renameAttachmentFile === "function") {
            signal?.throwIfAborted();
            if (!writable())
              continue;
            const renameOk = await (att as any).renameAttachmentFile(newFilename);
            signal?.throwIfAborted();
            if (renameOk)
              changed = true;
          }
        }
        catch (e) {
          debug(`Failed to rename attachment file for ${att.id}:`, e);
        }
      }

      signal?.throwIfAborted();
      if (!writable())
        continue;
      // Sync title only after extraction/renaming and the final eligibility check.
      if (syncTitle) {
        try {
          const currentTitle = typeof att.getField === "function" ? (att.getField("title") as string) : "";
          const newTitle = formatAttachmentItemTitle(
            currentTitle,
            parentMeta.title || "",
            classification.role,
            roleIndex,
          );
          if (newTitle && newTitle !== currentTitle) {
            att.setField("title", newTitle);
            changed = true;
          }
        }
        catch (e) {
          debug(`Failed to set attachment title for ${att.id}:`, e);
        }
      }

      if (changed) {
        try {
          if (typeof att.saveTx === "function")
            await att.saveTx({ skipSelect: true });
          signal?.throwIfAborted();
          const roleLabel = classification.role === "main_pdf"
            ? (mainIndex > 1 ? `正文 (Manuscript ${mainIndex})` : "正文 (Manuscript)")
            : `补充材料 (SI ${supplementIndex})`;
          modifiedSummaries.push(roleLabel);
        }
        catch (e) {
          debug(`Failed to save attachment ${att.id}:`, e);
        }
      }
    }

    if (modifiedSummaries.length > 0) {
      report({
        level: "info",
        message: getString("rule-correct-attachment-roles-report-message", {
          args: { summary: modifiedSummaries.join(", ") },
        }),
      });
    }
  },
});
