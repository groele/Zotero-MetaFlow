import { defineRule } from "../../../services/lint/rule-base";
import { DataLoader } from "../../../utils/data-loader";
import { watchItemFields } from "../../../utils/field-conflicts";

export const RequireUniversityPlace = defineRule({
  id: "require-university-place",
  scope: "field",

  targetItemTypes: ["thesis"],
  targetItemField: "place",
  fieldMenu: {
    l10nID: "rule-require-university-place-menu-field",
  },
  async apply({ item, debug, report }) {
    const university = item.getField("university") as string;
    if (!university || String(item.getField("place") || "").trim())
      return;

    const unchanged = watchItemFields(item, ["university", "place"], report);
    const data = await DataLoader.load("universityPlace");
    if (!unchanged())
      return;
    const place = data[university];

    if (place)
      item.setField("place", place);
    else
      debug(`${university} not found by exact match; leaving place empty.`);
  },
});
