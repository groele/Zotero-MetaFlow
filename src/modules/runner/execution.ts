import type { ApplyContext, PrepareContext, Rule } from "../rules/rule-base";
import { ItemMutationJournal } from "../../utils/item-mutation-journal";
import { isWritableItem } from "../../utils/item-write-policy";
import { getString } from "../../utils/locale";
import { createLogger } from "../../utils/logger";
import { executeRule, waitForOperation } from "../../utils/rule-execution";
import { ruleSupportsItems } from "../../utils/workflow-policy";
import { isFieldValidForItemType } from "../../utils/zotero";
import { Rules } from "../rules";

import { RunnerState } from "./state";

const logger = createLogger("Runner");

function shouldApplyRule(rule: Rule<any>, item: Zotero.Item): boolean {
  // tag and attachment rules are not implemented
  if (rule.scope !== "item" && rule.scope !== "field") {
    return false;
  }
  if (!item.isRegularItem()) {
    return false;
  }
  if (!isWritableItem(item)) {
    return false;
  }

  /*  For regular item and rule  */
  if (rule.targetItemTypes && rule.ignoreItemTypes) {
    logger.warn(`Rule ${rule.id} has both targetItemTypes and ignoreItemTypes.`);
  }

  // Check item type
  if (rule.targetItemTypes && !rule.targetItemTypes.includes(item.itemType)) {
    logger.debug(`Skip ${rule.id}: ${item.itemType} not supported by this rule`);
    return false;
  }
  if (rule.ignoreItemTypes?.includes(item.itemType)) {
    logger.debug(`Skip ${rule.id}: ${item.itemType} is ignored by this rule`);
    return false;
  }

  if (rule.scope === "field") {
    // if targetField of this rule is primary field, always apply
    if (rule.targetItemField === "creators")
      return true;

    // Check this target field is included in this item type
    if (!isFieldValidForItemType(rule.targetItemField, item.itemType)) {
      if (!rule.includeMappedFields) {
        logger.debug(`Skip ${rule.id}: ${rule.targetItemField} not valid for ${item.itemType}`);
        return false;
      }
      else {
        const mappedFields = (Zotero.ItemFields.getTypeFieldsFromBase(rule.targetItemField, true) as _ZoteroTypes.Item.ItemField[])
          .filter(field => isFieldValidForItemType(field, item.itemType));
        if (!mappedFields.length) {
          logger.debug(`Skip ${rule.id}: no mapped fields for ${rule.targetItemField} are valid for ${item.itemType}`);
          return false;
        }
      }
    }
  }

  return true;
}

export function createAbortController(): AbortController {
  const Controller = (typeof Zotero !== "undefined" && typeof Zotero.getMainWindow === "function" && (Zotero.getMainWindow() as any)?.AbortController) || AbortController;
  return new Controller();
}

export class RuleExecution extends RunnerState {
  protected async prepareRules(rules: Rule<any>[], items: Zotero.Item[]) {
    const optionsMap = new Map<ID, any>();

    for (const rule of rules) {
      await this.checkpoint();
      if (this.cancelled)
        break;
      if (!ruleSupportsItems(rule, items)) {
        optionsMap.set(rule.id, false);
        continue;
      }
      const controller = createAbortController();
      this.preparation = controller;
      try {
        const ctx: PrepareContext = {
          items,
          debug: (...a) => logger.debug(`[prepare] [${rule.id}]`, ...a),
          signal: controller.signal,
        };
        const options = await waitForOperation(() => rule.prepare?.(ctx), controller.signal, rule.prepareTimeout ?? (rule.category === "tool" ? 0 : 60_000)) ?? {};
        optionsMap.set(rule.id, options);
        if (options === false && rule.category === "tool") {
          this.cancel();
          break;
        }
      }
      catch (err) {
        controller.abort(err);
        if (this.cancelled)
          break;
        this.preparationFailed++;
        this.stats.records.push({
          message: err instanceof Error ? err.message : String(err),
          level: "error",
          itemID: 0,
          title: getString("report-prepare-failed"),
          ruleID: rule.id,
        });
        logger.error(`Failed to prepare rule ${rule.id}:`, err);

        optionsMap.set(rule.id, false);
      }
      finally {
        this.preparation = undefined;
      }
    }

    logger.debug("Options map:", optionsMap);
    return optionsMap;
  }

