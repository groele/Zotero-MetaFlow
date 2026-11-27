import type { ApplyContext, PrepareContext } from "./rule-base";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LintRunner } from "./runner";

vi.mock("../../utils/runtime-data-storage", () => ({ recordRuntimeResult: vi.fn() }));
vi.mock("./rule-registry", () => ({ Rules: {} }));
vi.mock("./reporter", () => ({ createReporter: vi.fn(async () => {}), ProgressUI: class { async init() {} close() {} updateProgress() {} showFinished() {} } }));
vi.mock("../../utils/logger", () => ({ createLogger: () => ({ debug() {}, warn() {}, error() {} }), logger: { debug() {} } }));
vi.mock("../../utils/locale", () => ({ getString: (id: string) => id }));

function createItem() {
  const item = {
    id: 1,
    itemType: "journalArticle",
    itemTypeID: 1,
    deleted: false,
    changed: false,
    fields: { title: "Original", itemType: "journalArticle" } as Record<string, string>,
    persisted: {} as Record<string, string>,
    isRegularItem: () => true,
    isEditable: () => true,
    getField(key: string) { return this.fields[key] || ""; },
    setField(key: string, value: string) {
      this.fields[key] = value;
      this.changed = true;
    },
    getDisplayTitle() { return this.fields.title; },
    hasChanged() { return this.changed; },
    toJSON() { return { ...this.fields }; },
    fromJSON(fields: Record<string, string>) { this.fields = { ...fields }; },
    async save() {
      this.persisted = { ...this.fields };
      this.changed = false;
    },
  };
  return item as unknown as Zotero.Item;
}

beforeEach(() => {
  vi.stubGlobal("addon", { data: { alive: true } });
  vi.stubGlobal("Zotero", { Prefs: { get: () => undefined }, getMainWindow: () => ({ AbortController }), DB: { executeTransaction: async (fn: () => Promise<void>) => fn() } });
});
afterEach(() => vi.unstubAllGlobals());

