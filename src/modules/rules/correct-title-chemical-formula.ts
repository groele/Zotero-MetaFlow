import { getPref } from "../../utils/prefs";
import { chemElements as ELEMENTS } from "./correct-title-sentence-case";
import { defineRule } from "./rule-base";

const elementSet = new Set(ELEMENTS);
/* eslint-disable antfu/consistent-list-newline */
const HOMONUCLEAR_MOLECULES = new Set([
  "H2", "D2", "T2", "N2", "O2", "O3", "F2", "Cl2", "Br2", "I2", "P2", "P4",
  "S2", "S4", "S6", "S8", "Se2", "Se8", "Te2", "As2", "As4", "Sb2", "Sb4", "Bi2",
  "C2", "C60", "C70", "C76", "C84", "B2", "B12", "Si2", "Ge2", "Sn2", "Pb2",
  "Li2", "Na2", "K2", "Rb2", "Cs2", "Au2", "Ag2", "Cu2",
]);
const SUB_DIGITS = "₀₁₂₃₄₅₆₇₈₉";
const SUP_CHARS: Record<string, string> = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4",
  "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
  "⁺": "+", "⁻": "-",
};
/* eslint-enable antfu/consistent-list-newline */
const UNICODE_SUB_RE = /[₀₁₂₃₄₅₆₇₈₉]/g;
const UNICODE_SUP_RE = /[⁰¹²³⁴⁵⁶₇₈₉⁺⁻]/g;
const UNICODE_SCRIPT_TEST_RE = /[₀₁₂₃₄₅₆₇₈₉⁰¹²³⁴⁵⁶⁺⁻]/;
const FORMULA_SIGNAL_RE = /[\d+−\-₀₁₂₃₄₅₆₇₈₉⁰¹²³⁴⁵⁶⁺⁻]/;
const SUB_TAG_RE = /<\/?sub>/g;
const INTER_FORMULA_SIGNAL_RE = /[ \t/·•]/;
const INTER_FORMULA_ATOM = "[A-Z][a-z]?(?:<sub>\\d{1,3}(?:\\.\\d+)?</sub>|\\d{1,3}(?:\\.\\d+)?)?";
const INTER_FORMULA_TOKEN = `(?:${INTER_FORMULA_ATOM})+`;
const INTER_FORMULA_BOUNDARY = "[\\p{L}\\p{N}_+^]";
const INTER_FORMULA_SPACE_RE = new RegExp(
  `(?<!${INTER_FORMULA_BOUNDARY})(${INTER_FORMULA_TOKEN})([ \\t]+(?:[/·•][ \\t]*)?|[ \\t]*[/·•][ \\t]+)(${INTER_FORMULA_TOKEN})(?!${INTER_FORMULA_BOUNDARY}|<sup>)`,
  "gu",
);

function normalizeUnicodeScripts(token: string): string {
  return token
    .replace(UNICODE_SUB_RE, ch => String(SUB_DIGITS.indexOf(ch)))
    .replace(UNICODE_SUP_RE, ch => SUP_CHARS[ch] ?? ch);
}

export const CorrectTitleChemicalFormula = defineRule({
  id: "correct-title-chemical-formula",
  scope: "field",
  targetItemField: "title",
  fieldMenu: {
    l10nID: "rule-correct-title-chemical-formula-menu-field",
  },
  apply({ item }) {
    const title = item.getField("title", false, true);
    if (!title)
      return;
    const newTitle = formatChemicalFormula(title, {
      normalizeSpaces: getPref("rule.correct-title-chemical-formula.normalize-spaces", true),
    });
    if (newTitle !== title)
      item.setField("title", newTitle);
  },
});

export function countElementSymbols(token: string): number {
  let index = 0;
  let count = 0;
  while (index < token.length) {
    const twoChar = token.slice(index, index + 2);
    const symbol = elementSet.has(twoChar) ? twoChar : token[index];
    if (!elementSet.has(symbol))
      return 0;
    index += symbol.length;
    count++;
  }
  return count;
}

interface Formula {
  text: string;
  elements: number;
}

