import type { JournalDatasetKind } from "./journal-datasets";
import { DataLoader } from "./data-loader";
import { parseESIDataset, parseNatureDataset } from "./journal-datasets";

const writingBuiltin = new Map<JournalDatasetKind, Promise<string>>();

export function builtinJournalDatabasePath(kind: JournalDatasetKind): string {
  const filename = kind === "esi" ? "esi-journals.json" : "nature-index-journals.json";
  if (typeof PathUtils !== "undefined" && typeof (Zotero as any)?.Profile?.dir === "string")
    return PathUtils.join((Zotero as any).Profile.dir, "metaflow", filename);
  const base = typeof rootURI === "string" && rootURI ? rootURI : "chrome://zoterometaflow/";
  return `${base}data/${kind === "esi" ? "esi/esi-journals.json" : "nature-index/nature-index-journals.json"}`;
}

export function writeBuiltinJournalDatabaseFile(kind: JournalDatasetKind): Promise<string> {
  const inflight = writingBuiltin.get(kind);
  if (inflight)
    return inflight;
  const task = (async () => {
    const path = builtinJournalDatabasePath(kind);
    if (typeof IOUtils === "undefined" || typeof PathUtils === "undefined" || typeof (Zotero as any)?.Profile?.dir !== "string")
      return path;
    const data = await DataLoader.load(kind === "esi" ? "esiJournals" : "natureIndexJournals");
    await IOUtils.makeDirectory(PathUtils.join((Zotero as any).Profile.dir, "metaflow"), { ignoreExisting: true });
    await IOUtils.writeJSON(path, data, { tmpPath: `${path}.tmp` });
    DataLoader.invalidateFile(path);
    return path;
  })().finally(() => {
    writingBuiltin.delete(kind);
  });
  writingBuiltin.set(kind, task);
  return task;
}

export async function validateJournalDatabase(kind: JournalDatasetKind, path: string) {
  DataLoader.clearCache();
  const data = path
    ? await DataLoader.load(/\.csv$/i.test(path) ? "csv" : "json", path, { noheader: false })
    : await DataLoader.load(kind === "esi" ? "esiJournals" : "natureIndexJournals");
  const records = kind === "esi" ? parseESIDataset(data) : parseNatureDataset(data);
  return { records: records.length, journals: records.filter(entry => !("type" in entry) || entry.type === "journal").length };
}

export async function exportJournalDatabase(kind: JournalDatasetKind, path: string) {
  const data = await DataLoader.load(kind === "esi" ? "esiJournals" : "natureIndexJournals");
  if (kind === "esi")
    parseESIDataset(data);
  else
    parseNatureDataset(data);
  await Zotero.File.putContentsAsync(path, `${JSON.stringify(data, null, 2)}\n`);
}
