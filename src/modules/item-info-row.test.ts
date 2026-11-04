// autocorrect-disable
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { placeTLDRBeforeExtra, refreshTLDRInfoRow, registerInfoRows, unregisterInfoRows } from "./item-info-row";

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

  it("places TLDR row directly before extra row in the itembox DOM", () => {
    const children: any[] = [];
    let extraLabel: any;
    let extraRow: any;

    const parent: any = {
      children,
      insertBefore: vi.fn((newChild: any, refChild: any) => {
        const oldIndex = children.indexOf(newChild);
        if (oldIndex !== -1)
          children.splice(oldIndex, 1);
        const refIndex = children.indexOf(refChild);
        if (refIndex !== -1)
          children.splice(refIndex, 0, newChild);
        else
          children.push(newChild);
      }),
      querySelector: vi.fn((sel: string) => {
        if (sel.includes("meta-label-extra"))
          return extraLabel;
        return null;
      }),
    };

    extraLabel = {
      closest: vi.fn((sel: string) => sel.includes("meta-row") ? extraRow : null),
      parentElement: null,
    };
    extraRow = {
      parentElement: parent,
      get nextElementSibling() {
        const idx = children.indexOf(extraRow);
        return idx !== -1 && idx + 1 < children.length ? children[idx + 1] : null;
      },
    };
    extraLabel.parentElement = extraRow;

    const tldrClasses = new Set<string>();
    const rowAttrs = new Map<string, string>();
    const labelClasses = new Set<string>();
    const labelAttrs = new Map<string, string>();
    const valueClasses = new Set<string>();
    const valueAttrs = new Map<string, string>();
    const mockLabelElem = {
      classList: {
        contains: (c: string) => labelClasses.has(c),
        add: (c: string) => labelClasses.add(c),
      },
      hasAttribute: (a: string) => labelAttrs.has(a),
      setAttribute: (a: string, v: string) => labelAttrs.set(a, v),
    };
    const mockValueElem = {
      classList: {
        contains: (c: string) => valueClasses.has(c),
        add: (c: string) => valueClasses.add(c),
      },
      hasAttribute: (a: string) => valueAttrs.has(a),
      setAttribute: (a: string, v: string) => valueAttrs.set(a, v),
    };

    const tldrRow: any = {
      parentElement: parent,
      classList: {
        contains: (c: string) => tldrClasses.has(c),
        add: (c: string) => tldrClasses.add(c),
      },
      hasAttribute: (a: string) => rowAttrs.has(a),
      setAttribute: (a: string, v: string) => rowAttrs.set(a, v),
      querySelector: (sel: string) => {
        if (sel.includes("meta-label"))
          return mockLabelElem;
        if (sel.includes(".value"))
          return mockValueElem;
        return null;
      },
      get nextElementSibling() {
        const idx = children.indexOf(tldrRow);
        return idx !== -1 && idx + 1 < children.length ? children[idx + 1] : null;
      },
    };

    const dateAddedRow: any = { parentElement: parent };
    children.push(extraRow, dateAddedRow, tldrRow);

    const mockDoc = {
      querySelectorAll: (sel: string) => {
        if (sel.includes("data-custom-row-id=\"tldr\""))
          return [tldrRow];
        return [];
      },
    } as unknown as Document;

    placeTLDRBeforeExtra(mockDoc);

    expect(parent.insertBefore).toHaveBeenCalledWith(tldrRow, extraRow);
    expect(tldrRow.nextElementSibling).toBe(extraRow);
    expect(tldrClasses.has("meta-row-tldr")).toBe(true);
    expect(rowAttrs.get("data-fieldname")).toBe("tldr");
    expect(labelClasses.has("meta-label-tldr")).toBe(true);
    expect(labelAttrs.get("fieldname")).toBe("tldr");
    expect(labelAttrs.get("data-fieldname")).toBe("tldr");
    expect(valueClasses.has("meta-value-tldr")).toBe(true);
    expect(valueAttrs.get("data-fieldname")).toBe("tldr");
  });

  it("falls back to placing TLDR before dateAdded when extra row is not found", () => {
    const children: any[] = [];
    let dateAddedLabel: any;
    let dateAddedRow: any;

    const parent: any = {
      children,
      insertBefore: vi.fn((newChild: any, refChild: any) => {
        const oldIndex = children.indexOf(newChild);
        if (oldIndex !== -1)
          children.splice(oldIndex, 1);
        const refIndex = children.indexOf(refChild);
        if (refIndex !== -1)
          children.splice(refIndex, 0, newChild);
        else
          children.push(newChild);
      }),
      querySelector: vi.fn((sel: string) => {
        if (sel.includes("meta-label-dateAdded"))
          return dateAddedLabel;
        return null;
      }),
    };

    dateAddedLabel = {
      closest: vi.fn((sel: string) => sel.includes("meta-row") ? dateAddedRow : null),
      parentElement: null,
    };
    dateAddedRow = {
      parentElement: parent,
      get nextElementSibling() {
        const idx = children.indexOf(dateAddedRow);
        return idx !== -1 && idx + 1 < children.length ? children[idx + 1] : null;
      },
    };
    dateAddedLabel.parentElement = dateAddedRow;

    const tldrRow: any = {
      parentElement: parent,
      classList: { contains: () => false, add: vi.fn() },
      querySelector: () => null,
      get nextElementSibling() {
        const idx = children.indexOf(tldrRow);
        return idx !== -1 && idx + 1 < children.length ? children[idx + 1] : null;
      },
    };

    // DOM: titleRow, dateAddedRow, tldrRow (no extra row)
    const titleRow: any = { parentElement: parent };
    children.push(titleRow, dateAddedRow, tldrRow);

    const mockDoc = {
      querySelectorAll: (sel: string) => sel.includes("data-custom-row-id=\"tldr\"") ? [tldrRow] : [],
    } as unknown as Document;

    placeTLDRBeforeExtra(mockDoc);

    expect(parent.insertBefore).toHaveBeenCalledWith(tldrRow, dateAddedRow);
    expect(tldrRow.nextElementSibling).toBe(dateAddedRow);
  });

  it("hides extra row when it only contains TLDR and tldrRow is visible", () => {
    let extraRow: any;
    const parent: any = {
      children: [],
      insertBefore: vi.fn(),
      closest: vi.fn(() => null),
      querySelector: vi.fn((sel: string) => {
        if (sel.includes("data-fieldname='extra'") || sel.includes("meta-label-extra"))
          return extraRow;
        return null;
      }),
    };

    extraRow = {
      parentElement: parent,
      style: {
        display: "",
        setProperty: vi.fn((prop: string, val: string) => {
          if (prop === "display")
            extraRow.style.display = val;
        }),
      },
      hidden: false,
      querySelector: vi.fn((sel: string) => {
        if (sel.includes(".value")) {
          return {
            value: "TLDR: The gate-tunable interband resonant four-wave mixing",
            textContent: "",
          };
        }
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

    expect(extraRow.hidden).toBe(true);
    expect(extraRow.style.display).toBe("none");
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
