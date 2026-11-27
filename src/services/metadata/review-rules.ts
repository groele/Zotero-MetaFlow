import type { BatchResult } from "../lint/runner";
import type { MetadataDecision, ReviewProposal } from "./review-policy";
import type { TransformedData } from "./tool-update-metadata/services/base-service";
import { mapBatch } from "../../utils/batch-map";
import { getString } from "../../utils/locale";
import { createLogger } from "../../utils/logger";
import { getPref } from "../../utils/prefs";
import { normalizedConcurrency } from "../../utils/rule-execution";
import { recordRuntimeResult } from "../../utils/runtime-data-storage";
import { updateBatchFeedback } from "../lint/batch-feedback";
import { defineRule } from "../lint/rule-base";
import { automaticIdentifier, automaticSelection, hasLocalCorroboration } from "./automatic-policy";
import { discoverIdentifiers, inspectMetadata, inspectPreprint } from "./metadata-inspector";
import { isUnconvertedArxivPreprint, isUnconvertedBiorxivPreprint } from "./preprint-status";
import { applyReviewedMetadata, createRelatedVersion, selectionIssue } from "./review-apply";
import { identityConflicts, reviewChanges } from "./review-policy";
import { CompleteMissingISSN } from "./tool-update-metadata/complete-issn";
import { extractIdentifiers } from "./tool-update-metadata/identifiers";
import { backfillItemTLDR } from "./tool-update-metadata/tldr";

export interface ReviewOptions {
  selections: MetadataDecision[];
  selectionsByItem: Map<number, MetadataDecision>;
  failures: Map<number, string>;
  failureCodes: Map<number, string>;
}

export interface ReviewFeatures {
  signal?: AbortSignal;
  history?: boolean;
  scanPDF?: boolean;
  searchTitle?: boolean;
  creatorsOnly?: boolean;
  repairCreators?: boolean;
  overwrite?: boolean;
  reviveSnapshots?: boolean;
}