describe("rule-level rollback", () => {
  function failedTransaction(item: Zotero.Item, persisted: Record<string, string>) {
    const target = item as any;
    target.persisted = { ...target.fields };
    target.reload = async () => {
      target.fields = { ...target.persisted };
      target.changed = false;
    };
    target.saveTx = async () => target.save();
    (Zotero.DB as any).executeTransaction = async (fn: () => Promise<void>) => {
      await fn();
      target.persisted = { ...persisted };
      throw new Error("Transaction rolled back; another writer committed before retry");
    };
  }

  it("rebases fallback saves onto independently committed fields instead of replacing a stale snapshot", async () => {
    const runner = new LintRunner();
    const item = createItem();
    failedTransaction(item, { title: "Original", itemType: "journalArticle", extra: "New manual note" });
    const result = await runner.add({ items: [item], silent: true, rules: [{ id: "format-title", scope: "item", apply({ item }: ApplyContext) {
      item.setField("title", "Formatted");
    } }] as any });
    expect((item as any).persisted).toEqual({ title: "Formatted", itemType: "journalArticle", extra: "New manual note" });
    expect(result).toMatchObject({ saved: 1, failed: 0 });
  });

  it("skips a conflicting fallback and reports the unsaved field without overwriting the latest title", async () => {
    const runner = new LintRunner();
    const item = createItem();
    failedTransaction(item, { title: "Latest manual title", itemType: "journalArticle" });
    const result = await runner.add({ items: [item], silent: true, rules: [{ id: "format-title", scope: "item", apply({ item }: ApplyContext) {
      item.setField("title", "Formatted");
    } }] as any });
    expect(item.getField("title")).toBe("Latest manual title");
    expect((item as any).persisted.title).toBe("Latest manual title");
    expect(result).toMatchObject({ saved: 0, failed: 1 });
    expect(result?.records).toEqual(expect.arrayContaining([expect.objectContaining({ code: "item-save-conflict" })]));
    expect(result?.changes[0]).toMatchObject({ after: "Formatted", saved: false });
  });
  it("lets native input cancel a large synchronous batch before every item runs", async () => {
    const runner = new LintRunner();
    const items = Array.from({ length: 200 }, (_, index) => Object.assign(createItem(), { id: index + 1 }));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await runner.add({ items, silent: true, rules: [{ id: "local", scope: "item", apply({ item }: ApplyContext) {
        timer ??= setTimeout(() => runner.cancel(), 0);
        item.setField("title", "Formatted");
      } }] as any });
      expect(result?.cancelled).toBe(true);
      expect(result!.processed).toBeLessThan(items.length);
      expect(result!.saved).toBeGreaterThan(0);
      expect(result!.saved).toBe(result!.changes.filter(change => change.saved).length);
    }
    finally { clearTimeout(timer); }
  });

  it("responds to input even when one item has many immediately resolved rules", async () => {
    const runner = new LintRunner();
    const apply = vi.fn();
    const timer = setTimeout(() => runner.cancel(), 0);
    try {
      const rules = Array.from({ length: 200 }, (_, index) => ({ id: `rule-${index}`, scope: "item", apply }));
      const result = await runner.add({ items: [createItem()], silent: true, rules } as any);
      expect(result?.cancelled).toBe(true);
      expect(apply.mock.calls.length).toBeLessThan(200);
    }
    finally { clearTimeout(timer); }
  });

  it("cancels a queued owner's batch without cancelling the unrelated running batch", async () => {
    const runner = new LintRunner();
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>(resolve => release = resolve);
    const entered = new Promise<void>(resolve => started = resolve);
    const background = runner.add({ items: [createItem()], silent: true, rules: [{ id: "background", scope: "item", async apply({ item }: ApplyContext) {
      started();
      await gate;
      item.setField("title", "Background saved");
    } }] as any });
    await entered;
    const owner = new AbortController();
    const apply = vi.fn();
    const queued = runner.add({ items: [createItem()], signal: owner.signal, silent: true, rules: [{ id: "owned", scope: "item", apply }] } as any);
    owner.abort(new Error("Owner cancelled"));
    release();
    expect(await background).toMatchObject({ cancelled: false, saved: 1 });
    expect(await queued).toMatchObject({ cancelled: true, saved: 0, processed: 0 });
    expect(apply).not.toHaveBeenCalled();
  });

  it("cancels an active rule promptly, restores its partial changes and blocks late writes", async () => {
    const runner = new LintRunner();
    const item = createItem();
    const owner = new AbortController();
    let release!: () => void;
    let started!: () => void;
    let late!: () => void;
    const gate = new Promise<void>(resolve => release = resolve);
    const entered = new Promise<void>(resolve => started = resolve);
    const finished = new Promise<void>(resolve => late = resolve);
    const pending = runner.add({ items: [item], signal: owner.signal, silent: true, rules: [{ id: "pending-apply", scope: "item", async apply({ item: guarded }: ApplyContext) {
      guarded.setField("title", "Partial");
      started();
      await gate;
      try {
        guarded.setField("title", "Late value");
      }
      finally { late(); }
    } }] } as any);
    await entered;
    owner.abort(new Error("Owner cancelled"));
    const settled = await Promise.race([pending.then(() => true), new Promise<boolean>(resolve => setTimeout(resolve, 50, false))]);
    release();
    await pending;
    await finished;
    expect(settled).toBe(true);
    expect(item.getField("title")).toBe("Original");
    expect(runner.lastResult).toMatchObject({ cancelled: true, failed: 0, saved: 0 });
  });

  it("skips a cancelled queued native operation without aborting its predecessor", async () => {
    const runner = new LintRunner();
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>(resolve => release = resolve);
    const entered = new Promise<void>(resolve => started = resolve);
    let precedingSignal: AbortSignal | undefined;
    const preceding = runner.exclusive(async (signal) => {
      precedingSignal = signal;
      started();
      await gate;
      return "done";
    });
    await entered;
    const owner = new AbortController();
    const operation = vi.fn();
    const queued = (runner.exclusive as any)(operation, owner.signal);
    owner.abort();
    expect(precedingSignal!.aborted).toBe(false);
    release();
    expect(await preceding).toBe("done");
    await queued;
    expect(operation).not.toHaveBeenCalled();
  });

  it("does not prepare irrelevant rules or load their datasets", async () => {
    const runner = new LintRunner();
    const prepare = vi.fn();
    await runner.add({ items: [createItem()], silent: true, rules: [{ id: "irrelevant", scope: "item", targetItemTypes: ["thesis"], prepare, apply: vi.fn() }] as any });
    expect(prepare).not.toHaveBeenCalled();
    expect(runner.lastResult).toMatchObject({ processed: 1, notApplicable: 1, preparationFailed: 0 });
  });
  it.each(["reject", "timeout", "report"])("discards partial %s writes while preserving healthy sibling changes", async (mode) => {
    const runner = new LintRunner();
    const item = createItem();
    await runner.add({ items: [item], silent: true, rules: [
      { id: "healthy-before", scope: "item", apply({ item }: ApplyContext) { item.setField("date", "2026"); } },
      { id: "broken", scope: "item", timeout: 5, async apply({ item, report }: ApplyContext) {
        item.setField("title", "Partial");
        if (mode === "timeout")
          await new Promise(() => {});
        if (mode === "report")
          report({ level: "error", message: "Invalid result" });
        else
          throw new Error("Injected failure");
      } },
      { id: "healthy-after", scope: "item", apply({ item }: ApplyContext) { item.setField("volume", "10"); } },
    ] as any });
    expect(item.getField("title")).toBe("Original");
    expect(item.getField("date")).toBe("2026");
    expect(item.getField("volume")).toBe("10");
    expect((item as any).persisted.title).toBe("Original");
    expect(runner.lastResult).toMatchObject({ failed: 1, saved: 1 });
  });

  it("does not save an item when the only change was rolled back", async () => {
    const runner = new LintRunner();
    const item = createItem();
    await runner.add({ items: [item], silent: true, rules: [{ id: "broken-only", scope: "item", apply({ item }: ApplyContext) {
      item.setField("title", "Partial");
      throw new Error("Failed");
    } }] as any });
    expect(runner.lastResult?.saved).toBe(0);
    expect(item.getField("title")).toBe("Original");
    expect(runner.lastResult?.changes).toEqual([]);
  });
  it("reports unchanged and inapplicable items separately", async () => {
    const runner = new LintRunner();
    await runner.add({ items: [createItem()], silent: true, rules: [{ id: "not-applicable", scope: "item", ignoreItemTypes: ["journalArticle"], apply() {
      throw new Error("Must not run");
    } }] as any });
    expect(runner.lastResult).toMatchObject({ processed: 1, saved: 0, changed: 0, unchanged: 1, notApplicable: 1 });
  });
  it("does not roll back concurrent edits made outside the failed rule", async () => {
    const runner = new LintRunner();
    const item = createItem();
    await runner.add({ items: [item], silent: true, rules: [{ id: "external-edit", scope: "item", async apply({ item: guarded }: ApplyContext) {
      guarded.setField("title", "Partial");
      item.setField("title", "Manual edit");
      item.setField("date", "2026");
      throw new Error("Failed");
    } }] as any });
    expect(item.getField("title")).toBe("Manual edit");
    expect(item.getField("date")).toBe("2026");
    expect(runner.lastResult?.changes).not.toEqual(expect.arrayContaining([expect.objectContaining({ field: "title" })]));
  });
  it("quarantines an item when its failed rule cannot be restored", async () => {
    const runner = new LintRunner();
    const item = createItem();
    (item as any).fromJSON = () => {
      throw new Error("Restore failed");
    };
    (item as any).reload = async () => {
      (item as any).fields = { title: "Original", itemType: "journalArticle" };
    };
    const following = vi.fn();
    await runner.add({ items: [item], silent: true, rules: [
      { id: "broken-restore", scope: "item", apply({ item: target }: ApplyContext) {
        target.setField("title", "Partial");
        throw new Error("Rule failed");
      } },
      { id: "following", scope: "item", apply: following },
    ] as any });
    expect(following).not.toHaveBeenCalled();
    expect(item.getField("title")).toBe("Original");
    expect(runner.lastResult).toMatchObject({ failed: 1, saved: 0 });
  });

  it("settles cancellation during preparation and permits a later batch", async () => {
    const runner = new LintRunner();
    const item = createItem();
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    let signal: AbortSignal | undefined;
    const pending = runner.add({ items: [item], silent: true, rules: [{ id: "pending-prepare", scope: "item", async prepare(ctx: PrepareContext) {
      signal = ctx.signal;
      started();
      await new Promise(() => {});
    }, apply() {} }] as any });
    await entered;
    runner.cancel();
    await pending;
    expect(signal?.aborted).toBe(true);
    expect(runner.lastResult?.cancelled).toBe(true);
    await runner.add({ items: [item], silent: true, rules: [{ id: "healthy", scope: "item", apply({ item }: ApplyContext) {
      item.setField("title", "Next batch");
    } }] as any });
    expect(item.getField("title")).toBe("Next batch");
  }, 1000);
  it("does not label superseded rule values as saved", async () => {
    const runner = new LintRunner();
    await runner.add({ items: [createItem()], silent: true, rules: [
      { id: "first", scope: "item", apply({ item }: ApplyContext) { item.setField("title", "Intermediate"); } },
      { id: "second", scope: "item", apply({ item }: ApplyContext) { item.setField("title", "Final"); } },
    ] as any });
    expect(runner.lastResult?.changes).toEqual([
      expect.objectContaining({ after: "Intermediate", saved: false }),
      expect.objectContaining({ after: "Final", saved: true }),
    ]);
  });

  it("restores an intervening manual edit when a failed rule writes the same field twice", async () => {
    const runner = new LintRunner();
    const item = createItem();
    await runner.add({ items: [item], silent: true, rules: [{ id: "repeated-write", scope: "item", async apply({ item: guarded }: ApplyContext) {
      guarded.setField("title", "First attempt");
      await Promise.resolve();
      item.setField("title", "Manual edit");
      guarded.setField("title", "Second attempt");
      throw new Error("Failed");
    } }] as any });
    expect(item.getField("title")).toBe("Manual edit");
    expect(runner.lastResult?.changes).toEqual([]);
  });
});
