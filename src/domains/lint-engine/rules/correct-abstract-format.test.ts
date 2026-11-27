import { describe, expect, it } from "vitest";
import { normalizeAbstract } from "./correct-abstract-format";

describe("abstract formatting", () => {
  it("repairs the publisher's separated formula and ion fragments", () => {
    const input = "ABSTRACT\n            \n Polarization, a fundamental degree of\n light. WSe\n 2\n /CuInP\n 2\n S\n 6\n (CIPS) breaks the symmetry of WSe\n 2\n , through Cu\n +\n displacement.";
    expect(normalizeAbstract(input)).toBe("Polarization, a fundamental degree of light. WSe2/CuInP2S6 (CIPS) breaks the symmetry of WSe2, through Cu+ displacement.");
  });

  it("preserves structured paragraphs, wording, numbers and prose spaces", () => {
    expect(normalizeAbstract(" Background:  Trial 2\r\n includes 20 patients.\r\n\r\nResults: p < 0.05.\r\n\r\nConclusion: Effective. "))
      .toBe("Background: Trial 2 includes 20 patients.\n\nResults: p < 0.05.\n\nConclusion: Effective.");
    expect(normalizeAbstract("Phase\n2\nwas studied with C\n12\nand I\nV\nin groups."))
      .toBe("Phase 2 was studied with C 12 and I V in groups.");
  });

  it("keeps rich text and word boundaries around inline tags", () => {
    expect(normalizeAbstract("Some  <i>important</i>  findings with WSe\n <sub> 2 </sub> and Cu\n <sup> + </sup>."))
      .toBe("Some <i>important</i> findings with WSe<sub>2</sub> and Cu<sup>+</sup>.");
    expect(normalizeAbstract("First paragraph.\n\n <i>Second</i> paragraph.\n\nThird paragraph."))
      .toBe("First paragraph.\n\n<i>Second</i> paragraph.\n\nThird paragraph.");
  });

  it("cleans Chinese and Unicode whitespace and removes only standalone headings", () => {
    expect(normalizeAbstract("摘要\n\n 这是\u3000 一个\n 测试。\u200B ")).toBe("这是一个测试。");
    expect(normalizeAbstract("Abstract reasoning is useful.\n More text.")).toBe("Abstract reasoning is useful. More text.");
    expect(normalizeAbstract("")).toBe("");
  });

  it("is idempotent", () => {
    const input = "ABSTRACT\n\n With WSe\n2\n /CuInP\n2\nS\n6\n and Cu\n+\n ions.\n\nResults:  A   result.";
    const once = normalizeAbstract(input);
    expect(normalizeAbstract(once)).toBe(once);
  });
});
