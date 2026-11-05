import type { DuplicatePair } from "./duplicate-matching";
import type { DefaultDuplicateAction, MasterStrategy } from "./duplicate-policy";
import { isWritableItem } from "../../utils/item-write-policy";
import { getString } from "../../utils/locale";
import { getPref } from "../../utils/prefs";
import { recordRuntimeResult } from "../../utils/runtime-data-storage";
import { assertReviewFresh } from "./apply";
import { duplicatePairs } from "./duplicate-matching";
import { canMergePair, chooseMaster, duplicateConcurrency, duplicateGroups } from "./duplicate-policy";
import { applyDuplicateDecision, duplicateRecord, findDuplicates, reviewDuplicate } from "./duplicates";
import { isNonDuplicate } from "./non-duplicates";

export interface DuplicateBatch {
  running: boolean;
  paused: boolean;
  cancelled: boolean;
  total: number;
  completed: number;
  merged: number;
  skipped: number;
  errors: string[];
  processedIDs: number[];
  savedIDs: number[];
  failedIDs: number[];
}
let active: DuplicateBatch | undefined;
export function getDuplicateBatch() {
  return active;
}
export function pauseDuplicateBatch() {
  if (active?.running)
    active.paused = !active.paused;
}
export function cancelDuplicateBatch() {
  if (active)
    active.cancelled = true;
}

export async function bulkMergeDuplicates(pairs: DuplicatePair[], signal?: AbortSignal, imported?: { ids: Set<number>; action: DefaultDuplicateAction }, update?: (state: DuplicateBatch) => void, record = true): Promise<DuplicateBatch> {
  if (active?.running)
    throw new Error(getString("duplicates-already-running"));
  const started = Date.now();
  const differentTypes = getPref("duplicates.mergeDifferentTypes" as any, false) === true;
  const groups = duplicateGroups(pairs.filter(pair => canMergePair(pair, differentTypes) && (!imported || pair.reason === "doi")));
  const state: DuplicateBatch = { running: true, paused: false, cancelled: false, total: groups.length, completed: 0, merged: 0, skipped: 0, errors: [], processedIDs: [], savedIDs: [], failedIDs: [] };
  active = state;
  let observer = update;
  const notify = () => {
    try {
      observer?.(state);
    }
    catch (error) {
      observer = undefined;
      Zotero.debug(`[MetaFlow duplicate-batch] ${String(error)}`);
    }
  };
  let next = 0;
  const worker = async () => {
    while (!state.cancelled && !signal?.aborted) {
      while (state.paused && !state.cancelled && !signal?.aborted)
        await Zotero.Promise.delay(50);
      if (state.cancelled || signal?.aborted)
        break;
      const group = groups[next++];
      if (!group)
        break;
      for (const record of group)
        state.processedIDs.push(record.id);
      try {
        for (const record of group) {
          const item = Zotero.Items.get(record.id);
          if (!item)
            throw new Error(getString("review-stale"));
          assertReviewFresh(item, record.data);
        }
        let candidates = group;
        if (imported) {
          const preferred = group.filter(record => imported.action === "keep" ? imported.ids.has(record.id) : !imported.ids.has(record.id));
          if (preferred.length)
            candidates = preferred;
        }
        const master = chooseMaster(candidates, imported?.action === "keep" ? "newest" : getPref("duplicates.masterStrategy" as any, "oldest") as MasterStrategy);
        for (const other of group.filter(record => record.id !== master.id)) {
          if (state.cancelled || signal?.aborted)
            break;
          const left = Zotero.Items.get(master.id) as Zotero.Item;
          const right = Zotero.Items.get(other.id) as Zotero.Item;
          if (!left || !right)
            throw new Error(getString("review-stale"));
          assertReviewFresh(right, other.data);
          const pair = duplicatePairs(new Set([left.id]), [duplicateRecord(left), duplicateRecord(right)])[0];
          if (!pair || !canMergePair(pair, differentTypes) || isNonDuplicate(left, right)) {
            state.skipped++;
            continue;
          }
          await applyDuplicateDecision({ pair, action: "merge", masterID: master.id, donors: new Map() }, signal);
          state.merged++;
          state.savedIDs.push(master.id, other.id);
        }
      }
      catch (error) {
        if (signal?.aborted) {
          state.cancelled = true;
        }
        else {
          state.errors.push(String(error));
          const saved = new Set(state.savedIDs);
          for (const record of group) {
            if (!saved.has(record.id))
              state.failedIDs.push(record.id);
          }
        }
      }
      state.completed++;
      notify();
    }
  };
  try {
    notify();
    await Promise.all(Array.from({ length: Math.min(groups.length, duplicateConcurrency(getPref("duplicates.concurrency" as any, 3))) }, worker));
    return state;
  }
  finally {
    state.cancelled ||= signal?.aborted || false;
    state.running = false;
    state.paused = false;
    notify();
    if (record) {
      const processed = new Set(state.processedIDs);
      const saved = new Set(state.savedIDs);
      const failed = new Set(state.failedIDs);
      recordRuntimeResult({ total: new Set(pairs.flatMap(pair => [pair.left.id, pair.right.id])).size, processed: processed.size, passed: processed.size - failed.size, failed: failed.size, saved: saved.size, cancelled: state.cancelled, skipped: state.skipped, preparationFailed: 0, records: [...processed].map(itemID => ({ itemID, title: "", ruleID: "tool-review-duplicates", code: failed.has(itemID) ? "duplicate-merge-failed" : saved.has(itemID) ? "duplicate-merged" : "duplicate-skipped", level: failed.has(itemID) ? "error" : "info", message: "" })), changes: [...saved].map(itemID => ({ itemID, ruleID: "tool-review-duplicates", field: "merge", before: null, after: null, saved: true })), changed: saved.size, unchanged: processed.size - saved.size, notApplicable: 0, warnings: 0, durationMs: Date.now() - started }, "duplicate-merge");
    }
  }
}

export async function processImportedDuplicates(items: Zotero.Item[]) {
  const action = getPref("duplicates.defaultAction" as any, "cancel") as DefaultDuplicateAction;
  if (action === "cancel")
    return;
  const eligible = items.filter(item => isWritableItem(item));
  if (!eligible.length)
    return;
  return addon.runner.exclusive(async (signal) => {
    if (!getPref("lint.onAdded"))
      return;
    const pairs = await findDuplicates(eligible, signal, action !== "ask");
    if (action === "ask") {
      const touched = new Set<number>();
      for (const pair of pairs) {
        if (touched.has(pair.left.id) || touched.has(pair.right.id) || !getPref("lint.onAdded"))
          continue;
        const choice = await reviewDuplicate(pair, signal);
        if (!choice)
          break;
        if (await applyDuplicateDecision(choice, signal) !== "skipped") {
          touched.add(pair.left.id);
          touched.add(pair.right.id);
        }
      }
      return;
    }
    return bulkMergeDuplicates(pairs, signal, { ids: new Set(eligible.map(item => item.id)), action });
  });
}
