import { requestTransport } from "./http-transport";
import { abortableDelay, waitForOperation } from "./rule-execution";
import { PUBLIC_CACHE_BYTES, PUBLIC_CACHE_LIMIT, PUBLIC_CACHE_TTL, publicationCacheName, SERVICE_CACHE_ENTRY_BYTES, SERVICE_CACHE_MEMORY_LIMIT, SERVICE_MEMORY_BYTES, serviceCacheTTL } from "./service-cache-policy";
import { clearStoredServiceCache, readServiceCache, removeStoredServiceCache, storeServiceAliases, storeServiceCache } from "./service-cache-storage";
import { withThrottle } from "./throttle";

type RequestOptions = NonNullable<Parameters<typeof Zotero.HTTP.request>[2]>;

interface CachedRequest {
  promise: ReturnType<typeof requestGET>;
  controller: AbortController;
  users: number;
  settled: boolean;
  expires: number;
  bytes: number;
}
const publicRequests = new Map<string, CachedRequest>();
const serviceRequests = new Map<string, CachedRequest>();

export function clearRequestCache() {
  for (const store of [publicRequests, serviceRequests]) {
    for (const entry of store.values()) {
      if (!entry.settled)
        entry.controller.abort(new Error("Request cache cleared"));
    }
    store.clear();
  }
}

export function clearServiceRequestCache(namespace: string) {
  void clearStoredServiceCache(namespace);
  for (const [key, entry] of serviceRequests) {
    if (key.startsWith(`${namespace}:`)) {
      if (!entry.settled)
        entry.controller.abort(new Error("Service cache cleared"));
      serviceRequests.delete(key);
    }
  }
}

export async function invalidateServiceRequest(namespace: string, url: string, options: RequestOptions = {}) {
  const key = serviceKey(namespace, url, options);
  const entry = serviceRequests.get(key);
  if (entry) {
    if (!entry.settled)
      entry.controller.abort(new Error("Service request invalidated"));
    serviceRequests.delete(key);
  }
  await removeStoredServiceCache(key);
}

export function requestServiceGET(namespace: string, url: string, options: RequestOptions = {}, signal?: AbortSignal) {
  return cachedGET(url, options, signal, serviceRequests, serviceKey(namespace, url, options), serviceCacheTTL(namespace));
}

const easyScholarNetwork = withThrottle(requestGET, 500, (_url, _options, signal) => signal);
const semanticNetworks = new Map<string, typeof requestGET>();

function networkGET(key: string, url: string, options: RequestOptions, signal: AbortSignal) {
  if (key.startsWith("easyscholar:"))
    return easyScholarNetwork(url, options, signal);
  if (key.startsWith("semantic-scholar:")) {
    const token = String((options.headers as Record<string, string> | undefined)?.["x-api-key"] || "");
    let request = semanticNetworks.get(token);
    if (!request) {
      request = withThrottle(requestGET, token ? 1000 : 3000, (_url, _options, signal) => signal);
      semanticNetworks.set(token, request);
      if (semanticNetworks.size > 16)
        semanticNetworks.delete(semanticNetworks.keys().next().value!);
    }
    return request(url, options, signal);
  }
  return requestGET(url, options, signal);
}

function serviceKey(namespace: string, url: string, options: RequestOptions) {
  if (namespace === "easyscholar") {
    const parsed = new URL(url);
    parsed.searchParams.set("publicationName", publicationCacheName(parsed.searchParams.get("publicationName") || ""));
    url = parsed.href;
  }
  return `${namespace}:${JSON.stringify([url, Object.entries(options.headers || {}).sort(), options.responseType || "text"])}`;
}

export async function rememberServiceAliases(namespace: string, url: string, aliases: string[], options: RequestOptions, response: Awaited<ReturnType<typeof requestGET>>) {
  const expires = Number((response as any)._metaflowCacheExpires);
  if (response.status !== 200 || !Number.isFinite(expires) || expires <= Date.now())
    return;
  await storeServiceAliases(serviceKey(namespace, url, options), aliases.map(alias => serviceKey(namespace, alias, options)), { status: 200, response: String(response.response || response.responseText || ""), responseText: String(response.responseText || response.response || "") }, expires);
}

/** Share public lookups only; authenticated metadata services never use this cache. */
export async function requestCachedGET(url: string, options: RequestOptions = {}, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (options.headers && Object.keys(options.headers).length)
    return requestGET(url, options, signal);
  const key = JSON.stringify([url, options.responseType || "text"]);
  return cachedGET(url, options, signal, publicRequests, key, PUBLIC_CACHE_TTL);
}

function trimRequests(store: Map<string, CachedRequest>) {
  const limit = store === serviceRequests ? SERVICE_CACHE_MEMORY_LIMIT : PUBLIC_CACHE_LIMIT;
  const budget = store === serviceRequests ? SERVICE_MEMORY_BYTES : PUBLIC_CACHE_BYTES;
  let bytes = 0;
  for (const [key, entry] of store) {
    if (entry.settled && entry.expires <= Date.now())
      store.delete(key);
    else
      bytes += entry.bytes;
  }
  for (const [key, entry] of store) {
    if (store.size <= limit && bytes <= budget)
      break;
    if (entry.settled) {
      bytes -= entry.bytes;
      store.delete(key);
    }
  }
}

