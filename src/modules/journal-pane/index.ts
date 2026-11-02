import type { BatchResult } from "../runner";
import { cleanupResourcesSync } from "../../utils/cleanup";
import { EASYSCHOLAR_FIELD_DEFINITIONS } from "../../utils/easyscholar";
import { isJournalFeedback } from "../../utils/journal-feedback";
import { clearJournalInsights, getJournalInsights, loadJournalInsights } from "../../utils/journal-insights";
import { hasEnabledJournalMetrics, isJournalIndexEnabled } from "../../utils/journal-permissions";
import { journalRankingRows } from "../../utils/journal-ranking-rows";
import { getLocaleID, getString } from "../../utils/locale";
import { createLogger } from "../../utils/logger";
import { NavigationQueryCache } from "../../utils/navigation-query-cache";
import { registerExtraColumns } from "../item-tree";
import { getEnabledEasyScholarFields } from "../rules/tool-update-easyscholar";
import {
  supportsRankings,
  supportsSection,
} from "./actions";
import { renderJournalPaneCard } from "./cards";
import { ensureJournalPaneStyles } from "./styles";

export {
  extractArxivID,
  isUnconvertedArxivPreprint,
  isUnrevivedSnapshot,
  supportsRankings,
  supportsSection,
} from "./actions";
export { createCheckSvgIcon, createShareSvgIcon } from "./icons";
export { ensureJournalPaneStyles } from "./styles";

let sectionID: string | undefined;
const observers: symbol[] = [];
const refreshers = new Map<HTMLElement, () => Promise<void>>();
const renders = new WeakMap<HTMLElement, object>();
const items = new WeakMap<HTMLElement, Zotero.Item>();
const queryMessages = new Map<number, { level?: string; message: string }[]>();
const navigationListeners = new Map<Document, EventListener>();
const updating = new Set<number>();
const navigationQueries = new NavigationQueryCache();
let settingsRefreshPending = false;
let settingsRevision = 0;
function navigationQueryKey(item: Zotero.Item) {
  return JSON.stringify([
    settingsRevision,
    item.itemType,
    ...["publicationTitle", "conferenceName", "ISSN", "extra"].map(field => item.getField(field as _ZoteroTypes.Item.ItemField)),
  ]);
}
const logger = createLogger("journal-pane");

export function ensureJournalPaneLocalization(doc?: Document | null) {
  if (!doc)
    return;
  const file = `${addon.data.config.addonRef}-main-window.ftl`;
  if (doc.querySelector?.(`link[rel="localization"][href="${file}"]`))
    return;
  try {
    (doc.defaultView as any)?.MozXULElement?.insertFTLIfNeeded?.(file);
    (doc as any).l10n?.addResourceIds?.([file]);
  }
  catch {
    // ignore
  }
}

function ensureSectionTitle(body: HTMLElement, doc?: Document | null) {
  const targetDoc = doc || body.ownerDocument;
  ensureJournalPaneLocalization(targetDoc);
  const section = (body.closest("collapsible-section") || body.parentElement) as (HTMLElement & { label?: string }) | null;
  if (!section)
    return;
  const heading = getString("journal-insights-heading") || "Zotero MetaFlow 期刊索引";
  if (!section.getAttribute("label") || !section.label) {
    section.setAttribute("label", heading);
    section.label = heading;
  }
  const titleEl = section.querySelector<HTMLElement>(".head .title-box .title, .title");
  if (titleEl && !titleEl.textContent?.trim()) {
    titleEl.textContent = heading;
  }
}

