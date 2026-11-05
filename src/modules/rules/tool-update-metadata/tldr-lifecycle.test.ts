import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fetchPaperTLDR } from "./services/semantic-scholar-service";
import { backfillItemTLDR, saveTLDRToItem, saveTLDRToNote } from "./tldr";

vi.mock("./services/semantic-scholar-service", () => ({ fetchPaperTLDR: vi.fn(), parsePaperID: (kind: string, value: string) => `${kind}:${value}` }));
vi.mock("../../journal-pane", () => ({ extractArxivID: () => undefined }));
vi.mock("../../../utils/locale", () => ({ getString: (id: string) => id }));
vi.mock("../../../utils/logger", () => ({ createLogger: () => ({ debug() {}, error() {} }) }));

const createNote = vi.fn();
beforeEach(() => {
  vi.mocked(fetchPaperTLDR).mockReset();
  createNote.mockReset();
  vi.stubGlobal("Zotero", { Item: class {
    constructor() {
      createNote();
    }
  }, Items: { get: vi.fn() } });
});
afterEach(() => vi.unstubAllGlobals());

function parent() {
  return {
    id: 1,
    deleted: false,
    inTrash: false,
    editable: true,
    isEditable() {
      return this.editable;
    },
    isRegularItem: () => true,
    getField: () => "",
    getNotes: () => [],
    setField: vi.fn(),
  };
}

it("rejects a late TLDR response after cancellation without creating a child note", async () => {
  let release!: (value: string) => void;
  vi.mocked(fetchPaperTLDR).mockImplementation(() => new Promise(resolve => release = resolve));
  const item = parent();
  const controller = new AbortController();
  const pending = backfillItemTLDR(item as any, { DOI: "10.1234/test" }, { signal: controller.signal });
  controller.abort(new Error("Cancelled"));
  release("A late summary");
  await expect(pending).rejects.toThrow("Cancelled");
  expect(createNote).not.toHaveBeenCalled();
  expect(item.setField).not.toHaveBeenCalled();
});

for (const field of ["deleted", "inTrash", "editable"] as const) {
  it(`does not write a fetched TLDR after parent ${field} changes`, async () => {
    const item = parent();
    vi.mocked(fetchPaperTLDR).mockImplementation(async () => {
      item[field] = field !== "editable";
      return "A late summary";
    });
    expect(await backfillItemTLDR(item as any, { DOI: "10.1234/test" })).toBe(false);
    expect(createNote).not.toHaveBeenCalled();
    expect(item.setField).not.toHaveBeenCalled();
  });
}

it("does not overwrite an existing read-only TLDR child note", async () => {
  const note = { isNote: () => true, getNote: () => "<div data-metaflow-tldr=\"true\"><blockquote>Old summary</blockquote></div>", isEditable: () => false, setNote: vi.fn(), saveTx: vi.fn() };
  (Zotero.Items.get as any).mockReturnValue(note);
  const item = { ...parent(), getNotes: () => [2] };
  expect(await saveTLDRToNote(item as any, "New summary")).toBe(false);
  expect(note.setNote).not.toHaveBeenCalled();
  expect(note.saveTx).not.toHaveBeenCalled();
});

it("does not clear legacy Extra when the destination note is read-only", async () => {
  const note = { isNote: () => true, getNote: () => "<div data-metaflow-tldr=\"true\"><blockquote>Old summary</blockquote></div>", isEditable: () => false };
  (Zotero.Items.get as any).mockReturnValue(note);
  const item = { ...parent(), getNotes: () => [2], getField: () => "TLDR: Original summary" };
  vi.mocked(fetchPaperTLDR).mockResolvedValue("New summary");
  expect(await backfillItemTLDR(item as any, { DOI: "10.1234/test" })).toBe(false);
  expect(item.setField).not.toHaveBeenCalled();
});

it("restores a changed note and rejects a failed native save", async () => {
  const original = "<div data-metaflow-tldr=\"true\"><blockquote>Original summary</blockquote></div>";
  let content = original;
  const note = { isNote: () => true, getNote: () => content, isEditable: () => true, setNote: (value: string) => {
    content = value;
  }, saveTx: async () => {
    throw new Error("Disk failure");
  } };
  (Zotero.Items.get as any).mockReturnValue(note);
  const item = { ...parent(), getNotes: () => [2] };
  await expect(saveTLDRToNote(item as any, "New summary")).rejects.toThrow("Disk failure");
  expect(content).toBe(original);
});

it("retains Extra when deletion of a linked note fails", async () => {
  const note = { isNote: () => true, getNote: () => "<div data-metaflow-tldr=\"true\"><blockquote>Original summary</blockquote></div>", eraseTx: async () => {
    throw new Error("Disk failure");
  } };
  (Zotero.Items.get as any).mockReturnValue(note);
  const item = { ...parent(), getNotes: () => [2], getField: () => "TLDR: Original summary" };
  await expect(saveTLDRToItem(item as any, "")).rejects.toThrow("Disk failure");
  expect(item.setField).not.toHaveBeenCalled();
});

it("keeps the Extra-only target independent from an unrelated read-only child note", async () => {
  const note = { getNote: () => "<div data-metaflow-tldr=\"true\"><blockquote>Old summary</blockquote></div>", isEditable: () => false };
  (Zotero.Items.get as any).mockReturnValue(note);
  (Zotero as any).Prefs = { get: () => "extra" };
  const item = { ...parent(), getNotes: () => [2], saveTx: vi.fn() };
  expect(await saveTLDRToItem(item as any, "Extra summary")).toBe(true);
  expect(item.setField).toHaveBeenCalledWith("extra", "TLDR: Extra summary");
  expect(item.saveTx).toHaveBeenCalledOnce();
});
