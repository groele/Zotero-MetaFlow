/* eslint-disable antfu/consistent-list-newline */
export const CHEM_ELEMENTS = [
  "H", "He",
  "Li", "Be", "B", "C", "N", "O", "F", "Ne",
  "Na", "Mg", "Al", "Si", "P", "S", "Cl", "Ar",
  "K", "Ca", "Sc", "Ti", "V", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Zn", "Ga", "Ge", "As", "Se", "Br", "Kr",
  "Rb", "Sr", "Y", "Zr", "Nb", "Mo", "Tc", "Ru", "Rh", "Pd", "Ag", "Cd", "In", "Sn", "Sb", "Te", "I", "Xe",
  "Cs", "Ba", "La", "Hf", "Ta", "W", "Re", "Os", "Ir", "Pt", "Au", "Hg", "Tl", "Pb", "Bi", "Po", "At", "Rn",
  "Fr", "Ra", "Ac", "Rf", "Db", "Sg", "Bh", "Hs", "Mt", "Ds", "Rg", "Cn", "Nh", "Fl", "Mc", "Lv", "Ts", "Og",
  "Ce", "Pr", "Nd", "Pm", "Sm", "Eu", "Gd", "Tb", "Dy", "Ho", "Er", "Tm", "Yb", "Lu",
  "Th", "Pa", "U", "Np", "Pu", "Am", "Cm", "Bk", "Cf", "Es", "Fm", "Md", "No", "Lr",
];

/** Complete element + hydrogen isotope symbol set (D = Deuterium, T = Tritium). */
export const FORMULA_ELEMENT_SET = new Set([...CHEM_ELEMENTS, "D", "T"]);

/** Neutral single-element molecules that legitimately take a numeric subscript. */
export const HOMONUCLEAR_MOLECULES = new Set([
  "H2", "H3", "D2", "T2", "N2", "N3", "O2", "O3", "F2", "Cl2", "Br2", "I2", "I3",
  "P2", "P4", "S2", "S4", "S6", "S8", "Se2", "Se8", "Te2", "As2", "As4", "Sb2", "Sb4", "Bi2",
  "C2", "C60", "C70", "C76", "C78", "C80", "C84", "B2", "Si2", "Ge2", "Sn2", "Pb2",
  "Li2", "Na2", "K2", "Rb2", "Cs2", "Au2", "Ag2", "Cu2",
]);

/** Catalyst metal centers for single-atom coordination sites (e.g. Fe-N4, Co-N4, Ni-N4). */
export const COORDINATION_METALS = new Set([
  "M", "Sc", "Ti", "V", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Zn",
  "Y", "Zr", "Nb", "Mo", "Ru", "Rh", "Pd", "Ag", "Cd", "In", "Sn", "Sb",
  "La", "Ce", "Nd", "Sm", "Eu", "Gd", "Dy", "Er", "Yb",
  "Hf", "Ta", "W", "Re", "Os", "Ir", "Pt", "Au", "Bi", "Al", "Mg", "Ca",
]);

const NON_CHEMICAL_EXACT = new Set([
  "I2C", "I2S", "W3C", "Y2K", "KN95", "SHOP2", "CI2", "Ti6Al4V",
  "B2B", "B2C", "C2B", "C2C", "O2O", "P2P", "P2C", "F2C",
]);

const SUB_CHARS: Record<string, string> = {
  "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4",
  "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9",
  "₊": "+", "₋": "-",
};

const SUP_CHARS: Record<string, string> = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4",
  "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
  "⁺": "+", "⁻": "-",
};

export function mapUnicodeSub(raw: string): string {
  return [...raw].map(ch => SUB_CHARS[ch] ?? ch).join("");
}

export function mapUnicodeSup(raw: string): string {
  return [...raw].map(ch => SUP_CHARS[ch] ?? ch).join("");
}

/** Multi-element lookalikes from virology, computing, pharmacology, and engineering. */
export function isNonChemicalToken(token: string): boolean {
  if (NON_CHEMICAL_EXACT.has(token))
    return true;
  // Influenza virus subtypes (H1N1, H3N2, H5N1, H7N9, H9N2...) and assay endpoints (IC50, CC50)
  return /^H\d{1,2}N\d{1,2}$/.test(token) || /^(?:IC|CC|TC|PC|FC|BC|NC|SC)50$/.test(token);
}

/** Exclude synthetic superheavy / ambiguous symbols when canonicalizing ALL-CAPS formulas. */
const ALLCAPS_EXCLUDED_TWO_CHAR = new Set([
  "PO", "NO", "BH", "HS", "MT", "DS", "RG", "CN", "NH", "FL", "MC", "LV", "TS", "OG",
  "AM", "AT", "AS", "IN", "IS", "IT", "OR", "OS", "PA", "PM", "RN", "FR", "AC", "ES", "MD", "BK", "CF", "FM", "LR",
]);
/* eslint-enable antfu/consistent-list-newline */

