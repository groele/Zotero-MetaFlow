import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { selectSettingsTab, SETTINGS_TABS, setupHorizontalTabs } from "./settings-tabs";

interface MockNode {
  tagName: string;
  id: string;
  className: string;
  textContent: string;
  open: boolean;
  parentElement: MockNode | null;
  children: MockNode[];
  ownerDocument: unknown;
  attributes: Map<string, string>;
  listeners: Map<string, Set<(event: any) => void>>;
  classList: {
    add: (...tokens: string[]) => void;
    remove: (...tokens: string[]) => void;
    toggle: (token: string, force?: boolean) => boolean;
    contains: (token: string) => boolean;
  };
  setAttribute: (name: string, value: string) => void;
  getAttribute: (name: string) => string | null;
  removeAttribute: (name: string) => void;
  hasAttribute: (name: string) => boolean;
  append: (...nodes: MockNode[]) => void;
  before: (...nodes: MockNode[]) => void;
  addEventListener: (type: string, fn: (event: any) => void) => void;
  removeEventListener: (type: string, fn: (event: any) => void) => void;
  dispatchEvent: (event: { type: string; key?: string; bubbles?: boolean; preventDefault?: () => void }) => void;
  click: () => void;
  focus: () => void;
  querySelector: (selector: string) => MockNode | null;
  querySelectorAll: (selector: string) => MockNode[];
  firstElementChild: MockNode | null;
}

function matchAtom(node: MockNode, atom: string): boolean {
  const s = atom.trim();
  const attrMatches = [...s.matchAll(/\[([^=\]$]+)(?:(\$=|=)['"]?([^'"\]]*)['"]?)?\]/g)];
  for (const m of attrMatches) {
    const [, attrName, op, attrVal] = m;
    const actual = node.getAttribute(attrName);
    if (!op && actual === null)
      return false;
    if (op === "=" && actual !== attrVal)
      return false;
    if (op === "$=" && (!actual || !actual.endsWith(attrVal)))
      return false;
  }
  const clean = s.replace(/\[[^\]]+\]/g, "");
  if (!clean)
    return true;
  if (clean.startsWith("#"))
    return node.id === clean.slice(1);
  const classes = node.className.split(/\s+/).filter(Boolean);
  if (clean.startsWith("."))
    return clean.split(".").filter(Boolean).every(c => classes.includes(c));
  const [tag, ...cls] = clean.split(".");
  if (tag && node.tagName !== tag.toLowerCase())
    return false;
  return cls.every(c => classes.includes(c));
}

function matchesSelector(node: MockNode, sel: string, scopeNode: MockNode): boolean {
  const trimmed = sel.trim();
  if (trimmed.startsWith(":scope >")) {
    const rest = trimmed.replace(/^:scope\s*>\s*/, "");
    if (!rest.includes(" "))
      return node.parentElement === scopeNode && matchAtom(node, rest);
    const [childSel, ...descParts] = rest.split(/\s+/);
    if (!matchAtom(node, descParts.join(" ")))
      return false;
    let cur = node.parentElement;
    while (cur && cur !== scopeNode) {
      if (cur.parentElement === scopeNode && matchAtom(cur, childSel))
        return true;
      cur = cur.parentElement;
    }
    return false;
  }
  if (trimmed.includes(" ")) {
    const parts = trimmed.split(/\s+/);
    const last = parts.pop()!;
    if (!matchAtom(node, last))
      return false;
    let cur = node.parentElement;
    while (cur) {
      if (matchAtom(cur, parts.join(" ")))
        return true;
      cur = cur.parentElement;
    }
    return false;
  }
  return matchAtom(node, trimmed);
}

function createMockDoc() {
  const doc = {
    defaultView: { AbortController },
    createElementNS(_ns: string, tag: string): MockNode {
      return createMockElement(tag, doc);
    },
    createElement(tag: string): MockNode {
      return createMockElement(tag, doc);
    },
  };
  return doc;
}

