import { describe, expect, it } from "vitest";
import response from "../../../test/data/crossref-nanolett-waveguides.json";
import { titlesAgree } from "../rules/tool-update-metadata/policy";
import { transformCrossrefWork } from "../rules/tool-update-metadata/services/crossref-service";
import { automaticSelection } from "./automatic-policy";
import { identityConflicts, reviewChanges } from "./policy";

const original = {
  itemType: "journalArticle" as const,
  title: "Polarization engineering of second-harmonic generation in 3R-MoS<sub>2</sub> waveguides",
  DOI: "10.1021/acs.nanolett.6c01388",
  publicationTitle: "",
  journalAbbreviation: "Nano Lett.",
  date: "2026-07-22",
  volume: "26",
  issue: "28",
  pages: "9051-9058",
  creators: [
    { creatorType: "author" as const, lastName: "Song", firstName: "" },
    { creatorType: "author" as const, lastName: "", firstName: "Junbo" },
    { creatorType: "author" as const, lastName: "Yin", firstName: "Yanzhen" },
  ],
};

function proposal() {
  const candidate = transformCrossrefWork(response.message);
  return {
    itemID: 1,
    original,
    candidate,
    source: "Crossref",
    blocked: false,
    identifier: { kind: "DOI" as const, value: original.DOI, source: "item" },
    conflicts: identityConflicts(original, candidate),
    changes: reviewChanges(original, candidate),
  };
}

describe("missing-field completion for the captured Nano Letters record", () => {
  it("recognizes a formula even when publisher XML puts whitespace before its subscript", () => {
    expect(titlesAgree(original.title, response.message.title[0])).toBe(true);
    expect(proposal().conflicts).toEqual([]);
  });

  it("retains word boundaries around nonnumeric subscript text", () => {
    expect(titlesAgree("A <sub>different</sub> method for layered materials", "A different method for layered materials")).toBe(true);
  });

  it("fills the empty journal and repairs authors without replacing existing title/date/pages", () => {
    const result = automaticSelection(proposal(), false, true);
    expect(result.reason).toBeUndefined();
    expect(result.selection?.fields.has("publicationTitle")).toBe(true);
    expect(result.selection?.fields.has("creators")).toBe(true);
    for (const field of ["title", "date", "pages", "volume", "issue"])
      expect(result.selection?.fields.has(field), field).toBe(false);
    expect(result.selection?.proposal.candidate.publicationTitle).toBe("Nano Letters");
  });

  it("still fills the journal while honoring a disabled author-repair switch", () => {
    const result = automaticSelection({ ...proposal(), excludedFields: ["creators" as const] }, false, false);
    expect(result.selection?.fields.has("publicationTitle")).toBe(true);
    expect(result.selection?.fields.has("creators")).toBe(false);
  });

  it("rejects contradictory DOI or genuinely unrelated titles", () => {
    const value = proposal();
    expect(automaticSelection({ ...value, candidate: { ...value.candidate, DOI: "10.1234/other" } }, true, true).reason).toBe("conflict");
    const candidate = { ...value.candidate, title: "A completely unrelated clinical study" };
    expect(automaticSelection({ ...value, candidate, conflicts: identityConflicts(original, candidate) }, false, true).reason).toBe("conflict");
  });
});
