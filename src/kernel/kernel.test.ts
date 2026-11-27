import type { BridgeModule, DomainModule } from "./types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandRegistry } from "./command-registry";
import { AsyncDisposableStack, DisposableStack } from "./disposable";
import { DomainPortRegistry } from "./domain-ports";
import { TypedEventBus } from "./event-bus";
import { NativeRuntime } from "./native-runtime";
import { UnifiedNotifierHub } from "./notifier-hub";
import { PluginKernel } from "./plugin-kernel";
import { observeHostPrefs, UnifiedPrefService } from "./pref-service";

function createMockPrefsAdapter(initial: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(initial));
  const observers = new Map<symbol, { key: string; handler: () => void }>();
  const registerObserver = vi.fn((key: string, handler: () => void) => {
    const token = Symbol(key);
    observers.set(token, { key, handler });
    return token;
  });
  const unregisterObserver = vi.fn((token: symbol) => void observers.delete(token));
  const get = vi.fn((key: string) => store.get(key));
  const notifyKey = (key: string) => {
    for (const entry of [...observers.values()]) {
      if (entry.key === key)
        entry.handler();
    }
  };
  const set = vi.fn((key: string, value: unknown) => {
    store.set(key, value);
    notifyKey(key);
  });
  const clear = vi.fn((key: string) => {
    store.delete(key);
    notifyKey(key);
  });
  return { store, observers, get, set, clear, registerObserver, unregisterObserver };
}

