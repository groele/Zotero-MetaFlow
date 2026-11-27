import { isNonDuplicate } from "../../../services/duplicates/non-duplicates";
import { defineRule } from "../../../services/lint/rule-base";
import { cachedDuplicateSearch } from "../../../utils/duplicate-search-cache";
import { getString } from "../../../utils/locale";

interface NoItemDuplicationOptions {
  duplicateItemIdsByLibrary: Map<number, Set<number>>;
  failedLibraries: Map<number, string>;
}

export const NoItemDuplication = defineRule<NoItemDuplicationOptions>({
  id: "no-item-duplication",
  scope: "item",

  async prepare({ items, debug }) {
    const libraryIds = new Set<number>();
    for (const item of items) {
      if (item.libraryID !== undefined) {
        libraryIds.add(item.libraryID);
      }
    }

    const duplicateItemIdsByLibrary = new Map<number, Set<number>>();
    const failedLibraries = new Map<number, string>();
    for (const libraryID of libraryIds) {
      try {
        duplicateItemIdsByLibrary.set(libraryID, await cachedDuplicateSearch(libraryID, async () => {
          // @ts-expect-error miss types for `Zotero.Duplicates`
          const duplicates = new Zotero.Duplicates(libraryID);
          const search = (await duplicates.getSearchObject()) as Zotero.Search;
          const found = await search.search();
          return new Set(found.filter((id) => {
            const item = Zotero.Items.get(id);
            if (!item)
              return false;
            return duplicates.getSetItemsByItemID(id).some((otherID: number) => {
              const other = Zotero.Items.get(otherID);
              return other && otherID !== id && !isNonDuplicate(item, other);
            });
          }));
        }));
      }
      catch (e) {
        failedLibraries.set(libraryID, e instanceof Error ? e.message : String(e));
        debug(`Failed to search duplicates for library ${libraryID}:`, e);
      }
    }

    return { duplicateItemIdsByLibrary, failedLibraries };
  },

  async apply({ item, options, report, debug }) {
    if (options.failedLibraries.has(item.libraryID)) {
      report({
        level: "error",
        message: getString("rule-no-item-duplication-search-failed", { args: { error: options.failedLibraries.get(item.libraryID)! } }),
      });
      return;
    }
    const duplicateIds = options?.duplicateItemIdsByLibrary?.get(item.libraryID);
    const isDuplicate = duplicateIds ? duplicateIds.has(item.id) : false;

    if (isDuplicate) {
      report({
        level: "warning",
        message: getString("rule-no-item-duplication-report-message"),
        action: {
          label: getString("rule-no-item-duplication-report-action"),
          callback: async () => {
            const mainWindow = Zotero.getMainWindow();
            if (!mainWindow)
              return;

            // Un-minimize if minimized
            if (mainWindow.windowState === mainWindow.STATE_MINIMIZED)
              mainWindow.restore();

            // Focus the main window
            mainWindow.focus();

            // Focus to item tree view
            mainWindow.Zotero_Tabs.select("zotero-pane");

            // Focus to 'duplicates' collection
            mainWindow.ZoteroPane.setVirtual(item.libraryID, "duplicates", true, true);
            const current = Zotero.Items.get(item.id);
            if (current && !current.deleted)
              await addon.hooks.onLintInBatch("tool-review-duplicates", [current]);
          },
        },
      });
    }
    else {
      debug("No duplicates found");
    }
  },
});