export function registerJournalPane() {
  if (sectionID)
    return;
  const icon = `${rootURI}content/icons/metaref.svg`;
  const id = Zotero.ItemPaneManager.registerSection({
    paneID: "metaref-journal-insights",
    pluginID: addon.data.config.addonID,
    header: { icon, l10nID: getLocaleID("journal-insights-heading")! },
    sidenav: { icon, l10nID: getLocaleID("journal-insights-heading")! },
    onInit({ body, doc, refresh, setEnabled }) {
      const targetDoc = doc || body.ownerDocument;
      ensureJournalPaneLocalization(targetDoc);
      ensureJournalPaneStyles(targetDoc);
      ensureSectionTitle(body, targetDoc);
      const hideSummary = () => {
        ensureSectionTitle(body, targetDoc);
        const summary = (body.closest("collapsible-section") || body.parentElement)?.querySelector<HTMLElement>(".head .title-box .summary, .summary");
        if (summary && !summary.textContent?.trim())
          summary.style.display = "none";
      };
      hideSummary();
      const raf = targetDoc?.defaultView?.requestAnimationFrame;
      if (typeof raf === "function")
        raf.call(targetDoc!.defaultView, hideSummary);
      if (!navigationListeners.has(doc)) {
        const listener: EventListener = (event) => {
          const mouse = event as MouseEvent;
          if (mouse.button !== 0 || mouse.detail > 1)
            return;
          const button = (event.target as Element)?.closest?.("item-pane-sidenav .btn[data-pane]");
          if (!button || button.getAttribute("data-pane") !== sectionID || button.hasAttribute("disabled"))
            return;
          const sidenav = button.closest("item-pane-sidenav") as Element & { container?: Element };
          const activeBody = [...refreshers.keys()].find(node => node.ownerDocument === doc && sidenav.container?.contains(node));
          const item = activeBody && items.get(activeBody);
          if (item && supportsRankings(item) && !updating.has(item.id))
            void completeFromNavigation(item).catch(error => logger.error(error));
        };
        doc.addEventListener("click", listener);
        navigationListeners.set(doc, listener);
      }
      refreshers.set(body, async () => {
        setEnabled(supportsSection(items.get(body)));
        await refresh();
      });
    },
    onDestroy({ body }) {
      refreshers.delete(body);
      renders.delete(body);
      items.delete(body);
      const doc = body.ownerDocument;
      if (doc && ![...refreshers.keys()].some(node => node.ownerDocument === doc)) {
        const listener = navigationListeners.get(doc);
        if (listener)
          doc.removeEventListener("click", listener);
        navigationListeners.delete(doc);
      }
    },
    onItemChange({ item, body, setEnabled }) {
      if (item)
        items.set(body, item);
      else
        items.delete(body);
      renders.delete(body);
      body.replaceChildren();
      body.style.cssText = "padding:0;margin:0;box-sizing:border-box;";
      const enabled = supportsSection(item);
      setEnabled(enabled);
      ensureJournalPaneStyles(body.ownerDocument);
      ensureSectionTitle(body, body.ownerDocument);
      const summary = (body.closest("collapsible-section") || body.parentElement)?.querySelector<HTMLElement>(".head .title-box .summary, .summary");
      if (summary && !summary.textContent?.trim())
        summary.style.display = "none";
    },
    onRender({ body, item, setEnabled }) {
      if (item)
        items.set(body, item);
      renders.delete(body);
      const enabled = supportsSection(item);
      setEnabled(enabled);
      const doc = body.ownerDocument || Zotero.getMainWindow()?.document;
      ensureJournalPaneStyles(doc);
      ensureSectionTitle(body, doc);
      body.style.cssText = "padding:0;margin:0;box-sizing:border-box;";
      const summary = (body.closest("collapsible-section") || body.parentElement)?.querySelector<HTMLElement>(".head .title-box .summary, .summary");
      if (summary && !summary.textContent?.trim())
        summary.style.display = "none";
      if (!enabled) {
        body.replaceChildren();
        return;
      }
      if (doc) {
        const loading = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
        loading.className = "metaref-journal-pane-wrap";
        loading.textContent = getString("journal-insights-loading");
        body.replaceChildren(loading);
      }
      else {
        body.textContent = getString("journal-insights-loading");
      }
    },
    onAsyncRender: context => renderJournalPaneCard(context, {
      queryMessages,
      renders,
      refreshJournalPane,
    }),
  });
  if (id)
    sectionID = id;
  for (const pref of ["insights.showPane", "insights.esiCustomDataPath", "insights.esiFormat", "insights.natureCustomDataPath", "insights.esiSourcePriority", "insights.natureSourcePriority", "insights.natureDatasetUUID", "easyscholar.secretKey", "insights.natureEnabled", ...EASYSCHOLAR_FIELD_DEFINITIONS.map(field => `easyscholar.fields.${field.key}`)]) {
    observers.push(Zotero.Prefs.registerObserver(`${addon.data.config.prefsPrefix}.${pref}`, () => {
      if (pref.endsWith("DataPath"))
        clearJournalInsights();
      refreshData();
    }, true));
  }
}

