export const API_CACHE_FILE = "api-cache.json";
export const OPERATION_HISTORY_FILE = "operation-history.json";

const CUSTOM_DIR_PREF = "extensions.zotero.metaref.cache.customDirectory";

export function defaultMetaFlowCacheDirectory() {
  return PathUtils.join((Zotero as any).Profile.dir, "zotero-metaflow-cache");
}

export function customMetaFlowCacheDirectory(): string {
  try {
    const raw = (Zotero as any)?.Prefs?.get?.(CUSTOM_DIR_PREF, true);
    return typeof raw === "string" ? raw.trim() : "";
  }
  catch {
    return "";
  }
}

export function metaflowCacheDirectory() {
  return customMetaFlowCacheDirectory() || defaultMetaFlowCacheDirectory();
}

export async function ensureMetaFlowCacheDirectory(directory = metaflowCacheDirectory()) {
  await IOUtils.makeDirectory(directory, { ignoreExisting: true, createAncestors: true });
}
