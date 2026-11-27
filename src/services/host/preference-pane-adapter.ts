import { resolveZoteroHost } from "../../kernel/host-globals";

export interface PreferencePaneSpec {
  id: string;
  pluginID: string;
  src: string;
  scripts: string[];
  stylesheets: string[];
  label: string;
  image: string;
  helpURL: string;
  isAlive?: () => boolean;
}

interface RegisteredPaneRecord {
  id: string;
  pluginID?: string;
  src?: string;
}

function getPreferencePanesAPI(): {
  pluginPanes?: RegisteredPaneRecord[];
  register?: (options: Record<string, unknown>) => Promise<string> | string;
  unregister?: (id: string) => void;
} | undefined {
  return resolveZoteroHost()?.PreferencePanes;
}

export function unregisterPluginPreferencePanes(pluginID: string): void {
  const api = getPreferencePanesAPI();
  if (!api || !Array.isArray(api.pluginPanes) || typeof api.unregister !== "function")
    return;
  const matching = api.pluginPanes.filter(pane => pane?.pluginID === pluginID);
  for (const pane of matching)
    api.unregister(pane.id);
}

export async function dedupeAndRegisterPreferencePane(spec: PreferencePaneSpec): Promise<string> {
  const api = getPreferencePanesAPI();
  if (!api || typeof api.register !== "function")
    throw new Error("Zotero.PreferencePanes.register is unavailable");

  const existing = Array.isArray(api.pluginPanes)
    ? api.pluginPanes.filter(pane => pane?.pluginID === spec.pluginID)
    : [];
  const current = existing.find(pane => pane?.src === spec.src);

  for (const pane of existing) {
    if (pane !== current)
      api.unregister?.(pane.id);
  }

  if (current) {
    if (spec.isAlive?.() === false)
      api.unregister?.(current.id);
    return current.id;
  }

  const registeredId = await api.register({
    id: spec.id,
    pluginID: spec.pluginID,
    src: spec.src,
    scripts: [...spec.scripts],
    stylesheets: [...spec.stylesheets],
    defaultXUL: true,
    label: spec.label,
    image: spec.image,
    helpURL: spec.helpURL,
  });

  if (spec.isAlive?.() === false)
    api.unregister?.(registeredId);

  return registeredId;
}

export function tileProgressWindow(popup: Window | undefined): void {
  if (!popup || popup.closed)
    return;
  resolveZoteroHost()?.ProgressWindowSet?.tile?.(popup);
}
