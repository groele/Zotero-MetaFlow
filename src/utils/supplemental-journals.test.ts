import { afterEach, describe, expect, it, vi } from "vitest";
import { clearSupplementalJournalCache, fetchSupplementalJournalRank, getNjauCore } from "./supplemental-journals";

describe("supplemental journal sources", () => {
  afterEach(() => {
    clearSupplementalJournalCache();
    vi.unstubAllGlobals();
  });
  it("reuses supplemental results until explicit clearing, then fetches fresh data", async () => {
    const request = vi.fn().mockResolvedValueOnce({ responseText: JSON.stringify({ classname: "old" }) }).mockResolvedValue({ responseText: JSON.stringify({ classname: "fresh" }) });
    vi.stubGlobal("Zotero", { HTTP: { request } });
    const fields = new Set(["njauQuality"] as const);
    expect((await fetchSupplementalJournalRank("Cache reset fixture", fields)).data.njauQuality).toBe("old");
    await fetchSupplementalJournalRank("Cache reset fixture", fields);
    expect(request).toHaveBeenCalledTimes(1);
    clearSupplementalJournalCache();
    expect((await fetchSupplementalJournalRank("Cache reset fixture", fields)).data.njauQuality).toBe("fresh");
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("does not repopulate a cleared cache when an earlier request completes", async () => {
    let release!: (value: { responseText: string }) => void;
    const request = vi.fn().mockImplementationOnce(() => new Promise(resolve => release = resolve)).mockResolvedValue({ responseText: JSON.stringify({ classname: "fresh" }) });
    vi.stubGlobal("Zotero", { HTTP: { request } });
    const fields = new Set(["njauQuality"] as const);
    const old = fetchSupplementalJournalRank("Pending reset fixture", fields);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    clearSupplementalJournalCache();
    release({ responseText: JSON.stringify({ classname: "obsolete" }) });
    await old;
    expect((await fetchSupplementalJournalRank("Pending reset fixture", fields)).data.njauQuality).toBe("fresh");
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("uses the attributed historical NJAU list and validates numeric impact factors", () => {
    expect(getNjauCore("病毒学报")).toBe("一类核心");
    expect(getNjauCore("\u6570\u5B66\u5E74\u520AA\u8F91")).toBe("二类核心");
    expect(getNjauCore("Unknown journal")).toBeUndefined();
  });
  it("reports source failures without discarding independent local results", async () => {
    vi.stubGlobal("Zotero", { HTTP: { request: vi.fn().mockRejectedValue(new Error("offline")) } });
    const result = await fetchSupplementalJournalRank("病毒学报", new Set(["njauCore", "njauQuality"]));
    expect(result.data.njauCore).toBe("一类核心");
    expect(result.errors).toHaveLength(1);
  });
  it("does not contact remote sources when their options are disabled", async () => {
    const request = vi.fn();
    vi.stubGlobal("Zotero", { HTTP: { request } });
    const result = await fetchSupplementalJournalRank("No remote lookup", new Set());
    expect(result).toEqual({ data: {}, errors: [] });
    expect(request).not.toHaveBeenCalled();
  });
  it("does not call a removed Chinese impact-factor proxy for Chinese journals", async () => {
    const request = vi.fn();
    vi.stubGlobal("Zotero", { HTTP: { request } });
    const result = await fetchSupplementalJournalRank("中文期刊", new Set(["compoundIF", "comprehensiveIF"]));
    expect(result).toEqual({ data: {}, errors: [] });
    expect(request).not.toHaveBeenCalled();
  });
  it("stops an aborted lookup before starting any request", async () => {
    const request = vi.fn();
    vi.stubGlobal("Zotero", { HTTP: { request } });
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    await expect(fetchSupplementalJournalRank("Cancelled", new Set(["njauQuality"]), controller.signal)).rejects.toThrow("cancelled");
    expect(request).not.toHaveBeenCalled();
  });
  it("times out the remaining supplemental source and clears its timer", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal("Zotero", { HTTP: { request: vi.fn(async () => new Promise(() => {})) } });
      const pending = fetchSupplementalJournalRank("来源超时测试", new Set(["njauQuality"]));
      await vi.advanceTimersByTimeAsync(9000);
      const result = await pending;
      expect(result.data.njauQuality).toBeUndefined();
      expect(result.errors).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(0);
    }
    finally {
      vi.useRealTimers();
    }
  });
});
