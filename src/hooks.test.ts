import { beforeEach, describe, expect, it, vi } from "vitest";
import { refreshJournalPane } from "./domains/journal-insights/journal-pane";
import { refreshTLDRInfoRow } from "./domains/workspace-ui/item-info-row";
import hooks from "./hooks";
import {
  computeItemLintSignature,
  getLintFingerprintStats,
  recordCleanLintFingerprint,
} from "./utils/lint-fingerprint-cache";

const mocks = vi.hoisted(() => ({
  register: vi.fn(),
  unregister: vi.fn(),
  load: vi.fn(),
  locale: vi.fn(),
  stopCore: vi.fn(),
  windowLocale: vi.fn(),
  toolbarInit: vi.fn(),
}));
vi.mock("./domains/lint-engine/core-workflow", () => ({ stopCoreWorkflows: mocks.stopCore, localDOICheck: vi.fn(), runCoreWorkflow: vi.fn() }));
vi.mock("./utils/persistence-shutdown", () => ({ registerPersistenceShutdown: vi.fn(() => vi.fn()) }));
vi.mock("./domains/journal-insights/item-tree", () => ({ registerExtraColumns: mocks.register, unregisterExtraColumns: mocks.unregister }));
vi.mock("./domains/workspace-ui/item-info-row", () => ({ registerInfoRows: mocks.register, unregisterInfoRows: mocks.unregister, refreshTLDRInfoRow: vi.fn(), placeTLDRBeforeExtra: vi.fn() }));
vi.mock("./domains/journal-insights/journal-pane", () => ({ registerJournalPane: mocks.register, unregisterJournalPane: mocks.unregister, refreshJournalPane: vi.fn(), setJournalUpdateResult: vi.fn() }));
vi.mock("./domains/workspace-ui/menu", () => ({ registerMenu: mocks.register, unregisterMenu: mocks.unregister }));
vi.mock("./services/notifier", () => ({ registerNotifier: mocks.register, unregisterNotifier: mocks.unregister }));
vi.mock("./domains/workspace-ui/preference", () => ({ registerPrefs: mocks.register, registerPrefsScripts: vi.fn(), registerPrefsWindow: vi.fn(), unregisterPrefsWindows: mocks.unregister }));
vi.mock("./domains/workspace-ui/rich-text", () => ({
  RichTextToolBar: class {
    init = mocks.toolbarInit;
    clean = vi.fn();
  },
  setHtmlTag: vi.fn(),
}));
vi.mock("./domains/lint-engine/rules", () => ({ Rules: {} }));
vi.mock("./domains/workspace-ui/shortcuts", () => ({ registerShortcuts: vi.fn() }));
vi.mock("./utils/dialog", () => ({ closeAllDialogs: mocks.unregister }));
vi.mock("./utils/journal-insights", () => ({ loadJournalInsights: mocks.load }));
vi.mock("./utils/locale", () => ({ initLocale: mocks.register, registerMainWindowLocale: mocks.windowLocale, unloadLocale: mocks.locale, unregisterMainWindowLocale: vi.fn() }));
vi.mock("./utils/logger", () => ({ createLogger: () => ({ debug: vi.fn(), error: vi.fn() }), logger: { error: vi.fn(), debug: vi.fn() } }));
vi.mock("./utils/prefs", () => ({ getPref: vi.fn() }));

