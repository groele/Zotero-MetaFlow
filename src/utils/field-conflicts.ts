import type { ApplyContext } from "../services/lint/rule-base";
import { getString } from "./locale";

/** Check the inputs and destination again after asynchronous work. */
export function watchItemFields(item: Zotero.Item, fields: string[], report: ApplyContext["report"]) {
  const baseline = fields.map(field => item.getField(field, false, true));
  const itemType = item.itemType;
  return () => {
    const changed = fields.filter((field, index) => item.getField(field, false, true) !== baseline[index]);
    if (item.itemType !== itemType)
      changed.push("itemType");
    if (!changed.length)
      return true;
    report({ level: "warning", message: getString("rule-fields-edited", { args: { fields: changed.join(", ") } }) });
    return false;
  };
}
