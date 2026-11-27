import type { PluginKernel } from "../../kernel/plugin-kernel";
import type { Disposable, DomainModule } from "../../kernel/types";
import { cleanupResourcesSync } from "../../utils/cleanup";
import { clearDuplicateSearchCache } from "../../utils/duplicate-search-cache";
import { logger } from "../../utils/logger";
import { setupDuplicateSettings } from "./duplicate-settings";
import {
  invalidateDuplicateStats,
  refreshDuplicateStats,
  registerDuplicateStats,
  unregisterDuplicateStats,
} from "./duplicate-stats";
import {
  registerNativeDuplicatePane,
  unregisterNativeDuplicatePane,
} from "./native-duplicate-pane";
import { runReviewCommand } from "./review";
import { processImportedDuplicates } from "./review/duplicate-batch";
import { closeReviewPanels } from "./review/panel";

const DUPLICATE_INVALIDATING_EVENTS = new Set(["add", "modify", "delete", "trash", "refresh"]);

export class ReviewDuplicatesDomainModule implements DomainModule {
  public readonly id = "review-duplicates" as const;

  private active = false;
  private portDisposer?: Disposable;
  private readonly disposers: Disposable[] = [];

  constructor(private readonly kernel: PluginKernel) {}

  public isActive(): boolean {
    return this.active;
  }

  public ensurePortRegistered(): void {
    if (this.portDisposer && this.kernel.ports.has("review-duplicates"))
      return;
    this.portDisposer?.();
    this.portDisposer = this.kernel.ports.register("review-duplicates", {
      runReview: (command, items, updateVersions = false, options) => (
        runReviewCommand(command, items, updateVersions, options)
      ),
      processImportedDuplicates: async (items) => {
        await processImportedDuplicates(items);
      },
      invalidateStats: () => invalidateDuplicateStats(),
      refreshStats: libraryID => refreshDuplicateStats(libraryID),
      setupSettingsPane: pane => setupDuplicateSettings(pane),
    });
  }

  public start(): void {
    if (this.active)
      return;
    this.active = true;
    registerDuplicateStats();
    this.ensurePortRegistered();
    this.disposers.push(
      this.kernel.notifier.subscribe(["item"], ({ event, type }) => {
        if (type === "item" && DUPLICATE_INVALIDATING_EVENTS.has(event)) {
          clearDuplicateSearchCache();
          invalidateDuplicateStats();
        }
      }),
    );
  }

  public onMainWindowLoad(win: Window): void {
    registerNativeDuplicatePane(win);
  }

  public onMainWindowUnload(win: Window): void {
    unregisterNativeDuplicatePane(win);
  }

  public stop(): void {
    this.active = false;
    this.portDisposer?.();
    this.portDisposer = undefined;
    while (this.disposers.length > 0)
      this.disposers.pop()?.();
    cleanupResourcesSync([
      unregisterDuplicateStats,
      clearDuplicateSearchCache,
      closeReviewPanels,
      () => {
        const windows = typeof Zotero !== "undefined" ? (Zotero.getMainWindows?.() ?? []) : [];
        for (const win of windows)
          unregisterNativeDuplicatePane(win);
      },
    ], error => logger.error("Review duplicates cleanup failed:", error));
  }
}
