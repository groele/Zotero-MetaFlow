import type { JournalLookupMaps } from "../../utils/data-loader";
import { isBuiltinAbbreviationPath } from "../../utils/builtin-abbreviation-file";
import { DataLoader } from "../../utils/data-loader";
import { watchItemFields } from "../../utils/field-conflicts";
import { buildJournalMaps, lookupJournalAbbreviation, styleJournalAbbreviation } from "../../utils/journal-abbreviation";
import { inferJournalAbbreviation } from "../../utils/journal-abbreviation-iso";
import { getString } from "../../utils/locale";
import { getPref } from "../../utils/prefs";
import { getTextLanguage, normalizeKey } from "../../utils/str";
import { defineRule } from "./rule-base";

interface Options {
  customDataPath: string;
  infer: boolean;
  usefull: boolean;
  usefullZh: boolean;
  withDots: boolean;
  sourceMode?: string;
  profile?: string;
  matchMode?: string;
  existingPolicy?: string;
  letterCase?: string;
  tagSource?: boolean;
  customAbbr?: CustomAbbreviationMap;
  customDataError?: string;
}

async function prepare(includeConferenceCustom = false): Promise<Options> {
  const options: Options = {
    customDataPath: getPref("rule.require-journal-abbr.customDataPath"),
    infer: getPref("rule.require-journal-abbr.infer"),
    usefull: getPref("rule.require-journal-abbr.usefull"),
    usefullZh: getPref("rule.require-journal-abbr.usefullZh"),
    sourceMode: getPref("rule.require-journal-abbr.sourceMode" as any, "auto"),
    profile: getPref("rule.require-journal-abbr.profile" as any, "combined"),
    matchMode: getPref("rule.require-journal-abbr.matchMode" as any, "exact"),
    existingPolicy: getPref("rule.require-journal-abbr.existingPolicy" as any, "known"),
    letterCase: getPref("rule.require-journal-abbr.letterCase" as any, "keep"),
    tagSource: getPref("rule.require-journal-abbr.tagSource" as any, false),
    withDots: getPref("rule.require-journal-abbr.withDots", true),
  };
  if (options.customDataPath && isBuiltinAbbreviationPath(options.customDataPath)) {
    options.customDataPath = "";
    if (options.sourceMode === "custom")
      options.sourceMode = "auto";
  }
  if (options.customDataPath && (includeConferenceCustom || ["auto", "custom"].includes(options.sourceMode || "auto"))) {
    try {
      options.customAbbr = await loadCustomAbbreviations(options.customDataPath);
    }
    catch (error) {
      options.customDataError = error instanceof Error ? error.message : String(error);
    }
  }
  return options;
}

export const RequireJournalAbbr = defineRule<Options>({
  id: "require-journal-abbr",
  scope: "field",
  targetItemTypes: ["journalArticle"],
  targetItemField: "journalAbbreviation",
  async apply({ item, options, debug, report }) {
    const publicationTitle = item.getField("publicationTitle") as string;

    // 无期刊全称直接跳过
    if (publicationTitle === "")
      return;

    const unchanged = watchItemFields(item, ["publicationTitle", "journalAbbreviation"], report);
    const currentAbbr = String(item.getField("journalAbbreviation") || "");
    const policy = options.existingPolicy || "known";
    if (currentAbbr && policy === "blank")
      return;
    const mode = options.sourceMode || "auto";
    const flexible = options.matchMode === "flexible";
    let journalAbbr: string | undefined;
    let source = "";
    if (["auto", "custom"].includes(mode) && options.customDataError)
      report({ level: "warning", message: getString("rule-require-journal-abbr-custom-data-error", { args: { error: options.customDataError } }) });
    if (mode === "custom" && !options.customAbbr) {
      if (!options.customDataError)
        report({ level: "warning", message: getString("abbr-custom-required") });
      return;
    }
    if (["auto", "custom"].includes(mode) && options.customAbbr) {
      const match = lookupJournalAbbreviation(publicationTitle, options.customAbbr, flexible);
      if (match.ambiguous) {
        report({ level: "warning", message: getString("abbr-match-ambiguous") });
        return;
      }
      journalAbbr = match.abbr;
      if (journalAbbr)
        source = "custom";
    }
    if (!journalAbbr && ["auto", "builtin"].includes(mode)) {
      const match = lookupJournalAbbreviation(publicationTitle, await DataLoader.getJournalAbbrMaps(options.profile || "combined"), flexible);
      if (match.ambiguous) {
        report({ level: "warning", message: getString("abbr-match-ambiguous") });
        return;
      }
      journalAbbr = match.abbr;
      if (journalAbbr)
        source = "builtin";
    }
    if (!journalAbbr && (mode === "iso4" || (mode === "auto" && options.infer)) && (!currentAbbr || policy === "replace")) {
      journalAbbr = await inferJournalAbbreviation(publicationTitle);
      if (journalAbbr)
        source = "iso4";
    }
    if (currentAbbr && !source && policy !== "replace")
      return;

    // 以期刊全称填充
    if (!journalAbbr) {
      debug("try to fill the abbreviation with its full name");
      // 获取条目语言，若无则根据期刊全称判断语言
      const itemLanguage = (item.getField("language") as string) || getTextLanguage(publicationTitle);
      const isChinese = /^(?:zh(?:[-_].*)?|ch|cn|中文|chinese)$/i.test(itemLanguage.trim());
      if (isChinese && options.usefullZh) {
      // 中文，无缩写的，是否以全称替代
        debug(`[Abbr] The abbr. of ${publicationTitle} is replaced by its full name`);
        journalAbbr = publicationTitle;
      }
      else if (!isChinese && options.usefull) {
      // 非中文，无缩写的，是否以全称替代
        debug(`[Abbr] The abbr. of ${publicationTitle} is replaced by its full name`);
        journalAbbr = publicationTitle;
      }
    }

    // 无缩写且不以全称替代，返回空值
    if (!journalAbbr)
      return;

    if (!unchanged())
      return;
    journalAbbr = formatJournalAbbreviation(styleJournalAbbreviation(journalAbbr, options.letterCase), options.withDots !== false);
    if (currentAbbr !== journalAbbr) {
      item.setField("journalAbbreviation", journalAbbr);
    }
    if (options.tagSource && source) {
      const tags = { custom: "abbr_user", builtin: "abbr", iso4: "abbr-iso4" };
      const sourceTag = tags[source as keyof typeof tags];
      for (const tag of Object.values(tags)) {
        if (tag !== sourceTag && item.hasTag(tag))
          item.removeTag(tag);
      }
      if (!item.hasTag(sourceTag))
        item.addTag(sourceTag);
    }
    report({ level: "info", field: "journalAbbreviation", source: source || "full-title", message: getString("abbr-result", { args: { value: journalAbbr, source: getString(`abbr-source-${source || "full"}` as any) } }) });
  },

  prepare: () => prepare(),

  fieldMenu: {
    l10nID: "rule-require-journal-abbr-menu-field",
  },
});

