import type { Arrayable } from "../utils/types";
import type { Rule } from "./rules/rule-base";
import type { BatchResult } from "./runner/types";
import { toArray } from "../utils/general";
import { isWritableItem } from "../utils/item-write-policy";
import { createLogger } from "../utils/logger";
import { getPref } from "../utils/prefs";
import { normalizedConcurrency } from "../utils/rule-execution";
import { ruleSupportsItems } from "../utils/workflow-policy";

import { createAbortController } from "./runner/execution";
import { BatchPersistence } from "./runner/persistence";

export type { BatchResult } from "./runner/types";

const logger = createLogger("Runner");

export class LintRunner extends BatchPersistence {
  private runningQueue: Promise<void> = Promise.resolve();

  public async stop(): Promise<void> {
    this.cancel();
    try {
      await this.runningQueue;
    }
    catch (error) {
      logger.error("Batch failed before shutdown:", error);
    }
    finally {
      this.ui.close();
    }
  }

  public async add(params: {
    items: Arrayable<Zotero.Item>;
    rules: Arrayable<Rule<any>>;
    silent?: boolean;
    history?: boolean;
    signal?: AbortSignal;
  }): Promise<BatchResult | undefined> {
    const batch = { ...params, items: [...toArray(params.items)], rules: [...toArray(params.rules)] };
    let result: BatchResult | undefined;
    const task = async () => {
      if (!addon.data.alive)
        return;
      await this.runBatch(batch);
      result = this.lastResult;
    };
    this.runningQueue = this.runningQueue.then(task, task);
    await this.runningQueue;
    return result;
  }

  /** Native merge/create operations share the same queue and shutdown cancellation as rules. */
  public async exclusive<T>(operation: (signal: AbortSignal) => Promise<T>, owner?: AbortSignal): Promise<T | undefined> {
    let result: T | undefined;
    const task = async () => {
      if (!addon.data.alive || owner?.aborted)
        return;
      this.cancelled = false;
      const controller = createAbortController();
      const abort = () => controller.abort(owner?.reason);
      owner?.addEventListener("abort", abort, { once: true });
      this.preparation = controller;
      try {
        result = await operation(controller.signal);
      }
      finally {
        owner?.removeEventListener("abort", abort);
        if (this.preparation === controller)
          this.preparation = undefined;
      }
    };
    const pending = this.runningQueue.then(task, task);
    this.runningQueue = pending.then(() => {}, () => {});
    await pending;
    return result;
  }

  private async runBatch(params: {
    items: Arrayable<Zotero.Item>;
    rules: Arrayable<Rule<any>>;
    silent?: boolean;
    history?: boolean;
    signal?: AbortSignal;
  }): Promise<void> {
    const { items: _items, rules: _rules, silent = false } = params;
    const items = [...new Map(toArray(_items).filter(item => item?.isRegularItem() && isWritableItem(item)).map(item => [item.id || item, item])).values()];

    this.initStats();
    this.execution = createAbortController();
    const abort = () => this.cancel();
    params.signal?.addEventListener("abort", abort, { once: true });
    if (params.signal?.aborted)
      abort();
    try {
      try {
        await this.ui.init(silent);
      }
      catch (error) {
        logger.error("Failed to initialize batch progress:", error);
        this.ui.close();
      }

      const rules = [...new Map(toArray(_rules).map(rule => [rule.id, rule])).values()];

      this.stats.phase = "idle";
      this.updateProgress(0, items.length);

      this.stats.total = items.length;
      if (!items.length || !rules.length || this.cancelled)
        return;
      const optionsMap = await this.prepareRules(rules, items);
      const hasActiveRules = [...optionsMap.values()].some(opt => opt !== false);

      if (!hasActiveRules && !this.cancelled && rules.every(rule => !ruleSupportsItems(rule, items))) {
        this.stats.current = items.length;
        items.forEach(item => this.processedIDs.add(item.id));
      }

      if (items.length === 0 || !hasActiveRules) {
        return;
      }

      this.stats.phase = "linting";
      this.updateProgress(this.stats.current, this.stats.total);

      let next = 0;
      const worker = async () => {
        while (!this.cancelled && next < items.length) {
          await this.checkpoint();
          if (this.cancelled || next >= items.length)
            break;
          const item = items[next++];
          try {
            await this.lintItem(item, rules, optionsMap);
          }
          catch (error) {
            this.failedItems.add(item.id || item);
            logger.error(error);
          }
          this.processedIDs.add(item.id);
          this.updateStats(this.failedItems.has(item.id || item) ? "error" : "pass");
        }
      };
      await Promise.all(Array.from({ length: Math.min(items.length, normalizedConcurrency(getPref("lint.numConcurrent"))) }, worker));
      await this.batchSave();
    }
    finally {
      params.signal?.removeEventListener("abort", abort);
      this.execution = undefined;
      this.finish(silent, items, params.history !== false);
    }
  }
}
