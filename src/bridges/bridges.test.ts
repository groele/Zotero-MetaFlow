import type { DomainId, DomainModule } from "../kernel/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PluginKernel } from "../kernel/plugin-kernel";
import { AutomaticIngestBridge } from "./automatic-ingest-bridge";
import { ItemSyncBridge } from "./item-sync-bridge";

function createPrefsAdapter(initial: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(initial));
  const observers = new Map<string | number | symbol, { key: string; handler: () => void }>();
  return {
    get: vi.fn((key: string) => store.get(key)),
    set: vi.fn((key: string, value: unknown) => {
      store.set(key, value);
      for (const entry of [...observers.values()]) {
        if (entry.key === key)
          entry.handler();
      }
    }),
    clear: vi.fn((key: string) => {
      store.delete(key);
      for (const entry of [...observers.values()]) {
        if (entry.key === key)
          entry.handler();
      }
    }),
    registerObserver: vi.fn((key: string, handler: () => void) => {
      const token = Symbol(key);
      observers.set(token, { key, handler });
      return token;
    }),
    unregisterObserver: vi.fn((token: string | number | symbol) => {
      observers.delete(token);
    }),
  };
}

function createFakeDomain(id: DomainId, enabledPref?: string): DomainModule {
  let active = false;
  return {
    id,
    enabledPref,
    isActive: () => active,
    start: () => {
      active = true;
    },
    stop: () => {
      active = false;
    },
  };
}

