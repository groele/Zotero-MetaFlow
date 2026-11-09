export function metaflowCacheDirectory() {
  return PathUtils.join((Zotero as any).Profile.dir, "zotero-metaflow-cache");
}

export async function ensureMetaFlowCacheDirectory() {
  await IOUtils.makeDirectory(metaflowCacheDirectory(), { ignoreExisting: true, createAncestors: true });
}