/** Parse complete formula tokens; partial element matches must not modify ordinary words. */
function parseFormula(source: string): Formula | null {
  let index = 0;
  const readNumber = (allowDoping = false) => {
    const rest = source.slice(index);
    const match = allowDoping
      ? rest.match(/^\d{1,3}(?:\.\d+)?(?:[-−][xyδ](?=$|[A-Z()])|(?!\d))/)
      : rest.match(/^\d{1,3}(?:\.\d+)?(?!\d)/);
    if (!match)
      return "";
    index += match[0].length;
    return match[0];
  };
  const parseGroup = (nested: boolean): Formula | null => {
    let text = "";
    let elements = 0;
    while (index < source.length && source[index] !== ")") {
      if (elements && /^[+−-]$/.test(source[index]) && index === source.length - 1 && !nested) {
        text += `<sup>${source[index++]}</sup>`;
        break;
      }
      if (source[index] === "^" && elements && !nested) {
        const charge = source.slice(index).match(/^\^(\d{1,3}[+−-])$/);
        if (!charge)
          return null;
        text += `<sup>${charge[1]}</sup>`;
        index = source.length;
        break;
      }
      const group = source[index] === "(";
      if (group) {
        index++;
        const inner = parseGroup(true);
        if (!inner || source[index] !== ")")
          return null;
        index++;
        text += `(${inner.text})`;
        elements += inner.elements;
      }
      else {
        const twoChar = source.slice(index, index + 2);
        const symbol = elementSet.has(twoChar) ? twoChar : source[index];
        if (!elementSet.has(symbol))
          return null;
        text += symbol;
        elements++;
        index += symbol.length;
      }

      let number = "";
      let explicitSub = false;
      if (source[index] === "_") {
        explicitSub = true;
        index++;
        number = readNumber(true);
        if (!number)
          return null;
      }
      else if (!group && source[index] === "(") {
        const wrapped = source.slice(index).match(/^\((\d{1,3}(?:\.\d+)?)([+−-]?)\)/);
        if (wrapped) {
          index += wrapped[0].length;
          text += wrapped[2] ? `<sup>${wrapped[1]}${wrapped[2]}</sup>` : `<sub>${wrapped[1]}</sub>`;
          continue;
        }
      }
      else {
        number = readNumber(true);
      }
      if (number) {
        // A single-element ion (Fe3+) has a charge; NH4+ has a count followed by a charge.
        const ion = !explicitSub && !group && elements === 1 && !nested
          && /^[+−-]$/.test(source[index] ?? "") && index === source.length - 1;
        text += ion ? `<sup>${number}${source[index++]}</sup>` : `<sub>${number}</sub>`;
      }
    }
    return elements ? { text, elements } : null;
  };
  // Preserve leading coefficients / isotope numbers; do not infer their vertical position.
  const leading = readNumber(false);
  const formula = parseGroup(false);
  return formula && index === source.length ? { ...formula, text: leading + formula.text } : null;
}

export function containsValidElementsOnly(source: string): boolean {
  return parseFormula(source) !== null;
}

