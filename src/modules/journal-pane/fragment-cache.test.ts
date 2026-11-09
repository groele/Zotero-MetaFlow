import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearJournalPaneFragmentCache,
  computeJournalCardCacheKey,
  getCachedJournalCardClone,
  getJournalPaneFragmentCacheStats,
  storeCachedJournalCardTemplate,
} from "./fragment-cache";
import { setupRefreshButton } from "./share-button";

function createFakeDoc() {
  const createNode = (tag: string): any => {
    const attrs = new Map<string, string>();
    const children: any[] = [];
    const listeners = new Map<string, ((e: any) => any)[]>();
    const node: any = {
      tagName: tag.toUpperCase(),
      className: "",
      textContent: "",
      title: "",
      type: "",
      disabled: false,
      isConnected: true,
      parentElement: null as any,
      style: { cssText: "" },
      get firstElementChild() {
        return children[0] || null;
      },
      setAttribute: (k: string, v: string) => attrs.set(k, String(v)),
      getAttribute: (k: string) => attrs.get(k) ?? null,
      removeAttribute: (k: string) => attrs.delete(k),
      hasAttribute: (k: string) => attrs.has(k),
      append: (...nodes: any[]) => {
        for (const n of nodes) {
          if (n && typeof n === "object")
            n.parentElement = node;
          children.push(n);
        }
      },
      replaceChildren: (...nodes: any[]) => {
        for (const old of children) {
          if (old && typeof old === "object")
            old.isConnected = false;
        }
        children.length = 0;
        for (const n of nodes) {
          if (n && typeof n === "object") {
            n.parentElement = node;
            n.isConnected = true;
          }
          children.push(n);
        }
      },
      closest: (selector: string) => {
        if (selector === "[data-type='body']")
          return node.parentElement;
        return null;
      },
      querySelector: (selector: string) => {
        if (selector.includes("data-journal-refresh"))
          return children.find(c => c?.getAttribute?.("data-journal-refresh") === "true") || null;
        return null;
      },
      cloneNode: () => {
        const copy = createNode(tag);
        copy.className = node.className;
        copy.textContent = node.textContent;
        for (const [k, v] of attrs)
          copy.setAttribute(k, v);
        for (const child of children)
          copy.append(child?.cloneNode ? child.cloneNode(true) : child);
        return copy;
      },
      addEventListener: (event: string, fn: (e: any) => any) => {
        const list = listeners.get(event) || [];
        list.push(fn);
        listeners.set(event, list);
      },
      dispatchClick: async () => {
        for (const fn of listeners.get("click") || [])
          await fn({ stopPropagation: () => {} });
      },
    };
    return node;
  };
  return {
    createElementNS: (_ns: string, tag: string) => createNode(tag),
    defaultView: {
      matchMedia: () => ({ matches: true }),
      setTimeout: () => 1,
      clearTimeout: () => {},
      addEventListener: () => {},
    },
  } as unknown as Document;
}

describe("journal pane fragment cache & refresh button feedback", () => {
  beforeEach(() => {
    clearJournalPaneFragmentCache();
  });

  it("caches and clones journal card DOM templates across same-journal items", () => {
    const doc = createFakeDoc();
    const key = computeJournalCardCacheKey({
      locale: "zh-CN",
      itemType: "journalArticle",
      headingText: "Nature Communications",
      badgeKind: "",
      noticeKind: "",
      noticeDOI: "",
      supportsRankings: true,
      editable: true,
      messages: [],
      displayedRankings: [{ key: "jcr", labelID: "easyscholar-field-jcr", value: "Q1" }],
      sciRanking: { key: "sci", labelID: "easyscholar-field-sci", value: "是" },
      rows: [{ label: "Nature Index", value: "是", matched: true, source: "builtin" }],
      matchBases: ["2041-1723"],
      issn: "2041-1723",
    });

    expect(getCachedJournalCardClone(doc, key)).toBeUndefined();
    expect(getJournalPaneFragmentCacheStats().misses).toBe(1);

    const template = doc.createElementNS("http://www.w3.org/1999/xhtml", "div") as HTMLElement;
    template.className = "metaref-journal-pane-wrap";
    template.setAttribute("data-journal-title", "Nature Communications");
    storeCachedJournalCardTemplate(doc, key, template);

    const clone = getCachedJournalCardClone(doc, key);
    expect(clone).toBeDefined();
    expect(clone).not.toBe(template);
    expect(clone?.getAttribute("data-journal-title")).toBe("Nature Communications");
    expect(getJournalPaneFragmentCacheStats().hits).toBe(1);

    clearJournalPaneFragmentCache();
    expect(getCachedJournalCardClone(doc, key)).toBeUndefined();
  });

  it("updates the newly re-rendered refresh button with checkmark feedback after onRefreshJournal replaces body", async () => {
    const doc = createFakeDoc();
    const hostBody = (doc as any).createElementNS("http://www.w3.org/1999/xhtml", "div");
    const item = {
      id: 42,
      itemType: "journalArticle",
      getField: (f: string) => (f === "publicationTitle" ? "Nature Communications" : ""),
    } as unknown as Zotero.Item;

    const btn1 = setupRefreshButton(doc, item);
    hostBody.append(btn1);

    let reRenderedBtn: HTMLButtonElement | undefined;
    (globalThis as any).addon = {
      data: { alive: true, config: { prefsPrefix: "extensions.zotero.metaref" } },
      hooks: {
        onRefreshJournal: vi.fn(async () => {
          // Simulate refreshJournalPane replacing hostBody's children with a brand-new button
          reRenderedBtn = setupRefreshButton(doc, item);
          hostBody.replaceChildren(reRenderedBtn);
          return { records: [], cancelled: false };
        }),
      },
    };

    await (btn1 as any).dispatchClick();

    expect((globalThis as any).addon.hooks.onRefreshJournal).toHaveBeenCalledWith(item, true);
    expect(btn1.isConnected).toBe(false);
    expect(reRenderedBtn?.isConnected).toBe(true);
    expect(reRenderedBtn?.getAttribute("data-refresh-success")).toBe("true");
  });
});