const ALLCAPS_ELEMENT_MAP = new Map<string, string>();
for (const sym of [...CHEM_ELEMENTS, "D"]) {
  const upper = sym.toUpperCase();
  if (sym.length === 2 && ALLCAPS_EXCLUDED_TWO_CHAR.has(upper))
    continue;
  ALLCAPS_ELEMENT_MAP.set(upper, sym);
}
// Re-admit common p-block / transition metals whose uppercase is unambiguous with digits
ALLCAPS_ELEMENT_MAP.set("IN", "In");
ALLCAPS_ELEMENT_MAP.set("AS", "As");
ALLCAPS_ELEMENT_MAP.set("OS", "Os");

function canonicalizeAllCapsCore(upper: string): string | null {
  const n = upper.length;
  const memo = new Set<number>();

  const dfs = (pos: number): string | null => {
    if (pos === n)
      return "";
    if (memo.has(pos))
      return null;

    const ch = upper[pos];
    if (ch === "(") {
      let depth = 1;
      let close = pos + 1;
      while (close < n && depth > 0) {
        if (upper[close] === "(")
          depth++;
        else if (upper[close] === ")")
          depth--;
        close++;
      }
      if (depth !== 0)
        return null;
      const inner = canonicalizeAllCapsCore(upper.slice(pos + 1, close - 1));
      if (!inner)
        return null;
      const numMatch = upper.slice(close).match(/^\d{1,3}(?:\.\d+)?/);
      const nextPos = close + (numMatch?.[0].length ?? 0);
      const tail = dfs(nextPos);
      if (tail !== null)
        return `(${inner})${numMatch?.[0] ?? ""}${tail}`;
      memo.add(pos);
      return null;
    }

    if (pos > 0 && (/^\^\d{1,3}[+−-]$/.test(upper.slice(pos)) || /^[+−-]$/.test(upper.slice(pos)))) {
      return upper.slice(pos);
    }

    const candidates: Array<[string, number]> = [];
    const two = upper.slice(pos, pos + 2);
    if (two.length === 2 && ALLCAPS_ELEMENT_MAP.has(two)) {
      if (two === "CO") {
        // Distinguish Carbon+Oxygen (CO2, CO3, CaCO3, HCO3-) from Cobalt (Co3O4, LiCoO2, CoS2, Co2+).
        const afterCO = upper.slice(pos + 2);
        const isCarbonOxide = /^[23](?:$|[)^+−-])/.test(afterCO) && !(pos === 0 && /^[23][+−-]$/.test(afterCO));
        if (isCarbonOxide) {
          candidates.push(["C", 1]);
          candidates.push(["Co", 2]);
        }
        else {
          candidates.push(["Co", 2]);
          candidates.push(["C", 1]);
        }
      }
      else {
        candidates.push([ALLCAPS_ELEMENT_MAP.get(two)!, 2]);
        if (ALLCAPS_ELEMENT_MAP.has(ch))
          candidates.push([ALLCAPS_ELEMENT_MAP.get(ch)!, 1]);
      }
    }
    else if (ALLCAPS_ELEMENT_MAP.has(ch)) {
      candidates.push([ALLCAPS_ELEMENT_MAP.get(ch)!, 1]);
    }

    for (const [sym, len] of candidates) {
      let afterSym = pos + len;
      let stoich = "";
      const numMatch = upper.slice(afterSym).match(/^_?\d{1,3}(?:\.\d+)?(?:[-−][XY])?/);
      if (numMatch) {
        stoich = numMatch[0].toLowerCase();
        afterSym += numMatch[0].length;
      }
      else if (pos === 0 && len === 2 && /^[234][+−-]$/.test(upper.slice(afterSym))) {
        return sym + upper.slice(afterSym);
      }
      const tail = dfs(afterSym);
      if (tail !== null)
        return sym + stoich + tail;
    }

    memo.add(pos);
    return null;
  };

  const leadMatch = upper.match(/^(?:\^\d{1,3}|\d{1,2})(?=[A-Z(])/);
  const startPos = leadMatch ? leadMatch[0].length : 0;
  const body = dfs(startPos);
  return body ? (leadMatch?.[0] ?? "") + body : null;
}

/** Restore canonical element casing for an ALL-CAPS token if it represents a chemical formula with digits. */
export function restoreAllCapsChemicalCandidate(upperToken: string): string | null {
  if (!/\d/.test(upperToken) || /\d{4}/.test(upperToken) || upperToken.length < 2)
    return null;
  let core = upperToken;
  let suffix = "";
  const mxene = core.match(/^(.+[CN]\d*)T([XZ])$/);
  if (mxene) {
    core = mxene[1];
    suffix = `T${mxene[2].toLowerCase()}`;
  }
  else {
    const catalysis = core.match(/^(.+\d)(RR|ER|OR)$/);
    if (catalysis) {
      core = catalysis[1];
      suffix = catalysis[2];
    }
  }
  const restored = canonicalizeAllCapsCore(core);
  if (!restored || isNonChemicalToken(restored))
    return null;
  return restored + suffix;
}
