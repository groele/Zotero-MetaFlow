import type { BatchResult } from "../services/lint/runner";
import { expect, it, vi } from "vitest";
import { createAutomaticWorkflow, runAutomaticWorkflow } from "./automatic-workflow";

const result = (cancelled = false) => ({ saved: 2, changed: 2, failed: 0, warnings: 1, preparationFailed: 0, cancelled }) as BatchResult;

it("records separate stage results and stops later stages after cancellation", async () => {
  const workflow = createAutomaticWorkflow();
  const format = vi.fn();
  await runAutomaticWorkflow(workflow, { metadata: async () => result(true), format, journal: vi.fn() }, () => true);
  expect(workflow.stages.map(stage => stage.status)).toEqual(["cancelled", "skipped", "skipped"]);
  expect(workflow.stages[0].saved).toBe(2);
  expect(format).not.toHaveBeenCalled();
  expect(workflow.undoScope).toBe("stage");
  expect(workflow.finishedAt).toBeDefined();
});

it("marks disabled stages as skipped and preserves the completed stage summary", async () => {
  const workflow = createAutomaticWorkflow();
  await runAutomaticWorkflow(workflow, { metadata: async () => undefined, format: async () => result(), journal: async () => undefined }, () => true);
  expect(workflow.stages.map(stage => stage.status)).toEqual(["skipped", "complete", "skipped"]);
  expect(workflow.stages[1].warnings).toBe(1);
});

it("finishes the workflow record and skips remaining stages after an unexpected error", async () => {
  const workflow = createAutomaticWorkflow();
  await expect(runAutomaticWorkflow(workflow, { metadata: async () => {
    throw new Error("failure");
  }, format: vi.fn(), journal: vi.fn() }, () => true)).rejects.toThrow("failure");
  expect(workflow.stages.map(stage => stage.status)).toEqual(["failed", "skipped", "skipped"]);
  expect(workflow.finishedAt).toBeDefined();
});