function createMockElement(tag: string, doc: unknown): MockNode {
  const attributes = new Map<string, string>();
  const listeners = new Map<string, Set<(event: any) => void>>();
  const node: MockNode = {
    tagName: tag.toLowerCase(),
    id: "",
    className: "",
    textContent: "",
    open: false,
    parentElement: null,
    children: [],
    ownerDocument: doc,
    attributes,
    listeners,
    get firstElementChild() {
      return node.children[0] ?? null;
    },
    classList: {
      add(...tokens: string[]) {
        const set = new Set(node.className.split(/\s+/).filter(Boolean));
        tokens.forEach(t => set.add(t));
        node.className = [...set].join(" ");
      },
      remove(...tokens: string[]) {
        const set = new Set(node.className.split(/\s+/).filter(Boolean));
        tokens.forEach(t => set.delete(t));
        node.className = [...set].join(" ");
      },
      toggle(token: string, force?: boolean) {
        const has = node.classList.contains(token);
        const next = force !== undefined ? force : !has;
        if (next)
          node.classList.add(token);
        else
          node.classList.remove(token);
        return next;
      },
      contains(token: string) {
        return node.className.split(/\s+/).filter(Boolean).includes(token);
      },
    },
    setAttribute(name: string, value: string) {
      attributes.set(name, value);
      if (name === "id")
        node.id = value;
      if (name === "class")
        node.className = value;
    },
    getAttribute(name: string) {
      if (name === "id" && node.id)
        return node.id;
      if (name === "class" && node.className)
        return node.className;
      return attributes.get(name) ?? null;
    },
    removeAttribute(name: string) {
      attributes.delete(name);
    },
    hasAttribute(name: string) {
      return attributes.has(name);
    },
    append(...nodes: MockNode[]) {
      for (const child of nodes) {
        child.parentElement = node;
        node.children.push(child);
      }
    },
    before(...nodes: MockNode[]) {
      const parent = node.parentElement;
      if (!parent)
        return;
      const idx = parent.children.indexOf(node);
      if (idx === -1)
        return;
      for (const n of nodes)
        n.parentElement = parent;
      parent.children.splice(idx, 0, ...nodes);
    },
    addEventListener(type: string, fn: (event: any) => void) {
      if (!listeners.has(type))
        listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: (event: any) => void) {
      listeners.get(type)?.delete(fn);
    },
    dispatchEvent(event: { type: string; key?: string; bubbles?: boolean; preventDefault?: () => void }) {
      const ev = { ...event, preventDefault: event.preventDefault ?? (() => {}) };
      for (const fn of listeners.get(ev.type) ?? [])
        fn(ev);
      if (ev.bubbles && node.parentElement)
        node.parentElement.dispatchEvent(ev);
    },
    click() {
      node.dispatchEvent({ type: "click", bubbles: true });
    },
    focus() {},
    querySelector(selector: string) {
      return node.querySelectorAll(selector)[0] ?? null;
    },
    querySelectorAll(selector: string) {
      const results: MockNode[] = [];
      const visit = (cur: MockNode) => {
        for (const child of cur.children) {
          if (matchesSelector(child, selector, node))
            results.push(child);
          visit(child);
        }
      };
      visit(node);
      return results;
    },
  };
  return node;
}

function buildMockPane() {
  const doc = createMockDoc();
  const pane = doc.createElement("div");
  pane.setAttribute("id", "metaref");
  /* eslint-disable antfu/consistent-list-newline */
  const cardHeadings = [
    "section-general", "core-workflows-heading", "duplicates-heading", "section-article-esi",
    "insights-share-heading", "section-article-abbreviation", "section-rules", "data-settings-heading",
    "workflow-tool-center", "shortcuts-header", "section-rich-text", "section-about",
  ];
  /* eslint-enable antfu/consistent-list-newline */

  for (const [index, headingId] of cardHeadings.entries()) {
    const card = doc.createElement("details");
    card.setAttribute("class", "metaref-setting-card metaref-section-card");
    card.open = index === 0;
    const summary = doc.createElement("summary");
    const label = doc.createElement("h2");
    label.setAttribute("data-l10n-id", `metaref-${headingId}`);
    label.textContent = headingId;
    summary.append(label);
    const body = doc.createElement("div");
    body.setAttribute("class", "metaref-card-body");
    card.append(summary, body);
    pane.append(card);
  }

  return { pane: pane as unknown as Element, rawPane: pane };
}

