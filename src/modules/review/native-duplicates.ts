import type { MasterStrategy } from "./duplicate-policy";
import { isWritableItem } from "../../utils/item-write-policy";
import { getString } from "../../utils/locale";
import { getPref } from "../../utils/prefs";
import { isFieldValidForItemType } from "../../utils/zotero";
import { chooseMaster } from "./duplicate-policy";
import { duplicateRecord } from "./duplicates";
import { isNonDuplicate, transferNonDuplicates } from "./non-duplicates";

export interface NativeDuplicatePlan {
  libraryID: number;
  strategy: MasterStrategy;
  groups: { ids: number[]; snapshots: string[] }[];
}
export interface NativeDuplicateResult {
  total: number;
  completed: number;
  merged: number;
  skipped: number;
  errors: string[];
  cancelled: boolean;
}

const snapshot = (item: Zotero.Item) => JSON.stringify(item.toJSON());

/** Use the host detector, including ISBN matches absent from MetaFlow's DOI matcher. */
export async function planNativeDuplicates(libraryID: number, signal?: AbortSignal): Promise<NativeDuplicatePlan> {
  signal?.throwIfAborted();
  const library = Zotero.Libraries.get(libraryID);
  if (!library || !library.editable)
    throw new Error(getString("review-blocked"));
  const detector = new (Zotero as any).Duplicates(libraryID);
  const search: Zotero.Search = await detector.getSearchObject();
  let ids: number[];
  try {
    ids = await search.search();
  }
  finally {
    // getSearchObject creates a host temporary table normally owned by the item tree.
    for (const condition of Object.values(search.getConditions())) {
      if (condition.condition === "tempTable" && /^tmpDuplicates_[a-z0-9]+$/i.test(String(condition.value)))
        await Zotero.DB.queryAsync(`DROP TABLE IF EXISTS ${condition.value}`);
    }
  }
  const seen = new Set<number>();
  const groups: NativeDuplicatePlan["groups"] = [];
  for (const id of ids) {
    signal?.throwIfAborted();
    if (seen.has(id))
      continue;
    const groupIDs: number[] = detector.getSetItemsByItemID(id);
    groupIDs.forEach(id => seen.add(id));
    const items = await Zotero.Items.getAsync(groupIDs);
    if (items.length > 1)
      groups.push({ ids: groupIDs, snapshots: items.map(snapshot) });
    await Zotero.Promise.delay(0);
  }
  const configured = getPref("duplicates.masterStrategy" as any, "oldest") as MasterStrategy;
  return { libraryID, strategy: ["oldest", "newest", "modified", "detailed"].includes(configured) ? configured : "oldest", groups };
}

/** One native transaction per group; cancellation leaves completed groups committed. */
export async function mergeNativeDuplicates(plan: NativeDuplicatePlan, signal: AbortSignal, update: (result: NativeDuplicateResult) => void = () => {}): Promise<NativeDuplicateResult> {
  const result: NativeDuplicateResult = { total: plan.groups.length, completed: 0, merged: 0, skipped: 0, errors: [], cancelled: false };
  for (const group of plan.groups) {
    if (signal.aborted || !addon.data.alive) {
      result.cancelled = true;
      break;
    }
    const items = await Zotero.Items.getAsync(group.ids);
    const library = Zotero.Libraries.get(plan.libraryID);
    const stale = items.length !== group.ids.length || items.some((item, index) => !item || item.libraryID !== plan.libraryID || !isWritableItem(item) || !item.isRegularItem() || item.hasChanged() || snapshot(item) !== group.snapshots[index]);
    const incompatible = items.some(item => item?.itemTypeID !== items[0]?.itemTypeID)
      || items.some((item, index) => item && items.slice(index + 1).some(other => other && isNonDuplicate(item, other)));
    if (!library || !library.editable || stale || incompatible) {
      result.skipped++;
    }
    else {
      const masterID = chooseMaster(items.map(duplicateRecord), plan.strategy).id;
      const master = items.find(item => item.id === masterID)!;
      const others = items.filter(item => item !== master);
      const children = await Zotero.Items.getAsync(items.flatMap(item => [...item.getAttachments(true), ...item.getNotes(true)]));
      if (signal.aborted || !addon.data.alive) {
        result.cancelled = true;
        break;
      }
      if (items.some((item, index) => !isWritableItem(item) || item.hasChanged() || snapshot(item) !== group.snapshots[index]) || children.some(item => item.hasChanged())) {
        result.skipped++;
      }
      else {
        try {
          for (const other of others) {
            for (const [field, value] of Object.entries(other.toJSON())) {
              if (field !== "extra" && typeof value === "string" && value && Zotero.ItemFields.getID(field) && isFieldValidForItemType(field as any, master.itemType) && !master.getField(field))
                master.setField(field, value);
            }
            if (!master.getCreators().length && other.getCreators().length)
              master.setCreators(other.getCreators());
          }
          const extra = items.flatMap(item => String(item.getField("extra") || "").split(/\r?\n/)).filter(Boolean);
          master.setField("extra", [...new Set(extra)].join("\n"));
          // This host API owns attachments, notes, relations, tags, collections and Undo.
          await Zotero.Items.merge(master, others);
          result.merged += others.length;
          for (const other of others)
            transferNonDuplicates(master, other);
        }
        catch (error) {
          result.errors.push(`${group.ids.join(", ")}: ${String(error)}`);
          for (const item of [...items, ...children])
            await item.reload(["primaryData", "itemData", "creators", "relations", "tags", "collections", "childItems"], true);
        }
      }
    }
    result.completed++;
    update(result);
    await Zotero.Promise.delay(0);
  }
  result.cancelled ||= signal.aborted || !addon.data.alive;
  update(result);
  return result;
}