export function formatPart(source: string, inHyphenated = false): string {
  if (!FORMULA_SIGNAL_RE.test(source))
    return source;
  const normalized = UNICODE_SCRIPT_TEST_RE.test(source) ? normalizeUnicodeScripts(source) : source;
  const formula = parseFormula(normalized);
  if (formula) {
    if (
      inHyphenated
      && formula.elements === 1
      && !formula.text.includes("<sup>")
      && !source.includes("_")
      && !source.includes("(")
      && !HOMONUCLEAR_MOLECULES.has(normalized)
    ) {
      return source;
    }
    return formula.text;
  }
  const coordMatch = normalized.match(/^\[([\w()]+)\](\d{0,2}[+−-])$/);
  if (coordMatch) {
    const inner = parseFormula(coordMatch[1]);
    if (inner)
      return `[${inner.text}]<sup>${coordMatch[2]}</sup>`;
  }
  // Punctuation, crystal-phase prefixes and heterostructure separators are outside chemical tokens.
  const parts = source.split(/([/·•@~:\u2010-\u2015-])/);
  if (parts.length > 1) {
    const hasHyphen = /[\u2010-\u2015-]/.test(source);
    return parts.map((part, idx) => idx % 2 === 1 ? part : formatPart(part, inHyphenated || hasHyphen)).join("");
  }
  let start = 0;
  let end = source.length;
  while (start < end && /["'“‘[{（(⟨《]/.test(source[start]))
    start++;
  while (end > start && /[,.;:!?"'”’\]}）)⟩》]/.test(source[end - 1]))
    end--;
  if (start < end && (start || end !== source.length)) {
    const innerSource = source.slice(start, end);
    const formattedInner = formatPart(innerSource, inHyphenated);
    if (formattedInner !== innerSource)
      return source.slice(0, start) + formattedInner + source.slice(end);
  }
  return source;
}

/** Only join complete chemical tokens, leaving prose and formatting attributes untouched. */
export function removeInterFormulaSpaces(html: string, formattedOnly = false): string {
  if (!html || !INTER_FORMULA_SIGNAL_RE.test(html))
    return html;
  const plain = (value: string) => value.replace(SUB_TAG_RE, "");
  let result = html;
  let previous: string;
  do {
    previous = result;
    result = result.replace(INTER_FORMULA_SPACE_RE, (match, left: string, space: string, right: string) => {
      if (formattedOnly && !left.includes("<sub>") && !right.includes("<sub>"))
        return match;
      const leftPlain = plain(left);
      const rightPlain = plain(right);
      const leftFormula = parseFormula(leftPlain);
      const rightFormula = parseFormula(rightPlain);
      if (!leftFormula || !rightFormula || !/\d/.test(leftPlain + rightPlain))
        return match;
      if (!space.trim() && !(rightFormula.elements === 1 && (leftFormula.elements >= 2 || !/\d/.test(leftPlain))))
        return match;
      return left + space.trim() + right;
    });
  } while (result !== previous);
  return result;
}

export function formatChemicalFormula(input: string, options: { normalizeSpaces?: boolean } = {}): string {
  if (!input || !FORMULA_SIGNAL_RE.test(input))
    return input;
  const normalizeSpaces = options.normalizeSpaces ?? true;
  let protectedDepth = 0;
  const protectedTags: string[] = [];
  const result = input.split(/(<[^>]+>)/).map((part) => {
    if (part.startsWith("<")) {
      const tag = part.match(/^<\/?([\w-]+)/)?.[1]?.toLowerCase();
      if (!tag)
        return part;
      if (part.startsWith("</")) {
        if (protectedTags.at(-1) === tag) {
          protectedTags.pop();
          protectedDepth--;
        }
      }
      else if (protectedDepth || ["sub", "sup", "nc"].includes(tag) || (tag === "span" && /\bclass\s*=\s*["'][^"']*\bnocase\b/i.test(part))) {
        if (!part.endsWith("/>")) {
          protectedTags.push(tag);
          protectedDepth++;
        }
      }
      return part;
    }
    if (protectedDepth)
      return part;
    let text = part;
    if (normalizeSpaces) {
      text = text.replace(/(?<![\p{L}\p{N}_])((?:[A-Z][a-z]?)+)[ \t]+(\d{1,3})(?![\d.])/gu, (match, token: string, digits: string) => {
        return Number(digits) < 20 && countElementSymbols(token) >= 2 ? token + digits : match;
      });
      text = removeInterFormulaSpaces(text);
    }
    return text.split(/(\s+)/).map(token => /^\s+$/.test(token) ? token : formatPart(token)).join("");
  }).join("");
  if (!normalizeSpaces)
    return result;
  // Clean spaces across existing numeric <sub> tags, excluding nocase regions.
  const output: string[] = [];
  const lockedTags: string[] = [];
  let buffer = "";
  const flush = () => {
    output.push(removeInterFormulaSpaces(buffer, true));
    buffer = "";
  };
  for (const part of result.split(/(<[^>]+>)/)) {
    const tag = part.match(/^<\/?([\w-]+)/)?.[1]?.toLowerCase();
    const startsLocked = tag === "nc" || (tag === "span" && /\bclass\s*=\s*["'][^"']*\bnocase\b/i.test(part));
    if (lockedTags.length || (startsLocked && !part.startsWith("</"))) {
      flush();
      output.push(part);
      if (tag && part.startsWith("</")) {
        if (lockedTags.at(-1) === tag)
          lockedTags.pop();
      }
      else if (tag && !part.endsWith("/>")) {
        lockedTags.push(tag);
      }
    }
    else {
      buffer += part;
    }
  }
  flush();
  return output.join("");
}
