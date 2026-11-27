import type { NativeRuntime } from "../kernel/native-runtime";
import type { PluginKernel } from "../kernel/plugin-kernel";
import type { Disposable, NotifierEventPayload } from "../kernel/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CacheCoordinatorService } from "./cache-coordinator";
import {
  dedupeAndRegisterPreferencePane,
  formatCapabilitiesSummary,
  patchCollectionTreeDuplicateStats,
  probeHostCapabilities,
  tileProgressWindow,
  unregisterPluginPreferencePanes,
} from "./host";
import { ServiceContainer } from "./service-container";

const mockSpies = vi.hoisted(() => ({
  clearRequestCache: vi.fn(),
  clearEasyScholarCache: vi.fn(),
  clearSupplementalJournalCache: vi.fn(),
  clearLintFingerprintCache: vi.fn(),
  invalidateItemLintFingerprint: vi.fn(),
  bumpLintPrefsRevision: vi.fn(),
  clearDuplicateSearchCache: vi.fn(),
  clearStoredServiceCache: vi.fn().mockResolvedValue(undefined),
  flushServiceCache: vi.fn().mockResolvedValue(true),
  startCacheMaintenance: vi.fn(),
  stopCacheMaintenance: vi.fn().mockResolvedValue(undefined),
  flushRuntimeData: vi.fn().mockResolvedValue(undefined),
  flushJournalRankingIndex: vi.fn().mockResolvedValue(undefined),
  resetJournalRankingIndex: vi.fn(),
  clearJournalInsights: vi.fn(),
}));

vi.mock("../utils/http", () => ({ clearRequestCache: mockSpies.clearRequestCache }));
vi.mock("../utils/easyscholar", () => ({ clearEasyScholarCache: mockSpies.clearEasyScholarCache }));
vi.mock("../utils/supplemental-journals", () => ({ clearSupplementalJournalCache: mockSpies.clearSupplementalJournalCache }));
vi.mock("../utils/lint-fingerprint-cache", () => ({
  clearLintFingerprintCache: mockSpies.clearLintFingerprintCache,
  invalidateItemLintFingerprint: mockSpies.invalidateItemLintFingerprint,
  bumpLintPrefsRevision: mockSpies.bumpLintPrefsRevision,
}));
vi.mock("../utils/duplicate-search-cache", () => ({ clearDuplicateSearchCache: mockSpies.clearDuplicateSearchCache }));
vi.mock("../utils/service-cache-storage", () => ({
  clearStoredServiceCache: mockSpies.clearStoredServiceCache,
  flushServiceCache: mockSpies.flushServiceCache,
}));
vi.mock("../utils/cache-maintenance", () => ({
  startCacheMaintenance: mockSpies.startCacheMaintenance,
  stopCacheMaintenance: mockSpies.stopCacheMaintenance,
}));
vi.mock("../utils/runtime-data-storage", () => ({ flushRuntimeData: mockSpies.flushRuntimeData }));
vi.mock("../utils/journal-ranking-index", () => ({
  flushJournalRankingIndex: mockSpies.flushJournalRankingIndex,
  resetJournalRankingIndex: mockSpies.resetJournalRankingIndex,
}));
vi.mock("../utils/journal-insights", () => ({ clearJournalInsights: mockSpies.clearJournalInsights }));

