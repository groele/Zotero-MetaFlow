import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("./logger", () => ({ createLogger: () => ({ debug: vi.fn() }) }));
vi.mock("./throttle", () => ({ withThrottle: (fn: unknown) => fn }));

const files = new Map<string, unknown>();
let request: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  files.clear();
  request = vi.fn(async (_method, url: string) => {
    const data = url.includes("easyscholar")
      ? { code: 200, data: { officialRank: { all: { sciif: "8.4" } } } }
      : { paperId: "audit-paper-id", title: "Paper fixture", externalIds: { DOI: "10.1234/audit" } };
    return { status: 200, response: JSON.stringify(data), responseText: JSON.stringify(data) };
  });
  vi.stubGlobal("Zotero", {
    HTTP: { request },
    Profile: { dir: "/audit-profile" },
    Prefs: { get: (key: string) => /(?:secretKey|semanticScholarToken)$/.test(key) ? "audit-fixture-key" : undefined },
    Utilities: { Internal: { md5: (key: string) => createHash("md5").update(key).digest("hex") } },
  });
  vi.stubGlobal("PathUtils", { join: (...parts: string[]) => parts.join("/") });
  vi.stubGlobal("IOUtils", {
    makeDirectory: async () => {},
    exists: async (path: string) => files.has(path),
    stat: async (path: string) => ({ size: JSON.stringify(files.get(path) || {}).length }),
    readJSON: async (path: string) => structuredClone(files.get(path)),
    writeJSON: async (path: string, value: unknown) => { files.set(path, structuredClone(value)); },
  });
});
afterEach(async () => {
  const http = await import("./http");
  const storage = await import("./service-cache-storage");
  http.clearRequestCache();
  await storage.flushServiceCache();
  storage.resetServiceCacheSession();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("cache integration: concurrent case variants of one journal should share a request", async () => {
  const { fetchEasyScholarRank } = await import("./easyscholar");
  const results = await Promise.all([fetchEasyScholarRank("Nature"), fetchEasyScholarRank("NATURE")]);
  expect(results.map(result => result.status)).toEqual(["success", "success"]);
  expect(request).toHaveBeenCalledTimes(1);
});

it("cache integration: changing from DOI to the returned paper ID after restart should reuse the cached paper", async () => {
  let service = (await import("../modules/rules/tool-update-metadata/services/semantic-scholar-service")).SemanticScholarService;
  const context = { item: { itemType: "journalArticle" }, identifiers: { DOI: "10.1234/audit" }, isPreprint: false, debug: () => {} };
  await service.fetch!(context as any);
  await (await import("./service-cache-storage")).flushServiceCache();
  (await import("./http")).clearRequestCache();
  (await import("./service-cache-storage")).resetServiceCacheSession();
  vi.resetModules();
  service = (await import("../modules/rules/tool-update-metadata/services/semantic-scholar-service")).SemanticScholarService;
  await service.fetch!({ ...context, identifiers: { SemanticScholarID: "audit-paper-id" } } as any);
  expect(request).toHaveBeenCalledTimes(1);
});

it("cache integration: strict custom maps should allow titles distinguished by punctuation", async () => {
  const { DataLoader } = await import("./data-loader");
  const loader = vi.spyOn(DataLoader, "load").mockResolvedValue({ "A-B Journal": "AB. J.", "A B Journal": "A. B. J." });
  try {
    const { loadCustomAbbreviations } = await import("../modules/rules/require-abbr");
    await expect(loadCustomAbbreviations("audit-custom.json")).resolves.toHaveProperty("size", 2);
  }
  finally { loader.mockRestore(); }
});

it("cache integration: identical concurrent journal lookups should finish together after one response", async () => {
  vi.doUnmock("./throttle");
  vi.resetModules();
  const { fetchEasyScholarRank } = await import("./easyscholar");
  const started = Date.now();
  const completions: number[] = [];
  const tasks = Array.from({ length: 10 }, () => fetchEasyScholarRank("Shared journal fixture").then(() => completions.push(Date.now() - started)));
  try {
    await vi.advanceTimersByTimeAsync(1);
    expect(request).toHaveBeenCalledTimes(1);
    expect(completions).toHaveLength(10);
  }
  finally {
    await vi.advanceTimersByTimeAsync(5000);
    await Promise.all(tasks);
    process.stdout.write(`Same-journal finish times (ms): ${JSON.stringify(completions)}\n`);
  }
});
