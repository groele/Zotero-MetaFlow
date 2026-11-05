import type { FieldChange } from "../reporter";
import type { BatchResult, RunnerStats } from "./types";
import { createWorkCheckpoint } from "../../utils/cooperative-scheduler";
import { DataLoader } from "../../utils/data-loader";
import { createLogger } from "../../utils/logger";
import { recordRuntimeResult } from "../../utils/runtime-data-storage";
import { updateBatchFeedback } from "../batch-feedback";
import { ProgressUI } from "../reporter";

const logger = createLogger("Runner");

export class RunnerState {
  protected stats: RunnerStats = this.emptyStats();
  protected modifiedItems = new Set<Zotero.Item>();
  protected itemBaselines = new Map<Zotero.Item, Record<string, unknown>>();
  protected cancelled = false;
  protected preparation?: AbortController;
  protected execution?: AbortController;
  protected saved = 0;
  protected failedItems = new Set<number | Zotero.Item>();
  protected unsafeItems = new Set<Zotero.Item>();
  protected preparationFailed = 0;
  protected changes: FieldChange[] = [];
  protected savedValues = new Map<number, Record<string, unknown>>();
  protected applicableIDs = new Set<number>();
  protected processedIDs = new Set<number>();
  protected lastProgressTime = 0;
  protected lastProgressPhase?: RunnerStats["phase"];
  protected checkpoint = createWorkCheckpoint();
  public lastResult?: BatchResult;
  protected readonly ui = new ProgressUI({
    onCancel: () => this.cancel(),
  });

  public cancel(): void {
    this.cancelled = true;
    this.execution?.abort(new Error("Batch cancelled"));
    this.preparation?.abort(new Error("Batch cancelled"));
  }

  protected updateStats(type: "pass" | "error") {
    this.stats[type]++;
    this.stats.current++;
    this.updateProgress(this.stats.current, this.stats.total);
  }

  protected updateProgress(current: number, total: number) {
    const now = Date.now();
    if (this.lastProgressPhase === this.stats.phase && current > 0 && current < total && now - this.lastProgressTime < 100)
      return;
    this.lastProgressTime = now;
    this.lastProgressPhase = this.stats.phase;
    try {
      this.ui.updateProgress(current, total, this.stats.phase);
    }
    catch (error) {
      logger.error("Failed to update batch progress:", error);
    }
  }

  protected initStats() {
    this.cancelled = false;
    this.saved = 0;
    this.preparationFailed = 0;
    this.lastProgressTime = 0;
    this.lastProgressPhase = undefined;
    this.checkpoint = createWorkCheckpoint();
    this.failedItems.clear();
    this.changes = [];
    this.itemBaselines.clear();
    this.savedValues.clear();
    this.applicableIDs.clear();
    this.processedIDs.clear();
    if (!this.stats.startTime)
      this.stats.startTime = Date.now();
    logger.debug(`Add tasks at ${new Date().toLocaleTimeString()}`);
  }

  protected finish(silent: boolean, items: Zotero.Item[], history: boolean) {
    if (this.stats.startTime === this.emptyStats().startTime)
      return;

    const duration = (Date.now() - this.stats.startTime) / 1000;
    const changedIDs = new Set(this.changes.map(change => change.itemID));
    const changed = changedIDs.size;
    this.lastResult = {
      itemOutcomes: items.map(item => ({ itemID: item.id, processed: this.processedIDs.has(item.id), saved: this.savedValues.has(item.id), failed: this.failedItems.has(item.id || item), changed: changedIDs.has(item.id), applicable: this.applicableIDs.has(item.id) })),
      durationMs: Math.round(duration * 1000),
      total: this.stats.total,
      processed: this.stats.current,
      passed: this.stats.current - this.failedItems.size,
      failed: this.failedItems.size,
      saved: this.saved,
      cancelled: this.cancelled,
      skipped: this.stats.total - this.stats.current,
      preparationFailed: this.preparationFailed,
      records: [...this.stats.records],
      changes: this.changes.map(change => ({ ...change, saved: this.savedValues.has(change.itemID) && JSON.stringify(this.savedValues.get(change.itemID)![change.field] ?? null) === JSON.stringify(change.after) })),
      changed,
      unchanged: this.stats.current - changed,
      notApplicable: this.stats.current - this.applicableIDs.size,
      warnings: this.stats.records.filter(record => record.level === "warning").length,
    };
    if (history)
      recordRuntimeResult(this.lastResult);
    // Release batch state before opening UI, which may fail when a window closes.
    this.modifiedItems.clear();
    this.itemBaselines.clear();
    this.savedValues.clear();
    this.changes = [];
    DataLoader.clearBatchCache();
    this.stats = this.emptyStats();
    logger.debug(`Batch tasks completed in ${duration}s`);
    if (addon.data.alive) {
      try {
        this.ui.showFinished(this.lastResult.passed, this.lastResult.failed, duration, this.cancelled, this.lastResult.skipped, this.preparationFailed, this.lastResult);
        updateBatchFeedback(this.lastResult);
      }
      catch (error) {
        logger.error("Failed to display batch results:", error);
      }
    }
  }

  protected emptyStats(): RunnerStats {
    return {
      total: 0,
      current: 0,
      pass: 0,
      error: 0,
      startTime: 0,
      records: [],
      phase: "idle",
    };
  }
}
