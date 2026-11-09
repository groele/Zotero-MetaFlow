import { ensureMetaFlowCacheDirectory, metaflowCacheDirectory } from "./cache-paths";
import { createLogger } from "./logger";
import { SERVICE_CACHE_BYTES, SERVICE_CACHE_ENTRY_BYTES, SERVICE_CACHE_LIMIT, SERVICE_CACHE_TTL, serviceCacheTTL } from "./service-cache-policy";

interface StoredResponse { status: number; response: string; responseText: string }
interface Entry { expires: number; value?: StoredResponse; alias?: string }
const logger = createLogger("service-cache");
const entries = new Map<string, Entry>();
const sizes = new Map<string, number>();
let bytes = 0;
let ready: Promise<void> | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let writes = Promise.resolve(true);
let generation = 0;
let session = 0;
let revision = 0;
let dirty = false;
let queuedRevision = -1;
let readOnly = false;
let writeFailed = false;
const validKey = /^(?:easyscholar|semantic-scholar):[a-f0-9]{32}$/;
function path() {
  return typeof IOUtils !== "undefined" && (Zotero as any).Profile?.dir
    ? PathUtils.join(metaflowCacheDirectory(), "api-responses-v1.json")
    : undefined;
}
const digest = (key: string) => `${key.slice(0, key.indexOf(":"))}:${Zotero.Utilities.Internal.md5(key)}`;
function remove(key: string) {
  bytes -= sizes.get(key) || 0;
  sizes.delete(key);
  const primary = entries.get(key)?.value;
  entries.delete(key);
  if (primary) {
    for (const [alias, entry] of entries) {
      if (entry.alias === key)
        remove(alias);
    }
  }
}
function put(key: string, entry: Entry) {
  const size = new TextEncoder().encode(JSON.stringify([key, entry])).byteLength + 1;
  if (size > SERVICE_CACHE_ENTRY_BYTES || (entry.alias && !entries.get(entry.alias)?.value))
    return false;
  remove(key);
  entries.set(key, entry);
  sizes.set(key, size);
  bytes += size;
  while (entries.size > SERVICE_CACHE_LIMIT || bytes > SERVICE_CACHE_BYTES - 128)
    remove(entries.keys().next().value!);
  return true;
}
function touch(key: string) {
  const entry = entries.get(key);
  if (entry) {
    entries.delete(key);
    entries.set(key, entry);
  }
}
async function load() {
  ready ||= (async () => {
    const token = session;
    const file = path();
    if (!file)
      return;
    try {
      const source = file;
      if (!await IOUtils.exists(source) || (await IOUtils.stat(source)).size! > SERVICE_CACHE_BYTES * 2)
        return;
      const data = await IOUtils.readJSON(source) as { version?: number; entries?: [string, Entry][] };
      if (token !== session)
        return;
      if ((data.version || 0) > 3) {
        readOnly = true;
        return;
      }
      if (![1, 2, 3].includes(data.version || 0) || !Array.isArray(data.entries))
        return;
      const valid: [string, Entry][] = [];
      for (const row of data.entries.slice(-SERVICE_CACHE_LIMIT)) {
        if (!Array.isArray(row) || row.length !== 2)
          continue;
        const [key, entry] = row;
        if (typeof key !== "string" || !validKey.test(key) || !Number.isFinite(entry?.expires))
          continue;
        const ttl = serviceCacheTTL(key.split(":")[0]);
        const legacyTTL = data.version === 1 ? 6 * 60 * 60_000 : SERVICE_CACHE_TTL;
        const expires = data.version === 3 ? entry.expires : Math.min(entry.expires, entry.expires - legacyTTL + ttl);
        if (expires <= Date.now() || expires > Date.now() + ttl)
          continue;
        if ((entry.value?.status === 200 && typeof entry.value.response === "string" && typeof entry.value.responseText === "string") || (typeof entry.alias === "string" && validKey.test(entry.alias) && entry.alias.split(":")[0] === key.split(":")[0] && entry.alias !== key))
          valid.push([key, entry.value ? { expires, value: { status: 200, response: entry.value.response, responseText: entry.value.responseText } } : { expires, alias: entry.alias }]);
      }
      for (const [key, entry] of valid.filter(([, entry]) => entry.value))
        put(key, entry);
      for (const [key, entry] of valid.filter(([, entry]) => entry.alias))
        put(key, entry);
      dirty = data.version !== 3 || entries.size !== data.entries.length;
      if (dirty)
        revision++;
    }
    catch (error) { logger.debug("Ignoring unreadable API cache", error); }
  })();
  await ready;
}
function schedule() {
  if (!path() || readOnly)
    return;
  dirty = true;
  revision++;
  clearTimeout(timer);
  timer = setTimeout(() => {
    timer = undefined;
    void flushServiceCache();
  }, 500);
}
export async function readServiceCache(key: string) {
  if (!path())
    return;
  await load();
  const hash = digest(key);
  const entry = entries.get(hash);
  const target = entry?.alias ? entries.get(entry.alias) : entry;
  const expires = Math.min(entry?.expires || 0, target?.expires || 0);
  if (!target?.value || expires <= Date.now()) {
    if (entry) {
      remove(hash);
      schedule();
    }
    return;
  }
  if (entry?.alias)
    touch(entry.alias);
  touch(hash);
  return { ...target.value, _metaflowCacheExpires: expires };
}
export async function storeServiceCache(key: string, value: StoredResponse, expires: number) {
  if (!path())
    return;
  const token = generation;
  await load();
  if (token !== generation || readOnly)
    return;
  if (put(digest(key), { value, expires }))
    schedule();
}
export async function storeServiceAliases(key: string, aliases: string[], value: StoredResponse, expires: number) {
  if (!path())
    return;
  const token = generation;
  await load();
  if (token !== generation || readOnly)
    return;
  const hash = digest(key);
  const primary = entries.get(hash)?.alias || hash;
  let changed = false;
  if (!entries.get(primary)?.value) {
    if (!put(primary, { value, expires }))
      return;
    changed = true;
  }
  touch(primary);
  const deadline = Math.min(expires, entries.get(primary)!.expires);
  for (const alias of aliases) {
    const target = digest(alias);
    const previous = entries.get(target);
    if (target !== primary && (previous?.alias !== primary || previous.expires !== deadline || previous.value))
      changed = put(target, { alias: primary, expires: deadline }) || changed;
  }
  if (changed)
    schedule();
}
export async function clearStoredServiceCache(namespace?: string, requireWrite = false) {
  generation++;
  await load();
  if (readOnly) {
    if (requireWrite)
      throw new Error("A newer cache format must be cleared by its owning plugin version");
    return;
  }
  for (const key of entries.keys()) {
    if (!namespace || key.startsWith(`${namespace}:`))
      remove(key);
  }
  schedule();
  if (await flushServiceCache() === false && requireWrite)
    throw new Error("API cache could not be cleared on disk");
}
export async function flushServiceCache() {
  clearTimeout(timer);
  timer = undefined;
  const file = path();
  if (!file)
    return;
  await load();
  for (const [key, entry] of entries) {
    if (entry.expires <= Date.now()) {
      remove(key);
      dirty = true;
      revision++;
    }
  }
  if (readOnly || !dirty || queuedRevision === revision)
    return writes;
  const token = revision;
  const snapshot = { version: 3, entries: [...entries] };
  queuedRevision = token;
  writes = writes.then(async () => {
    await ensureMetaFlowCacheDirectory();
    await IOUtils.writeJSON(file, snapshot, { tmpPath: `${file}.tmp` });
    writeFailed = false;
    if (revision === token)
      dirty = false;
    return true;
  }).catch((error) => {
    if (queuedRevision === token)
      queuedRevision = -1;
    logger.debug("API cache write failed", error);
    writeFailed = true;
    return false;
  });
  return writes;
}
export function resetServiceCacheSession() {
  clearTimeout(timer);
  timer = undefined;
  entries.clear();
  sizes.clear();
  bytes = 0;
  ready = undefined;
  dirty = false;
  readOnly = false;
  writeFailed = false;
  queuedRevision = -1;
  revision++;
  generation++;
  session++;
}

export async function getServiceCacheStatus() {
  await load();
  return { entries: entries.size, bytes, readOnly, writeFailed };
}