export function formatJournalAbbreviation(value: string, withDots: boolean): string {
  return withDots ? value : value.replace(/\./g, "");
}

export const CorrectConferenceAbbr = defineRule<Options>({
  id: "correct-conference-abbr",
  nameKey: "abbr-conference",
  scope: "field",
  targetItemTypes: ["conferencePaper"],
  targetItemField: "conferenceName",
  fieldMenu: {
    l10nID: "rule-require-journal-abbr-menu-field",
  },
  async apply({ item, options, report }) {
    const unchanged = watchItemFields(item, ["conferenceName", "proceedingsTitle"], report);
    const originalShortConf = ztoolkit.ExtraField.getExtraField(item, "shortConferenceName");
    const conferenceNames = [
      item.getField("conferenceName") as string,
      item.getField("proceedingsTitle") as string,
    ].filter(Boolean);

    // 无全称直接跳过
    if (conferenceNames.length === 0)
      return;
    if (options.customDataError)
      report({ level: "warning", message: getString("rule-require-journal-abbr-custom-data-error", { args: { error: options.customDataError } }) });

    let shortConferenceName: string | undefined;

    for (const conferenceName of conferenceNames) {
      // 先精确匹配，再移除会议届次序数（如 32nd）后匹配
      const conferenceNameWithoutOrdinal = conferenceName.replace(/\b\d+(?:st|nd|rd|th)\b/gi, "");
      const conferenceNameVariants = conferenceNameWithoutOrdinal === conferenceName
        ? [conferenceName]
        : [conferenceName, conferenceNameWithoutOrdinal];

      for (const conferenceNameVariant of conferenceNameVariants) {
        // 从自定义数据集获取
        if (options.customAbbr) {
          const match = lookupJournalAbbreviation(conferenceNameVariant, options.customAbbr, true);
          if (match.ambiguous) {
            report({ level: "warning", message: getString("abbr-match-ambiguous") });
            return;
          }
          shortConferenceName = match.abbr;
        }

        // 从本地数据集获取缩写
        if (!shortConferenceName) {
          const confMap = await DataLoader.getConferenceAbbrMap();
          shortConferenceName = confMap.get(normalizeKey(conferenceNameVariant));
        }

        if (shortConferenceName)
          break;
      }

      if (shortConferenceName)
        break;
    }

    if (!shortConferenceName)
      return;

    const currentShortConf = ztoolkit.ExtraField.getExtraField(item, "shortConferenceName");
    if (!unchanged() || currentShortConf !== originalShortConf)
      return;
    if (currentShortConf !== shortConferenceName) {
      await ztoolkit.ExtraField.setExtraField(item, "shortConferenceName", shortConferenceName, { save: false });
    }
  },

  prepare: () => prepare(true),

});

interface CustomAbbreviationMap extends JournalLookupMaps {
  size: number;
}

export async function loadCustomAbbreviations(path: string): Promise<CustomAbbreviationMap> {
  let rows: [unknown, unknown][];
  if (/\.json$/i.test(path)) {
    const data = await DataLoader.load("json", path);
    if (!data || Array.isArray(data) || typeof data !== "object")
      throw new TypeError("Expected a JSON object mapping titles to abbreviations");
    if (typeof data.entries === "number" && Array.isArray(data.conflicts) && Array.isArray(data.sources))
      throw new TypeError(getString("settings-abbr-provenance-file"));
    rows = Object.entries(data);
  }
  else if (/\.csv$/i.test(path)) {
    const data = await DataLoader.load("csv", path, { headers: ["publicationTitle", "abbr"] });
    rows = data.map(row => [row.publicationTitle, row.abbr]);
  }
  else {
    throw new TypeError("Expected a CSV or JSON abbreviation file");
  }
  const entries: [string, string][] = [];
  for (const [title, abbr] of rows) {
    if (typeof title !== "string" || typeof abbr !== "string")
      throw new TypeError("Each abbreviation row must contain a title and a text abbreviation");
    if (title.trim() && abbr.trim()) {
      entries.push([title.trim(), abbr.trim()]);
    }
  }
  const maps = buildJournalMaps(entries);
  if (maps.exactAmbiguousKeys?.size)
    throw new TypeError(`Conflicting abbreviations for ${maps.exactAmbiguousKeys.values().next().value}`);
  if (!maps.exactAbbrMap?.size)
    throw new TypeError("Expected at least one nonempty title and abbreviation");
  return { ...maps, size: maps.exactAbbrMap.size };
}