describe("kernel primitives", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("disposes sync and async stacks LIFO, idempotently, and isolates errors", async () => {
    const order: string[] = [];
    const errors: unknown[] = [];
    const stack = new DisposableStack();
    const d1 = stack.add(() => order.push("s1"));
    stack.add(() => {
      order.push("s2-err");
      throw new Error("boom");
    });
    stack.add(() => order.push("s3"));
    expect(stack.size).toBe(3);
    d1();
    d1();
    expect(stack.size).toBe(2);
    stack.disposeAll(err => errors.push(err));
    stack.disposeAll(err => errors.push(err));
    expect(order).toEqual(["s1", "s3", "s2-err"]);
    expect(errors).toHaveLength(1);
    stack.reset();
    stack.add(() => order.push("s4"));
    stack.disposeAll();
    expect(order).toEqual(["s1", "s3", "s2-err", "s4"]);

    const asyncOrder: string[] = [];
    const asyncErrors: unknown[] = [];
    const aStack = new AsyncDisposableStack();
    aStack.add(async () => {
      await Promise.resolve();
      asyncOrder.push("a1");
    });
    aStack.add(async () => {
      asyncOrder.push("a2-err");
      throw new Error("async-boom");
    });
    aStack.add(() => void asyncOrder.push("a3"));
    await Promise.all([aStack.disposeAll(e => asyncErrors.push(e)), aStack.disposeAll(e => asyncErrors.push(e))]);
    expect(asyncOrder).toEqual(["a3", "a2-err", "a1"]);
    expect(asyncErrors).toHaveLength(1);
    await aStack.reset();
    aStack.add(async () => void asyncOrder.push("a4"));
    await aStack.disposeAll();
    expect(asyncOrder).toEqual(["a3", "a2-err", "a1", "a4"]);
  });

  it("emits typed bus payloads, isolates sync/async errors, and clears listeners", async () => {
    const errors: Array<{ event: string; error: unknown }> = [];
    const bus = new TypedEventBus((event, error) => errors.push({ event, error }));
    const seen: number[][] = [];
    const off = bus.on("tldr:updated", p => void seen.push([...p.itemIDs]));
    bus.on("tldr:updated", () => {
      throw new Error("sync");
    });
    bus.on("tldr:updated", async () => {
      throw new Error("async");
    });
    expect([bus.listenerCount("tldr:updated"), bus.listenerCount()]).toEqual([3, 3]);
    bus.emit("tldr:updated", { itemIDs: [1, 2] });
    await vi.waitFor(() => expect(errors).toHaveLength(2));
    expect(seen).toEqual([[1, 2]]);
    off();
    off();
    expect(bus.listenerCount("tldr:updated")).toBe(2);
    bus.clear();
    expect(bus.listenerCount()).toBe(0);
  });

  it("restores chained NativeRuntime patches even when disposed out of order", () => {
    const runtime = new NativeRuntime();
    const host = {
      value: 10,
      compute(x: number) {
        return this.value + x;
      },
    };
    const orig = host.compute;
    const wrap = (fn: (v: number) => number) => (next: (...a: any[]) => any) => function (this: typeof host, x: number) {
      return fn(next.call(this, x));
    };
    const d1 = runtime.patch(host, "compute", "host", wrap(v => v * 2));
    const d2 = runtime.patch(host, "compute", "host", wrap(v => v + 1));
    expect([runtime.pendingPatchCount, host.compute(5)]).toEqual([2, 31]);
    d1();
    d1();
    expect([runtime.pendingPatchCount, host.compute(5)]).toEqual([1, 16]);
    d2();
    expect([runtime.pendingPatchCount, host.compute === orig, host.compute(5)]).toEqual([0, true, 15]);
    runtime.patch(host, "compute", "host", wrap(v => v + 100));
    runtime.unregisterAll();
    expect([runtime.pendingPatchCount, host.compute === orig]).toEqual([0, true]);
  });

  it("registers notifier once, dispatches sync bus + async subscribers, and stops when dead", async () => {
    let registeredObserver: any;
    const registerObserver = vi.fn((observer: any) => {
      registeredObserver = observer;
      return "obs-1";
    });
    const unregisterObserver = vi.fn();
    vi.stubGlobal("Zotero", { Notifier: { registerObserver, unregisterObserver } });

    let alive = true;
    const errors: unknown[] = [];
    const bus = new TypedEventBus();
    const busEvents: string[] = [];
    bus.on("notifier:event", payload => void busEvents.push(`${payload.type}:${payload.event}`));

    const hub = new UnifiedNotifierHub(bus, { isAlive: () => alive, onError: err => errors.push(err) });
    hub.start();
    hub.start();
    expect(hub.isStarted).toBe(true);
    expect(registerObserver).toHaveBeenCalledOnce();
    expect(registerObserver).toHaveBeenCalledWith(expect.any(Object), ["item"], "metaref", 666);
    const subCalls: string[] = [];
    const unsub = hub.subscribe(["item"], async (payload) => {
      await Promise.resolve();
      subCalls.push(payload.event);
    });
    hub.subscribe(["item"], async () => {
      throw new Error("sub-fail");
    });
    await hub.dispatch({ event: "modify", type: "item", ids: [11] });
    expect(busEvents).toEqual(["item:modify"]);
    expect(subCalls).toEqual(["modify"]);
    expect(errors).toHaveLength(1);
    unsub();
    alive = false;
    registeredObserver.notify("add", "item", [12]);
    expect(hub.isStarted).toBe(false);
    expect(unregisterObserver).toHaveBeenCalledWith("obs-1");
  });
});