describe("itemSyncBridge & AutomaticIngestBridge", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("coalesces concurrent modify events and refreshes journal pane + tldr row", async () => {
    const kernel = new PluginKernel({ prefAdapter: createPrefsAdapter() });
    const refreshPane = vi.fn().mockResolvedValue(undefined);
    const refreshTldrRow = vi.fn();
    kernel.ports.register("journal-insights", {
      refreshPane,
      refreshInsights: vi.fn(),
      refreshItemJournal: vi.fn(),
      setUpdateResult: vi.fn(),
      syncExtraColumns: vi.fn(),
    });
    kernel.ports.register("workspace-ui", {
      refreshTldrRow,
      placeTldrRow: vi.fn(),
      executeShortcut: vi.fn(),
    });
    kernel.ports.register("lint-engine", {
      runBatch: vi.fn(),
      stopAll: vi.fn(),
      enqueueAddedItems: vi.fn(),
      cancelAddedItems: vi.fn(),
      drainAddedItems: vi.fn(),
      isSavingPhase: () => false,
    });

    const bridge = new ItemSyncBridge(kernel);
    bridge.start();

    kernel.bus.emit("notifier:event", { event: "modify", type: "item", ids: [42, "invalid", 0] });
    kernel.bus.emit("notifier:event", { event: "modify", type: "item", ids: [42, 43] });

    await bridge.flushPendingModifies();

    expect(refreshPane).toHaveBeenCalledTimes(1);
    expect(refreshPane).toHaveBeenCalledWith([42, 43]);
    expect(refreshTldrRow).toHaveBeenCalledTimes(1);
    expect(bridge.flushPendingModifies()).toBeUndefined();
    bridge.stop();
  });

  it("skips microtask flush during saving phase and handles tldr:updated", async () => {
    const kernel = new PluginKernel({ prefAdapter: createPrefsAdapter() });
    const refreshPane = vi.fn().mockResolvedValue(undefined);
    const refreshTldrRow = vi.fn();
    let saving = true;

    kernel.ports.register("journal-insights", {
      refreshPane,
      refreshInsights: vi.fn(),
      refreshItemJournal: vi.fn(),
      setUpdateResult: vi.fn(),
      syncExtraColumns: vi.fn(),
    });
    kernel.ports.register("workspace-ui", {
      refreshTldrRow,
      placeTldrRow: vi.fn(),
      executeShortcut: vi.fn(),
    });
    kernel.ports.register("lint-engine", {
      runBatch: vi.fn(),
      stopAll: vi.fn(),
      enqueueAddedItems: vi.fn(),
      cancelAddedItems: vi.fn(),
      drainAddedItems: vi.fn(),
      isSavingPhase: () => saving,
    });

    const bridge = new ItemSyncBridge(kernel);
    bridge.start();

    kernel.bus.emit("notifier:event", { event: "modify", type: "item", ids: [101] });
    await Promise.resolve();
    expect(refreshPane).not.toHaveBeenCalled();
    expect(refreshTldrRow).not.toHaveBeenCalled();

    bridge.clearPending();
    saving = false;
    expect(bridge.flushPendingModifies()).toBeUndefined();

    kernel.bus.emit("tldr:updated", { itemIDs: [7, 8] });
    expect(refreshPane).toHaveBeenCalledWith([7, 8]);
    expect(refreshTldrRow).not.toHaveBeenCalled();
    bridge.stop();
  });

  it("enqueues added items unless skipAutoSync is set or lint.onAdded is false", async () => {
    const adapter = createPrefsAdapter({ "extensions.zotero.metaref.lint.onAdded": true });
    const kernel = new PluginKernel({ prefAdapter: adapter });
    const enqueueAddedItems = vi.fn().mockResolvedValue(undefined);
    kernel.ports.register("lint-engine", {
      runBatch: vi.fn(),
      stopAll: vi.fn(),
      enqueueAddedItems,
      cancelAddedItems: vi.fn(),
      drainAddedItems: vi.fn(),
      isSavingPhase: () => false,
    });

    const bridge = new AutomaticIngestBridge(kernel);
    bridge.start();

    await bridge.handleNotifierEvent({ event: "add", type: "item", ids: [11, 12], extraData: {} });
    expect(enqueueAddedItems).toHaveBeenCalledTimes(1);
    expect(enqueueAddedItems).toHaveBeenCalledWith([11, 12]);

    await bridge.handleNotifierEvent({ event: "add", type: "item", ids: [13], extraData: { skipAutoSync: true } });
    expect(enqueueAddedItems).toHaveBeenCalledTimes(1);

    kernel.prefs.set("lint.onAdded", false);
    await bridge.handleNotifierEvent({ event: "add", type: "item", ids: [14], extraData: {} });
    expect(enqueueAddedItems).toHaveBeenCalledTimes(1);

    bridge.stop();
  });

  it("stops bridges automatically when a required domain is disabled", async () => {
    const adapter = createPrefsAdapter({
      "extensions.zotero.metaref.domain.journal": true,
      "extensions.zotero.metaref.domain.workspace": true,
      "extensions.zotero.metaref.domain.lint": true,
      "extensions.zotero.metaref.lint.onAdded": true,
    });
    vi.stubGlobal("Zotero", {
      Prefs: adapter,
      Notifier: { registerObserver: vi.fn(() => "obs"), unregisterObserver: vi.fn() },
      getMainWindows: () => [],
    });

    const kernel = new PluginKernel({ prefAdapter: adapter });
    const enqueueAddedItems = vi.fn().mockResolvedValue(undefined);
    const refreshPane = vi.fn().mockResolvedValue(undefined);

    kernel.ports.register("lint-engine", {
      runBatch: vi.fn(),
      stopAll: vi.fn(),
      enqueueAddedItems,
      cancelAddedItems: vi.fn(),
      drainAddedItems: vi.fn(),
      isSavingPhase: () => false,
    });
    kernel.ports.register("journal-insights", {
      refreshPane,
      refreshInsights: vi.fn(),
      refreshItemJournal: vi.fn(),
      setUpdateResult: vi.fn(),
      syncExtraColumns: vi.fn(),
    });

    kernel.registerDomain(createFakeDomain("journal-insights", "domain.journal"));
    kernel.registerDomain(createFakeDomain("workspace-ui", "domain.workspace"));
    kernel.registerDomain(createFakeDomain("lint-engine", "domain.lint"));
    kernel.registerBridge(new ItemSyncBridge(kernel));
    kernel.registerBridge(new AutomaticIngestBridge(kernel));

    await kernel.start();
    expect(kernel.isBridgeActive("item-sync")).toBe(true);
    expect(kernel.isBridgeActive("automatic-ingest")).toBe(true);

    kernel.prefs.set("domain.lint", false);
    await vi.waitFor(() => expect(kernel.isBridgeActive("automatic-ingest")).toBe(false));
    expect(kernel.isBridgeActive("item-sync")).toBe(true);

    kernel.bus.emit("notifier:event", { event: "add", type: "item", ids: [99] });
    expect(enqueueAddedItems).not.toHaveBeenCalled();

    kernel.prefs.set("domain.journal", false);
    await vi.waitFor(() => expect(kernel.isBridgeActive("item-sync")).toBe(false));

    kernel.bus.emit("tldr:updated", { itemIDs: [55] });
    expect(refreshPane).not.toHaveBeenCalled();

    await kernel.shutdown();
  });
});
