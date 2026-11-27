import { defineRule } from "../../../services/lint/rule-base";
import { getString } from "../../../utils/locale";
import { getUsedItemFields } from "../../../utils/zotero";

/**
 * Some plugins use starand fields to store other data,
 * for example, Zotero One uses `shortTitle` to store the translated title,
 * and use `libraryCatalog` to store journal ranks, `callNumber` for IFs.
 * It's very bad, we should clean those fields.
 *
 * @see https://github.com/northword/zotero-format-metadata/issues/49
 * @see https://gitee.com/zotero-chinese/zotero-chinese/issues/I6W1QY
 */
export const NoFieldMisuse = defineRule({
  id: "no-field-misuse",
  scope: "item",
  apply({ item, report }) {
    const fields = getUsedItemFields(item);

    for (const field of fields) {
      const value = item.getField(field);

      if (value === "")
        continue;

      if (field === "extra")
        continue;

      let suspicious = false;

      switch (field) {
        // Some plugins use shortTitle to store the translated title
        // e.g. Zotero One (by qingning), Translate (old version)
        case "shortTitle": {
          const title = (item.getField("title") || "").trim();
          const hasCjkTitle = /[\u4E00-\u9FA5]/.test(title);
          const hasCjkShort = /[\u4E00-\u9FA5]/.test(value);
          // A different language may indicate a translation, but does not prove misuse.
          const isTranslatedTitle = !hasCjkTitle && hasCjkShort;

          if (hasEmoji(value) || isTranslatedTitle) {
            suspicious = true;
          }
          break;
        }

        case "series":
        case "seriesNumber":
        case "seriesText":
        case "seriesTitle":
          if (
            hasEmoji(value)
            || value === "EI"
            || (!/ESI/i.test(value) && /\bSCIE?\b/i.test(value))
          ) {
            suspicious = true;
          }

          break;

        case "archive":
        case "archiveLocation":
        case "archiveID":
        case "rights":
        case "callNumber":
        case "libraryCatalog":
          if (
            hasEmoji(value)
            // Q1
            || /^[A-Z]\d$/.test(value)
            // 31 citations
            || /^\d+\s+citation/.test(value)
            // 工程技术 2 区
            || /\d区$/.test(value)
            // 0.75 (SQ3)
            // 69.504
            || /^\d+\.\d+(?:\s*\(SQ\d\))?$/.test(value.trim())
            // 北大核心 / 南大核心 / CSCD 核心库
            || /核心/.test(value)
          ) {
            suspicious = true;
            break;
          }

          break;

        case "abstractNote":
          if (value.match("摘要翻译")) {
            suspicious = true;
          }
          break;

        default:
          break;
      }

      if (suspicious)
        report({ level: "warning", message: getString("rule-no-field-misuse-review", { args: { field, value } }) });
    }
  },
});

function hasEmoji(str: string): boolean {
  return /\p{Extended_Pictographic}/u.test(str);
}
