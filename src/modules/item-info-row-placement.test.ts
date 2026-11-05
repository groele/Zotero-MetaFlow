// autocorrect-disable
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { placeTLDRBeforeExtra, unregisterInfoRows } from "./item-info-row";

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
});
