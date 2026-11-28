import type { BatchResult } from "../../services/lint/runner";
import type { ActionsPanePosition } from "./actions-pane-order";
import { resolveAddonHost, resolveZoteroHost } from "../../kernel/host-globals";
import { observeHostPrefs } from "../../kernel/pref-service";
import { cleanupResourcesSync } from "../../utils/cleanup";
import { isTrashedItem, isWritableItem } from "../../utils/item-write-policy";
import { getLocaleID, getString } from "../../utils/locale";
import { createLogger } from "../../utils/logger";
import { getPref } from "../../utils/prefs";
import { applyActionsPaneSidenavPosition, ensureActionsPaneSidenavOrder } from "./actions-pane-order";
import { ACTIONS_PANE_ID, createActionChevronSvg, createActionIconSvg, ensureActionsPaneStyles } from "./actions-pane-styles";

export { type ActionsPanePosition, applyActionsPaneSidenavPosition, ensureActionsPaneSidenavOrder };

type ActionKind = "check" | "update";

interface ActionStatus {
  level: "info" | "warning" | "error";
  message: string;
}

const XHTML_NS = "http://www.w3.org/1999/xhtml";
const MAX_STATUS_ENTRIES = 64;

const logger = createLogger("actions-pane");
const refreshers = new Map<HTMLElement, () => Promise<void>>();
const activeActions = new Map<number, ActionKind>();
const statusMessages = new Map<number, ActionStatus>();

let sectionID: string | undefined;
let stopPrefObserver: (() => void) | undefined;

export function actionsPaneItem(body: HTMLElement): Zotero.Item | undefined {
  const section = body.closest("item-pane-custom-section") as (Element & { item?: Zotero.Item }) | null;
  return section?.item;
}

export function isActionsPaneItemCurrent(body: HTMLElement, item: Zotero.Item): boolean {
  return body.isConnected && actionsPaneItem(body)?.id === item.id;
}

export function supportsActionsPane(item?: Zotero.Item): boolean {
  if (!item || getPref("workflow.showActionsPane", true) !== true)
    return false;
  if (typeof item.isRegularItem !== "function" || !item.isRegularItem())
    return false;
  return !isTrashedItem(item);
}

function canEditItem(item?: Zotero.Item): boolean {
  if (!item)
    return false;
  return typeof item.isEditable === "function" ? isWritableItem(item) : !isTrashedItem(item);
}

function hideEmptySummary(body: HTMLElement, doc?: Document | null) {
  const summary = (body.closest("collapsible-section") || body.parentElement)?.querySelector<HTMLElement>(".head .title-box .summary, .summary");
  if (summary && !summary.textContent?.trim())
    summary.style.display = "none";
  const view = doc?.defaultView;
  if (typeof view?.requestAnimationFrame === "function") {
    view.requestAnimationFrame(() => {
      if (summary && !summary.textContent?.trim())
        summary.style.display = "none";
    });
  }
}

function setStatusMessage(itemID: number, status: ActionStatus) {
  statusMessages.delete(itemID);
  statusMessages.set(itemID, status);
  while (statusMessages.size > MAX_STATUS_ENTRIES) {
    const oldest = statusMessages.keys().next().value;
    if (oldest === undefined)
      break;
    statusMessages.delete(oldest);
  }
}

