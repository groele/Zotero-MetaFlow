import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureJournalPaneLocalization, registerJournalPane } from "./index";

describe("journal-pane title and localization assurance", () => {
  let originalZotero: any;
  let originalAddon: any;
  let registeredSection: any;

  beforeEach(() => {
    registeredSection = null;
    originalZotero = (globalThis as any).Zotero;
    originalAddon = (globalThis as any).addon;

    (globalThis as any).rootURI = "chrome://metaref/";
    (globalThis as any).addon = {
      data: {
        config: {
          addonID: "metaflow@groele",
          addonRef: "metaref",
          prefsPrefix: "extensions.zotero.metaref",
        },
        locale: {
          current: {
            formatMessagesSync: (_msgs: any[]) => [{ attributes: [{ name: "label", value: "Zotero MetaFlow 期刊索引" }] }],
          },
        },
      },
    };

    (globalThis as any).Zotero = {
      ItemPaneManager: {
        registerSection: (opts: any) => {
          registeredSection = opts;
          return "metaref-journal-insights";
        },
        unregisterSection: vi.fn(),
      },
      Prefs: {
        registerObserver: vi.fn(),
        unregisterObserver: vi.fn(),
        get: vi.fn(),
        set: vi.fn(),
      },
      getMainWindow: () => null,
    };
  });

  afterEach(() => {
    (globalThis as any).Zotero = originalZotero;
    (globalThis as any).addon = originalAddon;
  });

  it("injects main-window.ftl into doc if not present", () => {
    const links: any[] = [];
    const doc: any = {
      querySelector: (sel: string) => links.find(l => sel.includes(l.href)),
      defaultView: {
        MozXULElement: {
          insertFTLIfNeeded: vi.fn((file: string) => {
            links.push({ href: file });
          }),
        },
      },
      l10n: {
        addResourceIds: vi.fn(),
      },
    };

    ensureJournalPaneLocalization(doc);
    expect(doc.defaultView.MozXULElement.insertFTLIfNeeded).toHaveBeenCalledWith("metaref-main-window.ftl");
    expect(doc.l10n.addResourceIds).toHaveBeenCalledWith(["metaref-main-window.ftl"]);
  });

  it("ensures section has label and title element is populated onInit and onRender", () => {
    registerJournalPane();
    expect(registeredSection).toBeDefined();

    const titleEl: any = { textContent: "" };
    const section: any = {
      getAttribute: (attr: string) => (attr === "label" ? section.label : null),
      setAttribute: (attr: string, val: string) => {
        if (attr === "label")
          section.label = val;
      },
      querySelector: (sel: string) => (sel.includes("title") ? titleEl : null),
      label: "",
    };

    const body: any = {
      closest: (sel: string) => (sel === "collapsible-section" ? section : null),
      parentElement: section,
      ownerDocument: {
        querySelector: () => null,
        getElementById: () => null,
        createElementNS: () => ({ className: "", textContent: "", setAttribute: vi.fn(), appendChild: vi.fn() }),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        defaultView: {
          requestAnimationFrame: (cb: any) => cb(),
        },
      },
      style: {},
      replaceChildren: vi.fn(),
    };

    registeredSection.onInit({
      body,
      doc: body.ownerDocument,
      refresh: vi.fn(),
      setEnabled: vi.fn(),
    });

    expect(section.label).toBe("Zotero MetaFlow 期刊索引");
    expect(titleEl.textContent).toBe("Zotero MetaFlow 期刊索引");

    // Also verify onRender
    titleEl.textContent = "";
    section.label = "";
    registeredSection.onRender({
      body,
      item: { isRegularItem: () => true, itemType: "journalArticle", getField: () => "" },
      setEnabled: vi.fn(),
    });

    expect(section.label).toBe("Zotero MetaFlow 期刊索引");
    expect(titleEl.textContent).toBe("Zotero MetaFlow 期刊索引");
  });
});