async function cachedGET(url: string, options: RequestOptions, signal: AbortSignal | undefined, store: Map<string, CachedRequest>, key: string, ttl: number) {
  signal?.throwIfAborted();
  let entry = store.get(key);
  if (!entry || entry.expires <= Date.now()) {
    store.delete(key);
    const Controller = (typeof Zotero !== "undefined" && typeof Zotero.getMainWindow === "function" && (Zotero.getMainWindow() as any)?.AbortController) || AbortController;
    const controller = new Controller();
    const fetch = () => networkGET(key, url, options, controller.signal);
    const created: CachedRequest = { controller, users: 0, settled: false, expires: Number.POSITIVE_INFINITY, bytes: 0, promise: store === serviceRequests ? readServiceCache(key).then(value => value as unknown as Awaited<ReturnType<typeof requestGET>> || fetch()) : fetch() };
    created.promise = created.promise.then((result) => {
      controller.signal.throwIfAborted();
      created.settled = true;
      let valid = result.status === undefined || result.status === 200;
      let lifetime = ttl;
      if (store === serviceRequests) {
        try {
          const data = JSON.parse(String(result.responseText || result.response || ""));
          valid = result.status === 200 && (
            key.startsWith("easyscholar:")
              ? data.code === 200
              : key.startsWith("crossref:")
                ? (data.status === "ok" && typeof data.message === "object")
                : typeof data.paperId === "string"
          );
          if (key.startsWith("easyscholar:") && valid) {
            const all = data.data?.officialRank?.all;
            const custom = data.data?.customRank;
            const found = (all && Object.values(all).some(value => value !== null && value !== undefined && String(value).trim())) || custom?.rankInfo?.length;
            if (!found)
              lifetime = Math.min(ttl, PUBLIC_CACHE_TTL);
          }
        }
        catch { valid = false; }
      }
      created.bytes = new TextEncoder().encode(typeof result.response === "string" ? result.response : JSON.stringify(result.response || result.responseText || "")).byteLength;
      if (created.bytes > SERVICE_CACHE_ENTRY_BYTES)
        valid = false;
      if (!valid && store.get(key) === created)
        store.delete(key);
      created.expires = Math.min(Date.now() + lifetime, Number((result as any)._metaflowCacheExpires) || Number.POSITIVE_INFINITY);
      if (valid && store === serviceRequests && !(result as any)._metaflowCacheExpires)
        void storeServiceCache(key, { status: 200, response: String(result.response || result.responseText || ""), responseText: String(result.responseText || result.response || "") }, created.expires);
      trimRequests(store);
      if (store === serviceRequests)
        return { status: result.status, response: result.response, responseText: result.responseText, _metaflowCacheExpires: created.expires } as unknown as Awaited<ReturnType<typeof requestGET>>;
      return result;
    }).catch((error) => {
      created.settled = true;
      if (store.get(key) === created)
        store.delete(key);
      throw error;
    });
    // The eager shared request can reject before a cancelled subscriber starts
    // waiting. Observe it without changing the rejection seen by active users.
    void created.promise.catch(() => {});
    store.set(key, created);
    trimRequests(store);
    entry = created;
  }
  store.delete(key);
  store.set(key, entry);
  const current = entry;
  current.users++;
  try {
    return await (signal ? waitForOperation(() => current.promise, signal) : current.promise);
  }
  finally {
    current.users--;
    if (!current.users && !current.settled) {
      current.controller.abort(new Error("All request subscribers cancelled"));
      if (store.get(key) === current)
        store.delete(key);
    }
  }
}

/** Bound public API requests and connect the rule deadline to Gecko's canceller. */
export async function requestGET(url: string, options: RequestOptions = {}, signal?: AbortSignal) {
  return requestHTTP("GET", url, options, signal);
}

export async function requestHTTP(method: "GET" | "POST", url: string, options: RequestOptions = {}, signal?: AbortSignal) {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    let abort: (() => void) | undefined;
    try {
      // The native throttle opt-out is verified on Zotero 10.0.6 but is not
      // declared by the currently pinned zotero-types package yet.
      const requestOptions: RequestOptions & { noRetryOnThrottle: boolean } = {
        timeout: 15_000,
        ...options,
        // Gecko otherwise retries 429/5xx for up to an hour underneath our policy.
        errorDelayMax: 0,
        noRetryOnThrottle: true,
        cancellerReceiver(cancel: () => void) {
          abort = cancel;
          if (signal?.aborted)
            cancel();
          else
            signal?.addEventListener("abort", cancel, { once: true });
          options.cancellerReceiver?.(cancel);
        },
      };
      const send = () => requestTransport(method, url, requestOptions);
      const response = await (signal ? waitForOperation(send, signal) : send());
      signal?.throwIfAborted();
      return response;
    }
    catch (error) {
      signal?.throwIfAborted();
      const response = error as { status?: number; xmlhttp?: XMLHttpRequest };
      if (attempt || ![429, 503].includes(response.status || 0))
        throw error;
      const retryAfter = response.xmlhttp?.getResponseHeader?.("Retry-After");
      const seconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : undefined;
      const wait = seconds !== undefined ? seconds * 1000 : retryAfter ? Date.parse(retryAfter) - Date.now() : 1000;
      // Respect long server backoffs by returning the error, rather than retrying early.
      if (!Number.isFinite(wait) || wait > 5000)
        throw error;
      await abortableDelay(Math.max(0, wait), signal);
    }
    finally {
      if (abort)
        signal?.removeEventListener("abort", abort);
    }
  }
}
