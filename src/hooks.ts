import type { AddonRuntimeModules } from "./addon";
import { AutomaticIngestBridge } from "./bridges/automatic-ingest-bridge";
import { ItemSyncBridge } from "./bridges/item-sync-bridge";
import { JournalInsightsDomainModule } from "./domains/journal-insights/module";
import { LintEngineDomainModule } from "./domains/lint-engine/module";
import { ReviewDuplicatesDomainModule } from "./domains/review-duplicates/module";
import { WorkspaceUiDomainModule } from "./domains/workspace-ui/module";
import { PluginKernel } from "./kernel/plugin-kernel";
import { onLintInBatch } from "./modules/batch-dispatch";
import { placeTLDRBeforeExtra, refreshTLDRInfoRow } from "./modules/item-info-row";
import { registerNotifier, unregisterNotifier } from "./modules/notifier";
import { registerPrefsScripts, registerPrefsWindow } from "./modules/preference";
import { onShortcuts } from "./modules/shortcut-actions";
import { ServiceContainer } from "./services/service-container";
import { cleanupResources } from "./utils/cleanup";
import { migrateGreenFrogPreferences } from "./utils/greenfrog-migration";
import { bumpLintPrefsRevision } from "./utils/lint-fingerprint-cache";
import { logger } from "./utils/logger";
import { registerPersistenceShutdown } from "./utils/persistence-shutdown";

interface RuntimeBundle {
  kernel: PluginKernel;
  services: ServiceContainer;
  modules: AddonRuntimeModules;
}

const fallbackBundles = new WeakMap<object, RuntimeBundle>();
let unregisterPersistence: (() => void) | undefined;

function getRuntimeBundle(): RuntimeBundle {
  const host = addon as unknown as {
    kernel?: PluginKernel;
    services?: ServiceContainer;
    runtimeModules?: AddonRuntimeModules;
  };
  if (host.kernel && host.services && host.runtimeModules) {
    return {
      kernel: host.kernel,
      services: host.services,
      modules: host.runtimeModules,
    };
  }
  let cached = fallbackBundles.get(addon);
  if (!cached) {
    const kernel = new PluginKernel({
      onError: (scope, error) => logger.error(`Kernel error (${scope}):`, error),
    });
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
    cached = {
      kernel,
      services,
      modules: {
        workspaceUi,
        journalInsights,
        reviewDuplicates,
        lintEngine,
        itemSyncBridge,
        automaticIngestBridge,
      },
    };
    fallbackBundles.set(addon, cached);
  }
  return cached;
}

async function onStartup(): Promise<void> {
  await Promise.all([Zotero.initializationPromise, Zotero.unlockPromise, Zotero.uiReadyPromise]);
  if (!addon.data.alive)
    return;
  const { kernel, services, modules } = getRuntimeBundle();
  try {
    unregisterPersistence?.();
    unregisterPersistence = registerPersistenceShutdown(() => services.cache.flushAllPersistence());
    migrateGreenFrogPreferences();
    kernel.init({
      id: addon.data.config?.addonID ?? "metaflow@groele",
      version: "",
      rootURI: typeof rootURI === "string" ? rootURI : "",
    });
    services.cache.startMaintenance();
    services.init();
    const prefsReady = modules.workspaceUi.startEarly();
    registerNotifier();
    modules.reviewDuplicates.start();
    await Promise.all([prefsReady, modules.journalInsights.preload()]);
    if (!addon.data.alive)
      return;
    const mainWindows = Zotero.getMainWindows();
    // Item pane section headers are localized when the custom section is
    // registered. Make its Fluent resources available before registration.
    mainWindows.forEach(win => modules.workspaceUi.prepareWindowLocale(win));
    modules.journalInsights.start();
    modules.workspaceUi.startInfoRows();
    modules.lintEngine.start();
    await kernel.start();
  }
  catch (error) {
    await onShutdown();
    throw error;
  }
}

