import { defineRule } from "../../../services/lint/rule-base";
import {
  COORDINATION_METALS,
  HOMONUCLEAR_MOLECULES,
  isNonChemicalToken,
  mapUnicodeSup,
} from "../../../utils/chemical-formula-lexicon";
import { containsValidElementsOnly, countElementSymbols, parseFormula } from "../../../utils/chemical-formula-parser";
import { getPref } from "../../../utils/prefs";
import { isFieldValidForItemType } from "../../../utils/zotero";

export { containsValidElementsOnly, countElementSymbols };

const FORMULA_SIGNAL_RE = /[\d+−\-₀₁₂₃₄₅₆₇₈₉₊₋⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]|(?:NO|SO)x\b/;
const SUB_TAG_RE = /<\/?sub>/g;
const INTER_FORMULA_SIGNAL_RE = /[ \t/·•]/;
const INTER_FORMULA_ATOM = "[A-Z][a-z]?(?:<sub>\\d{1,3}(?:\\.\\d+)?</sub>|\\d{1,3}(?:\\.\\d+)?)?";
const INTER_FORMULA_TOKEN = `(?:${INTER_FORMULA_ATOM})+`;
const INTER_FORMULA_RIGHT = `\\d{0,2}(?:${INTER_FORMULA_ATOM})+`;
const INTER_FORMULA_BOUNDARY = "[\\p{L}\\p{N}_+^]";
const INTER_FORMULA_SPACE_RE = new RegExp(
  `(?<!${INTER_FORMULA_BOUNDARY})(${INTER_FORMULA_TOKEN})([ \\t]+(?:[/·•][ \\t]*)?|[ \\t]*[/·•][ \\t]+)(${INTER_FORMULA_RIGHT})(?!${INTER_FORMULA_BOUNDARY}|<sup>)`,
  "gu",
);
const TARGET_TITLE_FIELDS: _ZoteroTypes.Item.ItemField[] = ["title", "shortTitle", "bookTitle", "proceedingsTitle"];

export const CorrectTitleChemicalFormula = defineRule({
  id: "correct-title-chemical-formula",
  scope: "field",
  targetItemField: "title",
  fieldMenu: {
    l10nID: "rule-correct-title-chemical-formula-menu-field",
  },
  apply({ item }) {
    const normalizeSpaces = getPref("rule.correct-title-chemical-formula.normalize-spaces", true);
    for (const field of TARGET_TITLE_FIELDS) {
      if (field !== "title" && !isFieldValidForItemType(field, item.itemType))
        continue;
      const value = item.getField(field, false, true);
      if (!value)
        continue;
      const formatted = formatChemicalFormula(value, { normalizeSpaces });
      if (formatted !== value)
        item.setField(field, formatted);
    }
  },
});

export function formatPart(source: string, allowSingleElement = false): string {
  if (source === "NOx" || source === "SOx")
    return `${source.slice(0, 2)}<sub>x</sub>`;
  if (!FORMULA_SIGNAL_RE.test(source) || isNonChemicalToken(source))
    return source;

  const coordMatch = source.match(/^\[([\w()]+)\](\d{0,2}[+−-]|[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]+)$/);
  if (coordMatch) {
    const inner = parseFormula(coordMatch[1]);
    if (inner) {
      const charge = /^[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]+$/.test(coordMatch[2]) ? mapUnicodeSup(coordMatch[2]) : coordMatch[2];
      return `[${inner.text}]<sup>${charge}</sup>`;
    }
  }

  const formula = parseFormula(source);
  if (formula) {
    if (
      formula.elements === 1
      && !allowSingleElement
      && !formula.hasExplicitScript
      && !formula.text.includes("<sup>")
      && !source.includes("(")
      && !HOMONUCLEAR_MOLECULES.has(source)
    ) {
      return source;
    }
    return formula.text;
  }

  const mxeneMatch = source.match(/^(.+[CN]\d*)T([xz])$/);
  if (mxeneMatch) {
    const prefix = parseFormula(mxeneMatch[1]);
    if (prefix && prefix.elements >= 2)
      return `${prefix.text}T<sub>${mxeneMatch[2]}</sub>`;
  }

  const reactionMatch = source.match(/^(.+\d)(RR|ER|OR)$/);
  if (reactionMatch && !isNonChemicalToken(reactionMatch[1])) {
    const formattedPrefix = formatPart(reactionMatch[1]);
    if (formattedPrefix !== reactionMatch[1])
      return `${formattedPrefix}${reactionMatch[2]}`;
  }

  let start = 0;
  let end = source.length;
  while (start < end && /["'“‘[{（(⟨《]/.test(source[start]))
    start++;
  while (end > start && /[,.;:!?"'”’\]}）)⟩》]/.test(source[end - 1]))
    end--;
  if (start < end && (start || end !== source.length)) {
    const innerSource = source.slice(start, end);
    const formattedInner = formatPart(innerSource, allowSingleElement);
    if (formattedInner !== innerSource)
      return source.slice(0, start) + formattedInner + source.slice(end);
    return source;
  }

  const parts = source.split(/([/·•@~:\u2010-\u2015-])/);
  if (parts.length > 1) {
    return parts.map((part, idx) => {
      if (idx % 2 === 1)
        return part;
      const prevSep = parts[idx - 1];
      const prevPart = parts[idx - 2];
      const isCoordSite = Boolean(
        prevSep && /[\u2010-\u2015-]/.test(prevSep)
        && prevPart && COORDINATION_METALS.has(prevPart)
        && /^(?:N[2-6]|O[3-6]|S[2-6]|P[2-4]|C[34])$/.test(part),
      );
      return formatPart(part, isCoordSite);
    }).join("");
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
      if (/^\d/.test(rightPlain) && !/[·•]/.test(space))
        return match;
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
        return Number(digits) < 20 && countElementSymbols(token) >= 2 && !isNonChemicalToken(token + digits) ? token + digits : match;
      });
      text = removeInterFormulaSpaces(text);
    }
    return text.split(/(\s+)/).map(token => /^\s+$/.test(token) ? token : formatPart(token)).join("");
  }).join("");
  if (!normalizeSpaces)
    return result;
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
