import { defineRule } from "../../../services/lint/rule-base";
import { containsValidElementsOnly, countElementSymbols } from "./correct-title-chemical-formula";

export const CorrectAbstractFormat = defineRule({
  id: "correct-abstract-format",
  scope: "field",
  targetItemField: "abstractNote",
  fieldMenu: { l10nID: "rule-correct-abstract-format-menu-field" },
  apply({ item }) {
    const original = item.getField("abstractNote", false, true);
    const normalized = normalizeAbstract(original);
    if (normalized !== original)
      item.setField("abstractNote", normalized);
  },
});

function normalizeText(input: string): string {
  let text = input.replace(/&(?:nbsp|#160|#xA0);/gi, " ").replace(/\r\n?/g, "\n").replace(/[\u200B\uFEFF]/g, "").replace(/[^\S\n]+/g, " ").replace(/ *\n */g, "\n").trim();
  // Repair only isolated import fragments, not arbitrary spaces between prose tokens.
  let previous: string;
  do {
    previous = text;
    text = text.replace(/(?<![\p{L}\p{N}_])([A-Z][a-z]?(?:[A-Z][a-z]?|\d)*)\n+(\d{1,2}|[+−-]|\/?(?:[A-Z][a-z]?\d*)+)(?=\n|$)/gu, (match, left: string, right: string) => {
      if (!containsValidElementsOnly(left))
        return match;
      if (/^\d+$/.test(right))
        return Number(right) > 0 && Number(right) < 20 && countElementSymbols(left.replace(/\d/g, "")) >= 2 ? left + right : match;
      if (/^[+−-]$/.test(right))
        return left + right;
      const token = right.replace(/^\//, "");
      return /\d/.test(left) && containsValidElementsOnly(token) ? left + right : match;
    });
  } while (text !== previous);
  return text.split(/\n{2,}/).map(paragraph => paragraph.replace(/\n/g, " ")
    .replace(/ +([,.;:!?，。；：！？、])/g, "$1")
    .replace(/(\p{Script=Han}) +(?=\p{Script=Han})/gu, "$1")).join("\n\n");
}

/** Preserve paragraphs and inline markup; change layout artifacts only. */
export function normalizeAbstract(input: string): string {
  const text = input.replace(/^\s*(?:abstract|摘要)\s*(?:[:：][^\S\r\n]*)?\r?\n+/i, "");
  const markup = /<\/?[a-z][^>]*>/i.test(text);
  const boundary = (space: string) => /\n[^\S\n]*\n/.test(space.replace(/\r/g, "")) ? "\n\n" : " ";
  return text.split(/(<\/?[a-z][^>]*>)/gi).map((part) => {
    if (part.startsWith("<"))
      return part;
    const normalized = normalizeText(part);
    if (!markup)
      return normalized;
    const leading = part.match(/^\s+/)?.[0];
    const trailing = part.match(/\S(\s+)$/)?.[1];
    return (leading ? boundary(leading) : "") + normalized + (trailing ? boundary(trailing) : "");
  }).join("").replace(/\s*(<(?:sub|sup)>)\s*([\d+−-]+)\s*(<\/(?:sub|sup)>)/gi, "$1$2$3").trim();
}
