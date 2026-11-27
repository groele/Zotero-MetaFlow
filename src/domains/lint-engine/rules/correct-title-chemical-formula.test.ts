import { describe, expect, it } from "vitest";
import sentenceCase from "../../../../test/data/sentenceCase.json";
import {
  containsValidElementsOnly,
  CorrectTitleChemicalFormula,
  formatChemicalFormula,
  formatPart,
} from "./correct-title-chemical-formula";
import { toSentenceCase } from "./correct-title-sentence-case";

describe("containsValidElementsOnly", () => {
  it("recognizes element-only tokens including D and T isotopes", () => {
    const map: Record<string, boolean> = {
      "Na-": true,
      "Co3O4": true,
      "H2O": true,
      "D2O": true,
      "CDCl3": true,
      "HAP": false,
      "HTML5": false,
      "3D": false,
      "goal-": false,
      "P3": true,
      "C4": true,
    };
    Object.entries(map).forEach(([input, expected]) => {
      expect(containsValidElementsOnly(input)).toBe(expected);
    });
  });
});

describe("formatPart", () => {
  it("skips tokens without numbers or outside chemical lexicon", () => {
    expect(formatPart("NaCl")).toBe("NaCl");
    expect(formatPart("SAIHOP2")).toBe("SAIHOP2");
  });

  it("formats ionic charges and parenthesized stoichiometry", () => {
    expect(formatPart("Na-")).toBe("Na<sup>-</sup>");
    expect(formatPart("Co2+")).toBe("Co<sup>2+</sup>");
    expect(formatPart("O2-")).toBe("O<sup>2-</sup>");
    expect(formatPart("Co(2+)")).toBe("Co<sup>2+</sup>");
    expect(formatPart("O(2-)")).toBe("O<sup>2-</sup>");
    expect(formatPart("NO2")).toBe("NO<sub>2</sub>");
    expect(formatPart("Co3O4")).toBe("Co<sub>3</sub>O<sub>4</sub>");
    expect(formatPart("Mn0.1Co0.9Co2O4")).toBe("Mn<sub>0.1</sub>Co<sub>0.9</sub>Co<sub>2</sub>O<sub>4</sub>");
    expect(formatPart("Co_3O_4")).toBe("Co<sub>3</sub>O<sub>4</sub>");
    expect(formatPart("NO(2)")).toBe("NO<sub>2</sub>");
    expect(formatPart("N(2)O")).toBe("N<sub>2</sub>O");
    expect(formatPart("Fe(NO3)3")).toBe("Fe(NO<sub>3</sub>)<sub>3</sub>");
  });
});

const data: Record<string, string> = {
  "A study of NO conversion into NO2 and N2O over Co3O4 catalyst":
    "A study of NO conversion into NO<sub>2</sub> and N<sub>2</sub>O over Co<sub>3</sub>O<sub>4</sub> catalyst",
  "Co-existence of atomically dispersed Ru and Ce3+ sites is responsible for excellent low temperature N2O reduction activity of Ru/CeO2":
    "Co-existence of atomically dispersed Ru and Ce<sup>3+</sup> sites is responsible for excellent low temperature N<sub>2</sub>O reduction activity of Ru/CeO<sub>2</sub>",
  "A study of NO conversion into NO_2 and N_2O over Co_3O_4 catalyst":
    "A study of NO conversion into NO<sub>2</sub> and N<sub>2</sub>O over Co<sub>3</sub>O<sub>4</sub> catalyst",
  "A study of NO conversion into NO<sub>2</sub> and N<sub>2</sub>O over Co<sub>3</sub>O<sub>4</sub> catalyst":
    "A study of NO conversion into NO<sub>2</sub> and N<sub>2</sub>O over Co<sub>3</sub>O<sub>4</sub> catalyst",
};

