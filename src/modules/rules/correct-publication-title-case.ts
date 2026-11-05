import { DataLoader } from "../../utils/data-loader";
import { watchItemFields } from "../../utils/field-conflicts";
import { functionWords, isFullUpperCase } from "../../utils/str";
import { SpecialWords } from "./correct-publication-title-case-data";
import { defineRule } from "./rule-base";

export const CorrectPublicationTitleCase = defineRule({
  id: "correct-publication-title-case",
  scope: "field",

  targetItemTypes: ["journalArticle"],
  targetItemField: "publicationTitle",
  fieldMenu: {
    l10nID: "rule-correct-publication-title-case-menu-field",
  },
  async apply({ item, debug, report }) {
    const publicationTitle = item.getField("publicationTitle", false, true) as string;
    if (!publicationTitle)
      return;
    const unchanged = watchItemFields(item, ["publicationTitle"], report);

    // If this publicationTitle matches key of build-in data, do not change it
    const data = await DataLoader.load("journalAbbr");
    if (!unchanged())
      return;
    if (data[publicationTitle]) {
      debug(`Skip capitalize for ${publicationTitle}, it's a standard name in build-in data`);
      return;
    }

    // Else, try to capitalize it
    const newPublicationTitle = capitalizePublicationTitle(publicationTitle);
    if (newPublicationTitle !== publicationTitle) {
      debug(`Capitalize ${publicationTitle} -> ${newPublicationTitle}`);
      item.setField("publicationTitle", newPublicationTitle);
    }
  },
});

export function capitalizePublicationTitle(publicationTitle: string) {
  const isFullStringUpperCase = isFullUpperCase(publicationTitle);

  return publicationTitle.split(/(\s+)/).map((word, index) => {
    // Keep spaces
    if (/^\s$/.test(word))
      return word;

    const upperCaseVariant = word.toUpperCase();
    const lowerCaseVariant = word.toLowerCase();
    const capitalizeVariant = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();

    // Functions words: use lowercase
    if (functionWords.includes(lowerCaseVariant)) {
      // but if it's the first word, use capitalize variant
      if (index === 0)
        return capitalizeVariant;
      return lowerCaseVariant;
    }

    // Special words: build-in words use its own case
    // e.g. publisher name like "ACS", "IEEE", "npj"
    for (const specialWord of SpecialWords) {
      if (lowerCaseVariant === specialWord.toLowerCase()) {
        return specialWord;
      }
    }

    // If all words are uppercase, use capitalize variant
    if (isFullStringUpperCase) {
      return capitalizeVariant;
    }

    // Special words: if this word is uppercase, keep case
    if (word === upperCaseVariant) {
      return word;
    }

    // Special words: capital letters appear in the middle of words
    // e.g. iScience
    if (word !== upperCaseVariant && word !== lowerCaseVariant && word !== capitalizeVariant) {
      return word;
    }

    // Otherwise, use capitalize variant
    return capitalizeVariant;
  }).join("");
}