describe("settings-tabs horizontal navigation controller", () => {
  beforeEach(() => {
    vi.stubGlobal("MutationObserver", undefined);
    vi.stubGlobal("Zotero", { Prefs: { get: vi.fn(), set: vi.fn() } });
    vi.stubGlobal("addon", {
      data: {
        alive: true,
        config: { addonID: "metaflow@zotero.org", addonRef: "metaref", prefsPrefix: "extensions.zotero.metaref" },
        locale: { current: {} },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("mounts brand header, 6 horizontal tabs, and overview banner while preserving direct child cards", () => {
    const { pane, rawPane } = buildMockPane();
    setupHorizontalTabs(pane);

    expect(rawPane.querySelector(".metaref-header")).not.toBeNull();
    expect(rawPane.querySelector("#metaref-version-badge")?.textContent).toMatch(/^v\d+\.\d+\.\d+/);
    expect(rawPane.querySelector("#metaref-prefs-status")).not.toBeNull();

    const tabs = rawPane.querySelectorAll("[data-metaref-tab]");
    expect(tabs.map(t => t.getAttribute("data-metaref-tab"))).toEqual(SETTINGS_TABS.map(t => t.id));
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");

    const cards = rawPane.querySelectorAll(":scope > .metaref-section-card");
    expect(cards).toHaveLength(12);
    expect(cards.every(c => c.parentElement === rawPane)).toBe(true);
    expect(cards[0].open).toBe(true);
    expect(cards.slice(1).every(c => !c.open)).toBe(true);

    const overviewCards = cards.filter(c => c.getAttribute("data-metaref-tab-panel") === "overview");
    expect(overviewCards).toHaveLength(2);
    expect(overviewCards.every(c => !c.hasAttribute("data-tab-hidden"))).toBe(true);

    const hiddenCards = cards.filter(c => c.getAttribute("data-metaref-tab-panel") !== "overview");
    expect(hiddenCards).toHaveLength(10);
    expect(hiddenCards.every(c => c.getAttribute("data-tab-hidden") === "true")).toBe(true);
  });

  it("switches tabs on click, opens first card when none open while preserving manual collapse, and hides overview banner", () => {
    const { pane, rawPane } = buildMockPane();
    setupHorizontalTabs(pane);

    const journalsTab = rawPane.querySelector("[data-metaref-tab='journals']")!;
    journalsTab.click();

    expect(rawPane.getAttribute("data-active-tab")).toBe("journals");
    expect(journalsTab.getAttribute("aria-selected")).toBe("true");
    expect(rawPane.querySelector("#metaref-overview-banner")?.getAttribute("data-tab-hidden")).toBe("true");

    const cards = rawPane.querySelectorAll(":scope > .metaref-section-card");
    const journalCards = cards.filter(c => c.getAttribute("data-metaref-tab-panel") === "journals");
    expect(journalCards).toHaveLength(3);
    expect(journalCards.every(c => !c.hasAttribute("data-tab-hidden"))).toBe(true);
    expect(journalCards[0].open).toBe(true);
    expect(journalCards.slice(1).every(c => !c.open)).toBe(true);
  });

  it("supports keyboard ArrowRight, ArrowLeft, Home, and End navigation on tablist", () => {
    const { pane, rawPane } = buildMockPane();
    setupHorizontalTabs(pane);

    const tablist = rawPane.querySelector(".metaref-tabs")!;
    tablist.dispatchEvent({ type: "keydown", key: "ArrowRight", bubbles: true });
    expect(rawPane.getAttribute("data-active-tab")).toBe("rules");

    tablist.dispatchEvent({ type: "keydown", key: "End", bubbles: true });
    expect(rawPane.getAttribute("data-active-tab")).toBe("maintenance");

    tablist.dispatchEvent({ type: "keydown", key: "ArrowLeft", bubbles: true });
    expect(rawPane.getAttribute("data-active-tab")).toBe("tools");

    tablist.dispatchEvent({ type: "keydown", key: "Home", bubbles: true });
    expect(rawPane.getAttribute("data-active-tab")).toBe("overview");
  });

  it("jumps to target tab via overview quick-step pills and updates autosave status on change", () => {
    const { pane, rawPane } = buildMockPane();
    setupHorizontalTabs(pane);

    const dupStep = rawPane.querySelector("[data-metaref-jump='duplicates']")!;
    dupStep.click();
    expect(rawPane.getAttribute("data-active-tab")).toBe("duplicates");

    selectSettingsTab(pane, "overview");
    expect(rawPane.getAttribute("data-active-tab")).toBe("overview");

    const pill = rawPane.querySelector("#metaref-prefs-status")!;
    const actionBtn = rawPane.ownerDocument && (rawPane.ownerDocument as any).createElement("button");
    if (actionBtn) {
      rawPane.append(actionBtn);
      actionBtn.dispatchEvent({ type: "command", bubbles: true, target: actionBtn } as any);
      expect(pill.getAttribute("data-l10n-id")).toBe("metaref-settings-status-autosave");
    }

    rawPane.dispatchEvent({ type: "change", bubbles: true });
    expect(pill.getAttribute("data-l10n-id")).toBe("metaref-settings-status-saved");
  });
});
