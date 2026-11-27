import { resolveZoteroHost } from "../../kernel/host-globals";

export type HostCapabilityId
  = | "itemTreeColumns"
    | "itemPaneSections"
    | "itemPaneInfoRows"
    | "collectionTreeRowHook"
    | "preferencePanes"
    | "nativeDuplicatesPane"
    | "titleEditableHeader";

export interface HostCapabilityStatus {
  id: HostCapabilityId;
  available: boolean;
  degradedReason?: string;
}

export interface HostCapabilitiesSnapshot {
  hostVersion: string;
  checkedAt: number;
  capabilities: Record<HostCapabilityId, HostCapabilityStatus>;
  degradedIds: HostCapabilityId[];
}

const CAPABILITY_ORDER: readonly HostCapabilityId[] = [
  "itemTreeColumns",
  "itemPaneSections",
  "itemPaneInfoRows",
  "collectionTreeRowHook",
  "preferencePanes",
  "nativeDuplicatesPane",
  "titleEditableHeader",
];

function safeRead<T>(getter: () => T): { ok: true; value: T } | { ok: false; error: string } {
  try {
    return { ok: true, value: getter() };
  }
  catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function checkCapability(
  id: HostCapabilityId,
  probe: () => string | null,
): HostCapabilityStatus {
  const result = safeRead(probe);
  if (!result.ok)
    return { id, available: false, degradedReason: result.error };
  if (result.value !== null)
    return { id, available: false, degradedReason: result.value };
  return { id, available: true };
}

export function probeHostCapabilities(win?: Window | null): HostCapabilitiesSnapshot {
  const zotero = safeRead(() => resolveZoteroHost());
  const z = zotero.ok ? zotero.value : undefined;
  const versionRead = safeRead(() => (z?.version ? String(z.version) : "unknown"));
  const hostVersion = versionRead.ok ? versionRead.value : "unknown";

  const capabilities: Record<HostCapabilityId, HostCapabilityStatus> = {
    itemTreeColumns: checkCapability(
      "itemTreeColumns",
      () => typeof z?.ItemTreeManager?.registerColumn === "function"
        ? null
        : "Zotero.ItemTreeManager.registerColumn is unavailable",
    ),
    itemPaneSections: checkCapability(
      "itemPaneSections",
      () => typeof z?.ItemPaneManager?.registerSection === "function"
        ? null
        : "Zotero.ItemPaneManager.registerSection is unavailable",
    ),
    itemPaneInfoRows: checkCapability(
      "itemPaneInfoRows",
      () => typeof z?.ItemPaneManager?.registerInfoRow === "function"
        ? null
        : "Zotero.ItemPaneManager.registerInfoRow is unavailable",
    ),
    collectionTreeRowHook: checkCapability(
      "collectionTreeRowHook",
      () => typeof z?.CollectionTreeRow?.prototype?.getName === "function"
        ? null
        : "Zotero.CollectionTreeRow.prototype.getName is unavailable",
    ),
    preferencePanes: checkCapability(
      "preferencePanes",
      () => typeof z?.PreferencePanes?.register === "function"
        ? null
        : "Zotero.PreferencePanes.register is unavailable",
    ),
    nativeDuplicatesPane: checkCapability("nativeDuplicatesPane", () => {
      if (!win?.document?.getElementById?.("zotero-item-pane"))
        return "Window #zotero-item-pane container is unavailable";
      if (typeof z?.ProgressWindowSet?.tile !== "function")
        return "Zotero.ProgressWindowSet.tile is unavailable";
      return null;
    }),
    titleEditableHeader: checkCapability("titleEditableHeader", () => {
      const doc = win?.document;
      if (!doc)
        return "Window document is unavailable";
      const hasCustomElement = typeof win?.customElements?.get === "function"
        && Boolean(win.customElements.get("editable-text"));
      const hasHeaderNode = Boolean(
        doc.querySelector?.("item-pane-header, editable-text")
        || doc.getElementById?.("zotero-item-pane"),
      );
      if (!hasCustomElement && !hasHeaderNode)
        return "Editable title header host element is unavailable";
      return null;
    }),
  };

  const degradedIds = CAPABILITY_ORDER.filter(id => !capabilities[id].available);
  return {
    hostVersion,
    checkedAt: Date.now(),
    capabilities,
    degradedIds,
  };
}

export function formatCapabilitiesSummary(snapshot: HostCapabilitiesSnapshot): string {
  const total = CAPABILITY_ORDER.length;
  const availableCount = total - snapshot.degradedIds.length;
  const base = `Zotero ${snapshot.hostVersion}: ${availableCount}/${total} host capabilities available`;
  if (!snapshot.degradedIds.length)
    return base;
  const details = snapshot.degradedIds
    .map((id) => {
      const reason = snapshot.capabilities[id]?.degradedReason;
      return reason ? `${id} (${reason})` : id;
    })
    .join("; ");
  return `${base}; degraded: ${details}`;
}