function onMainWindowLoad(win: Window, localeRegistered = false): Promise<void> {
  const { kernel, modules } = getRuntimeBundle();
  if (localeRegistered)
    modules.workspaceUi.markWindowLocaleRegistered(win);
  if (kernel.isStarted)
    return kernel.onMainWindowLoad(win);
  return Promise.all([
    modules.workspaceUi.onMainWindowLoad(win, localeRegistered),
    Promise.resolve().then(() => modules.reviewDuplicates.onMainWindowLoad(win)),
  ]).then(() => {});
}

async function onMainWindowUnload(win: Window): Promise<void> {
  const { kernel, modules } = getRuntimeBundle();
  if (kernel.isStarted) {
    await kernel.onMainWindowUnload(win);
    return;
  }
  await cleanupResources([
    () => modules.reviewDuplicates.onMainWindowUnload(win),
    () => modules.workspaceUi.onMainWindowUnload(win),
  ], error => logger.error("Window cleanup failed:", error));
}

async function onShutdown(): Promise<void> {
  addon.data.alive = false;
  const { kernel, services, modules } = getRuntimeBundle();
  const workspaceWasActive = modules.workspaceUi.isActive();
  await cleanupResources([
    () => services.cache.stopMaintenance(),
    () => services.cache.clearMemoryCaches(),
    unregisterNotifier,
    () => modules.lintEngine.stop(),
    () => services.cache.flushAllPersistence(),
    () => services.cache.resetInMemoryIndexes(),
    () => {
      unregisterPersistence?.();
      unregisterPersistence = undefined;
      addon.data.lastAutomaticWorkflow = undefined;
      addon.data.lastCoreWorkflow = undefined;
      if (addon.runner)
        addon.runner.lastResult = undefined;
    },
    () => kernel.shutdown(),
    () => {
      if (!workspaceWasActive)
        return modules.workspaceUi.stop();
    },
    () => services.dispose(),
  ], error => logger.error("Plugin cleanup failed:", error));
  // @ts-expect-error - Plugin instance is not typed
  if (Zotero[addon.data.config.addonInstance] === addon) {
    // @ts-expect-error - Plugin instance is not typed
    delete Zotero[addon.data.config.addonInstance];
  }
}

async function onNotify(
  event: string,
  type: string,
  ids: Array<string | number>,
  extraData: { [key: string]: unknown },
): Promise<void> {
  logger.debug("notify", event, type, ids, extraData);
  const { kernel, services, modules } = getRuntimeBundle();
  services.init();
  if (!kernel.ports.has("workspace-ui")) {
    kernel.ports.register("workspace-ui", {
      refreshTldrRow: rowID => refreshTLDRInfoRow(rowID),
      placeTldrRow: doc => placeTLDRBeforeExtra(doc),
      executeShortcut: (hookName, win) => onShortcuts(hookName, win),
    });
  }
  if (!kernel.ports.has("journal-insights"))
    modules.journalInsights.start();
  if (!kernel.ports.has("lint-engine"))
    modules.lintEngine.start();
  modules.itemSyncBridge.start();
  modules.automaticIngestBridge.start();

  await kernel.notifier.dispatch({ event, type, ids: [...ids], extraData });
  if (event === "modify" && type === "item")
    await modules.itemSyncBridge.flushPendingModifies();
  else
    await modules.automaticIngestBridge.flushPendingIngest();
}

async function onPrefsEvent(type: string, data: { [key: string]: never }): Promise<void> {
  bumpLintPrefsRevision();
  if (type === "load-script")
    registerPrefsWindow(data.window);
  else if (type === "load")
    registerPrefsScripts(data.window);
}

function onRefreshJournal(item: Zotero.Item, force = false) {
  return getRuntimeBundle().modules.journalInsights.refreshItemJournal(item, force);
}

export default {
  onStartup,
  onMainWindowLoad,
  onMainWindowUnload,
  onShutdown,
  onNotify,
  onPrefsEvent,
  onShortcuts,
  onLintInBatch,
  onRefreshJournal,
};