describe("pref service and host observer", () => {
  beforeEach(() => vi.unstubAllGlobals());
  it("caches only observed keys, unregisters empty observers, and handles adapter swap", () => {
    const adapter1 = createMockPrefsAdapter({ "extensions.zotero.metaref.a": 1 });
    vi.stubGlobal("Zotero", { Prefs: adapter1 });
    const bus = new TypedEventBus();
    const busChanges: Array<{ key: string; value: unknown }> = [];
    bus.on("prefs:changed", p => void busChanges.push(p));
    const prefs = new UnifiedPrefService({ defaults: { a: 0, b: "def" }, bus });
    expect(prefs.get("a")).toBe(1);
    expect(prefs.get("b")).toBe("def");
    expect(prefs.get("b", "custom")).toBe("custom");
    expect(adapter1.registerObserver).not.toHaveBeenCalled();
    const ac = new AbortController();
    const observed: Array<[string, unknown]> = [];
    const d1 = prefs.observeKeys(["a"], (k, v) => observed.push([k, v]), ac.signal);
    const d2 = prefs.observeKeys(["a"], (k, v) => observed.push([k, v]));
    expect(adapter1.registerObserver).toHaveBeenCalledTimes(1);
    expect(prefs.get("a")).toBe(1);
    expect(prefs.get("a")).toBe(1);
    expect(adapter1.get).toHaveBeenCalledTimes(4);
    prefs.set("a", 2);
    expect(busChanges).toEqual([{ key: "a", value: 2 }]);
    expect(observed).toEqual([["a", 2], ["a", 2]]);
    prefs.clear("a");
    expect(prefs.get("a")).toBe(0);
    ac.abort();
    expect(adapter1.unregisterObserver).not.toHaveBeenCalled();
    d2();
    expect(adapter1.unregisterObserver).toHaveBeenCalledTimes(1);
    d1();
    const d3 = prefs.observeKeys(["a"], () => {});
    const adapter2 = createMockPrefsAdapter({ "extensions.zotero.metaref.a": 9 });
    vi.stubGlobal("Zotero", { Prefs: adapter2 });
    expect(prefs.get("a")).toBe(9);
    expect(adapter2.unregisterObserver).not.toHaveBeenCalled();
    d3();
    prefs.dispose();
  });

  it("delegates observeHostPrefs to kernel or uses fallback service", () => {
    const adapter = createMockPrefsAdapter({ "extensions.zotero.custom.flag": false });
    vi.stubGlobal("Zotero", { Prefs: adapter });
    vi.stubGlobal("addon", { data: { config: { prefsPrefix: "extensions.zotero.custom" } } });
    const seen: unknown[] = [];
    const stop = observeHostPrefs(["flag"], (_k, v) => seen.push(v));
    adapter.set("extensions.zotero.custom.flag", true);
    expect(seen).toEqual([true]);
    stop();
    expect(adapter.unregisterObserver).toHaveBeenCalledOnce();
    const kernelObserve = vi.fn(() => () => {});
    vi.stubGlobal("addon", { kernel: { prefs: { observeKeys: kernelObserve } } });
    observeHostPrefs(["x"], () => {});
    expect(kernelObserve).toHaveBeenCalledOnce();
  });
});

