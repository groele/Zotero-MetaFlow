import { defineRule } from "../../../services/lint/rule-base";
import { getJournalInsights } from "../../../utils/journal-insights";
import { isJournalIndexEnabled } from "../../../utils/journal-permissions";
import { getString } from "../../../utils/locale";

export const ToolQueryESI = defineRule({
  id: "tool-query-esi",
  scope: "item",
  category: "tool",
  targetItemTypes: ["journalArticle"],
  async apply({ item, debug, report }) {
    if (!isJournalIndexEnabled("esi"))
      return;
    const result = await getJournalInsights(item, { queryAPI: true });
    const error = result.esiError || result.customFallback;
    if (error)
      report({ level: "warning", message: error === "journal-insights-api-missing" ? getString("journal-insights-api-missing") : getString("rule-tool-query-esi-custom-data-error", { args: { error } }) });
    if (result.esiAPIWarning)
      debug("API has no usable value; using local database results.");
    debug(`ESI insight: ${result.esi}; source: ${result.esiSource}`);
  },
});
