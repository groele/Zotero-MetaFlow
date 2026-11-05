import { afterEach, expect, it, vi } from "vitest";
import { requestHTTP } from "../../../../utils/http";
import { CnkiTitleService } from "./cnki-title-service";

vi.mock("../../../../utils/http", () => ({ requestHTTP: vi.fn(async () => ({ responseText: "fixture" })) }));
vi.mock("../policy", () => ({ titlesAgree: () => true }));
afterEach(() => vi.unstubAllGlobals());

it("cancels CNKI document loading without starting a late native translator", async () => {
  let entered!: () => void;
  let release!: (documents: object[]) => void;
  const started = new Promise<void>(resolve => entered = resolve);
  const translate = vi.fn();
  const Parser = class {
    parseFromString() {
      return { querySelectorAll: () => [{ textContent: "Title", getAttribute: () => "https://kns.cnki.net/kcms/detail/fixture" }] };
    }
  };
  vi.stubGlobal("DOMParser", Parser);
  vi.stubGlobal("Zotero", {
    HTTP: { processDocuments: () => {
      entered();
      return new Promise(resolve => release = resolve);
    } },
    Translate: { Web: translate },
  });
  const controller = new AbortController();
  const pending = CnkiTitleService.fetch!({ item: { getField: () => "Title" }, identifiers: {}, signal: controller.signal, debug() {}, isPreprint: false } as any);
  await started;
  controller.abort(new Error("Cancelled CNKI"));
  await expect(pending).rejects.toThrow("Cancelled CNKI");
  release([{}]);
  await Promise.resolve();
  expect(translate).not.toHaveBeenCalled();
  expect(requestHTTP).toHaveBeenCalledOnce();
});
