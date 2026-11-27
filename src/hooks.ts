import { onLintInBatch } from "./modules/batch-dispatch";
import { closeCoreFeedback } from "./modules/batch-feedback";
import { closeCompletionNotices } from "./modules/completion-notice";
import { stopCoreWorkflows } from "./modules/core-workflow";
import { invalidateDuplicateStats, registerDuplicateStats, unregisterDuplicateStats } from "./modules/duplicate-stats";
import { placeTLDRBeforeExtra, refreshTLDRInfoRow, registerInfoRows, unregisterInfoRows } from "./modules/item-info-row";
import { registerExtraColumns, unregisterExtraColumns } from "./modules/item-tree";
import { refreshJournalPane, registerJournalPane, setJournalUpdateResult, unregisterJournalPane } from "./modules/journal-pane";
import { registerMenu, unregisterMenu } from "./modules/menu";
import { registerNativeDuplicatePane, unregisterNativeDuplicatePane } from "./modules/native-duplicate-pane";
import { registerNotifier, unregisterNotifier } from "./modules/notifier";
import { registerPrefs, registerPrefsScripts, registerPrefsWindow, unregisterPrefsWindows } from "./modules/preference";
import { runReviewCommand } from "./modules/review";
import { processImportedDuplicates } from "./modules/review/duplicate-batch";
import { closeReviewPanels } from "./modules/review/panel";
import { RichTextToolBar } from "./modules/rich-text";
import { Rules } from "./modules/rules";
import { ToolUpdateEasyScholar } from "./modules/rules/tool-update-easyscholar";
import { onShortcuts } from "./modules/shortcut-actions";
import { registerShortcuts } from "./modules/shortcuts";
import { AutomaticItems } from "./utils/automatic-items";
import { createAutomaticWorkflow, runAutomaticWorkflow } from "./utils/automatic-workflow";
import { startCacheMaintenance, stopCacheMaintenance } from "./utils/cache-maintenance";
import { cleanupResources } from "./utils/cleanup";
import { closeAllDialogs } from "./utils/dialog";
import { clearDuplicateSearchCache } from "./utils/duplicate-search-cache";
import { invalidateEasyScholarTitle } from "./utils/easyscholar";
import { migrateGreenFrogPreferences } from "./utils/greenfrog-migration";
import { clearRequestCache } from "./utils/http";
import { redrawItemValues } from "./utils/item-value-refresh";
import { closeJournalShareDialogs } from "./utils/journal-card-share";
import { clearJournalInsights, getJournalInsights, loadJournalInsights } from "./utils/journal-insights";
import { hasEnabledJournalMetrics } from "./utils/journal-permissions";
import { flushJournalRankingIndex, loadJournalRankingIndex, resetJournalRankingIndex } from "./utils/journal-ranking-index";
import { bumpLintPrefsRevision, clearLintFingerprintCache, invalidateItemLintFingerprint } from "./utils/lint-fingerprint-cache";
import { initLocale, registerMainWindowLocale, unloadLocale, unregisterMainWindowLocale } from "./utils/locale";
import { logger } from "./utils/logger";
import { registerPersistenceShutdown } from "./utils/persistence-shutdown";
import { getPref } from "./utils/prefs";
import { flushRuntimeData } from "./utils/runtime-data-storage";
import { flushServiceCache } from "./utils/service-cache-storage";
import { clearSupplementalJournalCache, invalidateSupplementalJournalTitle } from "./utils/supplemental-journals";

const windowBindings = new Map<Window, { closed: boolean; readyPromise: Promise<void> }>();
const shortcutCleanups = new Map<Window, () => void>();
const toolbars = new Map<Window, RichTextToolBar>();
let unregisterPersistence: (() => void) | undefined;
const journalRefreshes = new Map<number, Promise<unknown>>();
const pendingModifyIDs = new Set<number>();
let pendingModifyFlush: Promise<void> | undefined;
const automaticItems = new AutomaticItems(processAddedItems, () => {
  const configuredDelay = getPref("lint.delayOnAdded");
  return Number.isFinite(configuredDelay) ? Math.max(500, Math.min(60_000, configuredDelay)) : 500;
});

