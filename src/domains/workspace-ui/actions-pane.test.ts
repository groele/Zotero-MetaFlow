import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyActionsPaneSidenavPosition, ensureActionsPaneSidenavOrder, registerActionsPane, supportsActionsPane, unregisterActionsPane } from "./actions-pane";

const mocks = vi.hoisted(() => ({
  preferences: new Map<string, unknown>(),
  sections: new Map<string, any>(),
  prefObservers: new Map<symbol, { pref: string; callback: () => void }>(),
  runBatch: vi.fn(),
  onLintInBatch: vi.fn(),
}));

vi.mock("../../utils/prefs", () => ({
  getPref: (key: string, fallback: unknown) => mocks.preferences.get(key) ?? fallback,
  setPref: (key: string, value: unknown) => {
    mocks.preferences.set(key, value);
  },
}));

vi.mock("../../utils/locale", () => ({
  getLocaleID: (key: string) => `metaref-${key}`,
  getString: (key: string) => key,
}));

vi.mock("../../utils/logger", () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

function createMockDom() {
  const styles = new Map<string, any>();
  const makeNode = (tag: string): any => {
    const attributes = new Map<string, string>();
    const listeners = new Map<string, Set<(event: any) => void>>();
    const node: any = {
      tagName: tag.toLowerCase(),
      id: "",
      className: "",
      textContent: "",
      disabled: false,
      style: { cssText: "" },
      children: [] as any[],
      parentElement: null as any,
      isConnected: true,
      ownerDocument: null as any,
      setAttribute(name: string, value: string) {
        attributes.set(name, value);
        if (name === "id") {
          node.id = value;
          styles.set(value, node);
        }
        if (name === "class")
          node.className = value;
      },
      getAttribute(name: string) {
        if (name === "id" && node.id)
          return node.id;
        return attributes.get(name) ?? null;
      },
      append(...children: any[]) {
        for (const child of children) {
          child.parentElement = node;
          node.children.push(child);
        }
      },
      replaceChildren(...children: any[]) {
        node.children = [];
        node.append(...children);
      },
      addEventListener(type: string, fn: (event: any) => void) {
        if (!listeners.has(type))
          listeners.set(type, new Set());
        listeners.get(type)!.add(fn);
      },
      dispatchEvent(event: { type: string; stopPropagation?: () => void }) {
        const ev = { ...event, stopPropagation: event.stopPropagation ?? (() => {}) };
        for (const fn of listeners.get(ev.type) ?? [])
          fn(ev);
      },
      click() {
        node.dispatchEvent({ type: "click" });
      },
      closest(selector: string) {
        let cur: any = node;
        while (cur) {
          if (selector === "item-pane-custom-section" && cur.tagName === "item-pane-custom-section")
            return cur;
          cur = cur.parentElement;
        }
        return null;
      },
      querySelector(selector: string) {
        return node.querySelectorAll(selector)[0] ?? null;
      },
      querySelectorAll(selector: string) {
        const out: any[] = [];
        const visit = (cur: any) => {
          for (const child of cur.children) {
            if (selector === "[data-metaref-action='check']" && child.getAttribute("data-metaref-action") === "check")
              out.push(child);
            else if (selector === "[data-metaref-action='update']" && child.getAttribute("data-metaref-action") === "update")
              out.push(child);
            else if (selector === "[data-actions-status='true']" && child.getAttribute("data-actions-status") === "true")
              out.push(child);
            visit(child);
          }
        };
        visit(node);
        return out;
      },
    };
    return node;
  };

  const head = makeNode("head");
  const doc: any = {
    head,
    defaultView: {
      requestAnimationFrame: (fn: () => void) => fn(),
    },
    getElementById: (id: string) => styles.get(id) ?? null,
    createElementNS: (_ns: string, tag: string) => {
      const el = makeNode(tag);
      el.ownerDocument = doc;
      return el;
    },
  };
  head.ownerDocument = doc;
  const section = makeNode("item-pane-custom-section");
  section.ownerDocument = doc;
  const body = makeNode("div");
  body.ownerDocument = doc;
  section.append(body);
  return { doc, section, body };
}

function makeItem(overrides: Partial<Zotero.Item> = {}): Zotero.Item {
  return {
    id: 101,
    itemType: "journalArticle",
    deleted: false,
    isRegularItem: () => true,
    isEditable: () => true,
    ...overrides,
  } as unknown as Zotero.Item;
}

describe("actions-pane module", () => {
  beforeEach(() => {
    mocks.preferences.clear();
    mocks.sections.clear();
    mocks.prefObservers.clear();
    mocks.runBatch.mockReset().mockResolvedValue({ saved: 1, failed: 0, preparationFailed: 0, cancelled: false });
    mocks.onLintInBatch.mockReset().mockResolvedValue({ saved: 1, failed: 0, preparationFailed: 0, cancelled: false });
    vi.stubGlobal("rootURI", "chrome://zoterometaflow/");
    vi.stubGlobal("addon", {
      data: {
        alive: true,
        config: { addonID: "metaflow@groele", prefsPrefix: "extensions.zotero.metaref" },
      },
      hooks: {
        onLintInBatch: mocks.onLintInBatch,
      },
      kernel: {
        ports: {
          get: (id: string) => id === "lint-engine" ? { runBatch: mocks.runBatch } : undefined,
        },
      },
    });
    vi.stubGlobal("Zotero", {
      Items: {
        get: () => undefined,
      },
      ItemPaneManager: {
        registerSection: (options: any) => {
          mocks.sections.set(options.paneID, options);
          return options.paneID;
        },
        unregisterSection: vi.fn((id: string) => {
          mocks.sections.delete(id);
          return true;
        }),
      },
      Prefs: {
        get: vi.fn(),
        registerObserver: (pref: string, callback: () => void) => {
          const id = Symbol(pref);
          mocks.prefObservers.set(id, { pref, callback });
          return id;
        },
        unregisterObserver: (id: symbol) => {
          mocks.prefObservers.delete(id);
          return true;
        },
      },
    });
  });

  afterEach(() => {
    unregisterActionsPane();
    vi.unstubAllGlobals();
  });

  it("evaluates item eligibility and preference toggle correctly", () => {
    expect(supportsActionsPane(undefined)).toBe(false);
    expect(supportsActionsPane(makeItem())).toBe(true);
    expect(supportsActionsPane(makeItem({ isRegularItem: () => false }))).toBe(false);
    expect(supportsActionsPane(makeItem({ deleted: true }))).toBe(false);
    expect(supportsActionsPane(makeItem({ isEditable: () => false }))).toBe(true);

    mocks.preferences.set("workflow.showActionsPane", false);
    expect(supportsActionsPane(makeItem())).toBe(false);
  });

  it("places metaref-actions adjacent to metaref-journal-insights in existing sidenav.order once", () => {
    const store = new Map<string, unknown>([
      ["sidenav.order", "info,metaflow\\@groele-metaref-journal-insights,related"],
    ]);
    const fakeZotero = {
      Prefs: {
        get: (key: string) => store.get(key),
        set: (key: string, val: unknown) => store.set(key, val),
      },
    };
    ensureActionsPaneSidenavOrder(fakeZotero, "metaflow@groele");
    expect(store.get("sidenav.order")).toBe("info,metaflow\\@groele-metaref-journal-insights,metaflow\\@groele-metaref-actions,related");

    applyActionsPaneSidenavPosition(fakeZotero, "metaflow@groele", "top");
    expect(store.get("sidenav.order")).toBe("metaflow\\@groele-metaref-actions,info,metaflow\\@groele-metaref-journal-insights,related");

    applyActionsPaneSidenavPosition(fakeZotero, "metaflow@groele", "before-journal");
    expect(store.get("sidenav.order")).toBe("info,metaflow\\@groele-metaref-actions,metaflow\\@groele-metaref-journal-insights,related");

    applyActionsPaneSidenavPosition(fakeZotero, "metaflow@groele", "bottom");
    expect(store.get("sidenav.order")).toBe("info,metaflow\\@groele-metaref-journal-insights,related,metaflow\\@groele-metaref-actions");
  });

  it("registers the sidebar section with distinct icon, renders both core action buttons, and executes them", async () => {
    registerActionsPane();
    const sectionOpts = mocks.sections.get("metaref-actions");
    expect(sectionOpts).toBeDefined();
    expect(sectionOpts.pluginID).toBe("metaflow@groele");
    expect(sectionOpts.sidenav.icon).toContain("metaref-actions.svg");
    expect(sectionOpts.header.icon).toContain("metaref-actions.svg");

    const { doc, section, body } = createMockDom();
    const item = makeItem();
    section.item = item;
    const setEnabled = vi.fn();
    const refresh = vi.fn(async () => {
      sectionOpts.onRender({ body, doc, item, setEnabled });
    });

    sectionOpts.onInit({ body, doc, item, refresh, setEnabled });
    sectionOpts.onRender({ body, doc, item, setEnabled });
    expect(setEnabled).toHaveBeenLastCalledWith(true);

    const checkBtn = body.querySelector("[data-metaref-action='check']");
    const updateBtn = body.querySelector("[data-metaref-action='update']");
    expect(checkBtn).not.toBeNull();
    expect(updateBtn).not.toBeNull();
    expect(checkBtn.children[0]?.children).toHaveLength(4);
    expect(updateBtn.children[0]?.children).toHaveLength(3);
    expect(checkBtn.children[2]?.className).toBe("metaref-action-chevron");
    expect(updateBtn.children[2]?.className).toBe("metaref-action-chevron");
    expect(doc.head.children.find((el: any) => el.id === "metaref-actions-pane-styles")?.textContent).toContain("max-height: none !important");

    checkBtn.click();
    await vi.waitFor(() => expect(mocks.runBatch).toHaveBeenCalledTimes(1));
    expect(mocks.runBatch).toHaveBeenCalledWith("standard", [item], { core: true });
    await vi.waitFor(() => {
      expect(body.querySelector("[data-actions-status='true']")?.textContent).toBe("actions-pane-done-saved");
    });

    let resolveUpdate!: (value: unknown) => void;
    mocks.runBatch.mockImplementationOnce(() => new Promise((resolve) => {
      resolveUpdate = resolve;
    }));
    body.querySelector("[data-metaref-action='update']").click();
    await vi.waitFor(() => expect(mocks.runBatch).toHaveBeenCalledTimes(2));
    expect(mocks.runBatch).toHaveBeenLastCalledWith("tool-update-metadata", [item], { review: true });

    // Second click while running is ignored because buttons are disabled
    body.querySelector("[data-metaref-action='check']").click();
    expect(mocks.runBatch).toHaveBeenCalledTimes(2);

    resolveUpdate({ saved: 0, failed: 0, preparationFailed: 0, cancelled: false });
    await vi.waitFor(() => {
      expect(body.querySelector("[data-actions-status='true']")?.textContent).toBe("actions-pane-done-clean");
    });
  });

  it("toggles visibility immediately when workflow.showActionsPane changes and cleans up on unregister", async () => {
    registerActionsPane();
    const sectionOpts = mocks.sections.get("metaref-actions");
    const { doc, section, body } = createMockDom();
    const item = makeItem();
    section.item = item;
    const setEnabled = vi.fn();
    const refresh = vi.fn(async () => {
      sectionOpts.onRender({ body, doc, item, setEnabled });
    });

    sectionOpts.onInit({ body, doc, item, refresh, setEnabled });
    sectionOpts.onRender({ body, doc, item, setEnabled });
    expect(body.querySelector("[data-metaref-action='check']")).not.toBeNull();

    mocks.preferences.set("workflow.showActionsPane", false);
    for (const observer of mocks.prefObservers.values())
      observer.callback();

    await vi.waitFor(() => expect(setEnabled).toHaveBeenLastCalledWith(false));
    expect(body.children).toHaveLength(0);

    mocks.preferences.set("workflow.showActionsPane", true);
    for (const observer of mocks.prefObservers.values())
      observer.callback();

    await vi.waitFor(() => expect(setEnabled).toHaveBeenLastCalledWith(true));
    expect(body.querySelector("[data-metaref-action='check']")).not.toBeNull();

    // Re-init after DOM reorder (disconnectedCallback wipes body while section.item stays set)
    body.replaceChildren();
    sectionOpts.onInit({ body, doc, item: undefined, refresh, setEnabled });
    expect(body.querySelector("[data-metaref-action='check']")).not.toBeNull();

    // Expanding collapsed section recovers missing content via onToggle
    body.replaceChildren();
    sectionOpts.onToggle({ body, doc, item: undefined, setEnabled });
    expect(body.querySelector("[data-metaref-action='update']")).not.toBeNull();

    unregisterActionsPane();
    expect(mocks.sections.size).toBe(0);
    expect(mocks.prefObservers.size).toBe(0);
  });
});
