// autocorrect-disable
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refreshTLDRInfoRow, registerInfoRows, unregisterInfoRows } from "./item-info-row";

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

  it("registers info row with position end, multiline true, and editable true", () => {
    registerInfoRows();
    expect(mocks.infoRows.has("tldr")).toBe(true);

    const row = mocks.infoRows.get("tldr");
    expect(row.rowID).toBe("tldr");
    expect(row.pluginID).toBe("metaflow@groele");
    expect(row.label.l10nID).toBe("metaref-info-row-tldr");
    expect(row.label.value).toBe("field-tldr");
    expect(row.label.text).toBe("field-tldr");
    expect(row.position).toBe("end");
    expect(row.multiline).toBe(true);
    expect(row.editable).toBe(true);
    expect(row.nowrap).toBe(false);
  });

  it("does not re-register if already registered", () => {
    registerInfoRows();
    expect(mocks.infoRows.size).toBe(1);
    registerInfoRows();
    expect(mocks.infoRows.size).toBe(1);
  });

  it("handles onGetData correctly from extra tldr fields without interfering with remark", () => {
    registerInfoRows();
    const row = mocks.infoRows.get("tldr");

    const nonRegularItem = {
      isRegularItem: () => false,
      getField: () => "TLDR: non-regular",
    } as unknown as Zotero.Item;
    expect(row.onGetData({ item: nonRegularItem })).toBe("");

    const itemWithRemark = {
      isRegularItem: () => true,
      getField: (key: string) => (key === "extra" ? "remark: 光伏钙钛矿核心突破" : ""),
      getNotes: () => [],
    } as unknown as Zotero.Item;
    // 仅有 remark: 时，属于用户简记，绝不被撷论行误读
    expect(row.onGetData({ item: itemWithRemark })).toBe("");

    const itemWithBoth = {
      isRegularItem: () => true,
      getField: (key: string) => (key === "extra" ? "remark: 用户自己的简记\nTLDR: Monolayer MoS2 luminescent yield increases" : ""),
      getNotes: () => [],
    } as unknown as Zotero.Item;
    expect(row.onGetData({ item: itemWithBoth })).toBe("Monolayer MoS2 luminescent yield increases");

    const itemWithTLDR = {
      isRegularItem: () => true,
      getField: (key: string) => (key === "extra" ? "TLDR: Monolayer MoS2 luminescent yield increases" : ""),
      getNotes: () => [],
    } as unknown as Zotero.Item;
    expect(row.onGetData({ item: itemWithTLDR })).toBe("Monolayer MoS2 luminescent yield increases");

    const emptyItem = {
      isRegularItem: () => true,
      getField: () => "",
      getNotes: () => [],
    } as unknown as Zotero.Item;
    expect(row.onGetData({ item: emptyItem })).toBe("");
  });

  it("handles onItemChange enabled state depending on item type and preferences", () => {
    registerInfoRows();
    const row = mocks.infoRows.get("tldr");

    let enabled = false;
    let editable = false;
    const setEnabled = (val: boolean) => {
      enabled = val;
    };
    const setEditable = (val: boolean) => {
      editable = val;
    };

    // Non regular item
    row.onItemChange({
      item: { isRegularItem: () => false } as any,
      setEnabled,
      setEditable,
    });
    expect(enabled).toBe(false);
    expect(editable).toBe(false);

    // Regular item with preference enabled (default)
    mocks.preferences.set("workflow.tldrShowInInfoPane", true);
    row.onItemChange({
      item: { isRegularItem: () => true, getField: () => "", getNotes: () => [] } as any,
      setEnabled,
      setEditable,
    });
    expect(enabled).toBe(true);
    expect(editable).toBe(true);

    // Regular item with preference disabled, but item HAS a TLDR
    mocks.preferences.set("workflow.tldrShowInInfoPane", false);
    row.onItemChange({
      item: {
        isRegularItem: () => true,
        getField: (k: string) => (k === "extra" ? "TLDR: 存在论点" : ""),
        getNotes: () => [],
      } as any,
      setEnabled,
      setEditable,
    });
    expect(enabled).toBe(true);
    expect(editable).toBe(true);

    // Regular item with preference disabled and ONLY remark (user note, not TLDR)
    row.onItemChange({
      item: {
        isRegularItem: () => true,
        getField: (k: string) => (k === "extra" ? "remark: 仅用户简记" : ""),
        getNotes: () => [],
      } as any,
      setEnabled,
      setEditable,
    });
    expect(enabled).toBe(false);

    // Regular item with preference disabled and NO TLDR
    row.onItemChange({
      item: {
        isRegularItem: () => true,
        getField: () => "",
        getNotes: () => [],
      } as any,
      setEnabled,
      setEditable,
    });
    expect(enabled).toBe(false);
    expect(editable).toBe(true);
  });

  it("handles onSetData by updating Extra and refreshing journal-pane", async () => {
    registerInfoRows();
    const row = mocks.infoRows.get("tldr");

    let extraValue = "";
    const saveTxMock = vi.fn().mockResolvedValue(true);
    const item = {
      id: 1234,
      isRegularItem: () => true,
      getField: (key: string) => (key === "extra" ? extraValue : ""),
      setField: (key: string, val: string) => {
        if (key === "extra")
          extraValue = val;
      },
      getNotes: () => [],
      saveTx: saveTxMock,
    } as unknown as Zotero.Item;

    row.onSetData({ item, value: "用户手动编辑的撷论总结" });

    // Wait for async save to resolve
    await vi.waitFor(() => expect(mocks.refreshJournalPane).toHaveBeenCalledWith([1234]));
    expect(saveTxMock).toHaveBeenCalled();
    // 默认 note 模式下，保存时不污染 Extra 字段，杜绝重复填充
    expect(extraValue).not.toContain("remark:");
  });

  it("handles onSetData clearing TLDR by removing TLDR line from Extra while preserving user remark", async () => {
    registerInfoRows();
    const row = mocks.infoRows.get("tldr");

    let extraValue = "DOI: 10.1000/182\nremark: 用户的重要简记\nTLDR: 旧论点总结\nZotero: v7";
    const saveTxMock = vi.fn().mockResolvedValue(true);
    const item = {
      id: 5678,
      isRegularItem: () => true,
      getField: (key: string) => (key === "extra" ? extraValue : ""),
      setField: (key: string, val: string) => {
        if (key === "extra")
          extraValue = val;
      },
      getNotes: () => [],
      saveTx: saveTxMock,
    } as unknown as Zotero.Item;

    row.onSetData({ item, value: "   " });

    await vi.waitFor(() => expect(saveTxMock).toHaveBeenCalled());
    expect(extraValue).not.toContain("TLDR: 旧论点总结");
    expect(extraValue).toContain("remark: 用户的重要简记");
    expect(extraValue).toContain("DOI: 10.1000/182");
    expect(extraValue).toContain("Zotero: v7");
  });

  it("unregisters cleanly and clears preference observers", () => {
    registerInfoRows();
    expect(mocks.infoRows.has("tldr")).toBe(true);
    expect(mocks.prefsObservers.size).toBe(2);

    unregisterInfoRows();
    expect(mocks.infoRows.has("tldr")).toBe(false);
    expect(mocks.prefsObservers.size).toBe(0);
  });

  it("handles onItemChange safely when setEditable is not provided by Zotero", () => {
    registerInfoRows();
    const row = mocks.infoRows.get("tldr");
    let enabled = false;
    expect(() => {
      row.onItemChange({
        item: { isRegularItem: () => true, getField: () => "", getNotes: () => [] } as any,
        setEnabled: (val: boolean) => {
          enabled = val;
        },
      });
    }).not.toThrow();
    expect(enabled).toBe(true);
  });

  it("refreshTLDRInfoRow calls ItemPaneManager.refreshInfoRow", () => {
    refreshTLDRInfoRow("tldr");
    expect(Zotero.ItemPaneManager.refreshInfoRow).toHaveBeenCalledWith("tldr");
  });
});