describe("domain ports, commands, and PluginKernel", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("manages domain ports and command execution", async () => {
    const ports = new DomainPortRegistry();
    const lintPort = { runBatch: vi.fn(), stopAll: vi.fn(), enqueueAddedItems: vi.fn(), cancelAddedItems: vi.fn(), drainAddedItems: vi.fn(), isSavingPhase: vi.fn(() => false) };
    const offPort = ports.register("lint-engine", lintPort);
    expect(ports.has("lint-engine")).toBe(true);
    expect(ports.get("lint-engine")).toBe(lintPort);
    offPort();
    expect(ports.has("lint-engine")).toBe(false);

    const errors: unknown[] = [];
    const commands = new CommandRegistry((_id, err) => errors.push(err));
    const offCmd = commands.register({ id: "lint.run", owner: "lint-engine", title: "Run", action: (n: number) => n * 2 });
    expect(commands.has("lint.run")).toBe(true);
    expect(commands.listIds()).toEqual(["lint.run"]);
    expect(await commands.execute("lint.run", 21)).toBe(42);
    expect(await commands.execute("missing")).toBeUndefined();
    commands.register({
      id: "lint.fail",
      owner: "kernel",
      title: "Fail",
      action: async () => Promise.reject(new Error("cmd-err")),
    });
    await expect(commands.execute("lint.fail")).rejects.toThrow("cmd-err");
    expect(errors).toHaveLength(1);
    offCmd();
    commands.clear();
    expect(commands.listIds()).toEqual([]);
  });

  it("orchestrates domains, bridges, windows, pref toggles, and strict shutdown order", async () => {
    const adapter = createMockPrefsAdapter({ "extensions.zotero.metaref.domA.enabled": true, "extensions.zotero.metaref.domB.enabled": false });
    const fakeWin = { id: "win-1" } as unknown as Window;
    vi.stubGlobal("Zotero", { Prefs: adapter, Notifier: { registerObserver: vi.fn(() => "n-1"), unregisterObserver: vi.fn() }, getMainWindows: () => [fakeWin] });

    const events: string[] = [];
    const kernel = new PluginKernel();
    kernel.init({ id: "metaflow@groele", version: "17.1.2", rootURI: "chrome://metaref/" });

    const makeDomain = (id: DomainModule["id"], pref: string, withWin = false): { mod: DomainModule; isActive: () => boolean } => {
      let active = false;
      const mod: DomainModule = {
        id,
        enabledPref: pref,
        isActive: () => active,
        start: async () => {
          active = true;
          events.push(`${id}:start`);
        },
        stop: async () => {
          active = false;
          events.push(`${id}:stop`);
        },
        ...(withWin
          ? {
              onMainWindowLoad: () => void events.push(`${id}:winLoad`),
              onMainWindowUnload: () => void events.push(`${id}:winUnload`),
            }
          : {}),
      };
      return { mod, isActive: () => active };
    };

    const domA = makeDomain("lint-engine", "domA.enabled", true);
    const domB = makeDomain("journal-insights", "domB.enabled");
    const bridgeAB: BridgeModule = {
      id: "ab-bridge",
      requires: ["lint-engine", "journal-insights"],
      start: () => events.push("bridgeAB:start"),
      stop: () => events.push("bridgeAB:stop"),
    };

    kernel.registerDomain(domA.mod);
    kernel.registerDomain(domB.mod);
    kernel.registerBridge(bridgeAB);
    await kernel.start();
    expect(kernel.isStarted).toBe(true);
    expect([domA.isActive(), domB.isActive(), kernel.isBridgeActive("ab-bridge")]).toEqual([true, false, false]);
    expect(events).toEqual(["lint-engine:start", "lint-engine:winLoad"]);

    kernel.prefs.set("domB.enabled", true);
    await vi.waitFor(() => expect(kernel.isBridgeActive("ab-bridge")).toBe(true));

    kernel.disposables.add(async () => void events.push("disposables:dispose"));
    kernel.runtime.patch({ fn: () => 1 }, "fn", "test", orig => orig);
    kernel.commands.register({ id: "c1", owner: "kernel", title: "C1", action: () => {} });
    kernel.ports.register("workspace-ui", { refreshTldrRow: () => {}, placeTldrRow: () => {}, executeShortcut: () => {} });
    kernel.bus.on("tldr:updated", () => {});

    events.length = 0;
    const spyOrder = (obj: any, method: string, label: string) => {
      const orig = obj[method].bind(obj);
      vi.spyOn(obj, method).mockImplementation(() => {
        events.push(label);
        orig();
      });
    };
    spyOrder(kernel.notifier, "stop", "notifier:stop");
    spyOrder(kernel.runtime, "unregisterAll", "runtime:unregisterAll");
    spyOrder(kernel.prefs, "dispose", "prefs:dispose");

    await kernel.shutdown();
    expect(kernel.isDisposed).toBe(true);
    expect(kernel.isStarted).toBe(false);
    expect(kernel.commands.listIds()).toEqual([]);
    expect(kernel.ports.has("workspace-ui")).toBe(false);
    expect(kernel.bus.listenerCount()).toBe(0);
    expect(events).toEqual([
      "bridgeAB:stop",
      "lint-engine:winUnload",
      "journal-insights:stop",
      "lint-engine:stop",
      "notifier:stop",
      "disposables:dispose",
      "runtime:unregisterAll",
      "prefs:dispose",
    ]);
  });
});
