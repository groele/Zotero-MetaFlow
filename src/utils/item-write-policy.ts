/** Re-evaluate eligibility at the mutation/transaction boundary, not only at selection time. */
export function isTrashedItem(item: Zotero.Item): boolean {
  return Boolean(item.deleted || (item as Zotero.Item & { inTrash?: boolean }).inTrash);
}

export function isWritableItem(item: Zotero.Item): boolean {
  return !isTrashedItem(item) && item.isEditable();
}
