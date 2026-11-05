import { describe, expect, it, vi } from "vitest";
import { MENU_SECTIONS, registerMenu, shouldShowSeparator, unregisterMenu } from "./menu";
import { Rules } from "./rules";

describe("menu module", () => {
  const registered = () => {
    const options: any[] = [];
    vi.stubGlobal("addon", { data: { config: { addonRef: "metaref", addonID: "test", prefsPrefix: "test" } } });
    vi.stubGlobal("Zotero", { Prefs: { get: (key: string) => key.endsWith("menu.compact") ? false : undefined }, MenuManager: { registerMenu: (option: any) => {
      options.push(option);
      return String(options.length);
    }, unregisterMenu: vi.fn() } });
    registerMenu();
    return options.find(option => option.target === "main/library/item").menus[0];
  };
  it("registers every command directly with no nested submenus", () => {
    try {
      const root = registered();
      expect(root.menus.filter((menu: any) => menu.menuType === "submenu")).toHaveLength(0);
      expect(root.menus.filter((menu: any) => menu.menuType === "menuitem")).toHaveLength(33);
    }
    finally {
      unregisterMenu();
      vi.unstubAllGlobals();
    }
  });
  it("moves a command between levels without displaying duplicate entries", () => {
    try {
      const options: any[] = [];
      const values = new Map<string, unknown>();
      values.set("extensions.zotero.metaref.menu.compact", false);
      vi.stubGlobal("addon", { data: { config: { addonRef: "metaref", addonID: "test", prefsPrefix: "test" } } });
      vi.stubGlobal("Zotero", { Prefs: { get: (key: string) => values.get(key) }, MenuManager: { registerMenu: (option: any) => {
        options.push(option);
        return String(options.length);
      }, unregisterMenu: vi.fn() } });
      registerMenu();
      const entries = options.find(option => option.target === "main/library/item").menus;
      const label = "metaref-rule-tool-update-easyscholar-menu-item";
      const nested = entries[0].menus.find((entry: any) => entry.l10nID === label);
      const primary = entries.slice(1).find((entry: any) => entry.l10nID === label);
      for (const pinned of [false, true, false]) {
        values.set("extensions.zotero.metaref.menu.primary.tool-update-easyscholar", pinned);
        const visible = vi.fn();
        const context = { items: [], setVisible: visible, setEnabled: vi.fn() };
        nested.onShowing(null, context);
        expect(visible).toHaveBeenLastCalledWith(!pinned);
        primary.onShowing(null, context);
        expect(visible).toHaveBeenLastCalledWith(pinned);
      }
      values.set("extensions.zotero.metaref.menu.tool-update-easyscholar", false);
      for (const entry of [nested, primary]) {
        const visible = vi.fn();
        entry.onShowing(null, { items: [], setVisible: visible, setEnabled: vi.fn() });
        expect(visible).toHaveBeenLastCalledWith(false);
      }
    }
    finally {
      unregisterMenu();
      vi.unstubAllGlobals();
    }
  });
  it("enables read-only index actions but does not treat empty item selection as a collection", () => {
    try {
      const root = registered();
      const enabled = vi.fn();
      const context = { items: [{ isRegularItem: () => true, deleted: false, isEditable: () => false, itemType: "journalArticle" }], setVisible: vi.fn(), setEnabled: enabled };
      root.menus.find((menu: any) => menu.l10nID === "metaref-rule-tool-query-esi-menu-item").onShowing(null, context);
      expect(enabled).toHaveBeenLastCalledWith(true);
      root.menus.find((menu: any) => menu.l10nID === "metaref-menuitem-stdFormatFlow").onShowing(null, context);
      expect(enabled).toHaveBeenLastCalledWith(false);
      root.onShowing(null, { ...context, items: [], get collectionTreeRow() {
        throw new Error("must not read deprecated getter");
      } });
      expect(enabled).toHaveBeenLastCalledWith(true);
      root.menus.find((menu: any) => menu.l10nID === "metaref-menu-show-data-directory").onShowing(null, { ...context, items: [] });
      expect(enabled).toHaveBeenLastCalledWith(true);
    }
    finally {
      unregisterMenu();
      vi.unstubAllGlobals();
    }
  });

  it("executes a native command event once while allowing the next click", async () => {
    try {
      const root = registered();
      const run = vi.fn();
      (addon as any).hooks = { onLintInBatch: run };
      const command = root.menus.find((menu: any) => menu.l10nID === "metaref-menuitem-stdFormatFlow");
      const event = new Event("command");
      await Promise.all([command.onCommand(event, { items: [] }), command.onCommand(event, { items: [] })]);
      expect(run).toHaveBeenCalledTimes(1);
      await Promise.resolve();
      await command.onCommand(event, { items: [] });
      expect(run).toHaveBeenCalledTimes(2);
    }
    finally {
      unregisterMenu();
      vi.unstubAllGlobals();
    }
  });
  it("dispatches metadata updating through the configurable reviewed core workflow", async () => {
    try {
      const root = registered();
      const run = vi.fn();
      (addon as any).hooks = { onLintInBatch: run };
      const command = root.menus.find((menu: any) => menu.l10nID === "metaref-rule-tool-update-metadata-menu-item");
      await command.onCommand(new Event("command"), { items: [] });
      expect(run).toHaveBeenCalledWith(["tool-update-metadata"], [], { review: true });
    }
    finally {
      unregisterMenu();
      vi.unstubAllGlobals();
    }
  });
  describe("shouldShowSeparator", () => {
    it("returns true when current section and subsequent section both have visible items", () => {
      const current = ["a", "b"];
      const following = [["c", "d"], ["e"]];
      const isVisible = (k: string) => k === "a" || k === "e";

      expect(shouldShowSeparator(current, following, isVisible)).toBe(true);
    });

    it("returns false when current section has no visible items", () => {
      const current = ["a", "b"];
      const following = [["c", "d"], ["e"]];
      const isVisible = (k: string) => k === "c";

      expect(shouldShowSeparator(current, following, isVisible)).toBe(false);
    });

    it("returns false when following sections have no visible items", () => {
      const current = ["a", "b"];
      const following = [["c", "d"], ["e"]];
      const isVisible = (k: string) => k === "a";

      expect(shouldShowSeparator(current, following, isVisible)).toBe(false);
    });

    it("returns false when everything is hidden", () => {
      const current = ["a"];
      const following = [["b"]];
      const isVisible = () => false;

      expect(shouldShowSeparator(current, following, isVisible)).toBe(false);
    });
  });

  describe("menu sections configuration", () => {
    it("keeps registered rule IDs unique and every tool out of standard rules", () => {
      const all = Rules.getAll();
      expect(new Set(all.map(rule => rule.id)).size).toBe(all.length);
      for (const rule of all)
        expect(rule.category === "tool").toBe(rule.id.startsWith("tool-"));
      expect(Rules.getStandard().every(rule => !rule.id.startsWith("tool-"))).toBe(true);
    });

    it("covers all 32 menu items across all sections", () => {
      const allItemIDs = Object.values(MENU_SECTIONS).flat();

      expect(allItemIDs).toHaveLength(33);
      const uniqueIDs = new Set(allItemIDs);
      expect(uniqueIDs.size).toBe(33);
    });

    it("references valid registered rules for all rule-based menu items", () => {
      const ruleBasedItems = Object.values(MENU_SECTIONS).flat().filter(id => id !== "standard" && !id.startsWith("show-"));

      const allRegisteredIDs = new Set(Rules.getAll().map(r => r.id));

      for (const id of ruleBasedItems) {
        expect(allRegisteredIDs.has(id as any)).toBe(true);
      }
    });
  });
});