describe("startup cancellation and failure cleanup", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    const addon = { data: { alive: true, config: { addonInstance: "MetaRef" } }, runner: { stop: vi.fn() } };
    vi.stubGlobal("addon", addon);
    vi.stubGlobal("ztoolkit", { unregisterAll: vi.fn() });
    vi.stubGlobal("Zotero", { MetaRef: addon, getMainWindows: () => [] });
  });

  it("cancels both queues and waits for complete core workflows before unloading locale", async () => {
    let release!: () => void;
    mocks.stopCore.mockImplementation(() => new Promise<void>(resolve => release = resolve));
    const pending = hooks.onShutdown();
    await vi.waitFor(() => expect(mocks.stopCore).toHaveBeenCalledOnce());
    expect(addon.data.alive).toBe(false);
    expect(addon.runner.stop).toHaveBeenCalledOnce();
    expect(mocks.locale).not.toHaveBeenCalled();
    release();
    await pending;
    expect(addon.runner.stop).toHaveBeenCalledOnce();
    expect(mocks.locale).toHaveBeenCalledOnce();
  });

  it("does not register resources if disabled while waiting for the host", async () => {
    let ready!: () => void;
    (Zotero as any).initializationPromise = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const pending = hooks.onStartup();
    await hooks.onShutdown();
    ready();
    await pending;
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it("does not register columns or notifier after disable during data loading", async () => {
    let ready!: () => void;
    mocks.load.mockImplementation(() => new Promise<void>((resolve) => {
      ready = resolve;
    }));
    const pending = hooks.onStartup();
    await vi.waitFor(() => expect(mocks.load).toHaveBeenCalledOnce());
    expect(mocks.register).toHaveBeenCalledTimes(3);
    await hooks.onShutdown();
    ready();
    await pending;
    expect(mocks.register).toHaveBeenCalledTimes(3);
  });

  it("cleans a failed startup even if host unregister operations throw", async () => {
    mocks.load.mockRejectedValue(new Error("database"));
    mocks.unregister.mockImplementation(() => {
      throw new Error("unregister");
    });
    await expect(hooks.onStartup()).rejects.toThrow("database");
    expect(addon.data.alive).toBe(false);
    expect(addon.runner.stop).toHaveBeenCalledOnce();
    expect(mocks.locale).toHaveBeenCalledOnce();
  });

  it("does not delete a replacement plugin instance", async () => {
    const replacement = {};
    (Zotero as any).MetaRef = replacement;
    await hooks.onShutdown();
    expect((Zotero as any).MetaRef).toBe(replacement);
  });

  it("ignores notifications before kernel.start() and coalesces after startup", async () => {
    const item = { id: 42, version: 1, getField: () => "2026", toJSON: () => ({ title: "Test" }), getAttachments: () => [] } as unknown as Zotero.Item;
    const rule = { id: "r1", category: "rule", apply: () => {} } as any;
    const optionsMap = new Map([["r1", {}]]);
    const sig = computeItemLintSignature(item, [rule], optionsMap);
    recordCleanLintFingerprint(sig);
    expect(getLintFingerprintStats().size).toBe(1);

    await hooks.onNotify("modify", "item", [42], {});
    expect(getLintFingerprintStats().size).toBe(1);
    expect(refreshJournalPane).not.toHaveBeenCalled();

    await hooks.onStartup();
    await Promise.all([
      hooks.onNotify("modify", "item", [42], {}),
      hooks.onNotify("modify", "item", [42, 43], {}),
    ]);
    expect(getLintFingerprintStats().size).toBe(0);
    expect(refreshJournalPane).toHaveBeenCalledOnce();
    expect(refreshJournalPane).toHaveBeenCalledWith([42, 43]);
    expect(refreshTLDRInfoRow).toHaveBeenCalledOnce();
  });

  it("does not revive stopped bridges or ports when a domain is disabled", async () => {
    const prefs = new Map<string, unknown>([
      ["extensions.zotero.metaref.domain.journal", true],
      ["extensions.zotero.metaref.domain.workspace", true],
      ["extensions.zotero.metaref.domain.lint", true],
    ]);
    const observers = new Map<string | number | symbol, { key: string; handler: () => void }>();
    const prefAdapter = {
      get: (key: string) => prefs.get(key),
      set: (key: string, value: unknown) => {
        prefs.set(key, value);
        for (const entry of observers.values()) {
          if (entry.key === key)
            entry.handler();
        }
      },
      clear: (key: string) => {
        prefs.delete(key);
      },
      registerObserver: (key: string, handler: () => void) => {
        const token = Symbol(key);
        observers.set(token, { key, handler });
        return token;
      },
      unregisterObserver: (token: string | number | symbol) => {
        observers.delete(token);
      },
    };
    const { PluginKernel } = await import("./kernel/plugin-kernel");
    const { ServiceContainer } = await import("./services/service-container");
    const { WorkspaceUiDomainModule } = await import("./domains/workspace-ui/module");
    const { JournalInsightsDomainModule } = await import("./domains/journal-insights/module");
    const { ReviewDuplicatesDomainModule } = await import("./domains/review-duplicates/module");
    const { LintEngineDomainModule } = await import("./domains/lint-engine/module");
    const { ItemSyncBridge } = await import("./bridges/item-sync-bridge");
    const { AutomaticIngestBridge } = await import("./bridges/automatic-ingest-bridge");

    const kernel = new PluginKernel({ prefAdapter });
    const services = new ServiceContainer(kernel);
    const workspaceUi = new WorkspaceUiDomainModule(kernel);
    const journalInsights = new JournalInsightsDomainModule(kernel);
    const reviewDuplicates = new ReviewDuplicatesDomainModule(kernel);
    const lintEngine = new LintEngineDomainModule(kernel, services);
    const itemSyncBridge = new ItemSyncBridge(kernel);
    const automaticIngestBridge = new AutomaticIngestBridge(kernel);
    kernel.registerDomain(workspaceUi);
    kernel.registerDomain(journalInsights);
    kernel.registerDomain(reviewDuplicates);
    kernel.registerDomain(lintEngine);
    kernel.registerBridge(itemSyncBridge);
    kernel.registerBridge(automaticIngestBridge);

    vi.stubGlobal("addon", {
      data: { alive: true, config: { addonID: "metaflow@groele", addonInstance: "MetaRef" } },
      runner: { stop: vi.fn() },
      kernel,
      services,
      runtimeModules: { workspaceUi, journalInsights, reviewDuplicates, lintEngine, itemSyncBridge, automaticIngestBridge },
      hooks,
    });

    await hooks.onStartup();
    expect(kernel.isBridgeActive("item-sync")).toBe(true);
    expect(kernel.ports.has("journal-insights")).toBe(true);

    (journalInsights as unknown as { enabledPref?: string }).enabledPref = "domain.journal";
    prefAdapter.set("extensions.zotero.metaref.domain.journal", false);
    await kernel.syncDomainStates();
    expect(journalInsights.isActive()).toBe(false);
    expect(kernel.isBridgeActive("item-sync")).toBe(false);
    expect(kernel.ports.has("journal-insights")).toBe(false);

    await hooks.onNotify("modify", "item", [77], {});
    expect(kernel.isBridgeActive("item-sync")).toBe(false);
    expect(kernel.ports.has("journal-insights")).toBe(false);
    expect(refreshJournalPane).not.toHaveBeenCalled();

    await hooks.onRefreshJournal({ id: 77, deleted: false, itemType: "journalArticle" } as unknown as Zotero.Item, true);
    expect(refreshJournalPane).not.toHaveBeenCalled();
  });

  it("initializes each existing main window only once during startup", async () => {
    const fakeWin = { closed: false, document: { getElementById: () => null } } as unknown as Window;
    (Zotero as any).getMainWindows = () => [fakeWin];
    await hooks.onStartup();
    expect(mocks.windowLocale).toHaveBeenCalledOnce();
    expect(mocks.windowLocale).toHaveBeenCalledWith(fakeWin);
    expect(mocks.toolbarInit).toHaveBeenCalledOnce();
  });
});
vi.mock("./utils/greenfrog-migration", () => ({ migrateGreenFrogPreferences: vi.fn() }));