async function runSidebarAction(kind: ActionKind, item: Zotero.Item): Promise<void> {
  const hostAddon = resolveAddonHost();
  const hostZotero = resolveZoteroHost();
  if (hostAddon?.data?.alive === false || activeActions.has(item.id))
    return;

  const target = hostZotero?.Items?.get?.(item.id) || item;
  if (!supportsActionsPane(target) || !canEditItem(target)) {
    await refreshActionsPane([item.id]);
    return;
  }

  activeActions.set(item.id, kind);
  setStatusMessage(item.id, {
    level: "info",
    message: getString(kind === "check" ? "actions-pane-running-check" : "actions-pane-running-update"),
  });
  await refreshActionsPane([item.id]);

  try {
    const ruleID = kind === "check" ? "standard" : "tool-update-metadata";
    const context = kind === "check" ? { core: true } : { review: true };
    const lintPort = hostAddon?.kernel?.ports?.get?.("lint-engine");
    const result = (lintPort?.runBatch
      ? await lintPort.runBatch(ruleID, [target], context)
      : await hostAddon?.hooks?.onLintInBatch?.(ruleID, [target], context)) as BatchResult | undefined;

    if (resolveAddonHost()?.data?.alive === false)
      return;
    if (result?.cancelled)
      setStatusMessage(item.id, { level: "warning", message: getString("actions-pane-done-cancelled") });
    else if ((result?.failed ?? 0) > 0 || (result?.preparationFailed ?? 0) > 0)
      setStatusMessage(item.id, { level: "error", message: getString("actions-pane-done-failed") });
    else if ((result?.saved ?? 0) > 0)
      setStatusMessage(item.id, { level: "info", message: getString("actions-pane-done-saved") });
    else
      setStatusMessage(item.id, { level: "info", message: getString("actions-pane-done-clean") });
  }
  catch (error) {
    logger.error(`Sidebar action (${kind}) failed:`, error);
    if (resolveAddonHost()?.data?.alive !== false)
      setStatusMessage(item.id, { level: "error", message: getString("actions-pane-done-failed") });
  }
  finally {
    activeActions.delete(item.id);
    if (resolveAddonHost()?.data?.alive !== false)
      await refreshActionsPane([item.id]);
  }
}

function buildActionButton(
  doc: Document,
  kind: ActionKind,
  labelText: string,
  hintText: string,
  disabled: boolean,
  busy: boolean,
  onRun: () => void,
): HTMLButtonElement {
  const button = doc.createElementNS(XHTML_NS, "button") as HTMLButtonElement;
  button.type = "button";
  button.className = "metaref-action-btn";
  button.setAttribute("data-metaref-action", kind);
  button.disabled = disabled;
  if (busy)
    button.setAttribute("aria-busy", "true");

  const icon = createActionIconSvg(doc, kind);
  const textWrap = doc.createElementNS(XHTML_NS, "span");
  textWrap.className = "metaref-action-text";
  const label = doc.createElementNS(XHTML_NS, "span");
  label.className = "metaref-action-label";
  label.textContent = labelText;
  const hint = doc.createElementNS(XHTML_NS, "span");
  hint.className = "metaref-action-hint";
  hint.textContent = hintText;
  textWrap.append(label, hint);
  const chevron = createActionChevronSvg(doc);

  button.append(icon, textWrap, chevron);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!button.disabled)
      onRun();
  });
  return button;
}

function ensureOpenHeightUnlocked(body: HTMLElement) {
  const section = body.closest?.("collapsible-section") as HTMLElement | null;
  if (section?.hasAttribute?.("open"))
    section.style?.setProperty?.("--open-height", "auto");
}

function renderActionsPane(body: HTMLElement, doc: Document, item?: Zotero.Item) {
  ensureActionsPaneStyles(doc);
  body.style.cssText = "padding:0;margin:0;box-sizing:border-box;";
  hideEmptySummary(body, doc);
  if (!item || !supportsActionsPane(item)) {
    body.replaceChildren();
    return;
  }

  const wrap = doc.createElementNS(XHTML_NS, "div");
  wrap.className = "metaref-actions-pane-wrap";
  wrap.setAttribute("data-item-id", String(item.id));

  const busy = activeActions.has(item.id);
  const disabled = busy || !canEditItem(item);
  const checkBtn = buildActionButton(
    doc,
    "check",
    getString("actions-pane-check-label"),
    getString("actions-pane-check-hint"),
    disabled,
    busy,
    () => { void runSidebarAction("check", item); },
  );
  const updateBtn = buildActionButton(
    doc,
    "update",
    getString("actions-pane-update-label"),
    getString("actions-pane-update-hint"),
    disabled,
    busy,
    () => { void runSidebarAction("update", item); },
  );

  const status = doc.createElementNS(XHTML_NS, "div");
  status.className = "metaref-actions-status";
  status.setAttribute("data-actions-status", "true");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const statusInfo = statusMessages.get(item.id);
  if (statusInfo) {
    status.setAttribute("data-level", statusInfo.level);
    status.textContent = statusInfo.message;
  }

  wrap.append(checkBtn, updateBtn, status);
  body.replaceChildren(wrap);
  ensureOpenHeightUnlocked(body);
}

