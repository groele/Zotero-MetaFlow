import { DataLoader } from "./data-loader";

let writing: Promise<string> | undefined;

export function builtinAbbreviationPath(): string {
  return PathUtils.join((Zotero as any).Profile.dir, "metaflow", "journal-abbr.json");
}

/** Materialize the bundled table atomically; custom source files are never overwritten. */
export function writeBuiltinAbbreviationFile(): Promise<string> {
  if (writing)
    return writing;
  writing = (async () => {
    const path = builtinAbbreviationPath();
    const data = await DataLoader.load("journalAbbr");
    await IOUtils.makeDirectory(PathUtils.join((Zotero as any).Profile.dir, "metaflow"), { ignoreExisting: true });
    await IOUtils.writeJSON(path, data, { tmpPath: `${path}.tmp` });
    DataLoader.invalidateFile(path);
    return path;
  })().finally(() => { writing = undefined; });
  return writing;
}

export function isBuiltinAbbreviationPath(path: string): boolean {
  return typeof PathUtils !== "undefined" && typeof (Zotero as any).Profile?.dir === "string"
    && path === builtinAbbreviationPath();
}
