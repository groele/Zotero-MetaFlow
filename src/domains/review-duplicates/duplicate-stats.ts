import { resolveAddonHost } from "../../kernel/host-globals";
import { patchCollectionTreeDuplicateStats } from "../../services/host";
import { duplicateSearchRevision } from "../../utils/duplicate-search-cache";
import { createLogger } from "../../utils/logger";
import { getPref } from "../../utils/prefs";
import { duplicateGroups } from "./review/duplicate-policy";
import { findDuplicates } from "./review/duplicates";

const counts = new Map<number, { groups: number; items: number; revision: number }>();
const pending = new Map<number, Promise<void>>();
let restore: (() => void) | { dispose: () => void } | undefined;

export function registerDuplicateStats() {
  if (restore)
    return;
  restore = patchCollectionTreeDuplicateStats(
    resolveAddonHost()?.kernel?.runtime,
    (libraryID) => {
      if (libraryID === undefined)
        return null;
      const stats = counts.get(libraryID);
      return getPref("duplicates.showStats" as any, true) && stats?.revision === duplicateSearchRevision()
        ? `${stats.groups}/${stats.items}`
        : null;
    },
  );
}

export function unregisterDuplicateStats() {
  if (typeof restore === "function")
    restore();
  else
    restore?.dispose();
  restore = undefined;
  counts.clear();
}

export function invalidateDuplicateStats() {
  counts.clear();
}

/** Statistics refresh on demand, never during a menu render or for each imported item. */
export async function refreshDuplicateStats(libraryID = Zotero.Libraries.userLibraryID) {
  if (!getPref("duplicates.showStats" as any, true))
    return;
  if (pending.has(libraryID))
    return pending.get(libraryID);
  const task = (async () => {
    const revision = duplicateSearchRevision();
    const items = (await Zotero.Items.getAll(libraryID, true, false)).filter(item => item.isRegularItem());
    const pairs = await findDuplicates(items, undefined, true);
    if (!addon.data.alive || revision !== duplicateSearchRevision())
      return;
    const groups = duplicateGroups(pairs);
    counts.set(libraryID, { groups: groups.length, items: groups.reduce((total, group) => total + group.length, 0), revision });
    await Zotero.Notifier.trigger("redraw", "collection", []);
  })().catch((error) => {
    createLogger("duplicate-stats").error(error);
    throw error;
  }).finally(() => pending.delete(libraryID));
  pending.set(libraryID, task);
  return task;
}
