import { defineRule } from "../../../services/lint/rule-base";
import { useSettingsDialog } from "../../../utils/dialog";
import { getString } from "../../../utils/locale";

export type CreatorStyleAction = "bold" | "star" | "both" | "removeBold" | "removeStar" | "removeAll";

export function styleCreatorName(firstName: string, lastName: string, action: CreatorStyleAction): { firstName: string; lastName: string } {
  const removeBold = (name: string) => name.replace(/<\/?b\s*>/gi, "");
  const removeStar = (name: string) => name.replace(/\*/g, "");
  if (["removeBold", "removeAll", "bold", "both"].includes(action)) {
    firstName = removeBold(firstName);
    lastName = removeBold(lastName);
  }
  if (["removeStar", "removeAll", "star", "both"].includes(action)) {
    firstName = removeStar(firstName);
    lastName = removeStar(lastName);
  }
  if (action === "bold" || action === "both") {
    firstName = firstName ? `<b>${firstName}</b>` : "";
    lastName = lastName ? `<b>${lastName}</b>` : "";
  }
  if ((action === "star" || action === "both") && lastName)
    lastName += "*";
  return { firstName, lastName };
}

interface CreatorStyleOptions { action: CreatorStyleAction; name: string }

export const ToolCreatorsStyle = defineRule<CreatorStyleOptions>({
  id: "tool-creators-style",
  category: "tool",
  scope: "field",
  targetItemField: "creators",
  async prepare({ signal }) {
    const { dialog, openForSettings } = useSettingsDialog<CreatorStyleOptions>(signal);
    dialog.addSetting(getString("maintenance-author-action"), "action", {
      tag: "select",
      children: (["bold", "star", "both", "removeBold", "removeStar", "removeAll"] as const).map(action => ({ tag: "option", properties: { value: action, textContent: getString(`maintenance-author-${action}` as any) } })),
    });
    dialog.addSetting(getString("maintenance-author-name"), "name", { tag: "input", attributes: { type: "text" } });
    return await openForSettings(getString("rule-tool-creators-style"));
  },
  apply({ item, options }) {
    const normalize = (value: string) => value.replace(/<\/?b\s*>|\*/gi, "").replace(/\s+/g, "").toLocaleLowerCase();
    const name = normalize(options.name || "");
    const creators = item.getCreators();
    let changed = false;
    for (const creator of creators) {
      if (name && ![`${creator.firstName || ""}${creator.lastName}`, `${creator.lastName}${creator.firstName || ""}`].some(value => normalize(value) === name))
        continue;
      const updated = styleCreatorName(creator.firstName || "", creator.lastName, options.action);
      if (updated.firstName !== creator.firstName || updated.lastName !== creator.lastName) {
        Object.assign(creator, updated);
        changed = true;
      }
    }
    if (changed)
      item.setCreators(creators);
  },
});

export const ToolCreatorsSwap = defineRule({
  id: "tool-creators-swap",
  category: "tool",
  scope: "field",
  targetItemField: "creators",
  apply({ item }) {
    const creators = item.getCreators();
    let changed = false;
    for (const creator of creators) {
      if (creator.fieldMode !== 0 || !creator.firstName || !creator.lastName)
        continue;
      [creator.firstName, creator.lastName] = [creator.lastName, creator.firstName];
      changed = true;
    }
    if (changed)
      item.setCreators(creators);
  },
});

interface ReplaceOptions { find: string; replacement: string; all: boolean }

function replacementRule(field: "title" | "publicationTitle") {
  const id = field === "title" ? "tool-title-replace" : "tool-publication-replace";
  return defineRule<ReplaceOptions>({
    id,
    category: "tool",
    scope: "field",
    targetItemField: field,
    ...(field === "publicationTitle" && { targetItemTypes: ["journalArticle"] as const }),
    async prepare({ signal }) {
      const { dialog, openForSettings } = useSettingsDialog<ReplaceOptions>(signal);
      dialog.addSetting(getString("maintenance-find"), "find", { tag: "input", attributes: { type: "text" } });
      dialog.addSetting(getString("maintenance-replacement"), "replacement", { tag: "input", attributes: { type: "text" } });
      dialog.addSetting(getString("maintenance-replace-all"), "all", { tag: "input", attributes: { type: "checkbox", checked: true } }, { valueType: "boolean" });
      const result = await openForSettings(getString(`rule-${id}` as any));
      if (result && !result.find) {
        Zotero.alert(Zotero.getMainWindow(), addon.data.config.addonName, getString("maintenance-find-required"));
        return false;
      }
      return result;
    },
    apply({ item, options }) {
      if (!options.find)
        return;
      const current = String(item.getField(field) || "");
      const updated = options.all ? current.split(options.find).join(options.replacement || "") : current.replace(options.find, () => options.replacement || "");
      if (updated !== current)
        item.setField(field, updated);
    },
  });
}

export const ToolTitleReplace = replacementRule("title");
export const ToolPublicationReplace = replacementRule("publicationTitle");

export const ToolClearAllExtra = defineRule({
  id: "tool-clear-all-extra",
  category: "tool",
  scope: "field",
  targetItemField: "extra",
  prepare({ items }) {
    return Zotero.getMainWindow().confirm(getString("maintenance-clear-extra-confirm", { args: { count: items.length } })) ? {} : false;
  },
  apply({ item }) {
    if (item.getField("extra"))
      item.setField("extra", "");
  },
});
