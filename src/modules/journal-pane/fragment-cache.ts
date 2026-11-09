const MAX_FRAGMENTS_PER_DOC = 128;

let docCaches = new WeakMap<Document, Map<string, HTMLElement>>();
let cacheGeneration = 0;
let fragmentHits = 0;
let fragmentMisses = 0;

export interface JournalCardCachePayload {
  locale: string;
  itemType: string;
  headingText: string;
  badgeKind: string;
  noticeKind: string;
  noticeDOI: string;
  supportsRankings: boolean;
  editable: boolean;
  messages: { level?: string; message: string }[];
  displayedRankings: { key: string; labelID: string; value: string }[];
  sciRanking?: { key: string; labelID: string; value: string };
  rows: { label: string; value: string; matched?: boolean; basis?: string; source?: string; warning?: string }[];
  matchBases: string[];
  issn: string;
}

export function computeJournalCardCacheKey(payload: JournalCardCachePayload): string {
  return `${cacheGeneration}:${JSON.stringify(payload)}`;
}

export function getCachedJournalCardClone(doc: Document | null | undefined, key: string): HTMLElement | undefined {
  if (!doc || !key) {
    fragmentMisses++;
    return undefined;
  }
  const map = docCaches.get(doc);
  const template = map?.get(key);
  if (!template) {
    fragmentMisses++;
    return undefined;
  }
  map!.delete(key);
  map!.set(key, template);
  fragmentHits++;
  return template.cloneNode(true) as HTMLElement;
}

export function storeCachedJournalCardTemplate(doc: Document | null | undefined, key: string, container: HTMLElement): void {
  if (!doc || !key)
    return;
  let map = docCaches.get(doc);
  if (!map) {
    map = new Map<string, HTMLElement>();
    docCaches.set(doc, map);
  }
  map.delete(key);
  while (map.size >= MAX_FRAGMENTS_PER_DOC) {
    const oldest = map.keys().next().value;
    if (oldest === undefined)
      break;
    map.delete(oldest);
  }
  map.set(key, container.cloneNode(true) as HTMLElement);
}

export function clearJournalPaneFragmentCache(): void {
  cacheGeneration++;
  docCaches = new WeakMap<Document, Map<string, HTMLElement>>();
  fragmentHits = 0;
  fragmentMisses = 0;
}

export function getJournalPaneFragmentCacheStats(): { hits: number; misses: number; generation: number } {
  return {
    hits: fragmentHits,
    misses: fragmentMisses,
    generation: cacheGeneration,
  };
}
