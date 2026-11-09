/** Column fixtures must finish the host's React rebuild before selecting rows. */
export async function waitForItemTree(win: Window & typeof globalThis) {
  await Promise.resolve();
  await Zotero.Notifier.trigger("refresh", "itemtree", [], {});
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const view = win.ZoteroPane.itemsView as any;
    const update = (Zotero.ItemTreeManager as any).customColumnUpdateID;
    await view.waitForLoad();
    await Zotero.Promise.delay(50);
    if (view === win.ZoteroPane.itemsView && view.tree && update === (Zotero.ItemTreeManager as any).customColumnUpdateID)
      return;
  }
  throw new Error("Native item tree did not finish the column-fixture rebuild");
}