describe("host services and containers", () => {
  const originalZotero = (globalThis as any).Zotero;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    (globalThis as any).Zotero = originalZotero;
  });

  describe("host-capabilities", () => {
    it("reports all capabilities available when host primitives exist", () => {
      (globalThis as any).Zotero = {
        version: "10.0.1",
        ItemTreeManager: { registerColumn: vi.fn() },
        ItemPaneManager: { registerSection: vi.fn(), registerInfoRow: vi.fn() },
        CollectionTreeRow: { prototype: { getName: vi.fn() } },
        PreferencePanes: { register: vi.fn() },
        ProgressWindowSet: { tile: vi.fn() },
      };
      const fakeWin = {
        customElements: { get: (name: string) => (name === "editable-text" ? {} : undefined) },
        document: {
          getElementById: (id: string) => (id === "zotero-item-pane" ? {} : null),
          querySelector: () => null,
        },
      } as unknown as Window;

      const snapshot = probeHostCapabilities(fakeWin);
      expect(snapshot.hostVersion).toBe("10.0.1");
      expect(snapshot.degradedIds).toEqual([]);
      expect(formatCapabilitiesSummary(snapshot)).toContain("7/7 host capabilities available");
    });

    it("degrades safely without throwing when Zotero globals or window elements throw/missing", () => {
      (globalThis as any).Zotero = {
        version: "10.0",
        get ItemTreeManager() {
          throw new Error("ItemTreeManager blocked");
        },
      };
      const snapshot = probeHostCapabilities(null);
      expect(snapshot.degradedIds).toHaveLength(7);
      expect(snapshot.capabilities.itemTreeColumns.degradedReason).toContain("ItemTreeManager blocked");
      expect(formatCapabilitiesSummary(snapshot)).toContain("0/7 host capabilities available; degraded:");
    });
  });

  describe("collection-tree-adapter", () => {
    it("patches via NativeRuntime when provided and delegates disposal", () => {
      const origGetName = vi.fn(() => "Duplicates");
      const prototype = { getName: origGetName };
      (globalThis as any).Zotero = { CollectionTreeRow: { prototype } };
      const disposeSpy = vi.fn();
      const runtime = {
        patch: vi.fn((owner, key, _name, createWrapper) => {
          owner[key] = createWrapper(owner[key]);
          return disposeSpy;
        }),
      } as unknown as NativeRuntime;

      const disposer = patchCollectionTreeDuplicateStats(runtime, lib => (lib === 1 ? "3/6" : null));
      expect(runtime.patch).toHaveBeenCalledWith(prototype, "getName", "CollectionTreeRow", expect.any(Function));
      const row = {
        ref: { libraryID: 1 },
        isDuplicates: () => true,
        getName: prototype.getName,
      };
      expect(row.getName()).toBe("Duplicates 3/6");
      disposer();
      expect(disposeSpy).toHaveBeenCalledTimes(1);
    });

    it("patches locally without runtime and restores original method on dispose", () => {
      const origGetName = function () {
        return "My Library";
      };
      const prototype = { getName: origGetName };
      (globalThis as any).Zotero = { CollectionTreeRow: { prototype } };

      const disposer = patchCollectionTreeDuplicateStats(undefined, () => "2/4");
      const dupRow = { ref: { libraryID: 2 }, isDuplicates: () => true, getName: prototype.getName };
      const normalRow = { ref: { libraryID: 2 }, isDuplicates: () => false, getName: prototype.getName };
      expect(dupRow.getName()).toBe("My Library 2/4");
      expect(normalRow.getName()).toBe("My Library");

      disposer();
      expect(prototype.getName).toBe(origGetName);
    });
  });

  describe("preference-pane-adapter", () => {
    it("dedupes stale panes, registers new pane, and unregisters if dead after await", async () => {
      const pluginPanes = [
        { id: "old-pane", pluginID: "metaflow@groele", src: "chrome://old.xhtml" },
        { id: "other-pane", pluginID: "other@plugin", src: "chrome://other.xhtml" },
      ];
      const unregister = vi.fn((id: string) => {
        const idx = pluginPanes.findIndex(p => p.id === id);
        if (idx >= 0)
          pluginPanes.splice(idx, 1);
      });
      const register = vi.fn().mockResolvedValue("metaref-settings");
      const tile = vi.fn();
      (globalThis as any).Zotero = {
        PreferencePanes: { pluginPanes, register, unregister },
        ProgressWindowSet: { tile },
      };

      const id = await dedupeAndRegisterPreferencePane({
        id: "metaref-settings",
        pluginID: "metaflow@groele",
        src: "chrome://prefs.xhtml",
        scripts: ["chrome://prefs.js"],
        stylesheets: ["chrome://prefs.css"],
        label: "MetaFlow",
        image: "chrome://icon.png",
        helpURL: "https://example.com",
        isAlive: () => false,
      });

      expect(id).toBe("metaref-settings");
      expect(unregister).toHaveBeenCalledWith("old-pane");
      expect(unregister).toHaveBeenCalledWith("metaref-settings");
      expect(register).toHaveBeenCalledTimes(1);

      pluginPanes.push({ id: "metaref-settings", pluginID: "metaflow@groele", src: "chrome://prefs.xhtml" });
      unregisterPluginPreferencePanes("metaflow@groele");
      expect(pluginPanes.map(p => p.id)).toEqual(["other-pane"]);

      const openPopup = { closed: false } as Window;
      const closedPopup = { closed: true } as Window;
      tileProgressWindow(undefined);
      tileProgressWindow(closedPopup);
      tileProgressWindow(openPopup);
      expect(tile).toHaveBeenCalledTimes(1);
      expect(tile).toHaveBeenCalledWith(openPopup);
    });
  });

  describe("cache-coordinator and service-container", () => {
    it("coordinates memory, api, target, maintenance, and persistence flush", async () => {
      const coordinator = new CacheCoordinatorService();
      const memSpy = vi.fn();
      const persistSpy = vi.fn().mockResolvedValue(undefined);
      const memDisp = coordinator.registerMemoryCleaner("custom-mem", memSpy);
      const persistDisp = coordinator.registerPersistentCleaner("custom-persist", persistSpy);

      coordinator.clearMemoryCaches();
      expect(mockSpies.clearRequestCache).toHaveBeenCalledTimes(1);
      expect(mockSpies.clearLintFingerprintCache).toHaveBeenCalledTimes(1);
      expect(mockSpies.clearDuplicateSearchCache).toHaveBeenCalledTimes(1);
      expect(memSpy).toHaveBeenCalledTimes(1);

      await coordinator.clearApiCaches();
      expect(mockSpies.clearStoredServiceCache).toHaveBeenCalledWith(undefined, true);
      expect(persistSpy).toHaveBeenCalledTimes(1);

      memDisp();
      persistDisp();
      await coordinator.clearByTarget("persistent");
      expect(persistSpy).toHaveBeenCalledTimes(1);

      coordinator.startMaintenance();
      expect(mockSpies.startCacheMaintenance).toHaveBeenCalledTimes(1);
      await coordinator.flushAllPersistence();
      expect(mockSpies.stopCacheMaintenance).toHaveBeenCalledTimes(1);
      expect(mockSpies.flushRuntimeData).toHaveBeenCalledTimes(1);
      expect(mockSpies.flushServiceCache).toHaveBeenCalledTimes(1);
      expect(mockSpies.flushJournalRankingIndex).toHaveBeenCalledTimes(1);

      coordinator.resetInMemoryIndexes();
      expect(mockSpies.resetJournalRankingIndex).toHaveBeenCalledTimes(1);
      expect(mockSpies.clearJournalInsights).toHaveBeenCalledTimes(1);
    });

    it("subscribes to kernel bus/notifier events and cleans up on dispose", async () => {
      const busHandlers = new Map<string, (...args: any[]) => unknown>();
      let notifierHandler: ((ev: NotifierEventPayload) => void) | undefined;
      const busDisposers: Array<ReturnType<typeof vi.fn>> = [];
      const notifierDisposer = vi.fn();

      const kernel = {
        isDisposed: false,
        disposables: {},
        bus: {
          on: vi.fn((event: string, fn: (...args: any[]) => unknown): Disposable => {
            busHandlers.set(event, fn);
            const dispose = vi.fn();
            busDisposers.push(dispose);
            return dispose;
          }),
        },
        notifier: {
          subscribe: vi.fn((_types: string[], fn: (ev: NotifierEventPayload) => void): Disposable => {
            notifierHandler = fn;
            return notifierDisposer;
          }),
        },
      } as unknown as PluginKernel;

      const container = new ServiceContainer(kernel);
      container.init();

      busHandlers.get("prefs:changed")?.();
      expect(mockSpies.bumpLintPrefsRevision).toHaveBeenCalledTimes(1);

      await busHandlers.get("cache:clear-requested")?.({ target: "memory" });
      expect(mockSpies.clearRequestCache).toHaveBeenCalledTimes(1);
      expect(mockSpies.clearDuplicateSearchCache).toHaveBeenCalledTimes(1);

      notifierHandler?.({ event: "modify", type: "item", ids: [11, "22", "bad"], extraData: {} });
      expect(mockSpies.invalidateItemLintFingerprint).toHaveBeenCalledWith(11);
      expect(mockSpies.invalidateItemLintFingerprint).toHaveBeenCalledWith(22);
      expect(mockSpies.invalidateItemLintFingerprint).toHaveBeenCalledTimes(2);
      expect(mockSpies.clearDuplicateSearchCache).toHaveBeenCalledTimes(2);

      notifierHandler?.({ event: "add", type: "item", ids: [33], extraData: {} });
      expect(mockSpies.invalidateItemLintFingerprint).toHaveBeenCalledTimes(2);
      expect(mockSpies.clearDuplicateSearchCache).toHaveBeenCalledTimes(3);

      container.dispose();
      for (const d of busDisposers)
        expect(d).toHaveBeenCalledTimes(1);
      expect(notifierDisposer).toHaveBeenCalledTimes(1);
    });
  });
});
