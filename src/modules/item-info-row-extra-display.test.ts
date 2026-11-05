// autocorrect-disable
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { placeTLDRBeforeExtra, registerInfoRows, unregisterInfoRows } from "./item-info-row";

const mocks = vi.hoisted(() => ({
  preferences: new Map<string, unknown>(),
  refreshJournalPane: vi.fn(),
  infoRows: new Map<string, any>(),
  prefsObservers: new Map<symbol, { pref: string; callback: () => void }>(),
}));

vi.mock("../utils/prefs", () => ({
  getPref: (key: string, fallback: unknown) => mocks.preferences.get(key) ?? fallback,
}));

vi.mock("../utils/locale", () => ({
  getLocaleID: (key: string) => `metaref-${key}`,
  getString: (key: string) => key,
}));

vi.mock("../utils/logger", () => ({
  logger: { error: vi.fn() },
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

vi.mock("./journal-pane", () => ({
  refreshJournalPane: mocks.refreshJournalPane,
}));

describe("item-info-row module", () => {
  beforeEach(() => {
    mocks.preferences.clear();
    mocks.refreshJournalPane.mockReset();
    mocks.infoRows.clear();
    mocks.prefsObservers.clear();

    vi.stubGlobal("addon", {
      data: {
        alive: true,
        config: { addonID: "metaflow@groele", prefsPrefix: "extensions.zotero.metaref" },
      },
    });

    const mockNotes = new Map<number, any>();
    class MockItem {
      libraryID?: number;
      parentID?: number;
      parentItemID?: number;
      private noteContent = "";
      constructor(public itemType: string) {}
      getNote() {
        return this.noteContent;
      }

      setNote(val: string) {
        this.noteContent = val;
      }

      saveTx = vi.fn().mockResolvedValue(true);
    }

    vi.stubGlobal("Zotero", {
      Item: MockItem,
      Items: {
        get: (id: number) => mockNotes.get(id) || null,
      },
      ItemPaneManager: {
        registerInfoRow: (options: any) => {
          mocks.infoRows.set(options.rowID, options);
          return options.rowID;
        },
        unregisterInfoRow: (id: string) => {
          mocks.infoRows.delete(id);
          return true;
        },
        refreshInfoRow: vi.fn(),
      },
      ItemTreeManager: {
        refreshColumns: vi.fn(),
      },
      Prefs: {
        registerObserver: (pref: string, callback: () => void) => {
          const id = Symbol(pref);
          mocks.prefsObservers.set(id, { pref, callback });
          return id;
        },
        unregisterObserver: (id: symbol) => {
          mocks.prefsObservers.delete(id);
          return true;
        },
      },
    });
  });

  afterEach(() => {
    unregisterInfoRows();
    vi.unstubAllGlobals();
  });

  it("filters out TLDR line in extra row when extra contains other metadata", () => {
    let extraRow: any;
    const parent: any = {
      children: [],
      insertBefore: vi.fn(),
      closest: vi.fn(() => null),
      querySelector: vi.fn((sel: string) => {
        if (sel.includes("meta-label-extra"))
          return extraRow;
        return null;
      }),
    };

    const mockValElem = {
      value: "Citation Key: smith2020\nTLDR: The gate-tunable interband resonant\nPMID: 123456",
      setAttribute: vi.fn(),
    };

    extraRow = {
      parentElement: parent,
      style: {
        display: "",
        setProperty: vi.fn(),
      },
      hidden: false,
      querySelector: vi.fn((sel: string) => {
        if (sel.includes(".value"))
          return mockValElem;
        return null;
      }),
    };

    const tldrRow: any = {
      parentElement: parent,
      style: { display: "" },
      hidden: false,
      classList: { contains: () => false, add: vi.fn() },
      querySelector: () => null,
      get nextElementSibling() { return extraRow; },
    };

    parent.children.push(tldrRow, extraRow);

    const mockDoc = {
      querySelectorAll: (sel: string) => sel.includes("data-custom-row-id=\"tldr\"") ? [tldrRow] : [],
    } as unknown as Document;

    placeTLDRBeforeExtra(mockDoc);

    expect(extraRow.hidden).toBe(false);
    expect(extraRow.style.display).toBe("");
    expect(mockValElem.value).toBe("Citation Key: smith2020\nPMID: 123456");
    expect(mockValElem.setAttribute).toHaveBeenCalledWith("value", "Citation Key: smith2020\nPMID: 123456");
  });

  it("restores extra row when tldrRow is hidden or disabled", () => {
    let extraRow: any;
    const parent: any = {
      children: [],
      insertBefore: vi.fn(),
      closest: vi.fn(() => null),
      querySelector: vi.fn((sel: string) => {
        if (sel.includes("meta-label-extra"))
          return extraRow;
        return null;
      }),
    };

    extraRow = {
      parentElement: parent,
      style: { display: "none" },
      hidden: true,
      querySelector: vi.fn(() => ({ value: "TLDR: Test", textContent: "" })),
    };

    const tldrRow: any = {
      parentElement: parent,
      style: { display: "none" },
      hidden: true,
      classList: { contains: () => false, add: vi.fn() },
      querySelector: () => null,
      get nextElementSibling() { return extraRow; },
    };

    parent.children.push(tldrRow, extraRow);

    const mockDoc = {
      querySelectorAll: (sel: string) => sel.includes("data-custom-row-id=\"tldr\"") ? [tldrRow] : [],
    } as unknown as Document;

    placeTLDRBeforeExtra(mockDoc);

    expect(extraRow.hidden).toBe(false);
    expect(extraRow.style.display).toBe("");
  });

  it("blocks auto-migration and manual saving on deleted (trash) or read-only items", async () => {
    registerInfoRows();
    const row = mocks.infoRows.get("tldr");

    const saveTxMock = vi.fn().mockResolvedValue(true);
    const setFieldMock = vi.fn();
    let editable = true;
    const deletedItem = {
      id: 9999,
      deleted: true,
      isRegularItem: () => true,
      isEditable: () => true,
      getField: (k: string) => (k === "extra" ? "TLDR: 回收站条目中的旧论点" : ""),
      setField: setFieldMock,
      getNotes: () => [],
      saveTx: saveTxMock,
    } as unknown as Zotero.Item;

    row.onItemChange({
      item: deletedItem,
      setEnabled: vi.fn(),
      setEditable: (val: boolean) => {
        editable = val;
      },
    });
    expect(editable).toBe(false);
    expect(setFieldMock).not.toHaveBeenCalled();
    expect(saveTxMock).not.toHaveBeenCalled();

    row.onSetData({ item: deletedItem, value: "试图修改回收站条目" });
    expect(saveTxMock).not.toHaveBeenCalled();
  });
});
