export interface CardContext {
  item: Zotero.Item;
  body: HTMLElement;
  doc: Document;
}

export interface CardRenderOptions {
  queryMessages: Map<number, { level?: string; message: string }[]>;
  renders: WeakMap<HTMLElement, object>;
  refreshJournalPane: (itemIDs?: number[]) => Promise<void>;
}