  public async lintItem(
    item: Zotero.Item,
    rules: Rule<any>[],
    optionsMap: Map<string, any>,
  ) {
    logger.debug(`Linting item ${item.id}`);
    if (this.unsafeItems.has(item)) {
      await item.reload(["primaryData", "itemData", "creators", "tags", "collections", "relations"], true);
      this.unsafeItems.delete(item);
    }
    const errors: any[] = [];
    const baseline = item.toJSON() as Record<string, unknown>;

    for (const rule of rules) {
      await this.checkpoint();
      if (this.cancelled || this.unsafeItems.has(item))
        break;
      if (!optionsMap.has(rule.id))
        continue;
      const options = optionsMap.get(rule.id);
      if (options === false) {
        logger.debug(`Skip ${rule.id}: options is false`);
        continue;
      }

      // We expect one rule's error does not affect next rule apply,
      // so we eat any error here and throw them after all rules applied.
      await Promise.resolve().then(() => {
        if (shouldApplyRule(rule, item)) {
          this.applicableIDs.add(item.id);
          return this.applyRule(item, rule, options);
        }
      }).catch((error) => {
        if (this.cancelled)
          return;
        let message: string = "";
        // Zotero.HTTP.request error, the message is too long, here we just show the status
        if (error && typeof error === "object" && "xmlhttp" in error && "message" in error)
          message += `HTTP request error: status ${error.status}, ${String(error.message).slice(0, 250)}`;
          // For regular error, we just show the message in the reporter window
        else if (error instanceof Error || (error && typeof error === "object" && "message" in error))
          message += `${error.name || "Error"}: ${error.message}`;
          // If error not have message, we show the error string
        else
          message += String(error);

        this.stats.records.push({
          message,
          level: "error",
          itemID: item.id,
          title: item.getDisplayTitle(),
          ruleID: rule.id,
        });

        logger.error(`[${rule.id}]`, error);

        errors.push(error);
      });
    }

    if (!this.unsafeItems.has(item) && item.hasChanged() && JSON.stringify(item.toJSON()) !== JSON.stringify(baseline)) {
      this.modifiedItems.add(item);
      this.itemBaselines.set(item, baseline);
    }

    // If there are errors, throw a error so queue can catch
    if (errors.length)
      throw new Error(`Item ${item.id} failed ${errors.length} rules`, { cause: errors });
  }

  public async applyRule(item: Zotero.Item, rule: Rule<any>, options: any) {
    logger.debug(`Applying ${rule.id}`);
    let ruleFailed = false;
    const sources = new Map<string, string>();
    const journal = new ItemMutationJournal(item);
    const restore = async () => {
      try {
        journal.restore();
      }
      catch (error) {
        this.unsafeItems.add(item);
        this.failedItems.add(item.id || item);
        this.stats.records.push({ itemID: item.id, title: item.getDisplayTitle(), ruleID: rule.id, level: "error", message: getString("rule-rollback-failed") });
        await item.reload(["primaryData", "itemData", "creators", "tags", "collections", "relations"], true);
        throw error;
      }
    };
    try {
      await executeRule(item, async (guardedItem, signal) => {
        let acceptingReports = true;
        const ctx: ApplyContext = {
          item: guardedItem,
          options,
          signal,
          debug: (...a) => createLogger(rule.id).debug(...a),
          report: (info) => {
            if (signal.aborted || !acceptingReports)
              return;
            if (info.level === "error") {
              ruleFailed = true;
              this.failedItems.add(item.id || item);
            }
            if (info.field && info.source)
              sources.set(info.field, info.source);
            this.stats.records.push({
              ...info,
              itemID: item.id,
              title: item.getDisplayTitle(),
              ruleID: rule.id,
            });
          },
        };

        try {
          await rule.apply(ctx);
        }
        finally {
          acceptingReports = false;
        }
      }, rule.timeout ?? 60_000, () => createAbortController(), (mutate) => {
        if (!isWritableItem(item))
          throw new Error(getString("report-save-conflict", { args: { fields: "editable" } }));
        return journal.capture(mutate);
      }, this.execution?.signal);
    }
    catch (error) {
      await restore();
      throw error;
    }
    if (ruleFailed) {
      await restore();
    }
    else {
      for (const change of journal.changes())
        this.changes.push({ ...change, itemID: item.id, ruleID: rule.id, source: sources.get(change.field), saved: false });
    }
  }

  public async applyRuleByID(item: Zotero.Item, ruleID: ID, options: any) {
    return await this.applyRule(item, Rules.getByID(ruleID)!, options);
  }
}
