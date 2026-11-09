import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeRuntimeRun, RUNTIME_HISTORY_TTL } from "./runtime-data-policy";

const files = new Map<string, any>();
const file = "/profile/zotero-metaflow-cache/operation-history.json";
const entry = () => normalizeRuntimeRun({ id: "run-one", at: Date.now(), status: "running", stages: [{ name: "metadata", startedAt: Date.now(), status: "running" }] })!;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  files.clear();
  vi.stubGlobal("Zotero", { Profile: { dir: "/profile" }, debug: vi.fn(), Utilities: { randomString: () => "fixture" } });
  vi.stubGlobal("PathUtils", { join: (...parts: string[]) => parts.join("/"), parent: (path: string) => path.slice(0, path.lastIndexOf("/")) });
  vi.stubGlobal("IOUtils", {
    exists: async (path: string) => files.has(path),
    stat: async (path: string) => ({ size: JSON.stringify(files.get(path)).length }),
    readJSON: async (path: string) => structuredClone(files.get(path)),
    makeDirectory: async () => {},
    writeJSON: async (path: string, value: unknown) => { files.set(path, structuredClone(value)); },
  });
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("operation cache persistence", () => {
  it("keeps one operation identity when its first checkpoint write fails and later retries", async () => {
    vi.spyOn(IOUtils, "writeJSON").mockRejectedValueOnce(new Error("disk unavailable"));
    const storage = await import("./runtime-data-storage");
    const id = (await storage.beginRuntimeOperation("core-update", 1))!;
    expect(id).toBeDefined();
    await storage.beginRuntimeStage(id, "metadata");
    await storage.finishRuntimeStage(id, "metadata");
    expect(files.get(file).runs).toHaveLength(1);
    expect(files.get(file).runs[0].id).toBe(id);
    expect(files.get(file).runs[0].stages[0].status).toBe("completed");
  });

  it("prunes expired primary and backup records even without another operation", async () => {
    const { RuntimeDataStore } = await import("./runtime-data-storage");
    const store = new RuntimeDataStore(file);
    await store.append(entry());
    await store.flush();
    vi.setSystemTime(Date.now() + RUNTIME_HISTORY_TTL + 1);
    await store.flush();
    expect(files.get(file).runs).toEqual([]);
    expect(files.get(`${file}.bak`).runs).toEqual([]);
  });

  it("retains valid interrupted checkpoints alongside malformed rows", async () => {
    files.set(file, { version: 1, updatedAt: Date.now(), runs: [null, entry()] });
    const { RuntimeDataStore } = await import("./runtime-data-storage");
    const store = new RuntimeDataStore(file);
    expect((await store.read()).runs[0].stages[0].status).toBe("interrupted");
    await store.flush();
    expect(files.get(file).runs).toHaveLength(1);
    expect(files.get(file).runs[0].status).toBe("interrupted");
  });

  it.each([
    [{ failed: 1 }, "failed"],
    [{ preparationFailed: 1 }, "failed"],
    [{ cancelled: true }, "cancelled"],
    [{}, "completed"],
  ])("records stage result %j as %s", async (outcome, expected) => {
    const storage = await import("./runtime-data-storage");
    const id = (await storage.beginRuntimeOperation("core-update", 1))!;
    await storage.beginRuntimeStage(id, "metadata");
    await storage.finishRuntimeStage(id, "metadata", { processed: 1, saved: 0, failed: 0, warnings: 0, records: [], changes: [], ...outcome } as any);
    expect((await storage.readRuntimeData()).runs[0].stages[0].status).toBe(expected);
  });
});
