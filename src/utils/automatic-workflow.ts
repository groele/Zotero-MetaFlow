import type { BatchResult } from "../services/lint/runner";

export type AutomaticPhase = "metadata" | "format" | "journal";
export interface AutomaticWorkflow {
  startedAt: number;
  finishedAt?: number;
  undoScope: "stage";
  stages: {
    phase: AutomaticPhase;
    status: "pending" | "running" | "complete" | "failed" | "cancelled" | "skipped";
    saved?: number;
    failed?: number;
    changed?: number;
    warnings?: number;
  }[];
}

export function createAutomaticWorkflow(): AutomaticWorkflow {
  return { startedAt: Date.now(), undoScope: "stage", stages: (["metadata", "format", "journal"] as const).map(phase => ({ phase, status: "pending" })) };
}

export async function runAutomaticWorkflow(workflow: AutomaticWorkflow, stages: Record<AutomaticPhase, () => Promise<BatchResult | undefined>>, shouldContinue: () => boolean) {
  let cancelled = false;
  try {
    for (const stage of workflow.stages) {
      if (cancelled || !shouldContinue()) {
        stage.status = "skipped";
        continue;
      }
      stage.status = "running";
      try {
        const result = await stages[stage.phase]();
        stage.status = !result ? "skipped" : result.cancelled ? "cancelled" : result.failed || result.preparationFailed ? "failed" : "complete";
        if (result) {
          Object.assign(stage, { saved: result.saved, failed: result.failed, changed: result.changed, warnings: result.warnings });
          cancelled = result.cancelled;
        }
      }
      catch (error) {
        stage.status = "failed";
        throw error;
      }
    }
  }
  finally {
    for (const stage of workflow.stages) {
      if (stage.status === "pending")
        stage.status = "skipped";
    }
    workflow.finishedAt = Date.now();
  }
}
