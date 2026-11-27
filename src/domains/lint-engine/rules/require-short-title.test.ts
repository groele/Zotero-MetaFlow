import { describe, expect, it, vi } from "vitest";
import { getShortTitle, RequireShortTitle } from "./require-short-title";

describe("require-short-title", () => {
  it("should work", async () => {
    const title = "A review: this is a review";
    expect(getShortTitle(title)).toBe("A review");
  });
  it("preserves a manually curated short title that is not a prefix", async () => {
    const setField = vi.fn();
    await RequireShortTitle.apply({ item: { getField: (field: string) => field === "title" ? "A long title: Subtitle" : "Curated abbreviation", setField } as unknown as Zotero.Item, options: {}, debug: vi.fn(), report: vi.fn() });
    expect(setField).not.toHaveBeenCalled();
  });
  it("fills a missing short title", async () => {
    const setField = vi.fn();
    await RequireShortTitle.apply({ item: { getField: (field: string) => field === "title" ? "A long title: Subtitle" : "", setField } as unknown as Zotero.Item, options: {}, debug: vi.fn(), report: vi.fn() });
    expect(setField).toHaveBeenCalledWith("shortTitle", "A long title");
  });
});
