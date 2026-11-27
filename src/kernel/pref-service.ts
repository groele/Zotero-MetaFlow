import type { TypedEventBus } from "./event-bus";
import type { Disposable } from "./types";

export interface HostPrefsAdapter {
  get: (key: string, global?: boolean) => unknown;
  set?: (key: string, value: unknown, global?: boolean) => void;
  clear?: (key: string, global?: boolean) => void;
  registerObserver?: (key: string, handler: () => void, global?: boolean) => symbol | string | number;
  unregisterObserver?: (id: symbol | string | number) => void;
}

export interface UnifiedPrefServiceOptions {
  prefix?: string | (() => string);
  defaults?: Record<string, unknown>;
  bus?: TypedEventBus;
  adapter?: HostPrefsAdapter;
}

type ObserverToken = symbol | string | number;

function resolveHostAdapter(): HostPrefsAdapter | null {
  const host = (globalThis as any).Zotero?.Prefs;
  return host && typeof host.get === "function" ? host : null;
}

export class UnifiedPrefService {
  private readonly cache = new Map<string, unknown>();
  private readonly hostObserverByKey = new Map<string, ObserverToken>();
  private readonly keyListeners = new Map<string, Set<(value: unknown) => void>>();
  private readonly observerIDs: ObserverToken[] = [];
  private readonly prefixOption?: string | (() => string);
  private readonly defaults: Record<string, unknown>;
  private readonly bus?: TypedEventBus;
  private readonly adapterOverride?: HostPrefsAdapter;
  private boundAdapter: HostPrefsAdapter | null = null;
  private writingKey: string | null = null;

  constructor(options: UnifiedPrefServiceOptions = {}) {
    this.prefixOption = options.prefix;
    this.defaults = options.defaults ?? {};
    this.bus = options.bus;
    this.adapterOverride = options.adapter;
  }

  private resolveBoundAdapter(): HostPrefsAdapter | null {
    const nextAdapter = this.adapterOverride ?? resolveHostAdapter();
    if (nextAdapter !== this.boundAdapter) {
      this.cache.clear();
      this.hostObserverByKey.clear();
      this.observerIDs.length = 0;
      this.boundAdapter = nextAdapter;
    }
    return nextAdapter;
  }

  private resolvePrefix(): string {
    if (typeof this.prefixOption === "function")
      return this.prefixOption();
    if (typeof this.prefixOption === "string")
      return this.prefixOption;
    return (globalThis as any).addon?.data?.config?.prefsPrefix || "extensions.zotero.metaref";
  }

  fullKey(key: string): string {
    const raw = this.resolvePrefix();
    if (!raw)
      return key;
    const normalized = raw.endsWith(".") ? raw : `${raw}.`;
    return `${normalized}${key}`;
  }

  private ensureHostObserver(key: string, adapter: HostPrefsAdapter | null): void {
    if (this.hostObserverByKey.has(key) || !adapter?.registerObserver)
      return;
    const placeholder = Symbol(key);
    this.hostObserverByKey.set(key, placeholder);
    try {
      const token = adapter.registerObserver(
        this.fullKey(key),
        () => {
          this.cache.delete(key);
          const listeners = this.keyListeners.get(key);
          const emitBus = Boolean(this.bus && this.writingKey !== key);
          if ((listeners && listeners.size > 0) || emitBus) {
            const next = this.get(key);
            if (emitBus)
              this.bus?.emit("prefs:changed", { key, value: next });
            if (listeners) {
              for (const fn of [...listeners])
                fn(next);
            }
          }
        },
        true,
      );
      this.hostObserverByKey.set(key, token);
      this.observerIDs.push(token);
    }
    catch {
      this.hostObserverByKey.delete(key);
    }
  }

  private releaseKeyObserverIfEmpty(key: string, adapter: HostPrefsAdapter | null): void {
    const set = this.keyListeners.get(key);
    if (set && set.size > 0)
      return;
    this.keyListeners.delete(key);
    const token = this.hostObserverByKey.get(key);
    if (token !== undefined) {
      this.hostObserverByKey.delete(key);
      const idx = this.observerIDs.indexOf(token);
      if (idx >= 0)
        this.observerIDs.splice(idx, 1);
      try {
        adapter?.unregisterObserver?.(token);
      }
      catch {
        // ignore unregister error
      }
    }
    this.cache.delete(key);
  }

