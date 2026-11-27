import { beforeEach, describe, expect, it, vi } from "vitest";
import hooks from "./hooks";
import { refreshTLDRInfoRow } from "./modules/item-info-row";
import { refreshJournalPane } from "./modules/journal-pane";
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
vi.mock("./modules/core-workflow", () => ({ stopCoreWorkflows: mocks.stopCore, localDOICheck: vi.fn(), runCoreWorkflow: vi.fn() }));
vi.mock("./utils/persistence-shutdown", () => ({ registerPersistenceShutdown: vi.fn(() => vi.fn()) }));
vi.mock("./modules/item-tree", () => ({ registerExtraColumns: mocks.register, unregisterExtraColumns: mocks.unregister }));
vi.mock("./modules/item-info-row", () => ({ registerInfoRows: mocks.register, unregisterInfoRows: mocks.unregister, refreshTLDRInfoRow: vi.fn(), placeTLDRBeforeExtra: vi.fn() }));
vi.mock("./modules/journal-pane", () => ({ registerJournalPane: mocks.register, unregisterJournalPane: mocks.unregister, refreshJournalPane: vi.fn(), setJournalUpdateResult: vi.fn() }));
vi.mock("./modules/menu", () => ({ registerMenu: mocks.register, unregisterMenu: mocks.unregister }));
vi.mock("./modules/notifier", () => ({ registerNotifier: mocks.register, unregisterNotifier: mocks.unregister }));
vi.mock("./modules/preference", () => ({ registerPrefs: mocks.register, registerPrefsScripts: vi.fn(), registerPrefsWindow: vi.fn(), unregisterPrefsWindows: mocks.unregister }));
vi.mock("./modules/rich-text", () => ({
  RichTextToolBar: class {
    init = mocks.toolbarInit;
    clean = vi.fn();
  },
  setHtmlTag: vi.fn(),
}));
vi.mock("./modules/rules", () => ({ Rules: {} }));
vi.mock("./modules/shortcuts", () => ({ registerShortcuts: vi.fn() }));
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

  it("does not register columns after disable during data loading", async () => {
    let ready!: () => void;
    mocks.load.mockImplementation(() => new Promise<void>((resolve) => {
      ready = resolve;
    }));
    const pending = hooks.onStartup();
    await vi.waitFor(() => expect(mocks.load).toHaveBeenCalledOnce());
    expect(mocks.register).toHaveBeenCalledTimes(4);
    await hooks.onShutdown();
    ready();
    await pending;
    expect(mocks.register).toHaveBeenCalledTimes(4);
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

  it("coalesces concurrent modify notifications and invalidates lint fingerprint cache", async () => {
    const item = { id: 42, version: 1, getField: () => "2026", toJSON: () => ({ title: "Test" }), getAttachments: () => [] } as unknown as Zotero.Item;
    const rule = { id: "r1", category: "rule", apply: () => {} } as any;
    const optionsMap = new Map([["r1", {}]]);
    const sig = computeItemLintSignature(item, [rule], optionsMap);
    recordCleanLintFingerprint(sig);
    expect(getLintFingerprintStats().size).toBe(1);

    await Promise.all([
      hooks.onNotify("modify", "item", [42], {}),
      hooks.onNotify("modify", "item", [42, 43], {}),
    ]);
    expect(getLintFingerprintStats().size).toBe(0);
    expect(refreshJournalPane).toHaveBeenCalledOnce();
    expect(refreshJournalPane).toHaveBeenCalledWith([42, 43]);
    expect(refreshTLDRInfoRow).toHaveBeenCalledOnce();
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