async function onStartup() {
  await Promise.all([Zotero.initializationPromise, Zotero.unlockPromise, Zotero.uiReadyPromise]);
  if (!addon.data.alive)
    return;
  try {
    unregisterPersistence?.();
    unregisterPersistence = registerPersistenceShutdown(async () => {
      await stopCacheMaintenance();
      const results = await Promise.allSettled([flushRuntimeData(), flushServiceCache(), flushJournalRankingIndex()]);
      for (const result of results) {
        if (result.status === "rejected")
          Zotero.debug(`[MetaFlow shutdown persistence] ${String(result.reason)}`);
      }
    });
    migrateGreenFrogPreferences();
    initLocale();
    startCacheMaintenance();
    const prefsReady = registerPrefs();
    registerNotifier();
    registerMenu();
    registerDuplicateStats();
    await Promise.all([prefsReady, loadJournalInsights(), loadJournalRankingIndex()]);
    if (!addon.data.alive)
      return;
    const mainWindows = Zotero.getMainWindows();
    // Item pane section headers are localized when the custom section is
    // registered. Make its Fluent resources available before registration.
    mainWindows.forEach(registerMainWindowLocale);
    registerExtraColumns();
    registerJournalPane();
    registerInfoRows();
    await Promise.all(mainWindows.map(win => onMainWindowLoad(win, true)));
  }
  catch (error) {
    await onShutdown();
    throw error;
  }
}

function onMainWindowLoad(win: Window, localeRegistered = false): Promise<void> {
  const existing = windowBindings.get(win);
  if (existing)
    return existing.readyPromise;
  const binding = { closed: false, readyPromise: Promise.resolve() };
  windowBindings.set(win, binding);
  binding.readyPromise = Promise.resolve().then(async () => {
    if (binding.closed || win.closed || !addon.data.alive)
      return;
    try {
      await initializeMainWindow(win, localeRegistered);
      if (binding.closed || win.closed || !addon.data.alive)
        await onMainWindowUnload(win);
    }
    catch (error) {
      await onMainWindowUnload(win);
      throw error;
    }
  });
  return binding.readyPromise;
}

async function initializeMainWindow(win: Window, localeRegistered = false): Promise<void> {
  if (!addon.data.alive)
    return;
  if (!localeRegistered)
    registerMainWindowLocale(win);
  registerNativeDuplicatePane(win);
  shortcutCleanups.get(win)?.();
  shortcutCleanups.set(win, registerShortcuts(win));
  toolbars.get(win)?.clean();
  const toolbar = new RichTextToolBar(win);
  toolbar.init();
  toolbars.set(win, toolbar);
  placeTLDRBeforeExtra(win.document);
}

async function onMainWindowUnload(win: Window): Promise<void> {
  const binding = windowBindings.get(win);
  if (binding)
    binding.closed = true;
  windowBindings.delete(win);
  const shortcuts = shortcutCleanups.get(win);
  const toolbar = toolbars.get(win);
  shortcutCleanups.delete(win);
  toolbars.delete(win);
  await cleanupResources([
    () => unregisterNativeDuplicatePane(win),
    () => shortcuts?.(),
    () => toolbar?.clean(),
    () => unregisterMainWindowLocale(win),
  ], error => logger.error("Window cleanup failed:", error));
}

async function onShutdown() {
  closeJournalShareDialogs();
  addon.data.alive = false;
  pendingModifyIDs.clear();
  pendingModifyFlush = undefined;
  journalRefreshes.clear();
  await cleanupResources([
    stopCacheMaintenance,
    () => automaticItems.cancelPending(),
    clearRequestCache,
    clearSupplementalJournalCache,
    clearLintFingerprintCache,
    unregisterNotifier,
    unregisterDuplicateStats,
    clearDuplicateSearchCache,
    unregisterPrefsWindows,
    closeReviewPanels,
    closeCoreFeedback,
    closeCompletionNotices,
    closeAllDialogs,
    () => Zotero.getMainWindows().forEach(unregisterNativeDuplicatePane),
    () => Promise.all([stopCoreWorkflows(), addon.runner.stop()]),
    () => automaticItems.drain(),
    flushRuntimeData,
    flushServiceCache,
    flushJournalRankingIndex,
    resetJournalRankingIndex,
    () => {
      unregisterPersistence?.();
      unregisterPersistence = undefined;
      addon.data.lastAutomaticWorkflow = undefined;
      addon.data.lastCoreWorkflow = undefined;
      if (addon.runner)
        addon.runner.lastResult = undefined;
    },
    unregisterMenu,
    unregisterExtraColumns,
    unregisterJournalPane,
    unregisterInfoRows,
    () => ztoolkit.unregisterAll(),
    () => Promise.all([...new Set([...windowBindings.keys(), ...shortcutCleanups.keys(), ...toolbars.keys(), ...Zotero.getMainWindows()])].map(onMainWindowUnload)),
    unloadLocale,
  ], error => logger.error("Plugin cleanup failed:", error));
  // Remove addon object
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
) {
  logger.debug("notify", event, type, ids, extraData);

  if (type === "item" && ["modify", "delete", "trash"].includes(event)) {
    for (const id of ids) {
      const numericId = Number(id);
      if (Number.isFinite(numericId) && numericId > 0)
        invalidateItemLintFingerprint(numericId);
    }
  }

  if (type === "item" && ["add", "modify", "delete", "trash", "refresh"].includes(event)) {
    clearDuplicateSearchCache();
    invalidateDuplicateStats();
  }

  if (event === "modify" && type === "item") {
    for (const id of ids) {
      const numericId = Number(id);
      if (Number.isFinite(numericId))
        pendingModifyIDs.add(numericId);
    }
    if ((addon.runner as any)?.stats?.phase === "saving")
      return;
    pendingModifyFlush ??= Promise.resolve().then(async () => {
      pendingModifyFlush = undefined;
      if (!addon.data.alive || !pendingModifyIDs.size)
        return;
      const batchIDs = [...pendingModifyIDs];
      pendingModifyIDs.clear();
      await refreshJournalPane(batchIDs);
      refreshTLDRInfoRow();
    });
    await pendingModifyFlush;
    return;
  }

  // Skip if disabled add on lint
  if (!getPref("lint.onAdded"))
    return;

  // We only process the add item event
  if (event !== "add" || type !== "item")
    return;

  // Skip synced item
  if (extraData.skipAutoSync)
    return;

  // Let importers finish saving and group nearby notifications into one batch.
  await automaticItems.enqueue(ids);
}

