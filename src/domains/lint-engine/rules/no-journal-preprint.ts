import { defineRule } from "../../../services/lint/rule-base";
import { extractIdentifiers, isPreprint } from "../../../services/metadata/tool-update-metadata/identifiers";
import { getString } from "../../../utils/locale";

export const NoJournalPreprint = defineRule({
  id: "no-journal-preprint",
  scope: "item",
  targetItemTypes: ["journalArticle"],
  apply({ item, report }) {
    const identifiers = extractIdentifiers(item);
    if (isPreprint(item, identifiers)) {
      report({
        level: "warning",
        message: getString("rule-no-journal-preprint-report-message"),
        action: {
          label: getString("rule-no-journal-preprint-report-action"),
          callback: async () => {
            const currentItem = Zotero.Items.get(item.id);
            if (currentItem && !currentItem.deleted)
              await addon.hooks.onLintInBatch(["tool-update-metadata"], [currentItem], { review: true });
          },
        },
      });
    }
  },
});
