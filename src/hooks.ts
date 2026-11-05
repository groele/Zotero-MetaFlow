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
import { cleanupResources } from "./utils/cleanup";
import { closeAllDialogs } from "./utils/dialog";
import { clearDuplicateSearchCache } from "./utils/duplicate-search-cache";
import { migrateGreenFrogPreferences } from "./utils/greenfrog-migration";
import { clearRequestCache } from "./utils/http";
import { redrawItemValues } from "./utils/item-value-refresh";
import { closeJournalShareDialogs } from "./utils/journal-card-share";
import { getJournalInsights, loadJournalInsights } from "./utils/journal-insights";
import { hasEnabledJournalMetrics } from "./utils/journal-permissions";
import { flushJournalRankingIndex, loadJournalRankingIndex } from "./utils/journal-ranking-index";
import { initLocale, registerMainWindowLocale, unloadLocale, unregisterMainWindowLocale } from "./utils/locale";
import { logger } from "./utils/logger";
import { registerPersistenceShutdown } from "./utils/persistence-shutdown";
import { getPref } from "./utils/prefs";
import { flushRuntimeData } from "./utils/runtime-data-storage";
import { flushServiceCache } from "./utils/service-cache-storage";
import { clearSupplementalJournalCache } from "./utils/supplemental-journals";

const windowBindings = new Map<Window, { closed: boolean; readyPromise: Promise<void> }>();
const shortcutCleanups = new Map<Window, () => void>();
const toolbars = new Map<Window, RichTextToolBar>();
let unregisterPersistence: (() => void) | undefined;
const journalRefreshes = new Map<number, Promise<unknown>>();
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
      const results = await Promise.allSettled([flushRuntimeData(), flushServiceCache(), flushJournalRankingIndex()]);
      for (const result of results) {
        if (result.status === "rejected")
          Zotero.debug(`[MetaFlow shutdown persistence] ${String(result.reason)}`);
      }
    });
    migrateGreenFrogPreferences();
    initLocale();
    await registerPrefs();
    if (!addon.data.alive)
      return;
    registerNotifier();
    registerMenu();
    registerDuplicateStats();
    await loadJournalInsights();
    await loadJournalRankingIndex();
    if (!addon.data.alive)
      return;
    const mainWindows = Zotero.getMainWindows();
    // Item pane section headers are localized when the custom section is
    // registered. Make its Fluent resources available before registration.
    mainWindows.forEach(registerMainWindowLocale);
    registerExtraColumns();
    registerJournalPane();
    registerInfoRows();
    await Promise.all(mainWindows.map(onMainWindowLoad));
  }
  catch (error) {
    await onShutdown();
    throw error;
  }
}

function onMainWindowLoad(win: Window): Promise<void> {
  const existing = windowBindings.get(win);
  if (existing)
    return existing.readyPromise;
  const binding = { closed: false, readyPromise: Promise.resolve() };
  windowBindings.set(win, binding);
  binding.readyPromise = Promise.resolve().then(async () => {
    if (binding.closed || win.closed || !addon.data.alive)
      return;
    try {
      await initializeMainWindow(win);
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

async function initializeMainWindow(win: Window): Promise<void> {
  if (!addon.data.alive)
    return;
  registerMainWindowLocale(win);
  registerNativeDuplicatePane(win);
  shortcutCleanups.get(win)?.();
  shortcutCleanups.set(win, registerShortcuts(win));
  toolbars.get(win)?.clean();
  const toolbar = new RichTextToolBar(win);
  toolbar.init();
  toolbars.set(win, toolbar);
  registerInfoRows();
  refreshTLDRInfoRow();
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
  await cleanupResources([
    () => automaticItems.cancelPending(),
    clearRequestCache,
    clearSupplementalJournalCache,
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
    () => {
      unregisterPersistence?.();
      unregisterPersistence = undefined;
    },
    closeReviewPanels,
    closeAllDialogs,
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

  if (type === "item" && ["add", "modify", "delete", "trash", "refresh"].includes(event)) {
    clearDuplicateSearchCache();
    invalidateDuplicateStats();
  }

  if (event === "modify" && type === "item") {
    await refreshJournalPane(ids.map(Number));
    refreshTLDRInfoRow();
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

  const items = Zotero.Items.get(ids).filter(
    (item): item is Zotero.Item => {
      // skip deleted or non-existent items
      if (!item || !item.isRegularItem())
        return false;

      // skip non-editable item
      if (typeof item.isEditable === "function" && !item.isEditable())
        return false;

      // skip trash item
      if (item.deleted)
        return false;

      // skip feed item
      if (item.isFeedItem)
        return false;

      // skip new empty item
      if (!item.getField("title"))
        return false;

      // skip group item
      // @ts-expect-error libraryID is got from item, so get() will never return false
      if (Zotero.Libraries.get(item.libraryID)?.libraryType === "group" && !getPref("lint.onGroup"))
        return false;

      return true;
    },
  );

  if (items.length !== 0) {
    const workflow = createAutomaticWorkflow();
    addon.data.lastAutomaticWorkflow = workflow;
    await runAutomaticWorkflow(workflow, {
      metadata: async () => getPref("metadata.autoUpdateOnAdded")
        ? runReviewCommand("tool-review-metadata", items, false, { scanPDF: false, searchTitle: true, repairCreators: getPref("metadata.repairCreators", true) === true, overwrite: false })
        : undefined,
      format: async () => {
        return addon.hooks.onLintInBatch("standard", items, { automatic: true });
      },
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
  switch (type) {
    case "load-script":
      registerPrefsWindow(data.window);
      break;
    case "load":
      registerPrefsScripts(data.window);
      break;
    default:
  }
}

/**
 * 分发批量执行某函数的任务
 * @param ruleIDs 批量处理任务的类别，决定调用的函数
 * @param items 需要批量处理的 Zotero.Item[]，或通过触发批量任务的位置决定 Zotero Item 的获取方式。 "item" | "collection" | XUL.MenuPopup | "menuFile" | "menuEdit" | "menuView" | "menuGo" | "menuTools" | "menuHelp"
 */

function onRefreshJournal(item: Zotero.Item) {
  if (!hasEnabledJournalMetrics() || !item || item.deleted || !item.isEditable() || !["journalArticle", "conferencePaper"].includes(item.itemType))
    return Promise.resolve();
  const existing = journalRefreshes.get(item.id);
  if (existing)
    return existing;
  const task = (async () => {
    const mode = getPref("rule.tool-update-metadata.option.mode") === "all" ? "all" as const : "blank" as const;
    const result = await addon.runner.add({ items: [item], rules: [{ ...ToolUpdateEasyScholar, prepare: () => ({ mode }) }], silent: true });
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
