import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearRequestCache, clearServiceRequestCache, requestServiceGET } from "./http";
import { clearStoredServiceCache, flushServiceCache, resetServiceCacheSession } from "./service-cache-storage";

vi.mock("./logger", () => ({ createLogger: () => ({ debug: vi.fn() }) }));
vi.mock("./throttle", () => ({ withThrottle: (fn: unknown) => fn }));

describe("authenticated service response cache", () => {
  const files = new Map<string, any>();
  const response = (data = { paperId: "paper-1", title: "Cached paper" }) => ({ status: 200, response: JSON.stringify(data), responseText: JSON.stringify(data) });
  let request: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.useFakeTimers();
    request = vi.fn(async () => response());
    vi.stubGlobal("Zotero", { HTTP: { request }, Profile: { dir: "/isolated-profile" }, Utilities: { Internal: { md5: (key: string) => createHash("md5").update(key).digest("hex") } } });
    vi.stubGlobal("PathUtils", { join: (...parts: string[]) => parts.join("/") });
    vi.stubGlobal("IOUtils", {
      makeDirectory: async () => {},
      exists: async (path: string) => files.has(path),
      stat: async (path: string) => ({ size: JSON.stringify(files.get(path) || {}).length }),
      readJSON: async (path: string) => structuredClone(files.get(path)),
      writeJSON: async (path: string, data: any) => { files.set(path, structuredClone(data)); },
    });
    resetServiceCacheSession();
    clearRequestCache();
    await clearStoredServiceCache();
  });

  afterEach(async () => {
    clearRequestCache();
    await flushServiceCache();
    resetServiceCacheSession();
    files.clear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const fetch = (key = "test-secret", signal?: AbortSignal) => requestServiceGET("semantic-scholar", "https://example.test/paper/1", { headers: { "x-api-key": key } }, signal);

  it("shares concurrent lookups and partitions credentials", async () => {
    await Promise.all([fetch(), fetch(), fetch()]);
    expect(request).toHaveBeenCalledTimes(1);
    await fetch("different-secret");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("reports an explicit cache-clear write failure and permits a later retry", async () => {
    await fetch();
    await flushServiceCache();
    const write = vi.spyOn(IOUtils, "writeJSON").mockRejectedValueOnce(new Error("Disk denied"));
    try {
      await expect(clearStoredServiceCache(undefined, true)).rejects.toThrow();
      await expect(clearStoredServiceCache(undefined, true)).resolves.toBeUndefined();
      expect(write).toHaveBeenCalledTimes(2);
    }
    finally { write.mockRestore(); }
  });

  it("does not report a newer-format disk cache as cleared", async () => {
    await fetch();
    await flushServiceCache();
    const snapshot = files.values().next().value;
    snapshot.version = 99;
    resetServiceCacheSession();
    await expect(clearStoredServiceCache(undefined, true)).rejects.toThrow();
    expect(files.values().next().value).toBe(snapshot);
  });

  it("survives a session reset without persisting the key or extending the TTL", async () => {
    await fetch();
    await flushServiceCache();
    expect(JSON.stringify([...files.values()])).not.toContain("test-secret");
    await vi.advanceTimersByTimeAsync(23 * 60 * 60_000);
    clearRequestCache();
    resetServiceCacheSession();
    await fetch();
    await flushServiceCache();
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(61 * 60_000);
    await fetch();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("retries logical API errors instead of caching them", async () => {
    request.mockResolvedValueOnce(response({ error: "Not found" } as any));
    await fetch();
    await fetch();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("clears durable and in-memory responses", async () => {
    await fetch();
    clearServiceRequestCache("semantic-scholar");
    await clearStoredServiceCache("semantic-scholar");
    await fetch();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("keeps a shared request alive when only one subscriber cancels", async () => {
    let release!: (value: any) => void;
    request.mockImplementationOnce(() => new Promise((resolve) => {
      release = resolve;
    }));
    const controller = new AbortController();
    const cancelled = fetch("test-secret", controller.signal).catch(error => error);
    const surviving = fetch();
    await vi.advanceTimersByTimeAsync(0);
    controller.abort(new Error("cancel first subscriber"));
    expect((await cancelled).message).toContain("cancel first");
    release(response());
    await surviving;
    await fetch();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("continues a query when reading the cache file fails", async () => {
    (IOUtils as any).exists = async () => {
      throw new Error("filesystem unavailable");
    };
    resetServiceCacheSession();
    await fetch();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("starts a fresh cache in the new folder and does not read the retired profile-root file", async () => {
    await fetch();
    await flushServiceCache();
    const cachePath = "/isolated-profile/zotero-metaflow-cache/api-responses-v1.json";
    const legacyPath = "/isolated-profile/metaflow-api-cache-v1.json";
    files.set(legacyPath, structuredClone(files.get(cachePath)));
    files.delete(cachePath);
    request.mockClear();
    clearRequestCache();
    resetServiceCacheSession();
    await fetch();
    await flushServiceCache();
    expect(request).toHaveBeenCalledTimes(1);
    expect(files.has(cachePath)).toBe(true);
  });

  it("keeps the original deadline of a version 1 six-hour cache", async () => {
    await fetch();
    await flushServiceCache();
    const snapshot = files.values().next().value;
    snapshot.version = 1;
    snapshot.entries[0][1].expires = Date.now() + 6 * 60 * 60_000;
    clearRequestCache();
    resetServiceCacheSession();
    await vi.advanceTimersByTimeAsync(5 * 60 * 60_000);
    await fetch();
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(61 * 60_000);
    await fetch();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("preserves a stored cache when flushed before any lookup in the new session", async () => {
    await fetch();
    await flushServiceCache();
    clearRequestCache();
    resetServiceCacheSession();
    await flushServiceCache();
    resetServiceCacheSession();
    await fetch();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("shares durable paper aliases without duplicating response bodies", async () => {
    const { rememberServiceAliases } = await import("./http");
    const value = await fetch();
    await rememberServiceAliases("semantic-scholar", "https://example.test/paper/1", ["https://example.test/paper/DOI:1"], { headers: { "x-api-key": "test-secret" } }, value);
    await flushServiceCache();
    const snapshot = files.values().next().value;
    expect(snapshot.version).toBe(3);
    expect(snapshot.entries.filter(([, entry]: any) => entry.value)).toHaveLength(1);
    expect(snapshot.entries.filter(([, entry]: any) => entry.alias)).toHaveLength(1);
    clearRequestCache();
    resetServiceCacheSession();
    await requestServiceGET("semantic-scholar", "https://example.test/paper/DOI:1", { headers: { "x-api-key": "test-secret" } });
    expect(request).toHaveBeenCalledTimes(1);
    await requestServiceGET("semantic-scholar", "https://example.test/paper/DOI:1", { headers: { "x-api-key": "another-key" } });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does not rewrite durable storage when cached paper aliases are unchanged", async () => {
    const { rememberServiceAliases } = await import("./http");
    const value = await fetch();
    const options = { headers: { "x-api-key": "test-secret" } };
    const url = "https://example.test/paper/1";
    const aliases = ["https://example.test/paper/DOI:1"];
    await rememberServiceAliases("semantic-scholar", url, aliases, options, value);
    await flushServiceCache();
    const write = vi.spyOn(IOUtils, "writeJSON");
    try {
      await rememberServiceAliases("semantic-scholar", url, aliases, options, value);
      await vi.advanceTimersByTimeAsync(1000);
      expect(write).not.toHaveBeenCalled();
      await rememberServiceAliases("semantic-scholar", url, [...aliases, "https://example.test/paper/PMID:1"], options, value);
      await vi.advanceTimersByTimeAsync(1000);
      expect(write).toHaveBeenCalledTimes(1);
    }
    finally { write.mockRestore(); }
  });
  it("keeps journal data for 72 hours while paper data expires after 24 hours", async () => {
    request.mockResolvedValue(response({ code: 200, data: { officialRank: { all: { sciif: "8.4" } } } } as any));
    const journal = () => requestServiceGET("easyscholar", "https://example.test/journal?publicationName=Nature");
    await journal();
    await flushServiceCache();
    await vi.advanceTimersByTimeAsync(71 * 60 * 60_000);
    clearRequestCache();
    resetServiceCacheSession();
    await journal();
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(61 * 60_000);
    await journal();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("rechecks a successful empty journal response after five minutes", async () => {
    request.mockResolvedValue(response({ code: 200, data: { officialRank: { all: {} } } } as any));
    const journal = () => requestServiceGET("easyscholar", "https://example.test/empty?publicationName=Unknown");
    await journal();
    await vi.advanceTimersByTimeAsync(299_999);
    await journal();
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2);
    await journal();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does not rewrite an unchanged disk cache after a restored hit", async () => {
    await fetch();
    await flushServiceCache();
    clearRequestCache();
    resetServiceCacheSession();
    const write = vi.spyOn(IOUtils, "writeJSON");
    try {
      await fetch();
      await flushServiceCache();
      expect(write).not.toHaveBeenCalled();
      expect(request).toHaveBeenCalledTimes(1);
    }
    finally { write.mockRestore(); }
  });

  it("shortens old version-two paper deadlines without extending old results", async () => {
    await fetch();
    await flushServiceCache();
    const snapshot = files.values().next().value;
    snapshot.version = 2;
    snapshot.entries[0][1].expires = Date.now() + 72 * 60 * 60_000;
    await vi.advanceTimersByTimeAsync(25 * 60 * 60_000);
    clearRequestCache();
    resetServiceCacheSession();
    await fetch();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("serves an oversized response without keeping it in memory or on disk", async () => {
    request.mockResolvedValue(response({ paperId: "large", abstract: "x".repeat(600_000) } as any));
    await fetch();
    await fetch();
    await flushServiceCache();
    expect(request).toHaveBeenCalledTimes(2);
    expect(files.values().next().value.entries).toHaveLength(0);
  });

  it("bounds the serialized durable cache by bytes as well as count", async () => {
    request.mockResolvedValue(response({ paperId: "large", abstract: "x".repeat(200_000) } as any));
    for (let index = 0; index < 30; index++)
      await requestServiceGET("semantic-scholar", `https://example.test/large/${index}`);
    await flushServiceCache();
    const snapshot = files.values().next().value;
    expect(snapshot.entries.length).toBeLessThan(30);
    expect(new TextEncoder().encode(JSON.stringify(snapshot)).byteLength).toBeLessThanOrEqual(8 * 1024 * 1024);
  });
});
