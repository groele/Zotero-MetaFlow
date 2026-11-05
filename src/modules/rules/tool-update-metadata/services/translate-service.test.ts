import { afterEach, describe, expect, it, vi } from "vitest";
import { doTranslate } from "./translate-service";

afterEach(() => vi.useRealTimers());

describe("native translator lifetime", () => {
  it("does not start translation after cancellation during detection", async () => {
    let release!: (value: string[]) => void;
    const translator = {
      getTranslators: () => new Promise<string[]>((resolve) => { release = resolve; }),
      setTranslator: vi.fn(),
      translate: vi.fn(),
    };
    const parent = new AbortController();
    const pending = doTranslate(translator, parent.signal);
    await Promise.resolve();
    parent.abort(new Error("cancelled"));
    await expect(pending).rejects.toThrow("cancelled");
    release(["Crossref"]);
    await Promise.resolve();
    expect(translator.translate).not.toHaveBeenCalled();
  });

  it("releases a stalled translator after 15 seconds and ignores its late result", async () => {
    vi.useFakeTimers();
    let release!: (value: object[]) => void;
    const translator = {
      getTranslators: async () => ["Crossref"],
      setTranslator: vi.fn(),
      translate: vi.fn(() => new Promise<object[]>((resolve) => { release = resolve; })),
    };
    const pending = doTranslate(translator);
    const rejected = expect(pending).rejects.toThrow("Translation deadline exceeded");
    await vi.advanceTimersByTimeAsync(15_000);
    await rejected;
    release([{ title: "Late response" }]);
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
    expect(translator.translate).toHaveBeenCalledWith({ libraryID: false });
  });

  it("returns metadata without saving native items and clears its deadline", async () => {
    vi.useFakeTimers();
    const translate = vi.fn(async () => [{ title: "Paper" }]);
    expect(await doTranslate({ getTranslators: async () => ["Crossref"], setTranslator: vi.fn(), translate })).toEqual({ title: "Paper" });
    expect(translate).toHaveBeenCalledWith({ libraryID: false });
    expect(vi.getTimerCount()).toBe(0);
  });
});
