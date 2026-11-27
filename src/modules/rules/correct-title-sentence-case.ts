import type { CompiledTitleTerm } from "../../utils/title-terms";
import { COORDINATION_METALS, restoreAllCapsChemicalCandidate } from "../../utils/chemical-formula-lexicon";
import contryJson from "../../utils/country-by-capital-city.json";
import { getPref } from "../../utils/prefs";
import { escapeRegex, functionWords } from "../../utils/str";
import { applyTitleTerms, compileTitleTerms, loadTitleTerms } from "../../utils/title-terms";
import { formatPart } from "./correct-title-chemical-formula";
import { defineRule } from "./rule-base";

/** =============================  Special Words Begin  ============================= */

/* eslint-disable antfu/consistent-list-newline  -- We expect to customize the line breaks of these arrays. */
export const chemElements = [
  "H", "He",
  "Li", "Be", "B", "C", "N", "O", "F", "Ne",
  "Na", "Mg", "Al", "Si", "P", "S", "Cl", "Ar",
  "K", "Ca", "Sc", "Ti", "V", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Zn", "Ga", "Ge", "As", "Se", "Br", "Kr",
  "Rb", "Sr", "Y", "Zr", "Nb", "Mo", "Tc", "Ru", "Rh", "Pd", "Ag", "Cd", "In", "Sn", "Sb", "Te", "I", "Xe",
  "Cs", "Ba", "La", "Hf", "Ta", "W", "Re", "Os", "Ir", "Pt", "Au", "Hg", "Tl", "Pb", "Bi", "Po", "At", "Rn",
  "Fr", "Ra", "Ac", "Rf", "Db", "Sg", "Bh", "Hs", "Mt", "Ds", "Rg", "Cn", "Nh", "Fl", "Mc", "Lv", "Ts", "Og",
  "La", "Ce", "Pr", "Nd", "Pm", "Sm", "Eu", "Gd", "Tb", "Dy", "Ho", "Er", "Tm", "Yb", "Lu",
  "Ac", "Th", "Pa", "U", "Np", "Pu", "Am", "Cm", "Bk", "Cf", "Es", "Fm", "Md", "No", "Lr",
];

// unshift 'Be' for function word 'be'
const _chemElements = new Set(chemElements.filter(e => e !== "Be"));

const geographyWords = [
  "Asia", "Europe", "Africa", "North America", "South America",
  "Asian", "European", "African", "American",
  "Oceania", "Antarctica", "Pacific Ocean", "Atlantic Ocean", "Indian Ocean", "Arctic Ocean",
  "Mediterranean", "Tibetan Plateau",
  "Yangtze River", "Yangtze", "Beijing–Tianjin–Hebei", "Yellow River", "Huang He",
];

const dateWords = [
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
  "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December",
];

