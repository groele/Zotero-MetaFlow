import { describe, expect, it, vi } from "vitest";
import { createAbortController, executeRule, normalizedConcurrency, runWithDeadline, waitForOperation } from "./rule-execution";

describe("host factory & runWithDeadline", () => {
  it("uses Zotero.getMainWindow()?.AbortController when available and falls back safely", () => {
    const controller = createAbortController();
    expect(controller).toBeInstanceOf(AbortController);
    vi.stubGlobal("Zotero", { getMainWindow: () => undefined });
    expect(createAbortController()).toBeInstanceOf(AbortController);
    vi.unstubAllGlobals();
  });

  it("enforces timeout and parent cancellation in runWithDeadline", async () => {
    await expect(runWithDeadline(async () => "ok", undefined, 100, "timeout")).resolves.toBe("ok");
    await expect(runWithDeadline(async () => new Promise(() => {}), undefined, 10, "Deadline exceeded")).rejects.toThrow("Deadline exceeded");
    const parent = new AbortController();
    parent.abort(new Error("Parent aborted"));
    await expect(runWithDeadline(async () => "ok", parent.signal, 100, "timeout")).rejects.toThrow("Parent aborted");
  });
});

describe("rule deadlines", () => {
  it("does not start queued preparation after same-turn cancellation", async () => {
    const controller = new AbortController();
    let calls = 0;
    const pending = waitForOperation(() => {
      calls++;
    }, controller.signal);
    controller.abort(new Error("Batch cancelled"));
    await expect(pending).rejects.toThrow("Batch cancelled");
    expect(calls).toBe(0);
  });

  it("still runs active preparation and preserves its result", async () => {
    const controller = new AbortController();
    await expect(waitForOperation(() => 42, controller.signal)).resolves.toBe(42);
  });

  it("rejects a late field write without affecting a subsequent rule", async () => {
    const item = { title: "before", setField(_field: string, value: string) {
      this.title = value;
    } };
    let release!: () => void;
    let late!: Promise<void>;
    await expect(executeRule(item, async (guarded) => {
      late = new Promise<void>((resolve) => {
        release = resolve;
      }).then(() => guarded.setField("title", "late"));
      await late;
    }, 10)).rejects.toThrow("timed out");
    item.setField("title", "next");
    release();
    await expect(late).rejects.toThrow("timed out");
    expect(item.title).toBe("next");
  });

  it("revokes mutations after a rule rejects", async () => {
    const item = { value: "old" };
    let escaped!: typeof item;
    await expect(executeRule(item, async (guarded) => {
      escaped = guarded;
      throw new Error("failed");
    })).rejects.toThrow("failed");
    expect(() => {
      escaped.value = "late";
    }).toThrow("failed");
    expect(item.value).toBe("old");
  });

  it("revokes mutations after a successful rule returns", async () => {
    const item = { value: "old" };
    let escaped!: typeof item;
    await executeRule(item, async (guarded) => {
      escaped = guarded;
      guarded.value = "completed";
    });
    expect(() => {
      escaped.value = "late";
    }).toThrow("finished");
    expect(item.value).toBe("completed");
  });

  it("rejects a stale reload that would discard a later rule's fields", async () => {
    const item = {
      value: "stored",
      reload() {
        this.value = "stored";
      },
    };
    let escaped!: typeof item;
    await executeRule(item, async (guarded) => {
      escaped = guarded;
    });
    item.value = "next rule";
    expect(() => escaped.reload()).toThrow("finished");
    expect(item.value).toBe("next rule");
  });

  it("revokes property deletion and redefinition after a deadline", async () => {
    const item = { value: "original" };
    let escaped!: typeof item;
    await expect(executeRule(item, async (guarded) => {
      escaped = guarded;
      await new Promise<void>(() => {});
    }, 10)).rejects.toThrow("timed out");
    expect(() => Reflect.deleteProperty(escaped, "value")).toThrow("timed out");
    expect(() => Object.defineProperty(escaped, "value", { value: "late" })).toThrow("timed out");
    expect(item.value).toBe("original");
  });

  it.each([[0, 1], [-2, 1], [2.5, 2], [200, 16], [Number.NaN, 1], ["4", 1]])("bounds concurrency %s to %s", (value, expected) => {
    expect(normalizedConcurrency(value)).toBe(expected);
  });
});
