import { defineRule } from "../../../services/lint/rule-base";
// autocorrect-disable -- autocorrect mismark of `《》`
import { useSettingsDialog } from "../../../utils/dialog";
import { getString } from "../../../utils/locale";
import { getActualField } from "../../../utils/zotero";

interface TitleGuillemetOptions {
  target?: "single" | "double";
}

/**
 * Replaces `《》` to `〈〉`
 * @see https://github.com/redleafnew/Chinese-STD-GB-T-7714-related-csl/issues/204
 */
export const ToolTitleGuillemet = defineRule<TitleGuillemetOptions> ({
  id: "tool-title-guillemet",
  nameKey: "title-guillemet",
  scope: "field",
  category: "tool",
  targetItemField: "title",
  includeMappedFields: true,
  async apply({ item, options }) {
    if (!options.target)
      return;

    const field = getActualField(item, "title");
    if (!field)
      return;

    const title = item.getField(field, false, true);
    if (!title)
      return;

    let newTitle: string;
    if (options.target === "single") {
      newTitle = title.replace(/《/g, "〈").replace(/》/g, "〉");
    }
    else if (options.target === "double") {
      newTitle = title.replace(/〈/g, "《").replace(/〉/g, "》");
    }
    else {
      newTitle = title;
    }

    if (newTitle !== title) {
      item.setField(field, newTitle);
    }
  },

  async prepare({ signal }) {
    const { dialog, openForSettings } = useSettingsDialog<TitleGuillemetOptions>(signal);

    dialog.addSetting(getString("tool-guillemet-choice"), "target", {
      tag: "select",
      children: [
        {
          tag: "option",
          properties: {
            value: "double",
            textContent: getString("tool-guillemet-double"),
          },
        },
        {
          tag: "option",
          properties: {
            value: "single",
            textContent: getString("tool-guillemet-single"),
          },
        },
      ],
    });

    const result = await openForSettings(getString("tool-guillemet-title"));
    if (result) {
      return { target: result.target };
    }
    else {
      return false;
    }
  },
});
