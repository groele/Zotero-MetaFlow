// autocorrect-disable
import { describe, expect, it, vi } from "vitest";
import {
  backfillItemTLDR,
  saveTLDRToItem,
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
  it("handles saveTLDRToItem for inline updates and clears", async () => {
    let extra = "DOI: 10.1038/s41586\nTLDR: 初始论点\nremark: 用户的个人简记";
    const saveTx = vi.fn().mockResolvedValue(true);
    const item = {
      isRegularItem: () => true,
      getField: (f: string) => f === "extra" ? extra : "",
      setField: (f: string, v: string) => {
        if (f === "extra")
          extra = v;
      },
      getNotes: () => [],
      saveTx,
    } as unknown as Zotero.Item;

    const saved = await saveTLDRToItem(item, "更新后的撷论论点");
    expect(saved).toBe(true);
    // 默认 note 模式下，更新论点会从 Extra 中清洗掉历史 TLDR，但绝不触碰 remark:
    expect(extra).not.toContain("TLDR: 初始论点");
    expect(extra).toContain("remark: 用户的个人简记");
    expect(extra).toContain("DOI: 10.1038/s41586");
    expect(saveTx).toHaveBeenCalled();

    // Clearing
    extra = "DOI: 10.1038/s41586\nTLDR: 待清除论点\nremark: 用户的个人简记";
    const cleared = await saveTLDRToItem(item, "");
    expect(cleared).toBe(true);
    expect(extra).not.toContain("TLDR:");
    expect(extra).toContain("remark: 用户的个人简记");
    expect(extra).toContain("DOI: 10.1038/s41586");
  });

  it("respects different TLDR backfill target options (extra, both, abstract)", async () => {
    let extraValue = "";
    let abstractValue = "";
    let noteContent = "";

    const mockNote = {
      id: 999,
      getNote: () => noteContent,
      setNote: (content: string) => {
        noteContent = content;
      },
      saveTx: vi.fn().mockResolvedValue(true),
    };

    class MockItem {
      libraryID = 1;
      parentID = 99;
      setField = vi.fn();
      setNote = (content: string) => {
        noteContent = content;
      };

      saveTx = vi.fn().mockResolvedValue(true);
      id = 999;
    }

    (globalThis as any).Zotero = {
      Item: MockItem,
      Items: {
        get: (id: number) => (id === 999 ? mockNote : null),
      },
    };

    const makeItem = () => ({
      libraryID: 1,
      id: 99,
      isRegularItem: () => true,
      getField: (f: string) => {
        if (f === "DOI")
          return "10.1038/s41586";
        if (f === "extra")
          return extraValue;
        if (f === "abstractNote")
          return abstractValue;
        return "";
      },
      setField: (f: string, v: string) => {
        if (f === "extra")
          extraValue = v;
        if (f === "abstractNote")
          abstractValue = v;
      },
      getNotes: () => [],
      saveTx: vi.fn().mockResolvedValue(true),
    } as unknown as Zotero.Item);

    // 1. target = "extra"
    extraValue = "remark: 用户的个人简记";
    noteContent = "";
    await backfillItemTLDR(makeItem(), { DOI: "10.1038/s41586" }, { target: "extra" });
    expect(extraValue).toContain("TLDR: This paper presents a scalable method");
    expect(extraValue).toContain("remark: 用户的个人简记");
    expect(noteContent).toBe("");

    // 2. target = "both"
    extraValue = "remark: 用户的个人简记";
    noteContent = "";
    await backfillItemTLDR(makeItem(), { DOI: "10.1038/s41586" }, { target: "both" });
    expect(extraValue).toContain("TLDR: This paper presents a scalable method");
    expect(extraValue).toContain("remark: 用户的个人简记");
    expect(noteContent).toContain("This paper presents a scalable method");

    // 3. target = "abstract"
    extraValue = "TLDR: 旧论点\nremark: 用户的个人简记";
    abstractValue = "";
    noteContent = "";
    await backfillItemTLDR(makeItem(), { DOI: "10.1038/s41586" }, { target: "abstract" });
    expect(abstractValue).toContain("This paper presents a scalable method");
    expect(noteContent).toContain("This paper presents a scalable method");
    expect(extraValue).not.toContain("TLDR:");
    expect(extraValue).toContain("remark: 用户的个人简记");
  });
});
