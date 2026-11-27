import { describe, expect, it } from "vitest";
import { extractCrossrefEditorialNotice, extractCrossrefPublishedDOI, transformCrossrefWork } from "./crossref-service";

describe("crossrefService transformation", () => {
  it("transforms official Crossref JSON into complete TransformedData", () => {
    const crossrefMessage = {
      "DOI": "10.1002/adma.202404734",
      "type": "journal-article",
      "title": ["Constructing Slip Stacking Diversity in Van der Waals Homobilayers"],
      "author": [
        { given: "Yun", family: "Chen", sequence: "first" },
        { given: "Jinguo", family: "Lin", sequence: "additional" },
      ],
      "container-title": ["Advanced Materials"],
      "short-container-title": ["Adv. Mater."],
      "volume": 36,
      "issue": "40",
      "page": "2404734",
      "ISSN": ["0935-9648", "1521-4095"],
      "published-online": { "date-parts": [[2024, 7, 28]] },
      "publisher": "Wiley",
      "abstract": "<jats:title>Abstract</jats:title><jats:p>The van der Waals interface provides two important degrees of freedom.</jats:p>",
    };

    const transformed = transformCrossrefWork(crossrefMessage as any);

    expect(transformed.itemType).toBe("journalArticle");
    expect(transformed.title).toBe("Constructing Slip Stacking Diversity in Van der Waals Homobilayers");
    expect(transformed.creators).toEqual([
      { firstName: "Yun", lastName: "Chen", creatorType: "author" },
      { firstName: "Jinguo", lastName: "Lin", creatorType: "author" },
    ]);
    expect(transformed.publicationTitle).toBe("Advanced Materials");
    expect(transformed.journalAbbreviation).toBe("Adv. Mater.");
    expect(transformed.volume).toBe("36");
    expect(transformed.issue).toBe("40");
    expect(transformed.pages).toBe("2404734");
    expect(transformed.DOI).toBe("10.1002/adma.202404734");
    expect(transformed.ISSN).toBe("0935-9648");
    expect(transformed.date).toBe("2024-07-28");
    expect(transformed.publisher).toBe("Wiley");
    expect(transformed.abstractNote).toBe("The van der Waals interface provides two important degrees of freedom.");
    expect(transformed.libraryCatalog).toBe("Crossref");
  });

  it("handles conference paper and single-field creator correctly", () => {
    const proceedingsMessage = {
      "DOI": "10.1145/1234567.890",
      "type": "proceedings-article",
      "title": ["Scalable Graph Learning"],
      "author": [{ name: "ACM SIGKDD Committee" }],
      "container-title": ["Proceedings of KDD 2024"],
      "issued": { "date-parts": [[2024]] },
    };

    const transformed = transformCrossrefWork(proceedingsMessage as any);

    expect(transformed.itemType).toBe("conferencePaper");
    expect(transformed.title).toBe("Scalable Graph Learning");
    expect(transformed.proceedingsTitle).toBe("Proceedings of KDD 2024");
    expect(transformed.publicationTitle).toBeUndefined();
    expect(transformed.creators).toEqual([
      { name: "ACM SIGKDD Committee", creatorType: "author" },
    ]);
    expect(transformed.date).toBe("2024");
  });

  it("extracts editorial notices (Retracted, Expression of Concern, Correction) and published preprint DOIs", () => {
    const retractedWork = {
      "DOI": "10.1038/s41586-020-00000-x",
      "type": "journal-article",
      "title": ["Retracted Study"],
      "update-to": [{ type: "retraction", label: "Retraction", DOI: "10.1038/s41586-024-99999-z" }],
    };
    expect(extractCrossrefEditorialNotice(retractedWork as any)).toEqual({
      kind: "retracted",
      label: "Retracted",
      doi: "10.1038/s41586-024-99999-z",
    });
    expect(transformCrossrefWork(retractedWork as any).extra).toBe("Editorial Notice: Retracted (10.1038/s41586-024-99999-z)");

    const concernWork = {
      "DOI": "10.1016/j.cell.2023.01.001",
      "update-to": [{ type: "expression_of_concern", label: "Expression of Concern" }],
    };
    expect(extractCrossrefEditorialNotice(concernWork as any)?.kind).toBe("concern");

    const correctionWork = {
      "DOI": "10.1016/j.cell.2023.01.002",
      "update-to": [{ type: "erratum", label: "Corrigendum" }],
    };
    expect(extractCrossrefEditorialNotice(correctionWork as any)?.kind).toBe("correction");

    const biorxivWork = {
      DOI: "10.1101/2024.01.01.573822",
      relation: {
        "is-preprint-of": [{ "id-type": "doi", "id": "10.1038/s41586-024-07555-1" }],
      },
    };
    expect(extractCrossrefPublishedDOI(biorxivWork as any)).toBe("10.1038/s41586-024-07555-1");
  });
});
