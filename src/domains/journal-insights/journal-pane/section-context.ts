/** Resolve each section in its own document, including detached readers. */
export function journalPaneItem(body: HTMLElement): Zotero.Item | undefined {
  const section = body.closest("item-pane-custom-section") as (Element & { item?: Zotero.Item }) | null;
  return section?.item;
}

export function isJournalPaneItemCurrent(body: HTMLElement, item: Zotero.Item): boolean {
  return body.isConnected && journalPaneItem(body)?.id === item.id;
}
