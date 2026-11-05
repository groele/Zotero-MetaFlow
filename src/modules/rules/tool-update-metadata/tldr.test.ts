// autocorrect-disable
import { describe, expect, it, vi } from "vitest";
import {
  backfillItemTLDR,
  cleanseTLDRFromExtra,
  escapeHTML,
  extractTLDRFromExtra,
  extractTLDRFromItem,
  extractTLDRFromNote,
  findExistingTLDRNote,
  resolvePaperIDForTLDR,
  saveTLDRToAbstract,
  saveTLDRToExtra,
  saveTLDRToNote,
  unescapeHTML,
} from "./tldr";

vi.mock("./services/semantic-scholar-service", () => ({
  fetchPaperTLDR: vi.fn(async (paperID: string) => {
    if (paperID.includes("not-found"))
      return undefined;
    return "This paper presents a scalable method for large language models.";
  }),
  parsePaperID: vi.fn((type: string, value: string) => `${type}:${value}`),
}));

vi.mock("../../../utils/locale", () => ({
  getString: vi.fn((key: string, options?: any) => {
    if (options?.args?.target)
      return `Saved to ${options.args.target}`;
    return key;
  }),
}));

describe("tldr extraction and manipulation", () => {
  it("escapes and unescapes HTML special characters", () => {
    const escaped = escapeHTML("<script>alert('xss') & \"safe\"</script>");
    expect(escaped).toBe("&lt;script&gt;alert(&#039;xss&#039;) &amp; &quot;safe&quot;&lt;/script&gt;");
    expect(unescapeHTML(escaped)).toBe("<script>alert('xss') & \"safe\"</script>");
  });

  it("extracts TLDR from extra field without interfering with remark or 简记", () => {
    expect(extractTLDRFromExtra("")).toBeUndefined();
    expect(extractTLDRFromExtra("TLDR:   ")).toBeUndefined();
    expect(extractTLDRFromExtra("PMID: 123456\nTLDR: A concise paper summary.\nDOI: 10.1234/test"))
      .toBe("A concise paper summary.");
    expect(extractTLDRFromExtra("TL;DR: Another format supported."))
      .toBe("Another format supported.");
    expect(extractTLDRFromExtra("撷论: 中文冒号与前缀测试"))
      .toBe("中文冒号与前缀测试");
    expect(extractTLDRFromExtra("撷论：全角冒号测试"))
      .toBe("全角冒号测试");
    expect(extractTLDRFromExtra("💡 撷论: 带灯泡图标的前缀"))
      .toBe("带灯泡图标的前缀");
    // 用户的 remark / 简记 必须完全隔离，绝不被提取为 TLDR
    expect(extractTLDRFromExtra("remark: Ethereal Style 简记测试"))
      .toBeUndefined();
    expect(extractTLDRFromExtra("简记: 中文简记列测试"))
      .toBeUndefined();
    expect(extractTLDRFromExtra("💡 remark: 带灯泡的简记测试"))
      .toBeUndefined();
    expect(extractTLDRFromExtra("remark: 用户个人简记\nTLDR: 真正的学术论点"))
      .toBe("真正的学术论点");
  });

  it("extracts TLDR from HTML note formats and decodes entities", () => {
    const html1 = "<div data-metaflow-tldr=\"true\"><p><strong>💡 撷论 (Semantic Scholar TL;DR)</strong></p><blockquote style=\"...\">A key finding &amp; discovery.</blockquote></div>";
    expect(extractTLDRFromNote(html1)).toBe("A key finding & discovery.");

    const html2 = "<p><strong>💡 TL;DR (Semantic Scholar)</strong></p><p>Summary in second paragraph.</p>";
    expect(extractTLDRFromNote(html2)).toBe("Summary in second paragraph.");

    // syt2/Zotero-TLDR single paragraph format
    const htmlSyt2 = "<p><b>TL;DR:</b> Models &lt;A&gt; outperform Models &lt;B&gt;.</p>";
    expect(extractTLDRFromNote(htmlSyt2)).toBe("Models <A> outperform Models <B>.");

    const html3 = "<p>Unrelated regular note</p>";
    expect(extractTLDRFromNote(html3)).toBeUndefined();
  });

  it("finds existing notes from MetaFlow or syt2/Zotero-TLDR", () => {
    const makeItem = (_noteText?: string) => ({
      getNotes: () => [1],
    } as unknown as Zotero.Item);

    (globalThis as any).Zotero = {
      Items: {
        get: () => ({
          deleted: false,
          getNote: () => "<p><strong>TL;DR:</strong> Old summary</p>",
        }),
      },
    };

    expect(findExistingTLDRNote(makeItem("<p><strong>TL;DR:</strong> Old summary</p>"))).toBeTruthy();
  });

  it("guards non-regular items from note and extra mutation", async () => {
    const attachmentItem = {
      isRegularItem: () => false,
      getField: () => "",
      setField: vi.fn(),
      getNotes: () => [],
    } as unknown as Zotero.Item;

    expect(extractTLDRFromItem(attachmentItem)).toBeUndefined();
    expect(await saveTLDRToNote(attachmentItem, "Test")).toBe(false);
    expect(saveTLDRToAbstract(attachmentItem, "Test")).toBe(false);
    expect(await backfillItemTLDR(attachmentItem, { DOI: "10.1000/182" })).toBe(false);
  });

  it("extracts TLDR from item via extra or notes", () => {
    const itemWithExtra = {
      getField: (f: string) => f === "extra" ? "TLDR: Summary from extra." : "",
    } as unknown as Zotero.Item;
    expect(extractTLDRFromItem(itemWithExtra)).toBe("Summary from extra.");

    (globalThis as any).Zotero = {
      Items: {
        get: (id: number) => {
          if (id === 101) {
            return {
              deleted: false,
              getNote: () => "<div data-metaflow-tldr=\"true\"><blockquote>Summary from note.</blockquote></div>",
            };
          }
          return null;
        },
      },
    };

    const itemWithNote = {
      getField: () => "",
      getNotes: () => [101],
    } as unknown as Zotero.Item;
    expect(extractTLDRFromItem(itemWithNote)).toBe("Summary from note.");
  });

  it("resolves paperID for TLDR from identifiers or item fields", () => {
    const item = {
      getField: (f: string) => f === "DOI" ? "10.1000/182" : "",
    } as unknown as Zotero.Item;

    expect(resolvePaperIDForTLDR(item, { DOI: "10.1038/nature" })).toBe("DOI:10.1038/nature");
    expect(resolvePaperIDForTLDR(item, { arXiv: "2106.09685" })).toBe("arXiv:2106.09685");
    expect(resolvePaperIDForTLDR(item, { PMID: "12345" })).toBe("PMID:12345");
    expect(resolvePaperIDForTLDR(item, {})).toBe("DOI:10.1000/182");
  });

  it("saves TLDR to Extra field idempotently with TLDR format while preserving remark", () => {
    let extraValue = "Citation Key: test\nremark: 用户的个人重要简记";
    const item = {
      getField: (f: string) => f === "extra" ? extraValue : "",
      setField: (f: string, v: string) => {
        if (f === "extra")
          extraValue = v;
      },
    } as unknown as Zotero.Item;

    // First write appends standard TLDR: format without touching remark:
    const saved1 = saveTLDRToExtra(item, "First summary");
    expect(saved1).toBe(true);
    expect(extraValue).toContain("TLDR: First summary");
    expect(extraValue).toContain("remark: 用户的个人重要简记");

    // Second write with same content is no-op
    const saved2 = saveTLDRToExtra(item, "First summary");
    expect(saved2).toBe(false);

    // Updating summary replaces only the existing TLDR line, preserving remark
    const saved3 = saveTLDRToExtra(item, "Updated summary");
    expect(saved3).toBe(true);
    expect(extraValue).toContain("TLDR: Updated summary");
    expect(extraValue).not.toContain("First summary");
    expect(extraValue).toContain("remark: 用户的个人重要简记");

    // Cleans only TLDR and preserves remark
    const cleansed = cleanseTLDRFromExtra(item);
    expect(cleansed).toBe(true);
    expect(extraValue).not.toContain("TLDR:");
    expect(extraValue).toContain("remark: 用户的个人重要简记");
    expect(extraValue).toContain("Citation Key: test");
  });

  it("prioritizes data-metaflow-tldr child notes over generic notes with keywords", () => {
    (globalThis as any).Zotero = {
      Items: {
        get: (id: number) => {
          if (id === 101)
            return { deleted: false, getNote: () => "<p>简记：用户阅读第1章笔记</p>" };
          if (id === 102)
            return { deleted: false, getNote: () => "<div data-metaflow-tldr=\"true\"><blockquote>ML summary of paper.</blockquote></div>" };
          return null;
        },
      },
    };

    const item = {
      getField: () => "",
      getNotes: () => [101, 102],
    } as unknown as Zotero.Item;

    expect(extractTLDRFromItem(item)).toBe("ML summary of paper.");
  });

  it("saves TLDR to abstractNote only when empty", () => {
    let abstractValue = "";
    const item = {
      getField: (f: string) => f === "abstractNote" ? abstractValue : "",
      setField: (f: string, v: string) => {
        if (f === "abstractNote")
          abstractValue = v;
      },
    } as unknown as Zotero.Item;

    expect(saveTLDRToAbstract(item, "New TLDR abstract")).toBe(true);
    expect(abstractValue).toBe("New TLDR abstract");

    // Already non-empty, should not overwrite
    expect(saveTLDRToAbstract(item, "Another abstract")).toBe(false);
    expect(abstractValue).toBe("New TLDR abstract");
  });

  it("saves TLDR to Note with creation and update", async () => {
    let noteContent = "";
    const mockNote = {
      deleted: false,
      getNote: () => noteContent,
      setNote: (content: string) => {
        noteContent = content;
      },
      saveTx: vi.fn(),
    };

    class MockItem {
      constructor() {
        return mockNote;
      }
    }

    (globalThis as any).Zotero = {
      Item: MockItem,
      Items: {
        get: (id: number) => (id === 200 ? mockNote : null),
      },
    };

    const item = {
      libraryID: 1,
      id: 50,
      getNotes: () => [200],
    } as unknown as Zotero.Item;

    // Updates existing note
    const saved = await saveTLDRToNote(item, "Note TLDR content");
    expect(saved).toBe(true);
    expect(noteContent).toContain("Note TLDR content");
    expect(mockNote.saveTx).toHaveBeenCalled();
  });

  it("runs backfillItemTLDR end-to-end", async () => {
    let extraValue = "DOI: 10.1038/s41586\nTLDR: 旧的论点需要清洗\nremark: 用户手动写的个人简记";
    let noteContent = "";
    const mockNote = {
      deleted: false,
      getNote: () => noteContent,
      setNote: (content: string) => {
        noteContent = content;
      },
      saveTx: vi.fn(),
    };

    class MockItem {
      constructor() {
        return mockNote;
      }
    }

    (globalThis as any).Zotero = {
      Item: MockItem,
      Items: {
        get: (id: number) => (id === 999 ? mockNote : null),
      },
    };

    const item = {
      libraryID: 1,
      id: 99,
      isRegularItem: () => true,
      getField: (f: string) => {
        if (f === "DOI")
          return "10.1038/s41586";
        if (f === "extra")
          return extraValue;
        return "";
      },
      setField: (f: string, v: string) => {
        if (f === "extra")
          extraValue = v;
      },
      getNotes: () => [999],
      saveTx: vi.fn().mockResolvedValue(true),
    } as unknown as Zotero.Item;

    const report = vi.fn();
    const result = await backfillItemTLDR(item, { DOI: "10.1038/s41586" }, {
      report,
    });

    expect(result).toBe(true);
    // 沉淀至专属子笔记
    expect(noteContent).toContain("This paper presents a scalable method");
    // 从 Extra 字段中彻底清洗旧的 TLDR，但绝对保留用户的个人简记 (remark:)
    expect(extraValue).not.toContain("TLDR:");
    expect(extraValue).toContain("remark: 用户手动写的个人简记");
    expect(extraValue).toContain("DOI: 10.1038/s41586");
    expect(report).toHaveBeenCalledWith(expect.objectContaining({
      level: "info",
      code: "metadata-tldr-extracted",
    }));
  });
});
