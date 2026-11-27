import type { DomainModule } from "./kernel/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AutomaticIngestBridge } from "./bridges/automatic-ingest-bridge";
import { ItemSyncBridge } from "./bridges/item-sync-bridge";
import { LintEngineDomainModule } from "./domains/lint-engine/module";
import hooks from "./hooks";
import { PluginKernel } from "./kernel/plugin-kernel";
import { UnifiedPrefService } from "./kernel/pref-service";
import { registerNotifier } from "./services/notifier";
import { ServiceContainer } from "./services/service-container";

const regMocks = vi.hoisted(() => ({
  registerCols: vi.fn(),
  registerPane: vi.fn(),
  batchLint: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./domains/lint-engine/batch-dispatch", () => ({ onLintInBatch: regMocks.batchLint }));
vi.mock("./domains/lint-engine/core-workflow", () => ({ stopCoreWorkflows: vi.fn().mockResolvedValue(undefined), localDOICheck: vi.fn(), runCoreWorkflow: vi.fn() }));
vi.mock("./domains/journal-insights/item-tree", () => ({ registerExtraColumns: regMocks.registerCols, unregisterExtraColumns: vi.fn() }));
vi.mock("./domains/journal-insights/journal-pane", () => ({ registerJournalPane: regMocks.registerPane, unregisterJournalPane: vi.fn(), refreshJournalPane: vi.fn().mockResolvedValue(undefined), refreshJournalInsights: vi.fn().mockResolvedValue(undefined), setJournalUpdateResult: vi.fn() }));
vi.mock("./domains/workspace-ui/item-info-row", () => ({ registerInfoRows: vi.fn(), unregisterInfoRows: vi.fn(), refreshTLDRInfoRow: vi.fn(), placeTLDRBeforeExtra: vi.fn() }));
vi.mock("./domains/workspace-ui/menu", () => ({ registerMenu: vi.fn(), unregisterMenu: vi.fn() }));
vi.mock("./domains/workspace-ui/preference", () => ({ registerPrefs: vi.fn().mockResolvedValue(undefined), registerPrefsScripts: vi.fn(), registerPrefsWindow: vi.fn(), unregisterPrefsWindows: vi.fn() }));
vi.mock("./domains/workspace-ui/rich-text", () => ({
  RichTextToolBar: class {
    init = vi.fn();
    clean = vi.fn();
  },
}));
vi.mock("./domains/workspace-ui/shortcuts", () => ({ registerShortcuts: vi.fn(() => vi.fn()) }));
vi.mock("./domains/review-duplicates/duplicate-stats", () => ({ registerDuplicateStats: vi.fn(), unregisterDuplicateStats: vi.fn(), invalidateDuplicateStats: vi.fn(), refreshDuplicateStats: vi.fn() }));
vi.mock("./domains/review-duplicates/native-duplicate-pane", () => ({ registerNativeDuplicatePane: vi.fn(), unregisterNativeDuplicatePane: vi.fn() }));
vi.mock("./domains/review-duplicates/review", () => ({ runReviewCommand: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./domains/review-duplicates/review/duplicate-batch", () => ({ processImportedDuplicates: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./domains/review-duplicates/review/panel", () => ({ closeReviewPanels: vi.fn() }));
vi.mock("./domains/lint-engine/rules", () => ({ Rules: { getByID: vi.fn() } }));
vi.mock("./utils/persistence-shutdown", () => ({ registerPersistenceShutdown: vi.fn(() => vi.fn()) }));
vi.mock("./utils/greenfrog-migration", () => ({ migrateGreenFrogPreferences: vi.fn() }));
vi.mock("./utils/journal-insights", () => ({ loadJournalInsights: vi.fn().mockResolvedValue(undefined), clearJournalInsights: vi.fn(), getJournalInsights: vi.fn() }));
vi.mock("./utils/journal-ranking-index", () => ({ loadJournalRankingIndex: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./utils/locale", () => ({ initLocale: vi.fn(), registerMainWindowLocale: vi.fn(), unloadLocale: vi.fn(), unregisterMainWindowLocale: vi.fn() }));

describe("architecture deep-audit regression guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("bug 1: UnifiedPrefService preserves explicit fallback after caching an unset observed pref", () => {
    const store = new Map<string, unknown>();
    let hostTrigger: (() => void) | undefined;
    const prefs = new UnifiedPrefService({
      prefix: "extensions.zotero.metaref",
      defaults: { "from.default": 7 },
      adapter: {
        get: key => store.get(key),
        set: (key, val) => store.set(key, val),
        clear: key => store.delete(key),
        registerObserver: (_key, cb) => {
          hostTrigger = cb;
          return "obs-1";
        },
        unregisterObserver: vi.fn(),
      },
    });

    const dispose = prefs.observeKeys(["unset.flag", "from.default"], () => {});
    // Triggering host observer caches the unset value via get(key) with no fallback
    hostTrigger?.();
    expect(prefs.get("unset.flag")).toBeUndefined();
    expect(prefs.get("unset.flag", true)).toBe(true);
    expect(prefs.get("unset.flag", "custom")).toBe("custom");
    expect(prefs.get("from.default")).toBe(7);
    expect(prefs.get("from.default", 99)).toBe(99);
    dispose();
  });

  it("bug 2 & 4: Zotero.Notifier routes via onHostNotify and restart() preserves hub subscribers", async () => {
    let registeredObserver: { notify: (...args: any[]) => void } | undefined;
    vi.stubGlobal("Zotero", {
      Notifier: {
        registerObserver: vi.fn((obs) => {
          registeredObserver = obs;
          return "nid-1";
        }),
        unregisterObserver: vi.fn(),
      },
    });

    const onNotifySpy = vi.fn(async (event: string, type: string, ids: Array<string | number>, extraData: Record<string, unknown>) => {
      await (globalThis as any).addon.kernel.notifier.dispatch({ event, type, ids, extraData });
    });
    const kernel = new PluginKernel({
      onHostNotify: payload => (globalThis as any).addon.hooks.onNotify(payload.event, payload.type, [...payload.ids], payload.extraData ?? {}),
    });
    const subSpy = vi.fn();
    kernel.notifier.subscribe(["item"], subSpy);
    vi.stubGlobal("addon", { data: { alive: true }, kernel, hooks: { onNotify: onNotifySpy } });

    registerNotifier();
    // Calling registerNotifier() a second time (repeated onStartup) must NOT wipe subscribers
    registerNotifier();

    registeredObserver?.notify("modify", "item", [101], { flag: true });
    await vi.waitFor(() => expect(onNotifySpy).toHaveBeenCalledOnce());
    expect(subSpy).toHaveBeenCalledOnce();
    expect(subSpy.mock.calls[0][0].ids).toEqual([101]);
  });

  it("bug 3: LintEngineDomainModule delegates batch format to addon.hooks.onLintInBatch override", async () => {
    const customHook = vi.fn().mockResolvedValue({ cancelled: false });
    const kernel = new PluginKernel();
    const services = new ServiceContainer(kernel);
    const lintDomain = new LintEngineDomainModule(kernel, services);
    const bridge = new AutomaticIngestBridge(kernel);

    vi.stubGlobal("Zotero", {
      debug: vi.fn(),
      Prefs: {
        get: (k: string) => {
          if (k.endsWith("lint.onAdded"))
            return true;
          if (k.endsWith("lint.delayOnAdded"))
            return 500;
          return false;
        },
      },
      Items: {
        get: (ids: number[]) => ids.map(id => ({
          id,
          deleted: false,
          isFeedItem: false,
          itemType: "journalArticle",
          isRegularItem: () => true,
          isEditable: () => true,
          getField: (f: string) => (f === "title" ? "Sample Paper" : ""),
        })),
      },
      Libraries: { get: () => ({ libraryType: "user" }) },
    });
    vi.stubGlobal("addon", {
      data: { alive: true, env: "production", config: { prefsPrefix: "extensions.zotero.metaref" } },
      kernel,
      hooks: { onLintInBatch: customHook },
      runner: { stop: vi.fn() },
    });

    vi.useFakeTimers();
    try {
      lintDomain.start();
      bridge.start();
      await kernel.notifier.dispatch({ event: "add", type: "item", ids: [7] });
      const flushPromise = bridge.flushPendingIngest();
      await vi.advanceTimersByTimeAsync(600);
      await flushPromise;
      expect(customHook).toHaveBeenCalledWith("standard", expect.any(Array), { automatic: true });
      await lintDomain.stop();
      bridge.stop();
    }
    finally {
      vi.useRealTimers();
    }
  });

  it("bug 5 & 8: PluginKernel supports shutdown -> revive -> start cycle and deduplicates concurrent window loads", async () => {
    const kernel = new PluginKernel();
    let resolveLoad!: () => void;
    const loadGate = new Promise<void>((r) => {
      resolveLoad = r;
    });
    const loadSpy = vi.fn(() => loadGate);
    const domain: DomainModule = {
      id: "workspace-ui",
      isActive: () => true,
      start: vi.fn(),
      stop: vi.fn(),
      onMainWindowLoad: loadSpy,
      onMainWindowUnload: vi.fn(),
    };
    kernel.registerDomain(domain);
    vi.stubGlobal("Zotero", { getMainWindows: () => [] });

    kernel.init({ id: "metaflow@groele", version: "17.3.0", rootURI: "" });
    await kernel.start();
    const win = { closed: false } as unknown as Window;
    const p1 = kernel.onMainWindowLoad(win);
    const p2 = kernel.onMainWindowLoad(win);
    expect(p1).toBe(p2);
    expect(loadSpy).toHaveBeenCalledOnce();
    resolveLoad();
    await Promise.all([p1, p2]);

    await kernel.shutdown();
    expect(kernel.isDisposed).toBe(true);
    await kernel.revive();
    expect(kernel.isDisposed).toBe(false);
    kernel.init({ id: "metaflow@groele", version: "17.3.0", rootURI: "" });
    await kernel.start();
    expect(kernel.isStarted).toBe(true);
  });

  it("bug 6 & 7: hooks.onNotify guards dead addon, avoids mounting UI on standalone notify, and ItemSyncBridge aborts when dead", async () => {
    const addonObj = {
      data: { alive: false, env: "production", config: { addonInstance: "MetaRef", addonID: "metaflow@groele" } },
      runner: { stop: vi.fn() },
    };
    vi.stubGlobal("addon", addonObj);
    vi.stubGlobal("Zotero", { debug: vi.fn(), MetaRef: addonObj, getMainWindows: () => [] });

    await hooks.onNotify("modify", "item", [1], {});
    expect(regMocks.registerCols).not.toHaveBeenCalled();
    expect(regMocks.registerPane).not.toHaveBeenCalled();

    addonObj.data.alive = true;
    await hooks.onNotify("modify", "item", [2], {});
    // Standalone onNotify must only register ports, never Zotero UI columns/sections
    expect(regMocks.registerCols).not.toHaveBeenCalled();
    expect(regMocks.registerPane).not.toHaveBeenCalled();

    const kernel = new PluginKernel();
    const refreshPane = vi.fn();
    kernel.ports.register("journal-insights", {
      refreshPane,
      refreshInsights: vi.fn(),
      refreshItemJournal: vi.fn(),
      setUpdateResult: vi.fn(),
      syncExtraColumns: vi.fn(),
    });
    const syncBridge = new ItemSyncBridge(kernel);
    syncBridge.start();
    kernel.bus.emit("notifier:event", { event: "modify", type: "item", ids: [99] });
    addonObj.data.alive = false;
    await syncBridge.flushPendingModifies();
    expect(refreshPane).not.toHaveBeenCalled();
  });
});
