import type { MetadataContext } from "./base-service";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineService } from "./base-service";

afterEach(() => vi.useRealTimers());

describe("service request scheduling", () => {
  it("shares a cooldown between identifier enrichment and metadata fetching", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-07T00:00:00Z"));
    const requests: string[] = [];
    const service = defineService({
      id: "test-service",
      name: "Test service",
      cooldown: 100,
      shouldApply: () => true,
      async updateIdentifiers() {
        requests.push("identifier");
        return true;
      },
      async fetch() {
        requests.push("metadata");
        return { title: "Paper" };
      },
    });
    const context = {} as MetadataContext;
    const pending = Promise.all([service.updateIdentifiers!(context), service.fetch!(context)]);
    await vi.advanceTimersByTimeAsync(0);
    expect(requests).toEqual(["identifier"]);
    await vi.advanceTimersByTimeAsync(100);
    await pending;
    expect(requests).toEqual(["identifier", "metadata"]);
  });

  it("skips a queued request whose rule has already been aborted", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-07T00:00:00Z"));
    const fetch = vi.fn(async () => ({ title: "Paper" }));
    const service = defineService({ id: "test-service", name: "Test service", cooldown: 100, shouldApply: () => true, fetch });
    const controller = new AbortController();
    const context = { signal: controller.signal } as MetadataContext;
    const first = service.fetch!({} as MetadataContext);
    const second = expect(service.fetch!(context)).rejects.toThrow("cancelled request");
    controller.abort(new Error("cancelled request"));
    await vi.advanceTimersByTimeAsync(100);
    await first;
    await second;
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("reads changed cooldowns without resetting the last start time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let cooldown = 100;
    const starts: number[] = [];
    const service = defineService({ id: "dynamic", name: "Dynamic", get cooldown() {
      return cooldown;
    }, shouldApply: () => true, async fetch() {
      starts.push(Date.now());
      return {};
    } });
    await service.fetch!({} as MetadataContext);
    cooldown = 40;
    const pending = service.fetch!({} as MetadataContext);
    await vi.advanceTimersByTimeAsync(39);
    expect(starts).toEqual([0]);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(starts).toEqual([0, 40]);
  });
});
