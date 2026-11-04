import { getString } from "../../utils/locale";
import { getPref } from "../../utils/prefs";
import { defineRule } from "./rule-base";

export type AttachmentRole = "main_pdf" | "supplement" | "other";

export interface AttachmentClassificationResult {
  role: AttachmentRole;
  confidence: number;
  evidence: string[];
}

export interface ParentItemMetadata {
  title?: string;
  doi?: string;
  publicationTitle?: string;
  journalAbbreviation?: string;
  firstAuthorLastName?: string;
  year?: string;
}

/**
 * Supplementary Information (SI) filename patterns.
 * Derived from real-world scientific publishers (Nature, Science, Wiley, ACS, RSC, Springer, Elsevier).
 */
export const SUPPLEMENT_FILENAME_RE = new RegExp(
  [
    "(?:^|[._\\-\\s])supp(?:lement(?:ary)?)?(?:[._\\-\\s]|$)",
    "(?:^|[._\\-\\s])suppinfo(?:[._\\-\\s]|$)",
    "(?:^|[._\\-\\s])supporting[._\\-\\s]*information(?:[._\\-\\s]|$)",
    "(?:^|[._\\-\\s])supplementary[._\\-\\s]*(?:information|materials?|data|file|methods?|appendix)(?:[._\\-\\s]|$)",
    "(?:^|[._\\-\\s])(?:esi|esm|moesm)(?:[._\\-\\s]|$)",
    "(?:^|[._\\-\\s])si(?:[._\\-\\s]|$)",
    "(?:^|[._\\-\\s])sm(?:[._\\-\\s]|$)",
    "\\u8865\\u5145(?:\\u6750\\u6599|\\u4FE1\\u606F|\\u8BF4\\u660E|\\u6570\\u636E)",
    "\\u652F\\u6301\\u4FE1\\u606F",
  ].join("|"),
  "i",
);

/**
 * Supplementary figures and tables regex, e.g. "Figure S1", "Table S2", "Scheme S1".
 */
export const SUPPLEMENT_FIGURE_RE = /\b(?:fig(?:ure)?|table|scheme|movie|video|dataset|appendix)\s*S\d+[a-z]?\b/i;

/**
 * Supplementary headings in the first pages of PDF text.
 */
export const SUPPLEMENT_HEADING_RE = new RegExp(
  [
    "(?:^|[\\r\\n])\\s*supplementary\\s+(?:information|materials?|methods?|figures?|tables?|appendix)\\s*[:\\uFF1A]?(?=\\s|$)",
    "(?:^|[\\r\\n])\\s*supplemental\\s+(?:information|materials?|methods?|figures?|tables?)\\s*[:\\uFF1A]?(?=\\s|$)",
    "(?:^|[\\r\\n])\\s*supporting\\s+information\\s*[:\\uFF1A]?(?=\\s|$)",
    "(?:^|[\\r\\n])\\s*(?:\\u8865\\u5145(?:\\u6750\\u6599|\\u4FE1\\u606F|\\u8BF4\\u660E|\\u6570\\u636E)|\\u652F\\u6301\\u4FE1\\u606F)\\b",
  ].join("|"),
  "i",
);

/**
 * Main manuscript markers in the first pages of text.
 */
export const MAIN_METADATA_RE = /\b(?:received|accepted|published|correspondence|copyright|volume|issue|abstract|keywords)\b|收稿日期|通讯作者|中图分类号|摘要|关键词/i;

/** Windows reserved device names */
const RESERVED_DEVICE_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

/** Illegal characters in Windows and cross-platform file paths */
const ILLEGAL_PATH_CHARS = /[<>:"/\\|?*]/g;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1F\x7F]/g;
const MAX_COMPONENT_LEN = 80;
const MAX_FILENAME_BYTES = 240;

export function utf8ByteLength(input: string): number {
  let bytes = 0;
  for (const ch of input || "") {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp <= 0x7F)
      bytes += 1;
    else if (cp <= 0x7FF)
      bytes += 2;
    else if (cp <= 0xFFFF)
      bytes += 3;
    else
      bytes += 4;
  }
  return bytes;
}

export function truncateUtf8(input: string, maxBytes: number): string {
  let out = "";
  let bytes = 0;
  for (const ch of input || "") {
    const cp = ch.codePointAt(0) ?? 0;
    const size = cp <= 0x7F ? 1 : cp <= 0x7FF ? 2 : cp <= 0xFFFF ? 3 : 4;
    if (bytes + size > maxBytes)
      break;
    out += ch;
    bytes += size;
  }
  return out;
}

