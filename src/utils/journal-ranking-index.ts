import type { EasyScholarField, EasyScholarRank } from "./easyscholar";
import { EASYSCHOLAR_FIELD_DEFINITIONS } from "./easyscholar";
import { extractValidISSNs, normalizeJournalTitle } from "./journal-identity";
import { createLogger } from "./logger";

interface Entry { updatedAt: number; values: Partial<Record<EasyScholarField, string>>; issns?: string[]; removed?: EasyScholarField[] }
interface Store { version: 1; entries: Record<string, Entry> }
const logger = createLogger("journal-ranking-index");
const entries = new Map<string, Entry>();
const MAX_ENTRIES = 20_000;
const MEMBERSHIP_FIELDS = new Set<EasyScholarField>(["sci", "ssci", "ei", "utd24", "ft50", "cssci", "pku", "cscd", "technologyCore"]);
let ready: Promise<void> | undefined;
let writes = Promise.resolve();
let timer: ReturnType<typeof setTimeout> | undefined;
let revision = 0;
let dirty = false;
let queuedRevision = -1;
let readOnly = false;
let generation = 0;

function filePath() {
  return typeof IOUtils !== "undefined" && (Zotero as any).Profile?.dir
    ? PathUtils.join((Zotero as any).Profile.dir, "metaflow-journal-rankings-v1.json")
    : undefined;
}

function keys(item: Zotero.Item) {
  const type = item.itemType === "conferencePaper" ? "conference" : "journal";
  const title = item.itemType === "conferencePaper"
    ? item.getField("proceedingsTitle") || item.getField("conferenceName")
    : item.getField("publicationTitle");
  const issns = extractValidISSNs(item.getField("ISSN"));
  const normalized = normalizeJournalTitle(title);
  return [...issns.map(value => `${type}:issn:${value}`), ...(normalized ? [`${type}:title:${normalized}`] : [])];
}

async function load() {
  ready ||= (async () => {
    const token = generation;
    const path = filePath();
    if (!path)
      return;
    try {
      if (!(await IOUtils.exists(path)))
        return;
      const store = await IOUtils.readJSON(path) as Store;
      if (token !== generation)
        return;
      if (store.version > 1) {
        readOnly = true;
        logger.warn("Journal ranking index uses a newer format; preserving the file without rewriting it");
        return;
      }
      if (store.version !== 1 || !store.entries || typeof store.entries !== "object" || Array.isArray(store.entries)) {
        readOnly = true;
        logger.warn("Journal ranking index has an unrecognized structure; preserving the file without rewriting it");
        return;
      }
      for (const [key, entry] of Object.entries(store.entries).slice(-MAX_ENTRIES)) {
        if (!key || !Number.isSafeInteger(entry?.updatedAt) || entry.updatedAt < 0 || !entry.values || typeof entry.values !== "object" || Array.isArray(entry.values))
          continue;
        const values: Entry["values"] = {};
        for (const field of EASYSCHOLAR_FIELD_DEFINITIONS) {
          const value = entry.values[field.key];
          if (typeof value === "string" && value.trim())
            values[field.key] = value.trim();
        }
        // An explicit empty snapshot records a removal. Dropping it would let
        // an older alias restore the removed membership after a restart.
        if (Object.keys(values).length || Object.keys(entry.values).length === 0) {
          const issns = Array.isArray(entry.issns) ? [...new Set(entry.issns.filter(value => typeof value === "string" && /^\d{7}[\dX]$/.test(value)))] : undefined;
          const removed = Array.isArray(entry.removed) ? [...new Set(entry.removed.filter(field => MEMBERSHIP_FIELDS.has(field)))] : undefined;
          entries.set(key, { updatedAt: entry.updatedAt, values, ...issns && { issns }, ...removed?.length && { removed } });
        }
      }
    }
    catch (error) {
      if (token !== generation)
        return;
      readOnly = true;
      logger.warn("Unable to load local journal rankings; preserving the file and using session-only updates", error);
    }
  })();
  await ready;
}

function scheduleWrite() {
  if (readOnly)
    return;
  if (timer)
    clearTimeout(timer);
  timer = setTimeout(() => {
    timer = undefined;
    void flushJournalRankingIndex().catch(error => logger.error("Unable to save local journal rankings", error));
  }, 250);
}

export async function loadJournalRankingIndex() {
  await load();
}

