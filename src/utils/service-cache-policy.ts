export const SERVICE_CACHE_TTL = 72 * 60 * 60_000;
export const SERVICE_CACHE_LIMIT = 1024;
export const SERVICE_CACHE_MEMORY_LIMIT = 512;
export const SERVICE_CACHE_BYTES = 8 * 1024 * 1024;
export const SERVICE_CACHE_ENTRY_BYTES = 512 * 1024;
export const PUBLIC_CACHE_TTL = 5 * 60_000;
export const PUBLIC_CACHE_LIMIT = 128;
export const PUBLIC_CACHE_BYTES = 4 * 1024 * 1024;
export const SERVICE_MEMORY_BYTES = 16 * 1024 * 1024;

export function serviceCacheTTL(namespace: string): number {
  return namespace === "easyscholar" || namespace === "crossref" ? SERVICE_CACHE_TTL : namespace === "semantic-scholar" ? 24 * 60 * 60_000 : PUBLIC_CACHE_TTL;
}

export function publicationCacheName(title: string): string {
  return title.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}
