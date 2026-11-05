/** Value changes redraw all live item trees without rebuilding columns or restoring old selections. */
export async function redrawItemValues(itemIDs: readonly number[] = []): Promise<void> {
  if (typeof addon !== "undefined" && !addon.data.alive)
    return;
  if (typeof Zotero === "undefined" || !Zotero.Notifier?.trigger)
    return;
  const ids = [...new Set(itemIDs.filter(id => Number.isSafeInteger(id) && id > 0))];
  if (itemIDs.length && !ids.length)
    return;
  // Zotero 10 caches formatted custom-column values per row. Invalidate that
  // public cache before redraw without resetting columns or selection.
  for (const win of Zotero.getMainWindows?.() ?? []) {
    if (win.closed)
      continue;
    const view = win.ZoteroPane?.itemsView as unknown as { invalidateRowCache?: (ids: number[] | true) => void } | undefined;
    view?.invalidateRowCache?.(ids.length ? ids : true);
  }
  await Zotero.Notifier.trigger("redraw", "item", ids, {});
}
