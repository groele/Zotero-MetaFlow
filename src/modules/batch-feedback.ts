import type { BatchResult } from "./runner";
import { getString } from "../utils/locale";
import { createLogger } from "../utils/logger";
import { preferenceListeners } from "../utils/preference-listeners";
import { getPref } from "../utils/prefs";
import { RUNTIME_HISTORY_BYTES, RUNTIME_HISTORY_LIMIT, RUNTIME_HISTORY_TTL } from "../utils/runtime-data-policy";
import { flushRuntimeData, readRuntimeData, runtimeDataPath } from "../utils/runtime-data-storage";
import { configureCompletionNotice } from "./completion-notice";
import { createReporter, ProgressUI } from "./reporter";

const logger = createLogger("batch-feedback");
let coreProgress: ProgressUI | undefined;
let progressState: typeof addon.data.activeCoreWorkflow;

function reportDetails(result: BatchResult) {
  return { records: result.records, changes: result.changes };
}

export function updateBatchFeedback(result?: BatchResult) {
  try {
    renderBatchFeedback(result);
  }
  catch (error) {
    logger.error("Cannot refresh batch feedback", error);
  }
}

function renderBatchFeedback(result?: BatchResult) {
  result ||= addon.runner?.lastResult;
  const active = addon.data.activeCoreWorkflow;
  const doc = addon.data.prefs?.window.document;
  const status = doc?.getElementById("metaref-last-batch-status");
  const button = doc?.getElementById("metaref-last-batch-report") as HTMLButtonElement | null;
  if (status) {
    const workflow = addon.data.lastCoreWorkflow;
    status.textContent = active
      ? coreProgressText()
      : result && workflow?.lastResult === result
        ? coreResultText(result)
        : result ? getString("batch-feedback-summary", { args: { total: result.total, saved: result.saved, failed: result.failed, warnings: result.warnings } }) : getString("batch-feedback-empty");
  }
  if (button) {
    const details = result && reportDetails(result);
    button.disabled = Boolean(active) || !details || (!details.records.length && !details.changes.length);
  }
  updateCoreFeedback();
}

function coreProgressText() {
  const state = addon.data.activeCoreWorkflow!;
  return getString(state.cancelled ? "core-task-stopping" : "core-task-running", { args: { command: getString(`core-task-${state.command}`), stage: getString(`core-task-${state.stage || "preparing"}`), index: state.index, total: state.total } });
}

function coreResultText(result: BatchResult) {
  const stages = addon.data.lastCoreWorkflow?.stages.length || 0;
  return `${getString(result.cancelled ? "core-feedback-cancelled" : result.preparationFailed || result.failed ? "core-feedback-errors" : stages ? "core-feedback-completed" : "core-feedback-empty", { args: { stages } })} ${getString("batch-feedback-summary", { args: { total: result.total, saved: result.saved, failed: result.failed, warnings: result.warnings } })}`;
}

export function closeCoreFeedback() {
  coreProgress?.close();
  coreProgress = undefined;
  progressState = undefined;
  for (const win of Zotero.getMainWindows())
    win.document.getElementById("metaref-core-task")?.remove();
}

export function showCoreCompletionToast(result: BatchResult) {
  if (!getPref("lint.notify")) {
    closeCoreFeedback();
    return;
  }
  const outcome = result.cancelled
    ? getString("core-task-stopped")
    : result.failed || result.preparationFailed
      ? getString("core-task-attention")
      : !addon.data.lastCoreWorkflow?.stages.length
          ? getString("core-task-no-stages")
          : getString("core-task-finished");
  const summary = getString("batch-feedback-summary", { args: { total: result.total, saved: result.saved, failed: result.failed, warnings: result.warnings } });
  try {
    const openReport = () => createReporter(result.records, result.changes, `${outcome} · ${summary}`);
    if (coreProgress?.showCoreFinished(`${outcome} · ${summary}`, Boolean(result.failed || result.preparationFailed), openReport)) {
      coreProgress = undefined;
      progressState = undefined;
      return;
    }
    // If the running toast could not be converted in place (for example it
    // was closed while initialization was still settling), close its tracked
    // window before creating the fallback completion notice.
    closeCoreFeedback();
    const notice = new ztoolkit.ProgressWindow(addon.data.config.addonName, { closeOnClick: false, closeTime: -1 })
      .createLine({ type: result.failed || result.preparationFailed ? "fail" : "default", text: `${outcome} · ${summary}`, progress: 100, idx: 0 })
      .show();
    void configureCompletionNotice(notice, openReport);
  }
  catch (error) {
    logger.error("Cannot show core workflow completion toast", error);
  }
}

function updateCoreFeedback() {
  // Remove bars left by earlier versions, including in secondary main windows.
  for (const win of Zotero.getMainWindows())
    win.document.getElementById("metaref-core-task")?.remove();
  const state = addon.data.activeCoreWorkflow;
  if (!state) {
    closeCoreFeedback();
    return;
  }
  if (progressState !== state) {
    closeCoreFeedback();
    progressState = state;
    const progress = coreProgress = new ProgressUI({ onCancel: () => {
      state.cancel();
      updateBatchFeedback();
    } });
    void progress.init(false, coreProgressText()).then(() => {
      if (coreProgress === progress && addon.data.activeCoreWorkflow === state)
        progress.updateCoreProgress(coreProgressText());
    }).catch((error) => {
      progress.close();
      logger.error("Cannot show core workflow progress", error);
    });
  }
  coreProgress?.updateCoreProgress(coreProgressText());
}

export function setupBatchFeedback(pane: Element) {
  const policy = pane.querySelector("#metaref-runtime-data-policy");
  if (policy)
    policy.textContent = getString("runtime-data-policy", { args: { days: RUNTIME_HISTORY_TTL / 86_400_000, count: RUNTIME_HISTORY_LIMIT, size: RUNTIME_HISTORY_BYTES / 1024 / 1024 } });
  const report = pane.querySelector("#metaref-last-batch-report");
  if (report && !pane.querySelector("#metaref-runtime-data-open")) {
    const open = ztoolkit.UI.createElement(pane.ownerDocument!, "button", { attributes: { type: "button" }, properties: { id: "metaref-runtime-data-open", textContent: getString("runtime-data-open") } });
    report.after(open);
    preferenceListeners(pane)(open, "click", async () => {
      try {
        await readRuntimeData();
        await flushRuntimeData();
        await Zotero.File.reveal(runtimeDataPath());
      }
      catch (error) { logger.error("Cannot open runtime data", error); }
    });
  }

  updateBatchFeedback(addon.runner.lastResult);
  const button = pane.querySelector("#metaref-last-batch-report");
  if (button) {
    preferenceListeners(pane)(button, "command", () => {
      const result = addon.runner.lastResult;
      const details = result && reportDetails(result);
      if (details && (details.records.length || details.changes.length))
        void createReporter(details.records, details.changes).catch(error => logger.error(error));
    });
  }
}
