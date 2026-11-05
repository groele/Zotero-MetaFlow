import { afterEach, expect, it, vi } from "vitest";
import { CorrectAttachmentRoles } from "./correct-attachment-roles";

afterEach(() => vi.unstubAllGlobals());

for (const transition of ["cancel", "deleted", "inTrash", "readOnly"] as const) {
  it(`does not rename or save an attachment after ${transition} during PDF extraction`, async () => {
    let release!: (value: { text: string }) => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => entered = resolve);
    const controller = new AbortController();
    const attachment = { id: 2, deleted: false, inTrash: false, editable: true, isEditable() {
      return this.editable;
    }, isAttachment: () => true, attachmentFilename: "article_main.pdf", attachmentContentType: "application/pdf", getField: () => "Original", setField: vi.fn(), renameAttachmentFile: vi.fn(), saveTx: vi.fn() };
    const item = { id: 1, isEditable: () => true, isRegularItem: () => true, getAttachments: () => [2], getField: () => "Study", getCreators: () => [] };
    vi.stubGlobal("Zotero", { Prefs: { get: (key: string) => key.endsWith("template") ? "{title}_{role}" : true }, Items: { getAsync: async () => attachment }, PDFWorker: { getFullText: () => {
      entered();
      return new Promise(resolve => release = resolve);
    } } });
    const pending = CorrectAttachmentRoles.apply({ item, signal: controller.signal, options: {}, report: vi.fn(), debug: vi.fn() } as any);
    await started;
    if (transition === "cancel")
      controller.abort(new Error("Cancelled"));
    else if (transition === "readOnly")
      attachment.editable = false;
    else
      attachment[transition] = true;
    release({ text: "Abstract: a manuscript" });
    if (transition === "cancel")
      await expect(pending).rejects.toThrow("Cancelled");
    else
      await pending;
    expect(attachment.setField).not.toHaveBeenCalled();
    expect(attachment.renameAttachmentFile).not.toHaveBeenCalled();
    expect(attachment.saveTx).not.toHaveBeenCalled();
  });
}
