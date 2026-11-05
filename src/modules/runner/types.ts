import type { FieldChange, ReportInfo } from "../reporter";

export interface RunnerStats {
  total: number;
  current: number;
  pass: number;
  error: number;
  startTime: number;
  records: ReportInfo[];
  phase: "idle" | "linting" | "saving";
}

export interface BatchResult {
  itemOutcomes?: { itemID: number; processed: boolean; saved: boolean; failed: boolean; changed: boolean; applicable: boolean }[];
  durationMs?: number;
  total: number;
  processed: number;
  passed: number;
  failed: number;
  saved: number;
  cancelled: boolean;
  skipped: number;
  preparationFailed: number;
  records: ReportInfo[];
  changes: FieldChange[];
  changed: number;
  unchanged: number;
  notApplicable: number;
  warnings: number;
}