const planetWords = ["Mercury", "Venus", "Earth", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"];

const brands = [
  "Apple", "Microsoft", "Google", "Amazon", "Alibaba", "Tencent", "Facebook", "Twitter", "Instagram",
  "YouTube", "Netflix", "Spotify", "Tidal",
  "Inc", "Ltd",
];

const localityWords = [
  "north", "south", "east", "west",
  "northern", "southern", "eastern", "western",
  "southeast", "southwest", "northwest", "northeast",
  "southeastern", "southwestern", "northwestern", "northeastern",

  // 其他后可以跟地名等的虚词，虽不是方位词，但在此一并列出
  "over",
];

const chinaCapitals = [
  "Beijing", "Tianjin", "Shijiazhuang", "Taiyuan", "Hohhot", "Shenyang",
  "Changchun", "Harbin", "Shanghai", "Nanjing", "Hangzhou", "Hefei",
  "Fuzhou", "Nanchang", "Jinan", "Zhengzhou", "Wuhan", "Changsha",
  "Guangzhou", "Nanning", "Haikou", "Chongqing", "Chengdu", "Guiyang",
  "Kunming", "Lhasa", "Xi’an", "Lanzhou", "Xining", "Yinchuan",
  "Urumqi", "Hong Kong", "Macao",
];

const worldCities = [
  "New York", "Los Angeles", "San Francisco", "Chicago", "Miami", // United States
  "London", // United Kingdom
  "Paris", // France
  "Berlin", "Munich", // Germany
  "Rome", "Milan", // Italy
  "Madrid", "Barcelona", // Spain
  "Amsterdam", // Netherlands
  "Brussels", // Belgium
  "Vienna", // Austria
  "Zurich", // Switzerland
  "Moscow", "Saint Petersburg", // Russia
  "Istanbul", // Turkey
  "Dubai", "Abu Dhabi", // United Arab Emirates
  "Doha", // Qatar
  "Riyadh", // Saudi Arabia
  "Tel Aviv", // Israel
  "Singapore", // Singapore
  "Tokyo", "Osaka", "Kyoto", // Japan
  "Seoul", "Busan", // South Korea
  "Bangkok", // Thailand
  "Jakarta", // Indonesia
  "Kuala Lumpur", // Malaysia
  "Manila", // Philippines
  "Hanoi", "Ho Chi Minh City", // Vietnam
  "Sydney", "Melbourne", // Australia
  "Auckland", // New Zealand
  "Toronto", "Vancouver", "Montreal", // Canada
  "Mexico City", // Mexico
  "São Paulo", "Rio de Janeiro", // Brazil
  "Buenos Aires", // Argentina
  "Lima", // Peru
  "Cape Town", "Johannesburg", // South Africa
];

/* eslint-enable antfu/consistent-list-newline */

const contriesAndCities = [
  ...contryJson.flatMap(c => Object.values(c)).filter(v => v !== null) as string[],
  ...chinaCapitals,
  ...worldCities,
];

const specialWords = [
  ...brands,
  ...geographyWords,
  ...dateWords,
  ...contriesAndCities,
  ...planetWords,
];

const specialWordsPattern = specialWords.map(escapeRegex).join("|");
const specialWordsByKey = new Map<string, string>();
for (const word of specialWords) {
  if (!specialWordsByKey.has(word.toLowerCase()))
    specialWordsByKey.set(word.toLowerCase(), word);
}
const properNamePattern = new RegExp(
  `\\b(?:${functionWords.join("|")}|${localityWords.join("|")})\\s+(${specialWordsPattern})(?![\\p{L}\\p{N}_])`,
  "giu",
);

// Ambiguous common words retain contextual restoration above.
const ambiguousNames = new Set(["turkey", "chad", "jordan", "georgia", "reading", "nice", "male", "victoria"]);
const standaloneNames = [...new Set([...geographyWords, ...contriesAndCities, "America"])].filter(word => !ambiguousNames.has(word.toLowerCase()));
const standaloneNameMap = new Map(standaloneNames.map(word => [word.toLowerCase(), word]));
const standaloneNamePattern = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${standaloneNames.sort((a, b) => b.length - a.length).map(escapeRegex).join("|")})(?![\\p{L}\\p{N}_])`, "giu");
const scientificTerms = new Map(["COVID", "CRISPR", "LLM", "DNA", "RNA", "MRI", "fMRI", "EEG", "VASP"].map(word => [word.toLowerCase(), word]));

/** =============================  Special Words End  ============================= */

/**
 * To sentence case
 * The code is modified from Zotero.Utilities.sentenceCase.
 * AGPL v3.0 license.
 * @see https://github.com/zotero/utilities/pull/26
 * @see https://github.com/zotero/utilities/pull/27
 */
function restoreAllCapsFormulaWord(word: string): string | null {
  const unmasked = word.replace(/\uFFFD/g, "");
  const restored = restoreAllCapsChemicalCandidate(unmasked);
  if (!restored || restored.length !== unmasked.length || formatPart(restored) === restored)
    return null;
  if (!word.includes("\uFFFD"))
    return restored;
  let pos = 0;
  return [...word].map(ch => ch === "\uFFFD" ? ch : restored[pos++]).join("");
}

export function toSentenceCase(text: string, locale: string = "en-US") {
  const preserve = [] as any[]; // northword: add for tsc
  const plainForCase = text.replace(/<[^>]+>/g, "");
  const allcaps = /\p{Lu}/u.test(plainForCase) && plainForCase === plainForCase.toLocaleUpperCase(locale);

  // sub-sentence start
  text.replace(/([.?!]\s+)(<[^>]+>)?(\p{Lu})/gu, (match, end, markup, char, i) => {
    markup = markup || "";
    // We expect to keep the regular expression unchanged to maintain consistency with
    // Zotero's built-in version, even though it includes redundant capture groups.
    /* eslint-disable-next-line regexp/no-unused-capturing-group */
    if (!/(\p{Lu}\.){2,}$/u.test(text.substring(0, i + 1))) {
      // prevent "U.S. Taxes" from starting a new sub-sentence
      preserve.push({ start: i + end.length + markup.length, end: i + end.length + markup.length + char.length });
    }
    return match; // northword patch: make tsc happy
  });

  // protect leading capital
  // patched to https://github.com/zotero/utilities/pull/31/files
  text.replace(/^([“"‘']?)(<[^>]+>)?(\p{Lu})/gu, (match, prefix, markup, char, offset) => {
    markup = markup || "";
    const leadingTerm = text.slice(offset + prefix.length + markup.length).match(/^[\p{L}\p{N}]+/u)?.[0];
    if (!allcaps || !scientificTerms.has(leadingTerm?.toLowerCase() || ""))
      preserve.push({ start: offset + prefix.length + markup.length, end: offset + prefix.length + markup.length + char.length });
    return match; // northword patch: make tsc happy
  });

  // protect nocase
  text.replace(/<span class="nocase">.*?<\/span>|<nc>.*?<\/nc>/gi, (match, i) => {
    preserve.push({ start: i, end: i + match.length, description: "nocase" });
    return match; // northword patch: make tsc happy
  });

  // northword patch https://github.com/northword/zotero-format-metadata/issues/383
  // protect content inside specific formatting tags (i, b, em, strong, sup, sub)
  text.replace(/<(i|b|em|strong|sup|sub)(?:\s[^>]*)?>.*?<\/\1>/gi, (match, tagName, offset) => {
    preserve.push({ start: offset, end: offset + match.length, description: "protected-formatting-tag" });
    return match;
  });

  // mask html tags with characters so the sentence-casing can deal with them as simple words
  let masked = text.replace(/<[^>]+>/g, (match, i) => {
    preserve.push({ start: i, end: i + match.length, description: "markup" });
    return "\uFFFD".repeat(match.length);
  });

  masked = masked
    .replace(/[;:]\uFFFD*\s+\uFFFD*A\s/g, match => match.toLocaleLowerCase(locale))
    .replace(/[–—]\uFFFD*(?:\s+\uFFFD*)?A\s/g, match => match.toLocaleLowerCase(locale))
    // words, compound words, and acronyms (latter also catches U.S.A.)
    .replace(/([\u{FFFD}\p{L}\p{N}]+([\u{FFFD}\p{L}\p{N}\p{Pc}]*))|(\s(\p{Lu}+\.){2,})?/gu, (word) => {
      if (!word)
        return word;
      if (allcaps) {
        const unmaskedAllCaps = word.replace(/\uFFFD/g, "");
        return scientificTerms.get(unmaskedAllCaps.toLowerCase())
          ?? restoreAllCapsFormulaWord(word)
          ?? word.toLocaleLowerCase(locale);
      }

      const unmasked = word.replace(/\uFFFD/g, "");

      if (unmasked.length === 1) {
        return unmasked === "A" ? word.toLocaleLowerCase(locale) : word;
      }

      // inner capital somewhere
      if (/.\p{Lu}/u.test(unmasked)) {
        return word;
      }

      // identifiers or allcaps
      if (/^\p{L}+\p{N}[\p{L}\p{N}]*$/u.test(unmasked) || /^[\p{Lu}\p{N}]+$/u.test(unmasked)) {
        return word;
      }

      // northword patch: 支持化学元素识别
      if (_chemElements.has(word)) {
        return word;
      }

      return word.toLocaleLowerCase(locale);
    })

    // northword patch: 支持月、周、国家城市、大洲大洋等专有名词
    .replace(
      properNamePattern,
      (match, specialWord) => {
        return match.replace(
          specialWord,
          specialWordsByKey.get(specialWord.toLowerCase()) ?? specialWord,
        );
      },
    );

  if (allcaps) {
    masked = masked
      .replace(/\b([123][tThHrR])-(?=[A-Z][a-z]?\d|[A-Z][a-z]?[A-Z])/g, (_, phase: string) => `${phase.toUpperCase()}-`)
      .replace(/\b([a-z]{1,2})-([noscpb])([2-6])\b/gi, (match, metal: string, lig: string, count: string) => {
        const sym = metal[0].toUpperCase() + metal.slice(1).toLowerCase();
        return sym !== "In" && COORDINATION_METALS.has(sym) ? `${sym}-${lig.toUpperCase()}${count}` : match;
      });
  }

  masked = masked.replace(standaloneNamePattern, word => standaloneNameMap.get(word.toLowerCase()) ?? word);

  for (const { start, end } of preserve) {
    masked = masked.substring(0, start) + text.substring(start, end) + masked.substring(end);
  }

  return masked;
}

interface Options {
  data?: any[];
  terms?: CompiledTitleTerm[];
}

export function keepOriginalTitle(language: string, disabledLanguagesList: string) {
  const normalizedLanguage = language.toLowerCase();
  return disabledLanguagesList
    .split(",")
    .map(item => item.trim().toLowerCase())
    .filter(Boolean)
    .some(item => normalizedLanguage === item || normalizedLanguage.startsWith(`${item}-`));
}

function createCorrectTitleSentenceCaseRule(targetItemField: "title" | "shortTitle" | "bookTitle" | "proceedingsTitle") {
  return defineRule<Options>({
    id: `correct-${targetItemField}-sentence-case`,
    scope: "field",
    targetItemField,
    fieldMenu: {
      l10nID: "rule-correct-title-sentence-case-menu-field",
    },
    async apply({ item, options }) {
      const oldTitle = item.getField(targetItemField, false, true);
      if (!oldTitle)
        return;
      const lang = item.getField("language") || "en-US";
      let title = oldTitle;
      const disabledLanguagesList = getPref("rule.correct-title-sentence-case.disabled-languages") || "zh";
      title = keepOriginalTitle(lang, disabledLanguagesList) ? title : toSentenceCase(title, lang);

      const terms = options.terms ?? (options.data && compileTitleTerms(options.data));
      if (terms)
        title = applyTitleTerms(title, terms);

      if (title !== oldTitle) {
        item.setField(targetItemField, title);
      }
    },

    async prepare() {
      const customTermFilePath = getPref("rule.correct-title-sentence-case.custom-term-path");
      if (customTermFilePath) {
        return {
          terms: compileTitleTerms(await loadTitleTerms(customTermFilePath)),
        };
      }
      else {
        return {};
      }
    },
  });
}

export const CorrectTitleSentenceCase = createCorrectTitleSentenceCaseRule("title");
export const CorrectShortTitleSentenceCase = createCorrectTitleSentenceCaseRule("shortTitle");
export const CorrectBookTitleSentenceCase = createCorrectTitleSentenceCaseRule("bookTitle");
export const CorrectProceedingsTitleSentenceCase = createCorrectTitleSentenceCaseRule("proceedingsTitle");
