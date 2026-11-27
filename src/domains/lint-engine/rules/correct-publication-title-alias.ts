import { defineRule } from "../../../services/lint/rule-base";
import { DataLoader } from "../../../utils/data-loader";
import { watchItemFields } from "../../../utils/field-conflicts";
import { normalizeKey } from "../../../utils/str";

export const CorrectPublicationTitleAlias = defineRule({
  id: "correct-publication-title-alias",
  scope: "field",

  targetItemTypes: ["journalArticle"],
  targetItemField: "publicationTitle",
  fieldMenu: {
    l10nID: "rule-correct-publication-title-alias-menu-field",
  },
  async apply({ item, debug, report }) {
    const publicationTitle = item.getField("publicationTitle", false, true) as string;
    if (!publicationTitle)
      return;

    const unchanged = watchItemFields(item, ["publicationTitle"], report);
    const { titleMap } = await DataLoader.getJournalAbbrMaps();
    if (!unchanged())
      return;
    const publicationTitleDisambiguation = titleMap.get(normalizeKey(publicationTitle));
    if (publicationTitleDisambiguation && publicationTitleDisambiguation !== publicationTitle) {
      debug(`Found alias for ${publicationTitle} -> ${publicationTitleDisambiguation}`);
      item.setField("publicationTitle", publicationTitleDisambiguation);
    }
  },
});
