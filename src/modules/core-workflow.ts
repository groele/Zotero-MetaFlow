import type { CoreCommand, CoreStage } from "../utils/core-workflow";
import type { BatchResult } from "./runner";
import { coreWorkflowPlan } from "../utils/core-workflow";
import { getJournalInsights } from "../utils/journal-insights";
import { hasEnabledJournalMetrics } from "../utils/journal-permissions";
import { getString } from "../utils/locale";
import { createLogger } from "../utils/logger";
import { getPref } from "../utils/prefs";
import { recordRuntimeResult } from "../utils/runtime-data-storage";
import { REMOTE_STANDARD_RULES } from "../utils/workflow-policy";
import { combineWorkflowResults, CoreWorkflowQueue } from "../utils/workflow-result";
import { showCoreCompletionToast, updateBatchFeedback } from "./batch-feedback";
import { inspectItemDefects } from "./item-diagnostics";
import { refreshJournalPane, setJournalUpdateResult } from "./journal-pane";
import { runReviewCommand } from "./review";
import { Rules } from "./rules";
import { ToolUpdateEasyScholar } from "./rules/tool-update-easyscholar";

export function localDOICheck() {
  return {
    ...Rules.getByID("require-doi")!,
    cooldown: 0,
    apply({ item, report }: Parameters<typeof ToolUpdateEasyScholar.apply>[0]) {
      const defects = inspectItemDefects(item);
      if (!defects.length)
        return;
      for (const defect of defects) {
        report({
          level: defect.level === "suggestion" ? "info" : defect.level,
          code: defect.code,
          field: defect.field,
          message: defect.message,
          action: defect.fixAction
            ? {
                label: defect.fixAction === "update" ? getString("rule-tool-update-metadata-menu-item") : getString("menuitem-stdFormatFlow"),
                callback: async () => {
                  const current = Zotero.Items.get(item.id);
                  if (current && !current.deleted) {
                    if (defect.fixAction === "update")
                      await addon.hooks.onLintInBatch("tool-update-metadata", [current], { review: true });
                    else
                      await addon.hooks.onLintInBatch("standard", [current], { core: true });
                  }
                },
              }
            : undefined,
        });
      }
    },
  };
}

const queue = new CoreWorkflowQueue<BatchResult | undefined>();

export async function stopCoreWorkflows() {
  addon.data.activeCoreWorkflow?.cancel();
  await queue.drain();
}

export function runCoreWorkflow(command: CoreCommand, items: Zotero.Item[]) {
  const selected = [...new Map(items.filter(item => item?.id && item.isRegularItem() && !item.deleted && item.isEditable()).map(item => [item.id, item])).values()];
  const key = `${command}:${selected.map(item => item.id).sort((a, b) => a - b).join(",")}`;
  return queue.add(key, () => executeWorkflow(command, selected));
}

