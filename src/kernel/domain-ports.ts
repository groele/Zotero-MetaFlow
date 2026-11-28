import type { Disposable } from "./types";

export const REVIEW_COMMANDS = ["tool-review-metadata", "tool-review-preprint", "tool-review-duplicates"] as const;
export type ReviewCommand = typeof REVIEW_COMMANDS[number];

export interface LintEnginePort {
  runBatch: (
    ruleIDs: string | readonly string[],
    items?: Zotero.Item[],
    options?: { automatic?: boolean; review?: boolean; core?: boolean },
  ) => Promise<unknown>;
  stopAll: () => Promise<void>;
  enqueueAddedItems: (ids: readonly (string | number)[]) => Promise<void>;
  cancelAddedItems: () => void;
  drainAddedItems: () => Promise<void>;
  isSavingPhase: () => boolean;
  inspectDefects?: (item: Zotero.Item) => ReadonlyArray<{
    level: "error" | "warning" | "suggestion";
    message: string;
    fixAction?: "update" | "format";
  }>;
}

export interface JournalInsightsPort {
  refreshPane: (itemIDs?: number[]) => Promise<void>;
  refreshInsights: () => Promise<void>;
  refreshItemJournal: (item: Zotero.Item, force?: boolean) => Promise<unknown>;
  setUpdateResult: (itemIDs: number[], result?: unknown) => void;
  syncExtraColumns: () => void;
}

export interface ReviewDuplicatesPort {
  runReview: (
    command: ReviewCommand,
    items: Zotero.Item[],
    updateVersions?: boolean,
    options?: Record<string, unknown>,
  ) => Promise<unknown>;
  processImportedDuplicates: (items: Zotero.Item[]) => Promise<void>;
  invalidateStats: () => void;
  refreshStats: (libraryID?: number) => Promise<void>;
  setupSettingsPane?: (pane: Element) => void;
}

export interface WorkspaceUiPort {
  refreshTldrRow: (rowID?: string) => void;
  placeTldrRow: (doc?: Document) => void;
  executeShortcut: (hookName: string, win: Window) => void;
  refreshActionsPane?: (itemIDs?: readonly number[], invalidateStatus?: boolean) => Promise<void>;
}

export interface DomainPortMap {
  "lint-engine": LintEnginePort;
  "journal-insights": JournalInsightsPort;
  "review-duplicates": ReviewDuplicatesPort;
  "workspace-ui": WorkspaceUiPort;
}

export type DomainPortId = keyof DomainPortMap;

export class DomainPortRegistry {
  private readonly ports = new Map<DomainPortId, DomainPortMap[DomainPortId]>();

  register<K extends DomainPortId>(id: K, port: DomainPortMap[K]): Disposable {
    this.ports.set(id, port);
    let active = true;
    return () => {
      if (!active)
        return;
      active = false;
      if (this.ports.get(id) === port)
        this.ports.delete(id);
    };
  }

  get<K extends DomainPortId>(id: K): DomainPortMap[K] | undefined {
    return this.ports.get(id) as DomainPortMap[K] | undefined;
  }

  has(id: DomainPortId): boolean {
    return this.ports.has(id);
  }

  clear(): void {
    this.ports.clear();
  }
}
