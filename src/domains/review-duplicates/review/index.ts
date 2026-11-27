import type { ReviewCommand } from "../../../kernel/domain-ports";
import type { ReviewFeatures } from "../../../services/metadata/review-rules";
import { REVIEW_COMMANDS } from "../../../kernel/domain-ports";
import {
  emptyReviewResult,
  publishReviewResult,
  runMetadataReview,
  ToolReviewDuplicates,
  ToolReviewMetadata,
  ToolReviewPreprint,
} from "../../../services/metadata/review-rules";
import { isWritableItem } from "../../../utils/item-write-policy";
import { getString } from "../../../utils/locale";
import { chooseDuplicateBatch, runDuplicateBatch } from "./bulk-review";
import { applyDuplicateDecision, findDuplicates, reviewDuplicate } from "./duplicates";

export {
  REVIEW_COMMANDS,
  type ReviewCommand,
  ToolReviewDuplicates,
  ToolReviewMetadata,
  ToolReviewPreprint,
};

export async function runReviewCommand(
  command: ReviewCommand,
  items: Zotero.Item[],
  integrated = false,
  features: ReviewFeatures = {},
) {
  const eligible = [
    ...new Map(
      items
        .filter(item => item.id && item.isRegularItem() && isWritableItem(item))
        .map(item => [item.id, item]),
    ).values(),
  ];
  if (!eligible.length)
    return;
  if (command !== "tool-review-duplicates")
    return runMetadataReview(command, eligible, integrated, features);

  return addon.runner.exclusive(async (signal) => {
    const result = emptyReviewResult(eligible.length);
    const processed = new Set<number>();
    const failed = new Set<number>();
    const saved = new Set<number>();
    const touched = new Set<number>();
    const candidates = new Set(eligible.map(item => item.id));
    try {
      let pairs = await findDuplicates(eligible, signal, true);
      pairs.forEach(pair => [pair.left.id, pair.right.id].forEach(id => candidates.add(id)));
      result.total = pairs.length ? new Set(pairs.flatMap(pair => [pair.left.id, pair.right.id])).size : eligible.length;
      if (!pairs.length) {
        result.notApplicable = eligible.length;
        result.records.push({
          itemID: eligible[0].id,
          title: eligible[0].getDisplayTitle(),
          ruleID: command,
          level: "info",
          message: getString("review-no-duplicates"),
        });
      }
      if (pairs.length > 1) {
        const selected = await chooseDuplicateBatch(pairs, signal);
        if (selected === false) {
          result.cancelled = true;
          pairs = [];
        }
        else if (selected !== "individual") {
          const batch = await runDuplicateBatch(selected, signal);
          batch.processedIDs.forEach(id => processed.add(id));
          batch.savedIDs.forEach(id => saved.add(id));
          batch.failedIDs.forEach(id => failed.add(id));
          result.cancelled = batch.cancelled;
          for (const itemID of new Set(batch.processedIDs)) {
            const outcome = saved.has(itemID) ? "merged" : failed.has(itemID) ? "failed" : "skipped";
            result.records.push({
              itemID,
              title: "",
              ruleID: command,
              code: `duplicate-${outcome}`,
              level: outcome === "failed" ? "error" : "info",
              message: getString(outcome === "merged" ? "review-result-merged" : "review-skipped"),
            });
          }
          result.records.push({
            itemID: eligible[0].id,
            title: eligible[0].getDisplayTitle(),
            ruleID: command,
            level: batch.errors.length ? "error" : "info",
            message: getString("duplicates-bulk-status", {
              args: { completed: batch.completed, total: batch.total, merged: batch.merged, failed: batch.errors.length },
            }),
          });
          for (const message of batch.errors)
            result.records.push({ itemID: 0, title: "", ruleID: command, level: "error", message });
          pairs = [];
        }
      }
      for (const pair of pairs) {
        signal.throwIfAborted();
        if (touched.has(pair.left.id) || touched.has(pair.right.id))
          continue;
        const decision = await reviewDuplicate(pair, signal);
        if (!decision) {
          result.cancelled = true;
          break;
        }
        processed.add(pair.left.id);
        processed.add(pair.right.id);
        try {
          const outcome = await applyDuplicateDecision(decision, signal);
          if (outcome === "merged" || outcome === "related") {
            for (const id of [pair.left.id, pair.right.id]) {
              touched.add(id);
              saved.add(id);
            }
          }
          const message = `${pair.left.id} / ${pair.right.id}: ${getString(outcome === "skipped" ? "review-skipped" : `review-result-${outcome}`)}`;
          result.records.push({
            itemID: decision.masterID,
            title: String(pair.left.data.title || ""),
            ruleID: command,
            code: `duplicate-${outcome}`,
            level: "info",
            message,
          });
          if (outcome === "merged" || outcome === "related") {
            const other = decision.masterID === pair.left.id ? pair.right : pair.left;
            result.records.push({
              itemID: other.id,
              title: String(other.data.title || ""),
              ruleID: command,
              code: `duplicate-${outcome}`,
              level: "info",
              message,
            });
          }
        }
        catch (error) {
          signal.throwIfAborted();
          failed.add(pair.left.id);
          failed.add(pair.right.id);
          const message = `${pair.left.id} / ${pair.right.id}: ${String(error)}`;
          result.records.push({ itemID: pair.left.id, title: String(pair.left.data.title || ""), ruleID: command, level: "error", message });
        }
      }
    }
    catch (error) {
      if (signal.aborted) {
        result.cancelled = true;
      }
      else {
        result.preparationFailed++;
        result.records.push({ itemID: 0, title: "", ruleID: command, level: "error", message: String(error) });
      }
    }
    finally {
      result.itemOutcomes = [...candidates].map(itemID => ({
        itemID,
        processed: processed.has(itemID),
        failed: failed.has(itemID),
        saved: saved.has(itemID),
        changed: saved.has(itemID),
        applicable: !result.notApplicable,
      }));
      result.processed = processed.size;
      result.failed = failed.size;
      result.passed = processed.size - failed.size;
      result.saved = result.changed = saved.size;
      result.unchanged = processed.size - saved.size;
      result.skipped = result.total - processed.size;
      publishReviewResult(result, features.history);
    }
    if (addon.data.alive && !signal.aborted && result.cancelled) {
      result.records.push({
        itemID: eligible[0].id,
        title: eligible[0].getDisplayTitle(),
        ruleID: command,
        level: "warning",
        message: getString("review-operation-cancelled"),
      });
      result.warnings++;
      publishReviewResult(result, features.history);
    }
    return result;
  }, features.signal);
}
