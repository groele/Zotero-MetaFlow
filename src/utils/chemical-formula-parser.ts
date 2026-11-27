import {
  FORMULA_ELEMENT_SET as elementSet,
  HOMONUCLEAR_MOLECULES,
  mapUnicodeSub,
  mapUnicodeSup,
} from "./chemical-formula-lexicon";

const UNMAPPED_SUB_LETTER_RE = /[\u2090-\u209C\u1D62-\u1D6A]/;

export interface ParsedFormula {
  text: string;
  elements: number;
  hasExplicitScript: boolean;
}

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

/** Parse complete formula tokens; partial element matches must not modify ordinary words. */
export function parseFormula(source: string): ParsedFormula | null {
  if (UNMAPPED_SUB_LETTER_RE.test(source))
    return null;
  let index = 0;
  let hasExplicitScript = false;
  const hasDopingExpr = /\d[-−][xyδ]/.test(source);

  const readStoichiometry = (allowDoping = false) => {
    const rest = source.slice(index);
    if (allowDoping) {
      const dopingMatch = rest.match(/^\d{1,3}(?:\.\d+)?(?:(?:[-−][xyδ])+(?=$|[A-Z()])|(?!\d))/);
      if (dopingMatch) {
        index += dopingMatch[0].length;
        return dopingMatch[0];
      }
      if (hasDopingExpr) {
        const varMatch = rest.match(/^[xyδ](?=$|[A-Z()])/);
        if (varMatch) {
          index += varMatch[0].length;
          return varMatch[0];
        }
      }
      return "";
    }
    const plainMatch = rest.match(/^\d{1,3}(?:\.\d+)?(?!\d)/);
    if (!plainMatch)
      return "";
    index += plainMatch[0].length;
    return plainMatch[0];
  };

  const parseGroup = (nested: boolean): ParsedFormula | null => {
    let text = "";
    let elements = 0;
    while (index < source.length && source[index] !== ")") {
      if (elements && !nested) {
        const supUnicode = source.slice(index).match(/^[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]+$/);
        if (supUnicode) {
          hasExplicitScript = true;
          text += `<sup>${mapUnicodeSup(supUnicode[0])}</sup>`;
          index = source.length;
          break;
        }
        if (/^[+−-]$/.test(source[index]) && index === source.length - 1) {
          text += `<sup>${source[index++]}</sup>`;
          break;
        }
        if (source[index] === "^") {
          const charge = source.slice(index).match(/^\^(\d{1,3}[+−-])$/);
          if (!charge)
            return null;
          hasExplicitScript = true;
          text += `<sup>${charge[1]}</sup>`;
          index = source.length;
          break;
        }
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

      const subUnicode = source.slice(index).match(/^[₀₁₂₃₄₅₆₇₈₉₊₋]+/);
      if (subUnicode) {
        hasExplicitScript = true;
        index += subUnicode[0].length;
        text += `<sub>${mapUnicodeSub(subUnicode[0])}</sub>`;
        continue;
      }

      let number = "";
      let explicitSub = false;
      if (source[index] === "_") {
        explicitSub = true;
        hasExplicitScript = true;
        index++;
        number = readStoichiometry(true);
        if (!number)
          return null;
      }
      else if (!group && source[index] === "(") {
        const wrapped = source.slice(index).match(/^\((\d{1,3}(?:\.\d+)?)([+−-]?)\)/);
        if (wrapped) {
          hasExplicitScript = true;
          index += wrapped[0].length;
          text += wrapped[2] ? `<sup>${wrapped[1]}${wrapped[2]}</sup>` : `<sub>${wrapped[1]}</sub>`;
          continue;
        }
      }
      else {
        number = readStoichiometry(true);
      }
      if (number) {
        const ion = !explicitSub && !group && elements === 1 && !nested
          && /^[+−-]$/.test(source[index] ?? "") && index === source.length - 1;
        text += ion ? `<sup>${number}${source[index++]}</sup>` : `<sub>${number}</sub>`;
      }
    }
    return elements ? { text, elements, hasExplicitScript } : null;
  };

  let leading = "";
  let plainLeadingCoefficient = false;
  const unicodeIsotope = source.match(/^[⁰¹²³⁴⁵⁶⁷⁸⁹]{1,3}(?=[A-Z])/);
  const caretIsotope = !unicodeIsotope ? source.match(/^\^(\d{1,3})(?=[A-Z])/) : null;
  if (unicodeIsotope) {
    hasExplicitScript = true;
    index = unicodeIsotope[0].length;
    leading = `<sup>${mapUnicodeSup(unicodeIsotope[0])}</sup>`;
  }
  else if (caretIsotope) {
    hasExplicitScript = true;
    index = caretIsotope[0].length;
    leading = `<sup>${caretIsotope[1]}</sup>`;
  }
  else {
    leading = readStoichiometry(false);
    plainLeadingCoefficient = Boolean(leading);
  }

  const bodyStart = index;
  const formula = parseGroup(false);
  if (!formula || index !== source.length)
    return null;
  const bodyRaw = source.slice(bodyStart);
  if (plainLeadingCoefficient && formula.elements === 1 && !HOMONUCLEAR_MOLECULES.has(bodyRaw) && bodyRaw !== "C")
    return null;
  return { ...formula, text: leading + formula.text, hasExplicitScript };
}

export function containsValidElementsOnly(source: string): boolean {
  return parseFormula(source) !== null;
}
