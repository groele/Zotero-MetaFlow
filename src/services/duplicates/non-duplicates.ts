import { clearDuplicateSearchCache } from "../../utils/duplicate-search-cache";
import { getString } from "../../utils/locale";
import { createLogger } from "../../utils/logger";
import { getPref, setPref } from "../../utils/prefs";

interface NonDuplicate { libraryID: number; key1: string; key2: string }
interface PortableLibrary { libraryType: "user" | "group"; groupID: number | null; libraryName: string; pairs: { key1: string; key2: string }[] }
interface ExportData { format: "zoplicate-nonduplicates"; version: 1; exportedAt: string; libraries: PortableLibrary[] }
const validKey = (value: unknown): value is string => typeof value === "string" && /^[A-Z0-9]{8}$/.test(value);
let previous = "";
let cached: NonDuplicate[] = [];
let lookup = new Set<string>();
let participants = new Set<string>();
const pairKey = (libraryID: number, keys: string[]) => `${libraryID}:${[...keys].sort().join(":")}`;
let redrawPending = false;

function writeRecords(records: NonDuplicate[]) {
  const raw = JSON.stringify(records);
  if (raw === getPref("duplicates.nonDuplicatePairs" as any, "[]"))
    return;
  setPref("duplicates.nonDuplicatePairs" as any, raw);
  clearDuplicateSearchCache();
  if (!redrawPending) {
    redrawPending = true;
    void Promise.resolve().then(async () => {
      redrawPending = false;
      if (addon.data.alive)
        await Zotero.Notifier.trigger("redraw", "collection", []);
    }).catch(error => createLogger("non-duplicates").error(error));
  }
}

/** Retarget only after a successful host merge; size cannot grow, including at the storage limit. */
export function transferNonDuplicates(master: Zotero.Item, other: Zotero.Item) {
  const records = readRecords();
  if (!participants.has(`${other.libraryID}:${other.key}`))
    return;
  const seen = new Set<string>();
  const transferred: NonDuplicate[] = [];
  for (const record of records) {
    const next = record.libraryID === other.libraryID
      ? { ...record, key1: record.key1 === other.key ? master.key : record.key1, key2: record.key2 === other.key ? master.key : record.key2 }
      : record;
    const key = pairKey(next.libraryID, [next.key1, next.key2]);
    if (next.key1 !== next.key2 && !seen.has(key)) {
      seen.add(key);
      transferred.push(next);
    }
  }
  writeRecords(transferred);
}

function readRecords(): NonDuplicate[] {
  const raw = getPref("duplicates.nonDuplicatePairs" as any, "[]") as string;
  if (raw === previous)
    return cached;
  const records: unknown = JSON.parse(raw);
  if (!Array.isArray(records) || records.length > 10_000 || records.some(record => !Number.isSafeInteger(record?.libraryID) || !validKey(record?.key1) || !validKey(record?.key2) || record.key1 === record.key2))
    throw new Error(getString("duplicates-invalid-data"));
  cached = records;
  previous = raw;
  lookup = new Set(cached.map(record => pairKey(record.libraryID, [record.key1, record.key2])));
  participants = new Set(cached.flatMap(record => [`${record.libraryID}:${record.key1}`, `${record.libraryID}:${record.key2}`]));
  return cached;
}

export function isNonDuplicate(left: Zotero.Item, right: Zotero.Item): boolean {
  readRecords();
  return left.libraryID === right.libraryID && lookup.has(pairKey(left.libraryID, [left.key, right.key]));
}

export function markNonDuplicate(left: Zotero.Item, right: Zotero.Item) {
  if (left.libraryID !== right.libraryID || left.id === right.id || left.deleted || right.deleted || !left.isRegularItem() || !right.isRegularItem())
    throw new Error(getString("duplicates-invalid-data"));
  const records = readRecords();
  if (!isNonDuplicate(left, right)) {
    if (records.length >= 10_000)
      throw new Error(getString("duplicates-invalid-data"));
    writeRecords([...records, { libraryID: left.libraryID, key1: left.key, key2: right.key }]);
  }
}

export function exportNonDuplicates(): ExportData {
  const libraries: PortableLibrary[] = [];
  for (const lib of Zotero.Libraries.getAll()) {
    if (lib.libraryType !== "user" && lib.libraryType !== "group")
      continue;
    const pairs = readRecords().filter((record) => {
      if (record.libraryID !== lib.libraryID)
        return false;
      const left = Zotero.Items.getByLibraryAndKey(lib.libraryID, record.key1);
      const right = Zotero.Items.getByLibraryAndKey(lib.libraryID, record.key2);
      return left && right && !left.deleted && !right.deleted && left.isRegularItem() && right.isRegularItem();
    }).map(({ key1, key2 }) => ({ key1, key2 }));
    if (pairs.length)
      libraries.push({ libraryType: lib.libraryType, groupID: lib.libraryType === "group" ? Zotero.Groups.getGroupIDFromLibraryID(lib.libraryID) : null, libraryName: lib.name, pairs });
  }
  return { format: "zoplicate-nonduplicates", version: 1, exportedAt: new Date().toISOString(), libraries };
}

export async function importNonDuplicates(data: unknown) {
  const value = data as ExportData;
  if (!value || value.format !== "zoplicate-nonduplicates" || value.version !== 1 || !Array.isArray(value.libraries)
    || value.libraries.some(lib => !lib || !["user", "group"].includes(lib.libraryType) || !Array.isArray(lib.pairs) || lib.pairs.some(pair => !validKey(pair?.key1) || !validKey(pair?.key2) || pair.key1 === pair.key2))
    || value.libraries.reduce((total, lib) => total + lib.pairs.length, 0) > 10_000) {
    throw new Error(getString("duplicates-invalid-data"));
  }
  const pending: NonDuplicate[] = [];
  const known = new Set(readRecords().map(record => pairKey(record.libraryID, [record.key1, record.key2])));
  let imported = 0;
  let skipped = 0;
  for (const entry of value.libraries) {
    const libraryID = entry.libraryType === "user"
      ? Zotero.Libraries.userLibraryID
      : Zotero.Libraries.getAll().find(lib => lib.libraryType === "group" && Zotero.Groups.getGroupIDFromLibraryID(lib.libraryID) === entry.groupID)?.libraryID;
    for (const pair of entry.pairs) {
      const left = libraryID && await Zotero.Items.getByLibraryAndKeyAsync(libraryID, pair.key1);
      const right = libraryID && await Zotero.Items.getByLibraryAndKeyAsync(libraryID, pair.key2);
      const key = pairKey(libraryID || 0, [pair.key1, pair.key2]);
      if (!left || !right || left.deleted || right.deleted || !left.isRegularItem() || !right.isRegularItem() || known.has(key)) {
        skipped++;
        continue;
      }
      known.add(key);
      pending.push({ libraryID: libraryID!, key1: pair.key1, key2: pair.key2 });
      imported++;
    }
  }
  // Item resolution yields to other dialogs; preserve decisions written while it was pending.
  const records = [...readRecords()];
  const current = new Set(records.map(record => pairKey(record.libraryID, [record.key1, record.key2])));
  for (const record of pending) {
    const key = pairKey(record.libraryID, [record.key1, record.key2]);
    if (current.has(key)) {
      imported--;
      skipped++;
    }
    else {
      current.add(key);
      records.push(record);
    }
  }
  if (records.length > 10_000)
    throw new Error(getString("duplicates-invalid-data"));
  writeRecords(records);
  return { imported, skipped };
}

export function clearNonDuplicates() {
  writeRecords([]);
}