export function reviewRule(
  version: boolean,
  prepared?: (options: ReviewOptions) => void,
  integrated = false,
  features: ReviewFeatures = {},
) {
  return defineRule<ReviewOptions>({
    id: version ? "tool-review-preprint" : "tool-review-metadata",
    category: "tool",
    scope: "item",
    targetItemTypes: version
      ? ["preprint", "journalArticle", "conferencePaper"]
      : ["journalArticle", "preprint", "conferencePaper", "webpage", "blogPost", "book", "bookSection"],
    async prepare({ items, signal }) {
      const repairCreators = features.repairCreators ?? (getPref("metadata.repairCreators", true) === true);
      const overwrite = features.overwrite ?? (getPref("rule.tool-update-metadata.option.mode") === "all");
      const reviveSnapshots = features.reviveSnapshots ?? (getPref("workflow.reviveSnapshots" as any, true) === true);
      const evidence = new Map<string, Promise<ReviewProposal>>();
      const failures = new Map<number, string>();
      const failureCodes = new Map<number, string>();
      const supported = version
        ? ["preprint", "journalArticle", "conferencePaper"]
        : ["journalArticle", "preprint", "conferencePaper", "webpage", "blogPost", "book", "bookSection"];
      const inspected = await mapBatch(
        items.filter(item => supported.includes(item.itemType)),
        Math.min(4, normalizedConcurrency(getPref("lint.numConcurrent"))),
        async (item): Promise<ReviewProposal | undefined> => {
          signal?.throwIfAborted();
          const original = JSON.parse(JSON.stringify(item.toJSON())) as TransformedData;
          try {
            const allCandidates = await discoverIdentifiers(item, signal, features.scanPDF !== false, reviveSnapshots);
            if (!version && features.searchTitle !== false && !allCandidates.length && original.title)
              allCandidates.push({ kind: "Title", value: original.title, source: getString("review-source-title") });
            const isPreprintItem = isUnconvertedArxivPreprint(item) || isUnconvertedBiorxivPreprint(item);
            const arxiv = allCandidates.filter(candidate => candidate.kind === "arXiv");
            const biorxiv = allCandidates.filter(candidate => candidate.kind === "DOI" && /^10\.1101\//.test(candidate.value));
            const preprintCandidates = arxiv.length ? arxiv : biorxiv;
            const shouldInspectPreprint = version || (integrated && isPreprintItem && preprintCandidates.length > 0);
            const candidates = shouldInspectPreprint ? preprintCandidates : allCandidates;
            if (!candidates.length)
              throw new Error(getString(version ? "review-no-arxiv" : "review-no-identifier"));
            const identifier = automaticIdentifier(candidates);
            if (!identifier)
              throw new Error(getString("review-auto-ambiguous"));
            if ((identifier.kind === "Title" || identifier.excerpt) && !hasLocalCorroboration(original, identifier.kind)) {
              failures.set(item.id, getString("review-auto-evidence"));
              failureCodes.set(item.id, "metadata-auto-evidence");
              return;
            }
            const preprint = shouldInspectPreprint && (identifier.kind === "arXiv" || (identifier.kind === "DOI" && /^10\.1101\//.test(identifier.value)));
            const key = `${preprint}:${identifier.kind}:${identifier.value}:${identifier.kind === "Title" ? item.id : ""}`;
            let request = evidence.get(key);
            if (!request) {
              request = preprint
                ? inspectPreprint(item, identifier, original, signal, integrated)
                : inspectMetadata(item, identifier, original, signal, reviveSnapshots);
              evidence.set(key, request);
            }
            const proposal = await request;
            const conflicts = proposal.revival ? [] : identityConflicts(original, proposal.candidate, preprint || !!proposal.preprintURL);
            const changes = reviewChanges(original, proposal.candidate, !!proposal.preprintURL || !!proposal.revival);
            return { ...proposal, itemID: item.id, original, identifier, conflicts, changes };
          }
          catch (error) {
            signal?.throwIfAborted();
            failures.set(item.id, `${item.getDisplayTitle()} · ${String(error)}`);
            failureCodes.set(item.id, "metadata-lookup-failed");
          }
        },
        signal,
      );
      const proposals = inspected.filter((proposal): proposal is ReviewProposal => Boolean(proposal));
      for (const proposal of proposals) {
        proposal.excludedFields = !repairCreators ? ["creators"] : [];
        proposal.changes = proposal.changes.filter(change => features.creatorsOnly ? change.field === "creators" : repairCreators || change.field !== "creators");
      }
      signal?.throwIfAborted();
      const selections: MetadataDecision[] = [];
      for (const proposal of proposals) {
        const decision = automaticSelection(proposal, overwrite, repairCreators);
        if (decision.selection) {
          selections.push(decision.selection);
        }
        else {
          failures.set(proposal.itemID, getString(`review-auto-${decision.reason!}`));
          failureCodes.set(proposal.itemID, `metadata-auto-${decision.reason!}`);
        }
      }
      const options = { selections, selectionsByItem: new Map(selections.map(selection => [selection.proposal.itemID, selection])), failures, failureCodes };
      prepared?.(options);
      return options;
    },
    async apply({ item, options, report, signal }) {
      if (options.failures.has(item.id)) {
        report({ level: "warning", code: options.failureCodes.get(item.id), message: options.failures.get(item.id)! });
        return;
      }
      const selection = options.selectionsByItem.get(item.id);
      if (selection) {
        applyReviewedMetadata(item, selection, report);
        const resolved = selection.proposal.conflicts.filter(field => selection.fields.has(field));
        if (resolved.length)
          report({ level: "info", code: "metadata-cloud-priority", source: selection.proposal.source, message: getString("review-cloud-priority", { args: { fields: resolved.join(", ") } }) });

        if (!features.creatorsOnly && getPref("workflow.tldrEnabled" as any, true) === true) {
          const identifiers = extractIdentifiers(item);
          await backfillItemTLDR(item, identifiers, {
            signal,
            target: getPref("workflow.tldrTarget" as any, "note"),
            extraFormat: getPref("workflow.tldrExtraFormat" as any, "tldr"),
            report,
          });
        }
      }
    },
  });
}

export const ToolReviewMetadata = reviewRule(false);
export const ToolReviewPreprint = reviewRule(true);
export const ToolReviewDuplicates = defineRule({
  id: "tool-review-duplicates",
  category: "tool",
  scope: "item",
  apply({ report }) {
    report({ level: "warning", message: getString("review-use-command") });
  },
});

export function emptyReviewResult(total: number): BatchResult {
  return {
    total,
    processed: 0,
    passed: 0,
    failed: 0,
    saved: 0,
    cancelled: false,
    skipped: 0,
    preparationFailed: 0,
    records: [],
    changes: [],
    changed: 0,
    unchanged: 0,
    notApplicable: 0,
    warnings: 0,
  };
}

export function publishReviewResult(result: BatchResult, history = true) {
  addon.runner.lastResult = result;
  if (history)
    recordRuntimeResult(result, "review");
  if (addon.data.alive)
    updateBatchFeedback(result);
}

export async function runMetadataReview(
  command: "tool-review-metadata" | "tool-review-preprint",
  eligible: Zotero.Item[],
  integrated = false,
  features: ReviewFeatures = {},
): Promise<BatchResult | undefined> {
  let approved: ReviewOptions | undefined;
  const version = command === "tool-review-preprint";
  const rule = reviewRule(version, options => approved = options, integrated, features);
  const result = await addon.runner.add({
    items: eligible,
    rules: [rule, ...(!version && !features.creatorsOnly ? [CompleteMissingISSN] : [])],
    silent: true,
    history: features.history,
    signal: features.signal,
  });
  if (result && !result.cancelled && !features.signal?.aborted && approved && addon.data.alive) {
    const related = approved.selections.filter(selection => selection.action === "related" && !selectionIssue(selection));
    if (related.length) {
      const itemOutcomes = new Map(result.itemOutcomes?.map(outcome => [outcome.itemID, outcome]));
      await addon.runner.exclusive(async (signal) => {
        const failed = new Set(result.records.filter(record => record.level === "error").map(record => record.itemID));
        for (const selection of related) {
          if (signal.aborted) {
            result.cancelled = true;
            break;
          }
          try {
            const source = Zotero.Items.get(selection.proposal.itemID);
            if (!source)
              throw new Error(getString("review-stale"));
            const before = JSON.parse(JSON.stringify(source.getRelations()));
            const published = await createRelatedVersion(source, selection, signal);
            const itemOutcome = itemOutcomes.get(source.id);
            const after = JSON.parse(JSON.stringify(source.getRelations()));
            if (JSON.stringify(before) !== JSON.stringify(after)) {
              if (itemOutcome)
                itemOutcome.saved = itemOutcome.changed = true;
              if (!result.changes.some(change => change.itemID === source.id)) {
                result.changed++;
                result.unchanged = Math.max(0, result.unchanged - 1);
              }
              if (!result.changes.some(change => change.itemID === source.id && change.saved))
                result.saved++;
              result.changes.push({ itemID: source.id, ruleID: rule.id, field: "relations", before, after, saved: true, source: selection.proposal.source });
            }
            result.records.push({ itemID: source.id, title: source.getDisplayTitle(), ruleID: rule.id, level: "info", code: "version-related", source: selection.proposal.source, message: getString("review-related-applied", { args: { id: published.id } }) });
          }
          catch (error) {
            if (signal.aborted) {
              result.cancelled = true;
              break;
            }
            createLogger("version-review").error(error);
            result.records.push({ itemID: selection.proposal.itemID, title: String(selection.proposal.original.title || ""), ruleID: rule.id, level: "error", code: "version-related-failed", message: String(error) });
            if (!failed.has(selection.proposal.itemID)) {
              const itemOutcome = itemOutcomes.get(selection.proposal.itemID);
              if (itemOutcome)
                itemOutcome.failed = true;
              failed.add(selection.proposal.itemID);
              result.failed++;
              result.passed = Math.max(0, result.passed - 1);
            }
          }
        }
        publishReviewResult(result, features.history);
      }, features.signal);
    }
  }
  return result;
}
