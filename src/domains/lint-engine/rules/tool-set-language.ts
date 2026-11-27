import { langName, toISO3 } from "tinyld";
import { defineRule } from "../../../services/lint/rule-base";
import { useSettingsDialog } from "../../../utils/dialog";
import { getString } from "../../../utils/locale";
import { getPref } from "../../../utils/prefs";

interface Options {
  language?: string;
}

export const ToolSetLanguage = defineRule<Options>({
  id: "tool-set-language",
  scope: "field",
  category: "tool",
  targetItemField: "language",
  apply({ item, options }) {
    if (options.language && item.getField("language") !== options.language)
      item.setField("language", options.language);
  },

  async prepare({ signal }) {
    const allowLangs = ["zh", "en"];
    if (getPref("rule.require-language.only")) {
      const otherLang = getPref("rule.require-language.only.other") as string;
      if (otherLang !== "" && otherLang !== undefined) {
        allowLangs.push(...otherLang.replace(/ /g, "").split(","));
      }
    }

    const { dialog, openForSettings } = useSettingsDialog<{ option: string; input: string }>(signal);
    dialog.addSetting(getString("tool-language-choice"), "option", {
      tag: "select",
      children: allowLangs.map(lang => ({
        tag: "option",
        properties: {
          innerHTML: `${langName(toISO3(lang))} (${lang})`,
          value: lang,
        },
        styles: {
          minWidth: "400px",
          // auto resize to window width
          width: "-moz-available",
        },
      })),
    })
      .addSetting(getString("tool-language-input"), "input", {
        tag: "input",
      });

    const result = await openForSettings(getString("tool-language-title"));

    let language: string;
    if (!result) {
      return false;
    }
    else if (result.input) {
      language = result.input;
    }
    else {
      language = result.option;
    }

    return {
      language,
    };
  },
});
