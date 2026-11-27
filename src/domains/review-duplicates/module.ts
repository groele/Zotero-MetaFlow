import type { PluginKernel } from "../../kernel/plugin-kernel";
import type { Disposable, DomainModule } from "../../kernel/types";
import {
  invalidateDuplicateStats,
  refreshDuplicateStats,
  registerDuplicateStats,
  unregisterDuplicateStats,
} from "../../modules/duplicate-stats";
import {
  registerNativeDuplicatePane,
  unregisterNativeDuplicatePane,
} from "../../modules/native-duplicate-pane";
import { runReviewCommand } from "../../modules/review";
import { processImportedDuplicates } from "../../modules/review/duplicate-batch";
import { closeReviewPanels } from "../../modules/review/panel";
import { cleanupResourcesSync } from "../../utils/cleanup";
import { clearDuplicateSearchCache } from "../../utils/duplicate-search-cache";
import { logger } from "../../utils/logger";

const DUPLICATE_INVALIDATING_EVENTS = new Set(["add", "modify", "delete", "trash", "refresh"]);

export class ReviewDuplicatesDomainModule implements DomainModule {
  public readonly id = "review-duplicates" as const;

  private active = false;
  private readonly disposers: Disposable[] = [];

  constructor(private readonly kernel: PluginKernel) {}

  public isActive(): boolean {
    return this.active;
  }

  public start(): void {
    if (this.active)
      return;
    this.active = true;
    registerDuplicateStats();
    this.disposers.push(
      this.kernel.notifier.subscribe(["item"], ({ event, type }) => {
        if (type === "item" && DUPLICATE_INVALIDATING_EVENTS.has(event)) {
          clearDuplicateSearchCache();
          invalidateDuplicateStats();
        }
      }),
      this.kernel.ports.register("review-duplicates", {
        runReview: (command, items, updateVersions = false, options) => (
          runReviewCommand(command, items, updateVersions, options)
        ),
        processImportedDuplicates: async (items) => {
          await processImportedDuplicates(items);
        },
        invalidateStats: () => invalidateDuplicateStats(),
        refreshStats: libraryID => refreshDuplicateStats(libraryID),
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
