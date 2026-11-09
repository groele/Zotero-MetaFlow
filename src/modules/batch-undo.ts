import type { FieldChange } from "./reporter";
import type { BatchResult } from "./runner";
import { redrawItemValues } from "../utils/item-value-refresh";
import { isWritableItem } from "../utils/item-write-policy";
import { isFieldValidForItemType } from "../utils/zotero";
import { refreshJournalPane } from "./journal-pane";

const undoneResults = new WeakSet<BatchResult>();

export function canUndoLastBatch(result = addon?.runner?.lastResult): boolean {
  if (!result || undoneResults.has(result) || !Array.isArray(result.changes))
    return false;
  return result.changes.some(change => change.saved && change.field !== "relations" && change.itemID > 0);
}

function readItemFieldValue(item: Zotero.Item, field: string): unknown {
  if (field === "itemType")
    return item.itemType;
  if (field === "creators")
    return (item.toJSON() as Record<string, unknown>).creators;
  return item.getField(field as _ZoteroTypes.Item.ItemField);
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === undefined && b === undefined)
    return true;
  return JSON.stringify(a ?? "") === JSON.stringify(b ?? "");
}

function applySingleRevert(item: Zotero.Item, change: FieldChange): boolean {
  if (change.field === "itemType") {
    const typeID = typeof change.before === "string" && Zotero.ItemTypes?.getID(change.before);
    if (!typeID)
      return false;
    item.setType(typeID);
    return true;
  }
  if (change.field === "creators") {
    if (!Array.isArray(change.before))
      return false;
    item.setCreators(change.before);
    return true;
  }
  if (typeof change.before === "string" && isFieldValidForItemType(change.field as _ZoteroTypes.Item.ItemField, item.itemType)) {
    item.setField(change.field as _ZoteroTypes.Item.ItemField, change.before);
    return true;
  }
  return false;
}

export async function undoLastBatch(result = addon?.runner?.lastResult): Promise<{ restored: number; skipped: number }> {
  if (!result || !canUndoLastBatch(result))
    return { restored: 0, skipped: 0 };
  const runUndo = async () => {
    const byItem = new Map<number, FieldChange[]>();
    for (const change of result.changes) {
      if (!change.saved || change.field === "relations" || !change.itemID)
        continue;
      const list = byItem.get(change.itemID) || [];
      list.push(change);
      byItem.set(change.itemID, list);
    }
    let restored = 0;
    let skipped = 0;
    const touchedIDs: number[] = [];
    for (const [itemID, changes] of byItem) {
      const item = Zotero.Items.get(itemID);
      if (!item || item.deleted || !item.isRegularItem() || !isWritableItem(item)) {
        skipped++;
        continue;
      }
      const reversed = [...changes].reverse();
      const verifiedFields = new Set<string>();
      const conflictFields = new Set<string>();
      for (const change of reversed) {
        if (verifiedFields.has(change.field) || conflictFields.has(change.field))
          continue;
        if (sameValue(readItemFieldValue(item, change.field), change.after))
          verifiedFields.add(change.field);
        else
          conflictFields.add(change.field);
      }
      let mutated = false;
      for (const change of reversed) {
        if (!verifiedFields.has(change.field))
          continue;
        if (applySingleRevert(item, change))
          mutated = true;
      }
      if (mutated) {
        await item.saveTx();
        restored++;
        touchedIDs.push(item.id);
      }
      else {
        skipped++;
      }
    }
    undoneResults.add(result);
    if (touchedIDs.length && addon?.data?.alive) {
      await redrawItemValues(touchedIDs);
      await refreshJournalPane(touchedIDs);
    }
    return { restored, skipped };
  };
  return addon?.runner?.exclusive
    ? (await addon.runner.exclusive(() => runUndo())) || { restored: 0, skipped: 0 }
    : runUndo();
}