async function completeFromNavigation(item: Zotero.Item) {
  if (!hasEnabledJournalMetrics() || navigationQueries.has(item.id, navigationQueryKey(item)))
    return;
  updating.add(item.id);
  try {
    const insights = await getJournalInsights(item);
    const saved = new Set(journalRankingRows(String(item.getField("extra") || ""), item).map(row => row.key));
    const enabled = getEnabledEasyScholarFields();
    const missingRankings = EASYSCHOLAR_FIELD_DEFINITIONS.some(field => enabled.has(field.key) && !saved.has(field.key));
    const missingIndexes = item.itemType === "journalArticle" && ((isJournalIndexEnabled("esi") && (!insights.categories.length || insights.esiAPIWarning)) || (isJournalIndexEnabled("nature") && (insights.natureIndex === undefined || insights.natureAPIWarning)));
    if (!missingRankings && !missingIndexes)
      return;
    queryMessages.set(item.id, [{ message: getString("journal-insights-loading") }]);
    await refreshJournalPane([item.id]);
    const result = await addon.hooks.onRefreshJournal(item) as BatchResult | undefined;
    if (!result?.cancelled)
      navigationQueries.remember(item.id, navigationQueryKey(item), Boolean(result?.failed || result?.records.some(record => record.level === "warning" || record.level === "error")));
  }
  catch (error) {
    navigationQueries.remember(item.id, navigationQueryKey(item), true);
    queryMessages.set(item.id, [{ level: "error", message: getString("journal-rankings-refresh-failed") }]);
    await refreshJournalPane([item.id]);
    throw error;
  }
  finally {
    updating.delete(item.id);
  }
}

function refreshData() {
  settingsRevision++;
  if (settingsRefreshPending)
    return;
  settingsRefreshPending = true;
  let renderedRevision = settingsRevision;
  void Promise.resolve().then(async () => {
    renderedRevision = settingsRevision;
    if (!addon.data.alive)
      return;
    registerExtraColumns();
    await loadJournalInsights();
    if (addon.data.alive) {
      Zotero.ItemTreeManager.refreshColumns();
      await Promise.all([...refreshers.values()].map(refresh => refresh()));
    }
  }).catch(error => logger.error(error)).finally(() => {
    settingsRefreshPending = false;
    if (addon.data.alive && renderedRevision !== settingsRevision)
      refreshData();
  });
}

export async function refreshJournalInsights() {
  navigationQueries.clear();
  clearJournalInsights();
  await loadJournalInsights();
  if (!addon.data.alive)
    return;
  Zotero.ItemTreeManager.refreshColumns();
  await Promise.all([...refreshers.values()].map(refresh => refresh()));
}

export async function refreshJournalPane(itemIDs?: number[]) {
  if (!addon.data.alive)
    return;
  await Promise.all([...refreshers].filter(([body]) => !itemIDs || itemIDs.includes(items.get(body)?.id || 0)).map(([, refresh]) => refresh()));
}

export function setJournalUpdateResult(itemIDs: number[], result?: BatchResult) {
  for (const id of itemIDs) {
    const messages = result?.records.filter(record => record.itemID === id && isJournalFeedback(record)).map(({ level, message }) => ({ level, message })) || [];
    if (result && !messages.length && !result.cancelled)
      messages.push({ level: "info", message: getString("journal-rankings-query-complete") });
    if (result?.cancelled)
      messages.push({ level: "warning", message: getString("journal-rankings-cancelled") });
    queryMessages.delete(id);
    queryMessages.set(id, messages);
  }
  while (queryMessages.size > 128)
    queryMessages.delete(queryMessages.keys().next().value!);
}

export function unregisterJournalPane() {
  const id = sectionID;
  sectionID = undefined;
  refreshers.clear();
  queryMessages.clear();
  for (const [doc, listener] of navigationListeners)
    doc.removeEventListener("click", listener);
  navigationListeners.clear();
  updating.clear();
  navigationQueries.clear();
  cleanupResourcesSync([
    ...observers.splice(0).map(id => () => Zotero.Prefs.unregisterObserver(id)),
    () => id && Zotero.ItemPaneManager.unregisterSection(id),
    clearJournalInsights,
  ], error => logger.error("Journal pane cleanup failed:", error));
}
