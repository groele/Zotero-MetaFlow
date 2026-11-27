import { afterEach, describe, expect, it, vi } from "vitest";
import { clearRequestCache, parseResponseJSON, requestCachedGET, requestGET } from "./http";

afterEach(() => {
  clearRequestCache();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("public API request lifetime", () => {
  it("releases a direct caller on abort even if the native canceller never settles its transport", async () => {
    let release!: (value: any) => void;
    const cancel = vi.fn();
    const request = vi.fn((_method, _url, options) => {
      options.cancellerReceiver(cancel);
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    vi.stubGlobal("Zotero", { HTTP: { request } });
    const controller = new AbortController();
    const pending = requestGET("https://example.org/hanging", {}, controller.signal);
    await Promise.resolve();
    controller.abort(new Error("Caller cancelled"));
    let watchdog: ReturnType<typeof setTimeout>;
    try {
      await expect(Promise.race([pending, new Promise((_, reject) => {
        watchdog = setTimeout(() => reject(new Error("Cancellation did not release caller")), 100);
      })])).rejects.toThrow("Caller cancelled");
      expect(cancel).toHaveBeenCalledOnce();
    }
    finally {
      clearTimeout(watchdog!);
      release({ status: 200 });
      await pending.catch(() => {});
    }
  });

  it("disables Gecko retries so only the bounded MetaFlow retry policy runs", async () => {
    const request = vi.fn(async (_method, _url, options) => {
      expect(options.errorDelayMax).toBe(0);
      expect(options.noRetryOnThrottle).toBe(true);
      throw Object.assign(new Error("Service unavailable"), { status: 503, xmlhttp: { getResponseHeader: () => "60" } });
    });
    vi.stubGlobal("Zotero", { HTTP: { request } });
    await expect(requestGET("https://example.org/unavailable", { errorDelayMax: 3600000 }))
      .rejects
      .toMatchObject({ status: 503 });
    expect(request).toHaveBeenCalledOnce();
  });

  it("evicts a response that fails cache processing so the next request can recover", async () => {
    const invalid = { status: 200, response: { toJSON() {
      throw new Error("Invalid response");
    } } };
    const request = vi.fn().mockResolvedValueOnce(invalid).mockResolvedValue({ status: 200, response: "Recovered" });
    vi.stubGlobal("Zotero", { getMainWindow: () => ({ AbortController }), HTTP: { request } });
    await expect(requestCachedGET("https://example.org/recover")).rejects.toThrow("Invalid response");
    await expect(requestCachedGET("https://example.org/recover")).resolves.toMatchObject({ response: "Recovered" });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("connects abort to the real request canceller", async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    let release!: () => void;
    vi.stubGlobal("Zotero", { HTTP: { request: vi.fn(async (_method, _url, options) => {
      options.cancellerReceiver(cancel);
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { status: 200 };
    }) } });
    const pending = requestGET("https://example.org", {}, controller.signal);
    await Promise.resolve();
    controller.abort(new Error("Cancelled"));
    expect(cancel).toHaveBeenCalledOnce();
    release();
    await expect(pending).rejects.toThrow("Cancelled");
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("retries a short server backoff once and never retries a 404", async () => {
    vi.useFakeTimers();
    const request = vi.fn().mockRejectedValueOnce({ status: 429, xmlhttp: { getResponseHeader: () => "1" } }).mockResolvedValueOnce({ status: 200 });
    vi.stubGlobal("Zotero", { HTTP: { request } });
    const pending = requestGET("https://example.org");
    await vi.advanceTimersByTimeAsync(999);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(request).toHaveBeenCalledTimes(2);
    request.mockRejectedValue({ status: 404 });
    await expect(requestGET("https://example.org/missing")).rejects.toMatchObject({ status: 404 });
    expect(request).toHaveBeenCalledTimes(3);
  });
  it("does not retry early when the server requests a longer wait", async () => {
    const request = vi.fn().mockRejectedValue({ status: 429, xmlhttp: { getResponseHeader: () => "60" } });
    vi.stubGlobal("Zotero", { HTTP: { request } });
    await expect(requestGET("https://example.org")).rejects.toMatchObject({ status: 429 });
    expect(request).toHaveBeenCalledOnce();
  });
  it("shares a pending lookup and preserves other subscribers when one cancels", async () => {
    let release!: (value: any) => void;
    const cancel = vi.fn();
    const request = vi.fn((_method, _url, options) => {
      options.cancellerReceiver(cancel);
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    vi.stubGlobal("Zotero", { getMainWindow: () => ({ AbortController }), HTTP: { request } });
    const controller = new AbortController();
    const first = requestCachedGET("https://example.org/shared", {}, controller.signal);
    const second = requestCachedGET("https://example.org/shared");
    const cancelled = expect(first).rejects.toThrow("First cancelled");
    controller.abort(new Error("First cancelled"));
    await cancelled;
    expect(cancel).not.toHaveBeenCalled();
    release({ status: 200, response: "Shared" });
    expect(await second).toMatchObject({ response: "Shared" });
    await requestCachedGET("https://example.org/shared");
    expect(request).toHaveBeenCalledOnce();
  });
  it("cancels the underlying lookup after its last subscriber cancels", async () => {
    const cancel = vi.fn();
    vi.stubGlobal("Zotero", { getMainWindow: () => ({ AbortController }), HTTP: { request: (_method: string, _url: string, options: any) => new Promise((_resolve, reject) => {
      options.cancellerReceiver(() => {
        cancel();
        reject(new Error("HTTP aborted"));
      });
    }) } });
    const controller = new AbortController();
    const pending = requestCachedGET("https://example.org/cancel", {}, controller.signal);
    const cancelled = expect(pending).rejects.toThrow("Last cancelled");
    controller.abort(new Error("Last cancelled"));
    await cancelled;
    expect(cancel).toHaveBeenCalledOnce();
    // Drain the eager transport's rejection too, not just the subscriber race.
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  it("caches public requests with non-sensitive headers and bypasses cache only for auth headers", async () => {
    const request = vi.fn().mockResolvedValue({ status: 200, response: "{\"ok\":true}" });
    vi.stubGlobal("Zotero", { getMainWindow: () => ({ AbortController }), HTTP: { request } });
    const res1 = await requestCachedGET("https://example.org/public", { headers: { Accept: "application/json" } });
    const res2 = await requestCachedGET("https://example.org/public", { headers: { Accept: "application/json" } });
    expect(parseResponseJSON(res1)).toEqual({ ok: true });
    expect(parseResponseJSON(res2)).toEqual({ ok: true });
    expect(request).toHaveBeenCalledTimes(1);
    await requestCachedGET("https://example.org/public", { headers: { "x-api-key": "secret" } });
    expect(request).toHaveBeenCalledTimes(2);
  });
});
