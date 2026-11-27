import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveAddonHost, resolveZoteroHost } from "../../kernel/host-globals";
import { PluginKernel } from "../../kernel/plugin-kernel";
import { ReviewDuplicatesDomainModule } from "./module";

describe("duplicate-settings and Gecko loadSubScript global resolution", () => {
  afterEach(() => {
    delete (globalThis as any)._globalThis;
    delete (globalThis as any).addon;
    delete (globalThis as any).Zotero;
    vi.unstubAllGlobals();
  });

  it("resolves addon and Zotero from _globalThis sandbox ctx when globalThis.addon is undefined", () => {
    delete (globalThis as any).addon;
    delete (globalThis as any).Zotero;
    const sandboxZotero = { version: "10.0.8", Prefs: { get: () => "keep" } };
    const sandboxAddon = { data: { alive: true, config: { prefsPrefix: "extensions.zotero.metaref" } } };
    (globalThis as any)._globalThis = {
      Zotero: sandboxZotero,
      addon: sandboxAddon,
    };

    expect((globalThis as any).addon).toBeUndefined();
    expect(resolveZoteroHost()).toBe(sandboxZotero);
    expect(resolveAddonHost()).toBe(sandboxAddon);
  });

  it("renders default-action radios, master radios, and concurrency=3 via ReviewDuplicatesPort.setupSettingsPane", () => {
    const kernel = new PluginKernel({
      prefPrefix: "extensions.zotero.metaref",
      prefDefaults: {
        "duplicates.defaultAction": "keep",
        "duplicates.masterStrategy": "detailed",
        "duplicates.concurrency": 3,
      },
    });
    const domain = new ReviewDuplicatesDomainModule(kernel);
    domain.ensurePortRegistered();

    delete (globalThis as any).addon;
    const sandboxZotero = {
      Prefs: {
        get: (key: string) => {
          if (key.endsWith("duplicates.defaultAction"))
            return "keep";
          if (key.endsWith("duplicates.masterStrategy"))
            return "detailed";
          if (key.endsWith("duplicates.concurrency"))
            return 3;
          return undefined;
        },
        set: vi.fn(),
      },
      Libraries: { userLibraryID: 1 },
    };
    const sandboxAddon = {
      data: { alive: true, config: { addonID: "metaflow@groele", prefsPrefix: "extensions.zotero.metaref" } },
      kernel,
    };
    // Simulate Gecko Services.scriptloader.loadSubScript(url, ctx) where globalThis.addon is undefined
    (globalThis as any)._globalThis = { Zotero: sandboxZotero, addon: sandboxAddon };
    vi.stubGlobal("Zotero", sandboxZotero);

    const makeEl = (tag: string, id = "") => {
      const attrs = new Map<string, string>();
      const el: any = {
        tagName: tag,
        id,
        className: "",
        value: "",
        checked: false,
        disabled: false,
        textContent: "",
        children: [] as any[],
        append(...nodes: any[]) {
          this.children.push(...nodes);
        },
        setAttribute: (k: string, v: string) => attrs.set(k, v),
        removeAttribute: (k: string) => attrs.delete(k),
        hasAttribute: (k: string) => attrs.has(k),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        querySelectorAll: () => [],
      };
      return el;
    };

    const defaultGroup = makeEl("div", "metaref-duplicates-default-action");
    const masterGroup = makeEl("div", "metaref-duplicates-master");
    const concurrencyInput = makeEl("input", "metaref-duplicates-concurrency");
    const statusBox = makeEl("div", "metaref-duplicates-status");
    const buttons = Object.fromEntries(
      ["review", "bulk", "pause", "cancel", "refresh", "export", "import"].map(k => [
        `#metaref-duplicates-${k}`,
        makeEl("button", `metaref-duplicates-${k}`),
      ]),
    );
    const bySelector: Record<string, any> = {
      "#metaref-duplicates-default-action": defaultGroup,
      "#metaref-duplicates-master": masterGroup,
      "#metaref-duplicates-concurrency": concurrencyInput,
      "#metaref-duplicates-status": statusBox,
      ...buttons,
    };
    const host = {
      querySelector: (sel: string) => bySelector[sel] ?? null,
      querySelectorAll: () => [],
    };
    const pane: any = {
      ownerDocument: {
        defaultView: { AbortController },
        createElementNS: (_ns: string, tag: string) => makeEl(tag),
      },
      querySelector: (sel: string) => (sel === "#metaref-duplicate-settings" ? host : null),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    resolveAddonHost()?.kernel?.ports?.get?.("review-duplicates")?.setupSettingsPane?.(pane);

    expect(defaultGroup.children).toHaveLength(4);
    expect(masterGroup.children).toHaveLength(4);
    expect(concurrencyInput.value).toBe("3");
    expect(buttons["#metaref-duplicates-pause"].disabled).toBe(true);
    expect(buttons["#metaref-duplicates-cancel"].disabled).toBe(true);
  });
});
