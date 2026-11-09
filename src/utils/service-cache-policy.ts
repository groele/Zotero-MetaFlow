export const SERVICE_CACHE_TTL = 72 * 60 * 60_000;
export const SERVICE_CACHE_LIMIT = 1024;
export const SERVICE_CACHE_MEMORY_LIMIT = 512;
export const SERVICE_CACHE_BYTES = 8 * 1024 * 1024;
export const SERVICE_CACHE_ENTRY_BYTES = 512 * 1024;
export const PUBLIC_CACHE_TTL = 5 * 60_000;
export const PUBLIC_CACHE_LIMIT = 128;
export const PUBLIC_CACHE_BYTES = 4 * 1024 * 1024;
export const SERVICE_MEMORY_BYTES = 16 * 1024 * 1024;

function readIntPref(key: string, fallback: number, min: number, max: number): number {
  try {
    const value = (Zotero as any)?.Prefs?.get?.(`extensions.zotero.metaref.${key}`, true);
    const num = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
    return Number.isInteger(num) && num >= min && num <= max ? num : fallback;
  }
  catch {
    return fallback;
  }
}

export function easyScholarCacheHours(): number {
  return readIntPref("cache.easyScholarHours", 72, 1, 720);
}

export function semanticScholarCacheHours(): number {
  return readIntPref("cache.semanticScholarHours", 24, 1, 720);
}

export function serviceCacheMaxMiB(): number {
  return readIntPref("cache.maxMiB", 8, 1, 64);
}

export function serviceCacheLimit(): number {
  return readIntPref("cache.maxEntries", SERVICE_CACHE_LIMIT, 64, 10_000);
}

export function serviceCacheBytes(): number {
  return serviceCacheMaxMiB() * 1024 * 1024;
}

export function serviceCacheTTL(namespace: string): number {
  return namespace === "easyscholar" || namespace === "crossref"
    ? easyScholarCacheHours() * 60 * 60_000
    : namespace === "semantic-scholar"
      ? semanticScholarCacheHours() * 60 * 60_000
      : PUBLIC_CACHE_TTL;
}

export function publicationCacheName(title: string): string {
  return title.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}