describe("transformTitle", () => {
  it("does not corrupt any title in the entire official sentenceCase corpus", () => {
    Object.values(sentenceCase).forEach((expected) => {
      expect(formatChemicalFormula(expected)).toBe(expected);
    });
  });

  Object.entries(data).forEach(([title, expected], index) => {
    it(`transforms benchmark formula ${index}`, () => {
      expect(formatChemicalFormula(title)).toBe(expected);
    });
  });

  it("preserves existing HTML tags and formats untagged formulas", () => {
    expect(formatChemicalFormula("Study of <i>Escherichia coli</i> with H2O and TiO2"))
      .toBe("Study of <i>Escherichia coli</i> with H<sub>2</sub>O and TiO<sub>2</sub>");
    expect(formatChemicalFormula("NO<sub>2</sub> and N2O"))
      .toBe("NO<sub>2</sub> and N<sub>2</sub>O");
  });

  it("cleans inter-formula spaces and hydrate dots", () => {
    expect(formatChemicalFormula("ReS 2")).toBe("ReS<sub>2</sub>");
    expect(formatChemicalFormula("CuInP2 S6")).toBe("CuInP<sub>2</sub>S<sub>6</sub>");
    expect(formatChemicalFormula("MoS2 / WS2")).toBe("MoS<sub>2</sub>/WS<sub>2</sub>");
    expect(formatChemicalFormula("Bi2O2 Se")).toBe("Bi<sub>2</sub>O<sub>2</sub>Se");
    expect(formatChemicalFormula("CuSO4 · 5H2O")).toBe("CuSO<sub>4</sub>·5H<sub>2</sub>O");
  });

  it("protects 4-digit years and cross-disciplinary non-chemical identifiers", () => {
    expect(formatChemicalFormula("C2024 research report (2024)")).toBe("C2024 research report (2024)");
    for (const title of [
      "F1 score and F1-score in V2 and S3 benchmarks",
      "H1N1, H5N1, H7N9 and H3N2 influenza viruses",
      "Cytochrome P450, P53 signaling, Vitamin B12 and B6",
      "I2C bus, I2S interface, W3C standard, Y2K and K12 education",
      "N95 and KN95 respirators in B2B, O2O and P2P commerce",
      "IC50 and CC50 assays on C4 plants, C4.5 trees and Ti6Al4V alloy",
      "<sub>H2 O</sub> <sup>Fe3+</sup>",
      "<span class='nocase'>MoS2 / WS2</span>",
      "<nc>Bi<sub>2</sub>O<sub>2</sub> Se</nc>",
      "HTML5 RNA2 C2024 MoS1234 3D 2D H2O2x",
      "Method / Results in 2024",
      "response2 / WS<sub>2</sub>",
      "<i title='H2O'>Water</i>",
    ]) {
      expect(formatChemicalFormula(title)).toBe(title);
    }
  });

  it("formats mixed stoichiometry, grouping and charges in one pass", () => {
    expect(formatChemicalFormula("NH4+ (NH4)2SO4 SO4^2- H_2O2 Pd2+"))
      .toBe("NH<sub>4</sub><sup>+</sup> (NH<sub>4</sub>)<sub>2</sub>SO<sub>4</sub> SO<sub>4</sub><sup>2-</sup> H<sub>2</sub>O<sub>2</sub> Pd<sup>2+</sup>");
  });

  it("preserves boundary between Unicode subscripts and superscripts in polyatomic ions and isotopes", () => {
    expect(formatChemicalFormula("Adsorption of PO₄³⁻, SO₄²⁻, CO₃²⁻, Cr₂O₇²⁻ and [Fe(CN)6]³⁻"))
      .toBe("Adsorption of PO<sub>4</sub><sup>3-</sup>, SO<sub>4</sub><sup>2-</sup>, CO<sub>3</sub><sup>2-</sup>, Cr<sub>2</sub>O<sub>7</sub><sup>2-</sup> and [Fe(CN)<sub>6</sub>]<sup>3-</sup>");
    expect(formatChemicalFormula("¹³C NMR, ¹⁵N, ¹⁸O₂ tracing of ¹³CO₂ and ^13C-labeled ^18O2 vs 14C"))
      .toBe("<sup>13</sup>C NMR, <sup>15</sup>N, <sup>18</sup>O<sub>2</sub> tracing of <sup>13</sup>CO<sub>2</sub> and <sup>13</sup>C-labeled <sup>18</sup>O<sub>2</sub> vs 14C");
  });

  it("supports deuterium/tritium, electrocatalysis suffixes, MXenes, single-atom sites and variable doping", () => {
    expect(formatChemicalFormula("Solvent effects in D2O, CDCl3, CD3OD, ND3 and D2/T2 exchange"))
      .toBe("Solvent effects in D<sub>2</sub>O, CDCl<sub>3</sub>, CD<sub>3</sub>OD, ND<sub>3</sub> and D<sub>2</sub>/T<sub>2</sub> exchange");
    expect(formatChemicalFormula("Electrocatalytic CO2RR, N2RR and NO3RR on Fe-N4, Co-N4 and M-N4 sites"))
      .toBe("Electrocatalytic CO<sub>2</sub>RR, N<sub>2</sub>RR and NO<sub>3</sub>RR on Fe-N<sub>4</sub>, Co-N<sub>4</sub> and M-N<sub>4</sub> sites");
    expect(formatChemicalFormula("2D Ti3C2Tx, V2CTx and Mo2TiC2Tx MXene nanosheets"))
      .toBe("2D Ti<sub>3</sub>C<sub>2</sub>T<sub>x</sub>, V<sub>2</sub>CT<sub>x</sub> and Mo<sub>2</sub>TiC<sub>2</sub>T<sub>x</sub> MXene nanosheets");
    expect(formatChemicalFormula("Perovskite CsPbI3-xBrx, La1-xSrxMnO3, LiNixCoyMn1-x-yO2 and NOx/SOx removal"))
      .toBe("Perovskite CsPbI<sub>3-x</sub>Br<sub>x</sub>, La<sub>1-x</sub>Sr<sub>x</sub>MnO<sub>3</sub>, LiNi<sub>x</sub>Co<sub>y</sub>Mn<sub>1-x-y</sub>O<sub>2</sub> and NO<sub>x</sub>/SO<sub>x</sub> removal");
  });

  it("completes partially formatted formulas and respects normalizeSpaces option", () => {
    expect(formatChemicalFormula("Fe<sub>2</sub>O3 and MoS<sub>2</sub> / WS2"))
      .toBe("Fe<sub>2</sub>O<sub>3</sub> and MoS<sub>2</sub>/WS<sub>2</sub>");
    expect(formatChemicalFormula("ReS 2 MoS2 / WS2", { normalizeSpaces: false }))
      .toBe("ReS 2 MoS<sub>2</sub> / WS<sub>2</sub>");
  });

  it("formats ALL-CAPS titles cleanly after toSentenceCase without CO2 -> Co2 corruption", () => {
    const raw = "CO2 REDUCTION AND CO2RR ON 1T-MOS2, TI3C2TX, FE-N4, LIFEPO4 AND CO3O4 CATALYSTS";
    const cased = toSentenceCase(raw);
    expect(cased).toBe("CO2 reduction and CO2RR on 1T-MoS2, Ti3C2Tx, Fe-N4, LiFePO4 and Co3O4 catalysts");
    expect(formatChemicalFormula(cased))
      .toBe("CO<sub>2</sub> reduction and CO<sub>2</sub>RR on 1T-MoS<sub>2</sub>, Ti<sub>3</sub>C<sub>2</sub>T<sub>x</sub>, Fe-N<sub>4</sub>, LiFePO<sub>4</sub> and Co<sub>3</sub>O<sub>4</sub> catalysts");
  });

  it("is idempotent across all supported notations", () => {
    for (const title of [
      ...Object.keys(data),
      "Fe(NO3)3 NH4+ SO4^2- PO₄³⁻ ¹³CO₂ ^15NH4+ Mn0.1Co2.9O4",
      "MoS2 / WS2 CuInP2 S6 Bi2O2 Se ReS 2 CuSO4 · 5H2O",
      "CO2RR N2RR Ti3C2Tx Fe-N4 CsPbI3-xBrx D2O CDCl3 NOx",
      "<i>H2O</i> <span class='nocase'>TiO2</span>",
      "Na+, O2-; Pd2+ and 14C",
    ]) {
      const first = formatChemicalFormula(title);
      expect(formatChemicalFormula(first)).toBe(first);
    }
  });

  it("applies to title, shortTitle, bookTitle and proceedingsTitle when valid on item", async () => {
    const fields = new Map<string, string>([
      ["title", "CO2RR over Ti3C2Tx"],
      ["shortTitle", "CO2RR"],
      ["proceedingsTitle", "Symposium on H2SO4 and LiFePO4"],
    ]);
    (globalThis as any).Zotero = {
      ItemFields: {
        getID: (f: string) => fields.has(f) ? f : false,
        isValidForType: (id: string) => fields.has(id),
      },
      ItemTypes: { getID: () => 1 },
    };
    const item = {
      itemType: "conferencePaper",
      getField: (f: string) => fields.get(f) ?? "",
      setField: (f: string, v: string) => fields.set(f, v),
    } as unknown as Zotero.Item;

    await CorrectTitleChemicalFormula.apply({
      item,
      options: {},
      debug: () => {},
      report: () => {},
    });

    expect(fields.get("title")).toBe("CO<sub>2</sub>RR over Ti<sub>3</sub>C<sub>2</sub>T<sub>x</sub>");
    expect(fields.get("shortTitle")).toBe("CO<sub>2</sub>RR");
    expect(fields.get("proceedingsTitle")).toBe("Symposium on H<sub>2</sub>SO<sub>4</sub> and LiFePO<sub>4</sub>");
  });
});
