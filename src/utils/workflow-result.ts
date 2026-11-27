import type { BatchResult } from "../services/lint/runner";

/** Item counts describe the complete workflow; stage evidence keeps execution order. */
export function combineWorkflowResults(itemIDs: number[], results: BatchResult[], durationMs: number, cancelled = false): BatchResult {
  const outcomes = new Map<number, NonNullable<BatchResult["itemOutcomes"]>[number]>();
  for (const itemID of itemIDs)
    outcomes.set(itemID, { itemID, processed: false, saved: false, failed: false, changed: false, applicable: false });
  for (const result of results) {
    for (const next of result.itemOutcomes || []) {
      const previous = outcomes.get(next.itemID);
      outcomes.set(next.itemID, previous ? { itemID: next.itemID, processed: previous.processed || next.processed, saved: previous.saved || next.saved, failed: previous.failed || next.failed, changed: previous.changed || next.changed, applicable: previous.applicable || next.applicable } : { ...next });
    }
  }
  const items = [...outcomes.values()];
  const processed = items.filter(item => item.processed).length;
  const failed = items.filter(item => item.failed).length;
  const records = results.flatMap(result => result.records);
  return {
    itemOutcomes: items,
    total: items.length,
    processed,
    passed: items.filter(item => item.processed && !item.failed).length,
    failed,
    saved: items.filter(item => item.saved).length,
    cancelled: cancelled || results.some(result => result.cancelled),
    skipped: items.length - processed,
    preparationFailed: results.reduce((sum, result) => sum + result.preparationFailed, 0),
    records,
    changes: results.flatMap(result => result.changes),
    changed: items.filter(item => item.changed).length,
    unchanged: items.filter(item => item.processed && !item.changed).length,
    notApplicable: items.filter(item => item.processed && !item.applicable).length,
    warnings: records.filter(record => record.level === "warning").length,
    durationMs,
  };
}

/** Serialize complete core commands while sharing repeated requests for the same selection. */
export class CoreWorkflowQueue<T> {
  private tail = Promise.resolve();
  private pending = new Map<string, Promise<T>>();

  public async drain(): Promise<void> {
    await this.tail;
  }

  public add(key: string, run: () => Promise<T>): Promise<T> {
    const existing = this.pending.get(key);
    if (existing)
      return existing;
    const task = this.tail.then(run).finally(() => this.pending.delete(key));
    this.pending.set(key, task);
    this.tail = task.then(() => {}, () => {});
    return task;
  }
}