export function registerActionsPane() {
  if (sectionID)
    return;
  const hostZotero = resolveZoteroHost() as typeof Zotero | undefined;
  const hostAddon = resolveAddonHost();
  if (!hostZotero?.ItemPaneManager?.registerSection || !hostAddon?.data?.config)
    return;

  ensureActionsPaneSidenavOrder(hostZotero, hostAddon.data.config.addonID);

  const baseURI = typeof rootURI === "string" ? rootURI : "";
  const icon = `${baseURI}content/icons/metaref-actions.svg`;
  const headingL10nID = getLocaleID("actions-pane-heading") || "metaref-actions-pane-heading";
  const resolveDoc = (body: HTMLElement, doc?: Document) => doc || body.ownerDocument || hostZotero.getMainWindow()?.document;
  const ensureRendered = (body: HTMLElement, item?: Zotero.Item, doc?: Document, setEnabled?: (enabled: boolean) => void) => {
    const activeItem = item || actionsPaneItem(body);
    const enabled = supportsActionsPane(activeItem);
    if (activeItem || item !== undefined)
      setEnabled?.(enabled);
    const targetDoc = resolveDoc(body, doc);
    if (!targetDoc) {
      if (!enabled)
        body.replaceChildren();
      return;
    }
    renderActionsPane(body, targetDoc, activeItem);
  };
  const id = hostZotero.ItemPaneManager.registerSection({
    paneID: ACTIONS_PANE_ID,
    pluginID: hostAddon.data.config.addonID,
    header: { icon, l10nID: headingL10nID },
    sidenav: { icon, l10nID: headingL10nID },
    onInit({ body, doc, refresh, setEnabled }) {
      ensureActionsPaneStyles(doc || body.ownerDocument);
      hideEmptySummary(body, doc || body.ownerDocument);
      refreshers.set(body, async () => {
        const item = actionsPaneItem(body);
        setEnabled(supportsActionsPane(item));
        await refresh();
      });
      // Reordering in Zotero triggers disconnectedCallback -> connectedCallback, wiping DOM children while preserving section.item.
      const currentItem = actionsPaneItem(body);
      if (currentItem)
        ensureRendered(body, currentItem, doc, setEnabled);
    },
    onDestroy({ body }) {
      refreshers.delete(body);
    },
    onItemChange({ item, body, doc, setEnabled }) {
      ensureRendered(body, item, doc, setEnabled);
    },
    onRender({ body, item, doc, setEnabled }) {
      ensureRendered(body, item, doc, setEnabled);
    },
    onToggle({ body, item, doc, setEnabled }) {
      ensureRendered(body, item, doc, setEnabled);
    },
  });
  if (id)
    sectionID = id;
  stopPrefObserver?.();
  stopPrefObserver = observeHostPrefs(["workflow.showActionsPane", "workflow.actionsPanePosition"], (changedKey) => {
    if (changedKey === "workflow.actionsPanePosition") {
      applyActionsPaneSidenavPosition(
        resolveZoteroHost(),
        resolveAddonHost()?.data?.config?.addonID,
        getPref("workflow.actionsPanePosition", "after-journal"),
      );
      void Promise.resolve().then(() => refreshActionsPane());
      return;
    }
    void refreshActionsPane();
  });
}

export async function refreshActionsPane(itemIDs?: number[]) {
  if (resolveAddonHost()?.data?.alive === false)
    return;
  for (const body of [...refreshers.keys()]) {
    if (!body.isConnected)
      refreshers.delete(body);
  }
  await Promise.all([...refreshers].filter(([body]) => {
    const item = actionsPaneItem(body);
    return !itemIDs || (item && itemIDs.includes(item.id));
  }).map(([, refresh]) => refresh()));
}

export function unregisterActionsPane() {
  const id = sectionID;
  sectionID = undefined;
  refreshers.clear();
  activeActions.clear();
  statusMessages.clear();
  const hostZotero = resolveZoteroHost() as typeof Zotero | undefined;
  cleanupResourcesSync([
    () => {
      stopPrefObserver?.();
      stopPrefObserver = undefined;
    },
    () => id && hostZotero?.ItemPaneManager?.unregisterSection?.(id),
  ], error => logger.error("Actions pane cleanup failed:", error));
}