  observeKeys(
    keys: readonly string[],
    onChange: (key: string, value: unknown) => void,
    signal?: AbortSignal,
  ): Disposable {
    if (signal?.aborted)
      return () => {};
    const adapter = this.resolveBoundAdapter();
    const entries: Array<[string, (value: unknown) => void]> = [];
    for (const key of new Set(keys)) {
      const fn = (value: unknown) => onChange(key, value);
      let set = this.keyListeners.get(key);
      if (!set) {
        set = new Set();
        this.keyListeners.set(key, set);
      }
      set.add(fn);
      entries.push([key, fn]);
      this.ensureHostObserver(key, adapter);
    }

    let active = true;
    const cleanup = () => {
      if (!active)
        return;
      active = false;
      signal?.removeEventListener("abort", cleanup);
      const currentAdapter = this.resolveBoundAdapter();
      for (const [key, fn] of entries) {
        const set = this.keyListeners.get(key);
        set?.delete(fn);
        this.releaseKeyObserverIfEmpty(key, currentAdapter);
      }
    };

    if (signal)
      signal.addEventListener("abort", cleanup, { once: true });

    return cleanup;
  }

  get<T = unknown>(key: string, fallback?: T): T {
    const adapter = this.resolveBoundAdapter();
    const observed = this.hostObserverByKey.has(key);
    if (observed && this.cache.has(key))
      return this.cache.get(key) as T;

    let raw: unknown;
    try {
      raw = adapter?.get(this.fullKey(key), true);
    }
    catch {
      raw = undefined;
    }

    const resolved = (raw !== undefined ? raw : fallback !== undefined ? fallback : this.defaults[key]) as T;
    if (observed && (raw !== undefined || fallback === undefined))
      this.cache.set(key, resolved);
    return resolved;
  }

  set(key: string, value: unknown): void {
    const adapter = this.resolveBoundAdapter();
    if (this.hostObserverByKey.has(key))
      this.cache.set(key, value);
    const prevWriting = this.writingKey;
    this.writingKey = key;
    try {
      adapter?.set?.(this.fullKey(key), value, true);
    }
    catch {
      // ignore host set error
    }
    finally {
      this.writingKey = prevWriting;
    }
    this.bus?.emit("prefs:changed", { key, value });
  }

  clear(key: string): void {
    const adapter = this.resolveBoundAdapter();
    this.cache.delete(key);
    const prevWriting = this.writingKey;
    this.writingKey = key;
    try {
      adapter?.clear?.(this.fullKey(key), true);
    }
    catch {
      // ignore host clear error
    }
    finally {
      this.writingKey = prevWriting;
    }
    const next = this.get(key);
    this.bus?.emit("prefs:changed", { key, value: next });
  }

  invalidate(key?: string): void {
    if (key !== undefined)
      this.cache.delete(key);
    else
      this.cache.clear();
  }

  dispose(): void {
    const adapter = this.resolveBoundAdapter();
    if (adapter?.unregisterObserver) {
      for (const token of this.observerIDs) {
        try {
          adapter.unregisterObserver(token);
        }
        catch {
          // ignore unregister error
        }
      }
    }
    this.observerIDs.length = 0;
    this.hostObserverByKey.clear();
    this.keyListeners.clear();
    this.cache.clear();
  }
}

const fallbackHostPrefService = new UnifiedPrefService({
  prefix: () => (globalThis as any).addon?.data?.config?.prefsPrefix || "extensions.zotero.metaref",
});

export function observeHostPrefs(
  keys: readonly string[],
  onChange: (key: string, value: unknown) => void,
  signal?: AbortSignal,
): Disposable {
  const kernelPrefs = (globalThis as any).addon?.kernel?.prefs;
  if (kernelPrefs && typeof kernelPrefs.observeKeys === "function")
    return kernelPrefs.observeKeys(keys, onChange, signal);
  return fallbackHostPrefService.observeKeys(keys, onChange, signal);
}
