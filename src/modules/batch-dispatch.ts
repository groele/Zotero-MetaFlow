import type { Arrayable } from "../utils/types";
import { localDOICheck, runCoreWorkflow } from "../modules/core-workflow";
import { refreshJournalPane, setJournalUpdateResult } from "../modules/journal-pane";
import { REVIEW_COMMANDS, runReviewCommand } from "../modules/review";
import { Rules } from "../modules/rules";
import { ToolUpdateEasyScholar } from "../modules/rules/tool-update-easyscholar";
import { toArray } from "../utils/general";
import { redrawItemValues } from "../utils/item-value-refresh";
import { isWritableItem } from "../utils/item-write-policy";
import { getJournalInsights } from "../utils/journal-insights";
import { canRunJournalRule, hasEnabledJournalMetrics } from "../utils/journal-permissions";
import { getPref } from "../utils/prefs";
import { selectedCollections } from "../utils/selection";
import { REMOTE_STANDARD_RULES } from "../utils/workflow-policy";

export async function onLintInBatch(
  ruleIDs: Arrayable<ID | "standard">,
  items: Zotero.Item[] | "item" | "collection" | string,
  context: { automatic?: boolean; review?: boolean; core?: boolean } = {},
) {
  if (typeof items === "string") {
    switch (items) {
      case "item":
        items = Zotero.getActiveZoteroPane()?.getSelectedItems() ?? [];
        break;
      case "collection":
        items = selectedCollections(Zotero.getActiveZoteroPane()).flatMap(collection => collection.getChildItems());
        break;
      default:
        items = Zotero.getActiveZoteroPane()?.getSelectedItems() ?? [];
        break;
    }
  }

  items = items.filter(
    (item): item is Zotero.Item =>
      Boolean(item)
      && item.isRegularItem()
      && isWritableItem(item),
  );
  items = [...new Map(items.map(item => [item.id || item, item])).values()];

  const requested = [...toArray(ruleIDs)];
  if (!context.automatic && ((context.core && requested.includes("standard")) || ((context.core || context.review) && requested.includes("tool-update-metadata"))))
    return runCoreWorkflow(requested.includes("standard") ? "check" : "update", items);
  for (const command of REVIEW_COMMANDS) {
    if (requested.includes(command as ID))
      await runReviewCommand(command, items);
  }
  ruleIDs = requested.filter(id => !REVIEW_COMMANDS.includes(id as typeof REVIEW_COMMANDS[number]));

  const requestedIDs = [...toArray(ruleIDs)].filter(canRunJournalRule);
  if (requestedIDs.includes("tool-update-easyscholar")) {
    if (getPref("easyscholar.updateAbbreviation", true))
      requestedIDs.push("require-journal-abbr", "correct-conference-abbr");
  }
  const requestedRules = requestedIDs.map(id =>
    id === "standard"
      ? Rules.getEnabledStandard().filter(rule => !REMOTE_STANDARD_RULES.has(rule.id)
        && !(context.automatic && rule.id === "no-item-duplication" && getPref("duplicates.defaultAction" as any, "cancel") !== "cancel"))
      : Rules.getByID(id)!,
  ).flat();
  const rules = [...new Map(requestedRules.filter(Boolean).map(rule => [rule.id, rule])).values()];
  if (requestedIDs.includes("standard") && !requestedIDs.includes("require-doi") && getPref("rule.require-doi")) {
    rules.push(localDOICheck());
  }

  if (rules.length === 0 || items.length === 0)
    return;

  const updateJournal = hasEnabledJournalMetrics() && !context.automatic && getPref("metadata.updateJournalInfo" as any, true)
    && requestedIDs.includes("tool-update-metadata");
  if (updateJournal) {
    const mode = getPref("rule.tool-update-metadata.option.mode") === "all" ? "all" as const : "blank" as const;
    const rule = { ...ToolUpdateEasyScholar, prepare: () => ({ mode }) };
    const index = rules.findIndex(rule => rule.id === "tool-update-easyscholar");
    if (index >= 0)
      rules[index] = rule;
    else
      rules.push(rule);
  }

  const journalUpdate = rules.some(rule => rule.id === "tool-update-easyscholar");
  const tasks = { items, rules, silent: context.automatic || (journalUpdate && !requestedIDs.includes("standard")) };
  const result = await addon.runner.add(tasks);
  if (updateJournal && !result?.cancelled && addon.data.alive) {
    await Promise.all(items.filter(item => item.itemType === "journalArticle").map(item => getJournalInsights(item, { queryAPI: true })));
    await redrawItemValues(items.map(item => item.id));
  }
  if (rules.some(rule => ["tool-query-esi", "tool-query-nature-index"].includes(rule.id))) {
    await redrawItemValues(items.map(item => item.id));
    await refreshJournalPane(items.map(item => item.id));
  }
  if (journalUpdate) {
    setJournalUpdateResult(items.map(item => item.id), result);
    await refreshJournalPane(items.map(item => item.id));
  }
  return result;
}
