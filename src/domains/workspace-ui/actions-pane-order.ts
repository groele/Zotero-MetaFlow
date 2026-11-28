import { getPref, setPref } from "../../utils/prefs";
import { ACTIONS_PANE_ID } from "./actions-pane-styles";

const DEFAULT_SIDENAV_PANES = ["info", "abstract", "attachments", "notes", "libraries-collections", "tags", "related"] as const;

export type ActionsPanePosition
  = | "top"
    | "after-info"
    | "after-abstract"
    | "before-journal"
    | "after-journal"
    | "after-tags"
    | "bottom";

function escapePaneKey(raw: string): string {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(raw)
    : raw.replace(/[@.]/g, ch => `\\${ch}`);
}

function resolveInsertionIndex(order: string[], journalKey: string, position: string): number {
  const after = (id: string, fallback = order.length) => {
    const idx = order.indexOf(id);
    return idx >= 0 ? idx + 1 : fallback;
  };
  switch (position) {
    case "top":
      return 0;
    case "after-info":
      return after("info", 0);
    case "after-abstract":
      return after("abstract", after("info", 0));
    case "before-journal": {
      const idx = order.indexOf(journalKey);
      return idx >= 0 ? idx : after("related", order.length);
    }
    case "after-tags":
      return after("tags", order.length);
    case "bottom":
      return order.length;
    case "after-journal":
    default:
      return after(journalKey, after("related", order.length));
  }
}

export function applyActionsPaneSidenavPosition(
  hostZotero: any,
  addonID: string | undefined,
  position: string = getPref("workflow.actionsPanePosition", "after-journal"),
  options: { preserveExistingOrder?: boolean } = {},
) {
  if (!addonID || typeof hostZotero?.Prefs?.get !== "function" || typeof hostZotero?.Prefs?.set !== "function")
    return;
  const rawOrder = hostZotero.Prefs.get("sidenav.order");
  const hasPersisted = typeof rawOrder === "string" && rawOrder.trim().length > 0;
  if (options.preserveExistingOrder && !hasPersisted)
    return;
  const order = hasPersisted
    ? rawOrder.split(",").map((s: string) => s.trim()).filter(Boolean)
    : [...DEFAULT_SIDENAV_PANES];
  const mounted = hostZotero.getMainWindow?.()?.document?.querySelectorAll?.("#zotero-view-item-sidenav .btn[data-pane]") as Iterable<HTMLElement> | undefined;
  if (mounted) {
    for (const btn of mounted) {
      const id = btn.dataset?.pane;
      if (id && id !== "context-notes" && !order.includes(id))
        order.push(id);
    }
  }
  const actionsKey = escapePaneKey(`${addonID}-${ACTIONS_PANE_ID}`);
  if (options.preserveExistingOrder && order.includes(actionsKey)) {
    setPref("workflow.actionsPaneOrderSynced", true);
    return;
  }
  const cleanOrder = order.filter((key: string) => key !== actionsKey);
  const journalKey = escapePaneKey(`${addonID}-metaref-journal-insights`);
  const insertAt = resolveInsertionIndex(cleanOrder, journalKey, position);
  cleanOrder.splice(insertAt, 0, actionsKey);
  hostZotero.Prefs.set("sidenav.order", cleanOrder.join(","));
  setPref("workflow.actionsPaneOrderSynced", true);
}

export function ensureActionsPaneSidenavOrder(hostZotero: any, addonID: string) {
  if (getPref("workflow.actionsPaneOrderSynced", false) === true)
    return;
  applyActionsPaneSidenavPosition(hostZotero, addonID, getPref("workflow.actionsPanePosition", "after-journal"), {
    preserveExistingOrder: true,
  });
}
