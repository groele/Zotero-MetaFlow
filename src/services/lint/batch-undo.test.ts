import { afterEach, describe, expect, it, vi } from "vitest";
import { canUndoLastBatch, undoLastBatch } from "./batch-undo";

describe("batch-undo", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reverts saved field and creator changes when current values still match post-batch values, and skips manually edited fields", async () => {
    const fields = new Map<string, string>([
      ["title", "Normalized Title After Batch"],
      ["publicationTitle", "Manually Edited By User After Batch"],
    ]);
    let creators = [{ firstName: "Jane", lastName: "Doe", creatorType: "author" }];
    const saveTx = vi.fn(async () => {});
    const item = {
      id: 101,
      deleted: false,
      itemType: "journalArticle",
      isRegularItem: () => true,
      isEditable: () => true,
      getField: (field: string) => fields.get(field) || "",
      setField: (field: string, value: string) => { fields.set(field, value); },
      getCreators: () => creators,
      setCreators: (next: typeof creators) => { creators = next; },
      toJSON: () => ({ creators }),
      saveTx,
    };
    vi.stubGlobal("Zotero", {
      Items: { get: (id: number) => (id === 101 ? item : undefined) },
      ItemTypes: { getID: () => 1 },
      ItemFields: { getID: () => 1, isValidForType: () => true },
    });
    vi.stubGlobal("addon", {
      data: { alive: false },
      runner: {
        exclusive: async (fn: () => Promise<unknown>) => fn(),
      },
    });

    const result: any = {
      changes: [
        {
          itemID: 101,
          ruleID: "correct-title-sentence-case",
          field: "title",
          before: "ORIGINAL RAW TITLE",
          after: "Normalized Title After Batch",
          saved: true,
        },
        {
          itemID: 101,
          ruleID: "correct-publication-title-case",
          field: "publicationTitle",
          before: "Original Journal",
          after: "Normalized Journal",
          saved: true,
        },
        {
          itemID: 101,
          ruleID: "correct-creators-case",
          field: "creators",
          before: [{ firstName: "JANE", lastName: "DOE", creatorType: "author" }],
          after: [{ firstName: "Jane", lastName: "Doe", creatorType: "author" }],
          saved: true,
        },
      ],
    };

    expect(canUndoLastBatch(result)).toBe(true);
    const outcome = await undoLastBatch(result);
    expect(outcome).toEqual({ restored: 1, skipped: 0 });
    expect(fields.get("title")).toBe("ORIGINAL RAW TITLE");
    expect(fields.get("publicationTitle")).toBe("Manually Edited By User After Batch");
    expect(creators).toEqual([{ firstName: "JANE", lastName: "DOE", creatorType: "author" }]);
    expect(saveTx).toHaveBeenCalledTimes(1);
    expect(canUndoLastBatch(result)).toBe(false);
  });
});
