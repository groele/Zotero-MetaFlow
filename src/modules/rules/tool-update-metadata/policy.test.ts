import { describe, expect, it } from "vitest";
import { mergeMetadata, metadataIdentity, metadataMissing, metadataValuesEqual, normalizeDOI, titlesAgree } from "./policy";

describe("metadata identity and completion", () => {
  it("normalizes resolver forms and rejects a different DOI even for an identical title", () => {
    expect(normalizeDOI("https://doi.org/10.1234/ABC")).toBe("10.1234/abc");
    expect(metadataIdentity({ title: "Same title" }, { DOI: "10.1234/abc" }, { title: "Same title", DOI: "10.9999/wrong" }, "identifier")).toBe(false);
    expect(metadataIdentity({}, { DOI: "10.1234/ABC" }, { DOI: "https://doi.org/10.1234/abc" })).toBe("identifier");
  });
  it("accepts an exact identifier lookup without a returned DOI, but rejects unanchored responses", () => {
    expect(metadataIdentity({}, { PMID: "123" }, { title: "Result" }, "identifier")).toBe("identifier");
    expect(metadataIdentity({ title: "Original" }, {}, { title: "Unrelated" })).toBe(false);
    expect(metadataIdentity({}, {}, { title: "Unrelated" }, "identifier")).toBe(false);
  });
  it("allows documented identifier enrichment to provide the expected published DOI", () => {
    expect(metadataIdentity({ title: "Preprint" }, { arXiv: "2401.12345", DOI: "10.1234/published" }, { DOI: "10.1234/published", title: "Published work" }, "identifier")).toBe("identifier");
  });
  it("requires a strong title match and compatible year for metadata search", () => {
    expect(titlesAgree("Spin dynamics in MoS2", "SPIN dynamics in MoS2.")).toBe(true);
    expect(titlesAgree("Spin dynamics in MoS2", "Spin dynamics in WS2")).toBe(false);
    expect(titlesAgree("基于深度学习的图像识别方法研究", "基于深度学习的语音识别方法研究")).toBe(false);
    expect(titlesAgree("基于深度学习的图像去噪算法研究", "基于深度学习的图像去噪算法研究——以医学图像为例")).toBe(true);
    expect(titlesAgree("Ferroelectricity in ReS2 - Chen - 2024 - Advanced Materials - Wiley Online Library", "Ferroelectricity in ReS2")).toBe(true);
    expect(titlesAgree("Graphene Oxide Membranes - ScienceDirect", "Graphene Oxide Membranes")).toBe(true);
    expect(metadataIdentity({ title: "Same title", date: "2020" }, {}, { title: "Same title", date: "2025" })).toBe(false);
  });
  it("compares HTML and indented MathML formulas without treating formatting as a different work", () => {
    const html = "Ultrafast moiré-resolved spectroscopy of interlayer-exciton thermalization in twisted WSe<sub>2</sub>/WS<sub>2</sub> heterobilayers";
    const formula = "<mml:math xmlns:mml=\"http://www.w3.org/1998/Math/MathML\"><mml:mrow>\n <mml:msub><mml:mi>WSe</mml:mi>\n <mml:mn>2</mml:mn></mml:msub><mml:mo>/</mml:mo>\n <mml:msub><mml:mi>WS</mml:mi><mml:mn>2</mml:mn></mml:msub></mml:mrow></mml:math>";
    expect(titlesAgree(html, html.replace("WSe<sub>2</sub>/WS<sub>2</sub>", formula))).toBe(true);
    expect(titlesAgree("Optical response in WSe<sub>2</sub>", "Optical response in WS<sub>2</sub>")).toBe(false);
    expect(titlesAgree("<i>Spin</i> dynamics", "Spin dynamics")).toBe(true);
  });
  it("fills missing fields without letting a later service overwrite earlier data", () => {
    expect(mergeMetadata({ title: "First", creators: [] }, { title: "Second", date: "2026", creators: [{ creatorType: "author", lastName: "Doe" }] }))
      .toEqual({ title: "First", date: "2026", creators: [{ creatorType: "author", lastName: "Doe" }] });
    expect(metadataMissing({ DOI: "10.1234/a" }, { title: "Original" }, "blank", "journalArticle"))
      .toEqual(["date", "creators", "publicationTitle"]);
  });
});

it("compares access dates by UTC time while preserving actual concurrent edits", () => {
  expect(metadataValuesEqual("accessDate", "2026-10-16T04:05:06Z", "2026-10-16 04:05:06")).toBe(true);
  expect(metadataValuesEqual("accessDate", "2026-10-16T04:05:06Z", "2026-10-16 04:05:07")).toBe(false);
  expect(metadataValuesEqual("accessDate", "invalid", "different")).toBe(false);
  expect(metadataValuesEqual("title", "2026-10-16T04:05:06Z", "2026-10-16 04:05:06")).toBe(false);
});
