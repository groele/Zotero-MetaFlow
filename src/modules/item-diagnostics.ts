import { isFieldValidForItemType } from "../utils/zotero";
import { isPlaceholderCreator } from "./review/policy";
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
      message: "缺少官方学术 DOI 标识符",
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
      message: "DOI 字段包含多余 URL 前缀或前置字符",
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
      message: "作者字段为空，缺少创作者信息",
      fixable: true,
      fixAction: "update",
    });
  }
  else if (creators.every(isPlaceholderCreator)) {
    defects.push({
      code: "placeholder-creators",
      level: "error",
      field: "creators",
      message: "作者字段仅含未解析的占位符（如 (姓), (名)）",
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
        message: "标题包含网页/出版商抓取残留后缀（如 Wiley / ScienceDirect 等）",
        fixable: true,
        fixAction: "update",
      });
    }
    if (title.endsWith(".")) {
      defects.push({
        code: "trailing-dot-title",
        level: "suggestion",
        field: "title",
        message: "标题末尾包含多余标点句号",
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
      message: "缺少期刊出版物名称 (Publication Title)",
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
      message: "缺少出版日期/年份 (Date)",
      fixable: true,
      fixAction: "update",
    });
  }

  // 7. Missing Volume / Issue / Pages
  if (itemType === "journalArticle" && (!volume || !issue || !pages)) {
    const missingParts = [!volume && "卷号", !issue && "期号", !pages && "页码"].filter(Boolean).join(" / ");
    defects.push({
      code: "missing-pagination",
      level: "suggestion",
      field: "pages",
      message: `缺少文献定位信息 (${missingParts})`,
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
      message: "缺少论文摘要 (Abstract)",
      fixable: true,
      fixAction: "update",
    });
  }

  return defects;
}
