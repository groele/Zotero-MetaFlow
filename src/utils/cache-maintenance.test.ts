import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ runtime: vi.fn(), api: vi.fn(), read: vi.fn() }));
vi.mock("./logger", () => ({ createLogger: () => ({ debug: vi.fn() }) }));
vi.mock("./runtime-data-storage", () => ({ flushRuntimeData: mocks.runtime, readRuntimeData: mocks.read, getRuntimeDataStatus: vi.fn() }));
vi.mock("./service-cache-storage", () => ({ flushServiceCache: mocks.api, getServiceCacheStatus: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  mocks.read.mockResolvedValue({ runs: [] });
  mocks.api.mockResolvedValue(true);
  mocks.runtime.mockResolvedValue(undefined);
  vi.clearAllMocks();
});

it("coalesces maintenance requests and keeps shutdown waiting until both writes settle", async () => {
  let release!: () => void;
  mocks.runtime.mockImplementationOnce(() => new Promise<void>((resolve) => {
    release = resolve;
  }));
  mocks.api.mockResolvedValueOnce(false);
  const { cleanExpiredCaches, stopCacheMaintenance } = await import("./cache-maintenance");
  const first = cleanExpiredCaches();
  const failure = first.catch(error => error);
  expect(cleanExpiredCaches()).toBe(first);
  await vi.waitFor(() => expect(mocks.runtime).toHaveBeenCalledOnce());
  let stopped = false;
  const stopping = stopCacheMaintenance().then(() => {
    stopped = true;
  });
  await Promise.resolve();
  expect(stopped).toBe(false);
  release();
  expect(await failure).toBeInstanceOf(Error);
  await stopping;
  await expect(cleanExpiredCaches()).resolves.toBeUndefined();
});
