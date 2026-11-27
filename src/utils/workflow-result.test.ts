import type { BatchResult } from "../services/lint/runner";
import { describe, expect, it } from "vitest";
import { combineWorkflowResults, CoreWorkflowQueue } from "./workflow-result";

const batch = (items: NonNullable<BatchResult["itemOutcomes"]>, overrides: Partial<BatchResult> = {}): BatchResult => ({ total: items.length, processed: items.length, passed: items.length, failed: 0, saved: 0, cancelled: false, skipped: 0, preparationFailed: 0, records: [], changes: [], changed: 0, unchanged: 0, notApplicable: 0, warnings: 0, itemOutcomes: items, ...overrides });
const outcome = (itemID: number, saved = false) => ({ itemID, processed: true, saved, changed: saved, failed: false, applicable: true });

describe("whole-command results and scheduling", () => {
  it("drains queued commands and their failure cleanup before shutdown completes", async () => {
    const queue = new CoreWorkflowQueue<void>();
    let release!: () => void;
    const gate = new Promise<void>(resolve => release = resolve);
    const first = queue.add("first", async () => gate);
    const second = queue.add("second", async () => {
      throw new Error("failed");
    });
    const rejection = expect(second).rejects.toThrow("failed");
    let drained = false;
    const pending = queue.drain().then(() => drained = true);
    await Promise.resolve();
    expect(drained).toBe(false);
    release();
    await Promise.all([first, rejection, pending]);
    expect(drained).toBe(true);
  });

  it("counts each item once while retaining every stage's evidence and errors", () => {
    const metadata = batch([{ ...outcome(1, true), failed: true }, outcome(2)], { records: [{ itemID: 1, title: "", ruleID: "metadata", level: "warning", message: "warning" }], changes: [{ itemID: 1, ruleID: "metadata", field: "date", before: "", after: "2026", saved: true }] });
    const formatting = batch([outcome(1, true), outcome(2, true)], { changes: [{ itemID: 1, ruleID: "format", field: "title", before: "A.", after: "A", saved: true }] });
    const result = combineWorkflowResults([1, 2], [metadata, formatting], 100);
    expect(result).toMatchObject({ total: 2, processed: 2, saved: 2, failed: 1, passed: 1, changed: 2, warnings: 1, durationMs: 100 });
    expect(result.changes.map(change => change.field)).toEqual(["date", "title"]);
    expect(metadata.itemOutcomes![0].saved).toBe(true);
  });
  it("includes duplicate candidates outside the selection and preserves cancelled skips", () => {
    const result = combineWorkflowResults([1, 2], [batch([outcome(1, true), outcome(3, true)], { cancelled: true, preparationFailed: 1 })], 5);
    expect(result).toMatchObject({ total: 3, processed: 2, saved: 2, skipped: 1, cancelled: true, preparationFailed: 1 });
  });
  it("represents a disabled workflow without stale previous results", () => {
    expect(combineWorkflowResults([1], [], 0)).toMatchObject({ total: 1, processed: 0, saved: 0, skipped: 1, records: [], changes: [] });
  });
  it("serializes whole commands, coalesces repeated clicks and recovers after failure", async () => {
    const queue = new CoreWorkflowQueue<string>();
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>(resolve => release = resolve);
    const first = queue.add("check:1", async () => {
      order.push("check-start");
      await gate;
      order.push("check-end");
      return "checked";
    });
    const again = queue.add("check:1", async () => "duplicate");
    expect(again).toBe(first);
    const second = queue.add("update:1", async () => {
      order.push("update");
      throw new Error("failed");
    });
    const rejected = expect(second).rejects.toThrow("failed");
    const third = queue.add("check:2", async () => {
      order.push("recovered");
      return "done";
    });
    await Promise.resolve();
    expect(order).toEqual(["check-start"]);
    release();
    await first;
    await rejected;
    await expect(third).resolves.toBe("done");
    expect(order).toEqual(["check-start", "check-end", "update", "recovered"]);
  });
});
