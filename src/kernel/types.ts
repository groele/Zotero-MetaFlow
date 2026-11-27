export type Disposable = () => void;

export type AsyncDisposable = () => void | Promise<void>;

export interface PluginInfo {
  id: string;
  version: string;
  rootURI: string;
}

export interface NotifierEventPayload {
  readonly event: string;
  readonly type: string;
  readonly ids: readonly (string | number)[];
  readonly extraData?: Record<string, unknown>;
}

export interface MetaFlowEventMap {
  "prefs:changed": { readonly key: string; readonly value: unknown };
  "notifier:event": NotifierEventPayload;
  "tldr:updated": { readonly itemIDs: readonly number[] };
  "journal:refresh-requested": { readonly itemIDs?: readonly number[]; readonly reloadInsights?: boolean };
  "cache:clear-requested": { readonly target: "memory" | "persistent" | "all" };
}

export type MetaFlowEventName = keyof MetaFlowEventMap;

export type DomainId = "workspace-ui" | "journal-insights" | "review-duplicates" | "lint-engine";

export interface DomainModule {
  readonly id: DomainId;
  readonly enabledPref?: string;
  start: () => void | Promise<void>;
  stop: () => void | Promise<void>;
  onMainWindowLoad?: (win: Window) => void | Promise<void>;
  onMainWindowUnload?: (win: Window) => void | Promise<void>;
  isActive: () => boolean;
}

export interface BridgeModule {
  readonly id: string;
  readonly requires?: readonly DomainId[];
  start: () => void;
  stop: () => void;
}
