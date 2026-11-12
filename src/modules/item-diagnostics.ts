import { getString } from "../utils/locale";
import { isFieldValidForItemType } from "../utils/zotero";
import { isPlaceholderCreator } from "./review/policy";
import { extractDOIFromUrl } from "./rules/tool-update-metadata/identifiers";
import { sanitizeWebTitle } from "./rules/tool-update-metadata/policy";

export interface ItemDefect {
  code: string;
  level: "error" | "warning" | "suggestion";
  field?: string;
  message: string;
  fixable: boolean;
  fixAction?: "update" | "format";
}

export function inspectItemDefects(item: Zotero.Item): ItemDefect[] {
  const defects: ItemDefect[] = [];
  if (!item || !item.isRegularItem() || item.deleted)
    return defects;

  const itemType = item.itemType;
  const safeGet = (field: string) => {
    try {
      if (typeof Zotero !== "undefined" && Zotero.ItemFields && typeof isFieldValidForItemType === "function") {
        if (!isFieldValidForItemType(field as any, itemType))
          return "";
      }
      return String(item.getField(field) || "").trim();
    }
    catch {
      return "";
    }
  };

  const title = safeGet("title");
  const extraDOI = typeof ztoolkit !== "undefined" && ztoolkit.ExtraField ? ztoolkit.ExtraField.getExtraField(item, "DOI") : "";
  const rawDOI = safeGet("DOI") || String(extraDOI || "").trim();
  const urlDOI = extractDOIFromUrl(safeGet("url")) || "";
  const creators = item.getCreators?.() || [];
  const publication = safeGet("publicationTitle");
  const date = safeGet("date");
  const volume = safeGet("volume");
  const issue = safeGet("issue");
  const pages = safeGet("pages");
  const abstractNote = safeGet("abstractNote");

  // 1. Missing DOI on scholarly items
  if (["journalArticle", "preprint"].includes(itemType) && !rawDOI) {
    defects.push({
      code: "missing-doi",
      level: "warning",
      field: "DOI",
      message: urlDOI
        ? getString("diag-missing-doi-url", { args: { doi: urlDOI } })
        : getString("diag-missing-doi"),
      fixable: true,
      fixAction: "update",
    });
  }

  // 2. Non-standard DOI format
  if (rawDOI && (rawDOI.startsWith("http") || /^doi:/i.test(rawDOI))) {
    defects.push({
      code: "non-standard-doi",
      level: "suggestion",
      field: "DOI",
      message: getString("diag-non-standard-doi"),
      fixable: true,
      fixAction: "format",
    });
  }

  // 3. Authors: missing or placeholders
  if (!creators.length) {
    defects.push({
      code: "missing-creators",
      level: "error",
      field: "creators",
      message: getString("diag-missing-creators"),
      fixable: true,
      fixAction: "update",
    });
  }
  else if (creators.every(isPlaceholderCreator)) {
    defects.push({
      code: "placeholder-creators",
      level: "error",
      field: "creators",
      message: getString("diag-placeholder-creators"),
      fixable: true,
      fixAction: "update",
    });
  }

  // 4. Title anomalies
  if (title) {
    const sanitized = sanitizeWebTitle(title);
    if (sanitized !== title) {
      defects.push({
        code: "contaminated-title",
        level: "warning",
        field: "title",
        message: getString("diag-contaminated-title"),
        fixable: true,
        fixAction: "update",
      });
    }
    if (title.endsWith(".")) {
      defects.push({
        code: "trailing-dot-title",
        level: "suggestion",
        field: "title",
        message: getString("diag-trailing-dot-title"),
        fixable: true,
        fixAction: "format",
      });
    }
  }

  // 5. Missing publication for journal articles
  if (itemType === "journalArticle" && !publication) {
    defects.push({
      code: "missing-publication",
      level: "error",
      field: "publicationTitle",
      message: getString("diag-missing-publication"),
      fixable: true,
      fixAction: "update",
    });
  }

  // 6. Missing publication date
  if (!date) {
    defects.push({
      code: "missing-date",
      level: "warning",
      field: "date",
      message: getString("diag-missing-date"),
      fixable: true,
      fixAction: "update",
    });
  }

  // 7. Missing Volume / Issue / Pages
  if (itemType === "journalArticle" && (!volume || !issue || !pages)) {
    const missingParts = [
      !volume && getString("diag-field-volume"),
      !issue && getString("diag-field-issue"),
      !pages && getString("diag-field-pages"),
    ]
      .filter(Boolean)
      .join(" / ");
    defects.push({
      code: "missing-pagination",
      level: "suggestion",
      field: "pages",
      message: getString("diag-missing-pagination", { args: { parts: missingParts } }),
      fixable: true,
      fixAction: "update",
    });
  }

  // 8. Missing Abstract
  if (["journalArticle", "preprint"].includes(itemType) && !abstractNote) {
    defects.push({
      code: "missing-abstract",
      level: "suggestion",
      field: "abstractNote",
      message: getString("diag-missing-abstract"),
      fixable: true,
      fixAction: "update",
    });
  }

  return defects;
}