async function executeWorkflow(command: CoreCommand, items: Zotero.Item[]) {
  items = items.filter(item => !item.deleted && item.isEditable());
  if (!items.length || !addon.data.alive)
    return;
  const pref = (key: string, fallback: boolean) => getPref(key as any, fallback) === true;
  const options = {
    checkMetadata: false,
    checkAuthors: false,
    checkJournal: false,
    checkDuplicates: pref("workflow.reviewDuplicatesOnCheck", false),
    updateMetadata: pref("workflow.updateBibliographic", true),
    updateFormat: pref("workflow.formatAfterUpdate", true),
    updateJournal: pref("metadata.updateJournalInfo", true),
    updateDuplicates: pref("workflow.reviewDuplicatesOnUpdate", false),
  };
  const stages: { stage: CoreStage; result: BatchResult }[] = [];
  const plan = coreWorkflowPlan(command, options);
  const Controller = (typeof Zotero !== "undefined" && typeof Zotero.getMainWindow === "function" && (Zotero.getMainWindow() as any)?.AbortController) || AbortController;
  const controller = new Controller();
  const state = { command, stage: undefined as CoreStage | undefined, index: 0, total: plan.length, cancelled: false, cancel: () => {
    state.cancelled = true;
    controller.abort(new Error("Core workflow cancelled"));
  } };
  const started = Date.now();
  const overwrite = getPref("rule.tool-update-metadata.option.mode") === "all";
  const reviewOptions = {
    scanPDF: pref("workflow.scanPDF", false),
    searchTitle: pref("workflow.searchTitle", false),
    repairCreators: pref("metadata.repairCreators", true),
    reviveSnapshots: pref("workflow.reviveSnapshots", true),
    overwrite,
    history: false,
    signal: controller.signal,
  };
  const updateVersions = command === "update" && pref("workflow.updateVersions", false);
  const skipDuplicates = command === "update" || options.checkDuplicates;
  const localRules = Rules.getEnabledStandard().filter(rule => !REMOTE_STANDARD_RULES.has(rule.id) && !(skipDuplicates && rule.id === "no-item-duplication"));
  if (pref("rule.require-doi", true))
    localRules.push(localDOICheck());
  const run = async (stage: CoreStage) => {
    const current = items.filter(item => !item.deleted && item.isEditable());
    if (!current.length)
      return;
    if (stage === "metadata" || stage === "authors") {
      return runReviewCommand("tool-review-metadata", current, stage === "metadata" && updateVersions, {
        ...reviewOptions,
        creatorsOnly: stage === "authors",
        repairCreators: stage === "authors" || reviewOptions.repairCreators,
      });
    }
    if (stage === "format") {
      if (localRules.length)
        return addon.runner.add({ items: current, rules: localRules, silent: true, history: false, signal: controller.signal });
    }
    if (stage === "journal" && hasEnabledJournalMetrics()) {
      const journals = current.filter(item => ["journalArticle", "conferencePaper"].includes(item.itemType));
      if (!journals.length)
        return;
      const mode = overwrite ? "all" : "blank";
      const result = await addon.runner.add({ items: journals, rules: [{ ...ToolUpdateEasyScholar, prepare: () => ({ mode }) }], silent: true, history: false, signal: controller.signal });
      try {
        if (addon.data.alive && !state.cancelled && !result?.cancelled) {
          const unique = [...new Map(journals.filter(item => !item.deleted && item.itemType === "journalArticle").map(item => [JSON.stringify(["publicationTitle", "ISSN", "journalAbbreviation"].map(field => item.getField(field as any))), item])).values()];
          let next = 0;
          const warm = async () => {
            while (addon.data.alive && !state.cancelled && next < unique.length)
              await getJournalInsights(unique[next++], { queryAPI: true, signal: controller.signal });
          };
          const warming = await Promise.allSettled(Array.from({ length: Math.min(4, unique.length) }, warm));
          for (const outcome of warming) {
            if (outcome.status === "rejected" && result && !state.cancelled) {
              result.records.push({ itemID: 0, title: "", ruleID: "tool-update-easyscholar", code: "journal-refresh-failed", level: "warning", message: String(outcome.reason) });
              result.warnings++;
            }
          }
          if (addon.data.alive && !state.cancelled) {
            Zotero.ItemTreeManager.refreshColumns();
            setJournalUpdateResult(journals.map(item => item.id), result);
            await refreshJournalPane(journals.map(item => item.id));
          }
        }
      }
      catch (error) {
        createLogger("core-workflow").error("Cannot refresh journal feedback", error);
        if (result) {
          result.records.push({ itemID: 0, title: "", ruleID: "tool-update-easyscholar", code: "journal-refresh-failed", level: "warning", message: getString("journal-rankings-refresh-failed") });
          result.warnings++;
        }
      }
      return result;
    }
    if (stage === "duplicates")
      return runReviewCommand("tool-review-duplicates", current, false, { history: false, signal: controller.signal });
  };
  addon.data.activeCoreWorkflow = state;
  updateBatchFeedback();
  let failure: unknown;
  try {
    for (const [index, stage] of plan.entries()) {
      if (!addon.data.alive || state.cancelled)
        break;
      state.stage = stage;
      state.index = index + 1;
      updateBatchFeedback();
      const result = await run(stage);
      if (result)
        stages.push({ stage, result });
      if (result?.cancelled) {
        state.cancelled = true;
        break;
      }
    }
  }
  catch (error) {
    failure = error;
  }
  finally {
    addon.data.activeCoreWorkflow = undefined;
  }
  const result = combineWorkflowResults(items.map(item => item.id), stages.map(stage => stage.result), Date.now() - started, state.cancelled);
  if (failure) {
    result.preparationFailed++;
    result.records.push({ itemID: 0, title: "", ruleID: "tool-update-metadata", code: "workflow-stage-failed", level: "error", message: String(failure) });
  }
  recordRuntimeResult(result, `core-${command}`);
  if (addon.data.alive) {
    addon.runner.lastResult = result;
    addon.data.lastCoreWorkflow = { lastResult: result, stages };
    showCoreCompletionToast(result);
    updateBatchFeedback(result);
  }
  return result;
}