export function sanitizeComponent(input: unknown, fallback = "Untitled", maxLen = MAX_COMPONENT_LEN): string {
  let s = String(input ?? "");
  s = s.replace(/[\r\n\t]+/g, " ");
  s = s.replace(ILLEGAL_PATH_CHARS, " ");
  s = s.replace(CONTROL_CHARS, "");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/^[.\s]+/, "").replace(/[.\s]+$/, "");

  if (!s)
    s = fallback;

  if (RESERVED_DEVICE_NAMES.has(s.toUpperCase()))
    s = `_${s}`;

  if (maxLen > 0 && s.length > maxLen)
    s = s.slice(0, maxLen).replace(/[.\s]+$/, "");

  return s;
}

export function normalizeForMatch(input: unknown): string {
  return String(input ?? "")
    .toLowerCase()
    .replace(/[.,:;()[\]{}'"`]/g, " ")
    .replace(/[，。；：！？、（）《》【】“”‘’]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Classify a PDF attachment based on filename, extracted text, and parent metadata.
 */
export function classifyAttachment(
  filename: string,
  headText: string,
  parentMeta: ParentItemMetadata = {},
): AttachmentClassificationResult {
  const normFilename = normalizeForMatch(filename);
  const normText = normalizeForMatch(headText);

  let suppScore = 0;
  let mainScore = 0;
  const evidence: string[] = [];

  // 1. Filename heuristic for SI
  if (SUPPLEMENT_FILENAME_RE.test(filename) || SUPPLEMENT_FILENAME_RE.test(normFilename)) {
    suppScore += 7;
    evidence.push("filename-supplement");
  }

  // 2. Text heading heuristic for SI
  if (headText && SUPPLEMENT_HEADING_RE.test(headText)) {
    suppScore += 8;
    evidence.push("heading-supplement");
  }

  // 3. Text figure/table S1..Sn heuristic
  if (headText && SUPPLEMENT_FIGURE_RE.test(headText)) {
    suppScore += 4;
    evidence.push("figure-supplement");
  }

  // 4. Main article signals
  if (parentMeta.doi && (headText.includes(parentMeta.doi) || normText.includes(normalizeForMatch(parentMeta.doi)))) {
    mainScore += 5;
    evidence.push("parent-doi");
  }

  const pubTitle = parentMeta.publicationTitle || parentMeta.journalAbbreviation;
  if (pubTitle && pubTitle.length >= 4 && normText.includes(normalizeForMatch(pubTitle))) {
    mainScore += 3;
    evidence.push("parent-journal");
  }

  const title = parentMeta.title;
  if (title) {
    const normTitle = normalizeForMatch(title);
    const minLen = /[\u3400-\u9FFF]/.test(title) ? 6 : 14;
    if (normTitle.length >= minLen && normText.includes(normTitle)) {
      mainScore += 6;
      evidence.push("parent-title");
    }
    else {
      // Check significant title prefix (first 3+ significant words)
      const words = normTitle.split(/\s+/).filter(w => w.length >= 3);
      if (words.length >= 3) {
        const prefix = words.slice(0, 3).join(" ");
        if (prefix.length >= 10 && normText.includes(prefix)) {
          mainScore += 5;
          evidence.push("parent-title");
        }
      }
    }
  }

  if (headText && MAIN_METADATA_RE.test(headText)) {
    mainScore += 3;
    evidence.push("article-meta");
  }

  // Main filename heuristic
  if (/(?:^|[._\-\s])(?:main|manuscript|article|paper|正文|主文档)(?:[._\-\s]|$)/i.test(filename)) {
    mainScore += 5;
    evidence.push("filename-main");
  }

  // Decision logic
  if (suppScore >= 6 && (suppScore >= mainScore || evidence.includes("heading-supplement") || evidence.includes("filename-supplement"))) {
    return {
      role: "supplement",
      confidence: suppScore,
      evidence,
    };
  }

  if (mainScore >= 5 && suppScore < 6) {
    return {
      role: "main_pdf",
      confidence: mainScore,
      evidence,
    };
  }

  return {
    role: "other",
    confidence: Math.max(suppScore, mainScore),
    evidence,
  };
}

/**
 * Format a safe, sanitized filename from parent metadata and assigned role.
 */
export function formatAttachmentFilename(
  parentMeta: ParentItemMetadata,
  role: AttachmentRole,
  index = 1,
  template = "{author}_{year}_{title}_{role}",
): string {
  const author = sanitizeComponent(parentMeta.firstAuthorLastName, "Unknown", 40);
  const year = sanitizeComponent(parentMeta.year, "0000", 10);
  const title = sanitizeComponent(parentMeta.title, "Untitled", 80);

  let roleTag = "Other";
  if (role === "main_pdf")
    roleTag = index > 1 ? `Main__${index}` : "Main";
  else if (role === "supplement")
    roleTag = index > 1 ? `Supplement__${index}` : "Supplement";

  let stem = (template || "{author}_{year}_{title}_{role}")
    .replace(/\{author\}/gi, author)
    .replace(/\{year\}/gi, year)
    .replace(/\{title\}/gi, title)
    .replace(/\{role\}/gi, roleTag);

  stem = sanitizeComponent(stem, `${author}_${year}_${title}_${roleTag}`, 180);

  const ext = ".pdf";
  const budget = Math.max(1, MAX_FILENAME_BYTES - utf8ByteLength(ext));
  const fitted = truncateUtf8(stem, budget).replace(/[.\s]+$/, "");

  return `${fitted}${ext}`;
}

/**
 * Format a human-readable title for display in the Zotero attachment item tree.
 */
export function formatAttachmentItemTitle(
  originalTitle: string,
  parentTitle: string,
  role: AttachmentRole,
  index = 1,
): string {
  const baseTitle = parentTitle || originalTitle || "PDF";
  // Remove existing [正文] / [补充材料] / [Main] / [Supplement] prefixes to prevent compounding
  const cleanBase = baseTitle.replace(/^\[(?:正文(?:\s*\d+)?|主手稿(?:\s*\d+)?|补充材料(?:\s*\d+)?|Main(?:\s*\d+)?|Supplement(?:\s*\d+)?)\]\s*/i, "").trim();

  if (role === "main_pdf")
    return index > 1 ? `[正文 ${index}] ${cleanBase}` : `[正文] ${cleanBase}`;
  if (role === "supplement")
    return index > 1 ? `[补充材料 ${index}] ${cleanBase}` : `[补充材料] ${cleanBase}`;

  return cleanBase;
}

export function extractParentItemMetadata(item: Zotero.Item): ParentItemMetadata {
  const title = (typeof item.getField === "function" ? item.getField("title") : "") as string;
  const doi = (typeof item.getField === "function" ? item.getField("DOI") : "") as string;
  const publicationTitle = (typeof item.getField === "function" ? item.getField("publicationTitle") : "") as string;
  const journalAbbreviation = (typeof item.getField === "function" ? item.getField("journalAbbreviation") : "") as string;
  const date = (typeof item.getField === "function" ? item.getField("date") : "") as string;

  let year = "";
  const yearMatch = /\b(\d{4})\b/.exec(date || "");
  if (yearMatch)
    year = yearMatch[1];

  let firstAuthorLastName = "";
  try {
    if (typeof item.getCreators === "function") {
      const creators = item.getCreators();
      if (Array.isArray(creators) && creators.length > 0) {
        const first = creators[0];
        firstAuthorLastName = first.lastName || (first as any).name || "";
      }
    }
  }
  catch {
    // Ignore creator lookup failure
  }

  return {
    title,
    doi,
    publicationTitle,
    journalAbbreviation,
    firstAuthorLastName,
    year,
  };
}

export const CorrectAttachmentRoles = defineRule({
  id: "correct-attachment-roles",
  scope: "item",
  category: "rule",

  async apply({ item, report, debug }) {
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
      try {
        const att = typeof Zotero.Items.getAsync === "function"
          ? await Zotero.Items.getAsync(id)
          : Zotero.Items.get(id);
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
      const filename = att.attachmentFilename || "";
      let headText = "";

      // 1. Try Zotero.PDFWorker (page-accurate extraction in Zotero 7+)
      try {
        if (typeof (Zotero as any).PDFWorker?.getFullText === "function") {
          const res = await (Zotero as any).PDFWorker.getFullText(att.id, 2);
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
            if (indexed)
              headText = String(indexed).slice(0, 4000);
          }
        }
        catch {
          // Ignore
        }
      }

      const classification = classifyAttachment(filename, headText, parentMeta);
      if (classification.role === "other")
        continue;

      if (classification.role === "main_pdf")
        mainIndex += 1;
      else if (classification.role === "supplement")
        supplementIndex += 1;

      const roleIndex = classification.role === "main_pdf" ? mainIndex : supplementIndex;

      let changed = false;

      // 1. Sync title in Zotero item tree
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

      // 2. Rename PDF file safely
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
            const renameOk = await (att as any).renameAttachmentFile(newFilename);
            if (renameOk)
              changed = true;
          }
        }
        catch (e) {
          debug(`Failed to rename attachment file for ${att.id}:`, e);
        }
      }

      if (changed) {
        try {
          if (typeof att.saveTx === "function")
            await att.saveTx();
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
