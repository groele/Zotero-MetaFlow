import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanseTLDRFromExtra, findExistingTLDRNote, saveTLDRToNote } from "./rules/tool-update-metadata/tldr";
import { migrateLegacyTLDR } from "./tldr-migration";

vi.mock("./rules/tool-update-metadata/tldr", () => ({
  saveTLDRToNote: vi.fn(),
  findExistingTLDRNote: vi.fn(),
  extractTLDRFromNote: (value: string) => value,
  cleanseTLDRFromExtra: vi.fn(() => true),
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("addon", { data: { alive: true } });
});
afterEach(() => vi.unstubAllGlobals());

function parent() {
  return { deleted: false, inTrash: false, editable: true, extra: "TLDR: Summary", isEditable() {
    return this.editable;
  }, getField() {
    return this.extra;
  }, saveTx: vi.fn() };
}

for (const transition of ["deleted", "inTrash", "readOnly", "edit", "shutdown"]) {
  it(`preserves Extra if ${transition} happens while its note is being saved`, async () => {
    const item = parent();
    vi.mocked(saveTLDRToNote).mockImplementation(async () => {
      if (transition === "deleted")
        item.deleted = true;
      if (transition === "inTrash")
        item.inTrash = true;
      if (transition === "readOnly")
        item.editable = false;
      if (transition === "edit")
        item.extra = "TLDR: User edit";
      if (transition === "shutdown")
        addon.data.alive = false;
      return true;
    });
    expect(await migrateLegacyTLDR(item as any, "Summary", "TLDR: Summary")).toBe(false);
    expect(cleanseTLDRFromExtra).not.toHaveBeenCalled();
    expect(item.saveTx).not.toHaveBeenCalled();
  });
}

it("retains the source when an existing read-only note prevented a copy", async () => {
  vi.mocked(saveTLDRToNote).mockResolvedValue(false);
  vi.mocked(findExistingTLDRNote).mockReturnValue({ getNote: () => "Other summary" } as any);
  expect(await migrateLegacyTLDR(parent() as any, "Summary", "TLDR: Summary")).toBe(false);
  expect(cleanseTLDRFromExtra).not.toHaveBeenCalled();
});

it("cleans an unchanged source after a durable note, without changing selection", async () => {
  const item = parent();
  vi.mocked(saveTLDRToNote).mockResolvedValue(true);
  expect(await migrateLegacyTLDR(item as any, "Summary", "TLDR: Summary")).toBe(true);
  expect(item.saveTx).toHaveBeenCalledWith({ skipSelect: true });
});
