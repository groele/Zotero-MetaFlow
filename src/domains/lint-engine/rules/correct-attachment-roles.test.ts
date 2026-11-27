import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyAttachment,
  CorrectAttachmentRoles,
  formatAttachmentFilename,
  formatAttachmentItemTitle,
  sanitizeComponent,
  truncateUtf8,
  utf8ByteLength,
} from "./correct-attachment-roles";

describe("correct-attachment-roles module", () => {
  describe("string and filename sanitization", () => {
    it("measures utf-8 byte length accurately across ASCII and CJK", () => {
      expect(utf8ByteLength("abc")).toBe(3);
      expect(utf8ByteLength("科学")).toBe(6);
      expect(utf8ByteLength("abc 科学 123")).toBe(14);
    });

    it("truncates UTF-8 strings at byte boundaries without splitting characters", () => {
      expect(truncateUtf8("abcdef", 4)).toBe("abcd");
      expect(truncateUtf8("科学研究", 6)).toBe("科学");
      expect(truncateUtf8("科学研究", 7)).toBe("科学");
    });

    it("sanitizes components stripping illegal filesystem chars", () => {
      expect(sanitizeComponent("Nature: A <Novel> Study?")).toBe("Nature A Novel Study");
      expect(sanitizeComponent("   spaces   ")).toBe("spaces");
      expect(sanitizeComponent("AUX")).toBe("_AUX");
      expect(sanitizeComponent("COM1")).toBe("_COM1");
      expect(sanitizeComponent("")).toBe("Untitled");
    });
  });

  describe("attachment classification", () => {
    const parentMeta = {
      title: "Vacuum level dependent photoluminescence in CVD MoS2",
      doi: "10.1038/s41598-017-15577-1",
      publicationTitle: "Scientific Reports",
      journalAbbreviation: "Sci. Rep.",
      firstAuthorLastName: "Sun",
      year: "2017",
    };

    it("identifies supplementary information by filename patterns", () => {
      const siFilenames = [
        "41598_2017_15577_MOESM1_ESM.pdf",
        "Sun_2017_SuppInfo.pdf",
        "nature12345_si.pdf",
        "supplementary_information.pdf",
        "Sun_2017_补充材料.pdf",
        "supporting_information_revised.pdf",
      ];

      for (const fn of siFilenames) {
        const res = classifyAttachment(fn, "", parentMeta);
        expect(res.role).toBe("supplement");
        expect(res.evidence).toContain("filename-supplement");
      }
    });

    it("identifies supplementary information by heading and figure text markers", () => {
      const text = `
        Supplementary Information
        Vacuum level dependent photoluminescence in CVD MoS2
        Figure S1: AFM topography and Raman spectra of monolayer MoS2.
        Table S1: Summary of photoluminescence peak positions.
      `;

      const res = classifyAttachment("document.pdf", text, parentMeta);
      expect(res.role).toBe("supplement");
      expect(res.evidence).toContain("heading-supplement");
      expect(res.evidence).toContain("figure-supplement");
    });

    it("identifies main manuscript from parent DOI, title, journal and metadata", () => {
      const mainText = `
        Scientific Reports | 7:16714 | DOI:10.1038/s41598-017-15577-1
        Vacuum level dependent photoluminescence in chemical vapor deposition-grown monolayer MoS2
        Linfeng Sun, Xiaoming Zhang, Fucai Liu, Youde Shen, Xiaofeng Fan
        Received: 21 August 2017
        Accepted: 17 November 2017
        Published online: 01 December 2017
        Abstract: Monolayer molybdenum disulfide (MoS2) has attracted extensive interest...
      `;

      const res = classifyAttachment("s41598-017-15577-1.pdf", mainText, parentMeta);
      expect(res.role).toBe("main_pdf");
      expect(res.evidence).toContain("parent-doi");
      expect(res.evidence).toContain("parent-title");
      expect(res.evidence).toContain("parent-journal");
    });

    it("identifies main manuscript from filename markers", () => {
      const res = classifyAttachment("Sun_2017_Main.pdf", "", parentMeta);
      expect(res.role).toBe("main_pdf");
      expect(res.evidence).toContain("filename-main");
    });
  });

  describe("safe renaming and title formatting", () => {
    const parentMeta = {
      title: "Vacuum level dependent photoluminescence in CVD MoS2",
      firstAuthorLastName: "Sun",
      year: "2017",
    };

    it("formats main and supplement filenames according to template", () => {
      const mainFn = formatAttachmentFilename(parentMeta, "main_pdf");
      expect(mainFn).toBe("Sun_2017_Vacuum level dependent photoluminescence in CVD MoS2_Main.pdf");

      const siFn1 = formatAttachmentFilename(parentMeta, "supplement", 1);
      expect(siFn1).toBe("Sun_2017_Vacuum level dependent photoluminescence in CVD MoS2_Supplement.pdf");

      const siFn2 = formatAttachmentFilename(parentMeta, "supplement", 2);
      expect(siFn2).toBe("Sun_2017_Vacuum level dependent photoluminescence in CVD MoS2_Supplement__2.pdf");

      const customFn = formatAttachmentFilename(parentMeta, "supplement", 1, "{year}_{author}_{role}");
      expect(customFn).toBe("2017_Sun_Supplement.pdf");
    });

    it("formats attachment titles and avoids compounding tags", () => {
      const mainTitle = formatAttachmentItemTitle("", "Vacuum level dependent photoluminescence", "main_pdf");
      expect(mainTitle).toBe("[正文] Vacuum level dependent photoluminescence");

      // Idempotency: re-running does not compound [正文]
      const mainTitleAgain = formatAttachmentItemTitle(mainTitle, mainTitle, "main_pdf");
      expect(mainTitleAgain).toBe("[正文] Vacuum level dependent photoluminescence");

      const siTitle1 = formatAttachmentItemTitle("", "Vacuum level dependent photoluminescence", "supplement", 1);
      expect(siTitle1).toBe("[补充材料] Vacuum level dependent photoluminescence");

      const siTitle2 = formatAttachmentItemTitle("", "Vacuum level dependent photoluminescence", "supplement", 2);
      expect(siTitle2).toBe("[补充材料 2] Vacuum level dependent photoluminescence");
    });
  });

  describe("correctAttachmentRoles rule execution", () => {
    beforeEach(() => {
      (globalThis as any).Zotero = {
        Prefs: {
          get: vi.fn((key: string) => {
            if (key === "extensions.zotero.metaref.rule.correct-attachment-roles")
              return true;
            if (key === "extensions.zotero.metaref.rule.correct-attachment-roles.renamePdf")
              return true;
            if (key === "extensions.zotero.metaref.rule.correct-attachment-roles.syncTitle")
              return true;
            return undefined;
          }),
        },
        Items: {
          getAsync: vi.fn(),
          get: vi.fn(),
        },
      };
    });

    it("skips when rule is disabled in preferences", async () => {
      (globalThis as any).Zotero.Prefs.get.mockReturnValue(false);

      const item: any = {
        isEditable: vi.fn(() => true),
        isRegularItem: vi.fn(() => true),
        getAttachments: vi.fn(() => [1, 2]),
      };

      const report = vi.fn();
      await CorrectAttachmentRoles.apply({ item, options: {}, debug: vi.fn(), report });

      expect(item.getAttachments).not.toHaveBeenCalled();
      expect(report).not.toHaveBeenCalled();
    });

    it("skips when item is read-only", async () => {
      const item: any = {
        isEditable: vi.fn(() => false),
        isRegularItem: vi.fn(() => true),
        getAttachments: vi.fn(() => [1, 2]),
      };

      const report = vi.fn();
      await CorrectAttachmentRoles.apply({ item, options: {}, debug: vi.fn(), report });

      expect(item.getAttachments).not.toHaveBeenCalled();
      expect(report).not.toHaveBeenCalled();
    });

    it("decouples main manuscript and supplementary information attachments", async () => {
      const mainAtt: any = {
        id: 101,
        isAttachment: () => true,
        attachmentContentType: "application/pdf",
        attachmentFilename: "article_main.pdf",
        attachmentText: Promise.resolve("Scientific Reports DOI:10.1038/s41598-017-15577-1 Abstract"),
        getField: vi.fn(() => "article_main.pdf"),
        setField: vi.fn(),
        renameAttachmentFile: vi.fn(() => Promise.resolve(true)),
        saveTx: vi.fn(() => Promise.resolve()),
      };

      const siAtt: any = {
        id: 102,
        isAttachment: () => true,
        attachmentContentType: "application/pdf",
        attachmentFilename: "supp_info_table.pdf",
        attachmentText: Promise.resolve("Supplementary Information Figure S1"),
        getField: vi.fn(() => "supp_info_table.pdf"),
        setField: vi.fn(),
        renameAttachmentFile: vi.fn(() => Promise.resolve(true)),
        saveTx: vi.fn(() => Promise.resolve()),
      };

      (globalThis as any).Zotero.Items.getAsync.mockImplementation((id: number) => {
        if (id === 101)
          return Promise.resolve(mainAtt);
        if (id === 102)
          return Promise.resolve(siAtt);
        return Promise.resolve(null);
      });

      const parentItem: any = {
        id: 10,
        isEditable: () => true,
        isRegularItem: () => true,
        getAttachments: () => [101, 102],
        getField: vi.fn((f: string) => {
          if (f === "title")
            return "MoS2 Photoluminescence Study";
          if (f === "DOI")
            return "10.1038/s41598-017-15577-1";
          if (f === "publicationTitle")
            return "Scientific Reports";
          if (f === "date")
            return "2017-12-01";
          return "";
        }),
        getCreators: () => [{ lastName: "Sun", firstName: "Linfeng" }],
      };

      const report = vi.fn();
      await CorrectAttachmentRoles.apply({ item: parentItem, options: {}, debug: vi.fn(), report });

      // Main attachment verified
      expect(mainAtt.setField).toHaveBeenCalledWith("title", "[正文] MoS2 Photoluminescence Study");
      expect(mainAtt.renameAttachmentFile).toHaveBeenCalledWith("Sun_2017_MoS2 Photoluminescence Study_Main.pdf");
      expect(mainAtt.saveTx).toHaveBeenCalled();

      // SI attachment verified
      expect(siAtt.setField).toHaveBeenCalledWith("title", "[补充材料] MoS2 Photoluminescence Study");
      expect(siAtt.renameAttachmentFile).toHaveBeenCalledWith("Sun_2017_MoS2 Photoluminescence Study_Supplement.pdf");
      expect(siAtt.saveTx).toHaveBeenCalled();

      // Report called
      expect(report).toHaveBeenCalledWith(expect.objectContaining({
        level: "info",
      }));
    });
  });
});