async function processAddedItems(ids: number[]) {
  if (!addon.data.alive || !getPref("lint.onAdded"))
    return;

  const items = Zotero.Items.get(ids).filter((item): item is Zotero.Item => {
    if (!item || !item.isRegularItem() || item.deleted || item.isFeedItem)
      return false;
    if (typeof item.isEditable === "function" && !item.isEditable())
      return false;
    if (!item.getField("title"))
      return false;
    // @ts-expect-error libraryID is got from item, so get() will never return false
    if (Zotero.Libraries.get(item.libraryID)?.libraryType === "group" && !getPref("lint.onGroup"))
      return false;
    return true;
  });

  if (items.length !== 0) {
    const workflow = createAutomaticWorkflow();
    addon.data.lastAutomaticWorkflow = workflow;
    await runAutomaticWorkflow(workflow, {
      metadata: async () => getPref("metadata.autoUpdateOnAdded")
        ? runReviewCommand("tool-review-metadata", items, false, { scanPDF: false, searchTitle: true, repairCreators: getPref("metadata.repairCreators", true) === true, overwrite: false })
        : undefined,
      format: async () => addon.hooks.onLintInBatch("standard", items, { automatic: true }),
      journal: async () => {
        const journalItems = items.filter(item => ["journalArticle", "conferencePaper"].includes(item.itemType));
        if (!getPref("easyscholar.autoUpdateOnAdded", false) || !journalItems.length)
          return;
        const result = await addon.runner.add({ items: journalItems, rules: [Rules.getByID("tool-update-easyscholar")!], silent: true });
        setJournalUpdateResult(journalItems.map(item => item.id), result);
        await refreshJournalPane(journalItems.map(item => item.id));
        return result;
      },
    }, () => addon.data.alive && getPref("lint.onAdded"));
    if (addon.data.alive && getPref("lint.onAdded") && !workflow.stages.some(stage => stage.status === "cancelled"))
      await processImportedDuplicates(items);
  }
  logger.debug("automatic batch completed for", ids);
}

async function onPrefsEvent(type: string, data: { [key: string]: never }) {
  bumpLintPrefsRevision();
  if (type === "load-script")
    registerPrefsWindow(data.window);
  else if (type === "load")
    registerPrefsScripts(data.window);
}

function onRefreshJournal(item: Zotero.Item, force = false) {
  if (!item || item.deleted || !["journalArticle", "conferencePaper"].includes(item.itemType))
    return Promise.resolve();
  if (!force && (!hasEnabledJournalMetrics() || !item.isEditable()))
    return Promise.resolve();
  const existing = journalRefreshes.get(item.id);
  if (existing)
    return existing;
  const task = (async () => {
    if (force) {
      clearJournalInsights();
      const title = String(item.getField("publicationTitle") || item.getField("conferenceName") || item.getField("proceedingsTitle") || "").trim();
      if (title) {
        await invalidateEasyScholarTitle(title);
        invalidateSupplementalJournalTitle(title);
      }
    }
    const mode = force ? "all" as const : getPref("rule.tool-update-metadata.option.mode") === "all" ? "all" as const : "blank" as const;
    const result = (hasEnabledJournalMetrics() && item.isEditable())
      ? await addon.runner.add({ items: [item], rules: [{ ...ToolUpdateEasyScholar, prepare: () => ({ mode }) }], silent: true })
      : undefined;
    if (addon.data.alive && !result?.cancelled) {
      await getJournalInsights(item, { queryAPI: true });
      await redrawItemValues([item.id]);
      setJournalUpdateResult([item.id], result);
      await refreshJournalPane([item.id]);
    }
    return result;
  })().finally(() => journalRefreshes.delete(item.id));
  journalRefreshes.set(item.id, task);
  return task;
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
