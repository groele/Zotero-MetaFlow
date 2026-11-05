import { rebaseItemSnapshot, rollbackItemChanges } from "../../utils/item-recovery";
import { isWritableItem } from "../../utils/item-write-policy";
import { getString } from "../../utils/locale";
import { createLogger } from "../../utils/logger";

import { RuleExecution } from "./execution";

const logger = createLogger("Runner");

export class BatchPersistence extends RuleExecution {
  protected async batchSave(): Promise<void> {
    if (this.modifiedItems.size === 0)
      return;

    const items = [...this.modifiedItems];
    const snapshots = new Map(items.map(item => [item, item.toJSON()]));
    this.stats.phase = "saving";
    this.updateProgress(0, items.length);

    try {
      let savedCount = 0;
      const committedValues = new Map<number, Record<string, unknown>>();
      await Zotero.DB.executeTransaction(async () => {
        for (const item of items) {
          if (!item.hasChanged())
            continue;
          if (!isWritableItem(item)) {
            this.failedItems.add(item.id || item);
            this.stats.records.push({ itemID: item.id, title: item.getDisplayTitle(), ruleID: "item-save", code: "item-save-conflict", level: "error", message: getString("report-save-conflict", { args: { fields: "editable" } }) });
            const restored = rollbackItemChanges(item.toJSON() as Record<string, unknown>, this.changes.filter(change => change.itemID === item.id));
            item.fromJSON(restored, { strict: true });
            continue;
          }
          await item.save({ skipSelect: true });
          savedCount++;
          committedValues.set(item.id, item.toJSON() as Record<string, unknown>);
          this.updateProgress(savedCount, items.length);
        }
        if (savedCount > 0) {
          // @ts-expect-error - Zotero.UndoHistory not yet typed in zotero-types
          Zotero.UndoHistory?.stageAction?.(
            "metaref-undo-action-lint-metadata",
            { count: savedCount },
          );
        }
      });
      this.saved = savedCount;
      this.savedValues = committedValues;
    }
    catch (err) {
      logger.warn("Batch transaction save failed, falling back to individual saveTx:", err);
      for (const item of items) {
        try {
          // save() reloads the item before commit. Rollback does not restore its change flags.
          if (item.id)
            await item.reload(["primaryData", "itemData", "creators", "tags", "collections", "relations"], true);
          const latest = item.toJSON() as Record<string, unknown>;
          const rebased = rebaseItemSnapshot(this.itemBaselines.get(item)!, snapshots.get(item)! as Record<string, unknown>, latest);
          const conflicts = !isWritableItem(item) ? ["editable"] : rebased.conflicts;
          if (conflicts.length) {
            this.failedItems.add(item.id || item);
            this.stats.records.push({ itemID: item.id, title: item.getDisplayTitle(), ruleID: "item-save", code: "item-save-conflict", level: "error", message: getString("report-save-conflict", { args: { fields: conflicts.join(", ") } }) });
            continue;
          }
          item.fromJSON(rebased.data, { strict: true });
          await item.saveTx({ skipSelect: true, ...{ undoAction: "metaref-undo-action-lint-metadata", undoActionArgs: { count: 1 } } });
          this.saved++;
          this.savedValues.set(item.id, item.toJSON() as Record<string, unknown>);
        }
        catch (itemErr) {
          this.stats.records.push({
            message: itemErr instanceof Error ? itemErr.message : String(itemErr),
            level: "error",
            itemID: item.id,
            title: item.getDisplayTitle(),
            ruleID: "item-save",
          });
          logger.error(`Failed to save item ${item.id}:`, itemErr);
          this.failedItems.add(item.id || item);
          const recovered = rollbackItemChanges(item.toJSON() as Record<string, unknown>, this.changes.filter(change => change.itemID === item.id));
          try {
            await item.reload(["primaryData", "itemData", "creators", "tags", "collections", "relations"], true);
            const persisted = item.toJSON() as Record<string, unknown>;
            item.fromJSON(rebaseItemSnapshot(this.itemBaselines.get(item)!, recovered, persisted).data, { strict: true });
          }
          catch (recoveryError) {
            this.unsafeItems.add(item);
            this.stats.records.push({ itemID: item.id, title: item.getDisplayTitle(), ruleID: "item-save", level: "error", message: getString("rule-rollback-failed") });
            logger.error(`Failed to recover item ${item.id} after a save failure:`, recoveryError);
          }
        }
      }
    }

    this.modifiedItems.clear();
  }
}
