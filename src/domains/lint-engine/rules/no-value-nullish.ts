import { defineRule } from "../../../services/lint/rule-base";
import { getString } from "../../../utils/locale";
import { getUsedItemFields } from "../../../utils/zotero";

const NULLISH_VALUES = new Set([
  "null",
  "undefined",
  "nan",
  "n/a",
  "n.a.",
  "n/d",
  "n.d.",
  "no value",
  "none",
]);

const PLACEHOLDER_FIELDS = new Set(["DOI", "ISBN", "ISSN", "volume", "issue", "pages", "edition", "numPages", "numberOfVolumes"]);

export const NoValueNullish = defineRule({
  id: "no-value-nullish",
  scope: "item",
  apply({ item, report }) {
    const fields = getUsedItemFields(item);

    for (const field of fields) {
      const value = item.getField(field);
      if (typeof value !== "string" || !value)
        continue;

      const trimmed = value.trim();
      const lower = trimmed.toLowerCase();

      if (NULLISH_VALUES.has(lower) || trimmed === "无") {
        if (PLACEHOLDER_FIELDS.has(field))
          item.setField(field, "");
        else
          report({ level: "warning", message: getString("rule-no-value-nullish-review", { args: { field, value } }) });
      }
    }
  },
});