function matchingSnapshot(item: Zotero.Item) {
  const itemKeys = keys(item);
  const issns = itemKeys.filter(key => key.includes(":issn:")).map(key => key.split(":issn:")[1]);
  const knownISSN = itemKeys.some(key => key.includes(":issn:") && entries.has(key));
  const candidates = new Set(itemKeys);
  const type = item.itemType === "conferencePaper" ? "conference" : "journal";
  let latest: Entry | undefined;
  for (const key of candidates) {
    const entry = entries.get(key);
    if (!entry)
      continue;
    const conflicting = issns.length && entry.issns?.length && !entry.issns.some(value => issns.includes(value));
    if (conflicting)
      continue;
    // Legacy title rows have no identity evidence. Keep an explicit ISSN's
    // established precedence until a verified update supplies that evidence.
    if (knownISSN && key.includes(":title:") && !entry.issns?.length)
      continue;
    // Follow only identities already recorded by eligible snapshots. This
    // repairs older print/electronic aliases without a full index scan.
    for (const issn of entry.issns || [])
      candidates.add(`${type}:issn:${issn}`);
    if (!latest || entry.updatedAt > latest.updatedAt)
      latest = entry;
  }
  return { latest, itemKeys, issns };
}

export function readJournalRankingIndex(item: Zotero.Item, fallback?: ReadonlyMap<EasyScholarField, string>) {
  const { latest } = matchingSnapshot(item);
  // Every saved entry is a complete snapshot. Mixing older aliases into the
  // latest one can revive a deliberately removed value.
  const values = new Map([...fallback || [], ...Object.entries(latest?.values || {}) as [EasyScholarField, string][]]);
  for (const field of latest?.removed || [])
    values.delete(field);
  return values;
}

export async function saveJournalRankingIndex(item: Zotero.Item, values: Partial<EasyScholarRank>, selected: ReadonlySet<EasyScholarField>, mode: "blank" | "all" = "all") {
  await load();
  const { latest, itemKeys, issns } = matchingSnapshot(item);
  if (!itemKeys.length || !selected.size)
    return;
  const existing = new Map(Object.entries(latest?.values || {}) as [EasyScholarField, string][]);
  const next = new Map(existing);
  const removed = new Set(latest?.removed || []);
  let changed = false;
  for (const field of selected) {
    if (mode === "blank" && next.has(field))
      continue;
    const value = values[field];
    if (typeof value === "string" && value.trim()) {
      if (MEMBERSHIP_FIELDS.has(field) && /^(?:否|no|false|0)$/i.test(value.trim())) {
        changed = !removed.has(field) || changed;
        removed.add(field);
        changed = next.delete(field) || changed;
      }
      else {
        changed = removed.delete(field) || changed;
        if (next.get(field) !== value.trim()) {
          next.set(field, value.trim());
          changed = true;
        }
      }
    }
  }
  const identity = [...new Set([...latest?.issns || [], ...issns])];
  const type = item.itemType === "conferencePaper" ? "conference" : "journal";
  const safeKeys = itemKeys.filter((key) => {
    if (!key.includes(":title:") || !issns.length)
      return true;
    const existingTitle = entries.get(key);
    return !existingTitle?.issns?.length || existingTitle.issns.some(value => issns.includes(value));
  });
  const writeKeys = new Set([...safeKeys, ...identity.map(issn => `${type}:issn:${issn}`)]);
  const existingAliases = [...writeKeys].map(key => entries.get(key));
  const aliasChanged = existingAliases.some(entry => entry
    ? Object.keys(entry.values).length !== next.size || [...next].some(([field, value]) => entry.values[field] !== value)
    || entry.issns?.length !== identity.length || identity.some(value => !entry.issns?.includes(value))
    || (entry.removed?.length || 0) !== removed.size || [...removed].some(field => !entry.removed?.includes(field))
    : next.size > 0 || existingAliases.some(Boolean));
  if (!changed && !aliasChanged)
    return { sessionOnly: readOnly };
  dirty = true;
  revision++;
  const updatedAt = Math.max(Date.now(), ...existingAliases.map(entry => (entry?.updatedAt ?? -1) + 1));
  const snapshot: Entry = { updatedAt, values: Object.fromEntries(next) as Entry["values"], issns: identity, ...removed.size && { removed: [...removed] } };
  for (const key of writeKeys) {
    entries.delete(key);
    entries.set(key, snapshot);
  }
  while (entries.size > MAX_ENTRIES)
    entries.delete(entries.keys().next().value!);
  scheduleWrite();
  return { sessionOnly: readOnly };
}

export async function flushJournalRankingIndex() {
  if (timer) {
    clearTimeout(timer);
    timer = undefined;
  }
  const path = filePath();
  if (!path)
    return;
  if (readOnly || !dirty || queuedRevision === revision)
    return writes;
  const token = revision;
  queuedRevision = token;
  const data: Store = { version: 1, entries: Object.fromEntries(entries) };
  const write = writes.catch(() => {}).then(async () => {
    await IOUtils.writeJSON(path, data, { tmpPath: `${path}.tmp` });
    if (revision === token)
      dirty = false;
  }).catch((error) => {
    if (queuedRevision === token)
      queuedRevision = -1;
    throw error;
  });
  writes = write;
  await write;
}

export function resetJournalRankingIndex() {
  generation++;
  if (timer) {
    clearTimeout(timer);
    timer = undefined;
  }
  entries.clear();
  ready = undefined;
  dirty = false;
  readOnly = false;
  queuedRevision = -1;
  revision++;
}
