import type { HostPrefsAdapter } from "./pref-service";
import type { BridgeModule, DomainId, DomainModule, NotifierEventPayload, PluginInfo } from "./types";
import { CommandRegistry } from "./command-registry";
import { AsyncDisposableStack } from "./disposable";
import { DomainPortRegistry } from "./domain-ports";
import { TypedEventBus } from "./event-bus";
import { resolveZoteroHost } from "./host-globals";
import { NativeRuntime } from "./native-runtime";
import { UnifiedNotifierHub } from "./notifier-hub";
import { UnifiedPrefService } from "./pref-service";

export interface PluginKernelOptions {
  prefPrefix?: string | (() => string);
  prefDefaults?: Record<string, unknown>;
  prefAdapter?: HostPrefsAdapter;
  onHostNotify?: (payload: NotifierEventPayload) => void | Promise<void>;
  onError?: (scope: string, error: unknown) => void;
}

export class PluginKernel {
  public info: PluginInfo = { id: "metaflow@groele", version: "", rootURI: "" };
  public readonly bus: TypedEventBus;
  public readonly commands: CommandRegistry;
  public readonly ports = new DomainPortRegistry();
  public readonly prefs: UnifiedPrefService;
  public readonly runtime = new NativeRuntime();
  public readonly notifier: UnifiedNotifierHub;
  public readonly disposables = new AsyncDisposableStack();

  private readonly onError?: (scope: string, error: unknown) => void;
  private readonly domains = new Map<DomainId, DomainModule>();
  private readonly bridges: BridgeModule[] = [];
  private readonly activeBridges = new Set<BridgeModule>();
  private readonly openWindows = new Map<Window, Promise<void>>();
  private initialized = false;
  private started = false;
  private disposed = false;
  private generation = 0;
  private syncQueue: Promise<void> = Promise.resolve();
  private shutdownPromise: Promise<void> | null = null;

  constructor(options: PluginKernelOptions = {}) {
    this.onError = options.onError;
    this.bus = new TypedEventBus((event, error) => this.reportError(`bus:${event}`, error));
    this.commands = new CommandRegistry((id, error) => this.reportError(`command:${id}`, error));
    this.prefs = new UnifiedPrefService({
      prefix: options.prefPrefix,
      defaults: options.prefDefaults,
      bus: this.bus,
      adapter: options.prefAdapter,
    });
    this.notifier = new UnifiedNotifierHub(this.bus, {
      isAlive: () => !this.disposed,
      onHostNotify: options.onHostNotify,
      onError: error => this.reportError("notifier", error),
    });
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  get isStarted(): boolean {
    return this.started;
  }

  private reportError(scope: string, error: unknown): void {
    this.onError?.(scope, error);
  }

  init(info: PluginInfo): void {
    if (this.initialized || this.disposed)
      return;
    this.info = { ...info };
    this.initialized = true;
  }

  async revive(): Promise<void> {
    if (this.shutdownPromise)
      await this.shutdownPromise;
    if (!this.disposed)
      return;
    this.disposed = false;
    this.disposables.reopen();
  }

  registerDomain(domain: DomainModule): void {
    this.domains.set(domain.id, domain);
  }

  registerBridge(bridge: BridgeModule): void {
    this.bridges.push(bridge);
  }

  isBridgeActive(id: string): boolean {
    for (const bridge of this.activeBridges) {
      if (bridge.id === id)
        return true;
    }
    return false;
  }

  async start(): Promise<void> {
    if (this.started || this.disposed)
      return;
    const gen = this.generation;
    this.started = true;
    this.notifier.start();

    const watchedKeys = [
      ...new Set(
        [...this.domains.values()]
          .map(domain => domain.enabledPref)
          .filter((key): key is string => Boolean(key)),
      ),
    ];
    if (watchedKeys.length > 0) {
      this.disposables.add(
        this.prefs.observeKeys(watchedKeys, () => {
          void this.syncDomainStates();
        }),
      );
    }

    await this.syncDomainStates();
    if (this.disposed || gen !== this.generation)
      return;

    const zot = resolveZoteroHost();
    const existing = zot?.getMainWindows?.() as Window[] | undefined;
    if (Array.isArray(existing) && existing.length > 0) {
      for (const win of existing) {
        if (this.disposed || gen !== this.generation)
          return;
        await this.onMainWindowLoad(win);
      }
    }
    else {
      const mainWin = zot?.getMainWindow?.() as Window | undefined;
      if (mainWin && !this.disposed && gen === this.generation)
        await this.onMainWindowLoad(mainWin);
    }
  }

  syncDomainStates(): Promise<void> {
    const next = this.syncQueue.then(() => this.runSyncDomainStates());
    this.syncQueue = next.catch(() => {});
    return next;
  }

  private shouldBridgeBeActive(bridge: BridgeModule): boolean {
    if (!this.started || this.disposed)
      return false;
    if (!bridge.requires?.length)
      return true;
    return bridge.requires.every(id => Boolean(this.domains.get(id)?.isActive()));
  }

  private syncBridgeStates(): void {
    for (const bridge of [...this.bridges].reverse()) {
      if (this.activeBridges.has(bridge) && !this.shouldBridgeBeActive(bridge)) {
        this.activeBridges.delete(bridge);
        try {
          bridge.stop();
        }
        catch (error) {
          this.reportError(`bridge:stop:${bridge.id}`, error);
        }
      }
    }
    for (const bridge of this.bridges) {
      if (!this.activeBridges.has(bridge) && this.shouldBridgeBeActive(bridge)) {
        try {
          bridge.start();
          this.activeBridges.add(bridge);
        }
        catch (error) {
          this.reportError(`bridge:${bridge.id}`, error);
        }
      }
    }
  }

  private async runSyncDomainStates(): Promise<void> {
    const gen = this.generation;
    for (const domain of this.domains.values()) {
      if (this.disposed || gen !== this.generation)
        return;
      const shouldEnable = domain.enabledPref
        ? Boolean(this.prefs.get(domain.enabledPref))
        : true;
      const currentlyActive = domain.isActive();
      if (shouldEnable && !currentlyActive) {
        try {
          await domain.start();
          if (this.disposed || gen !== this.generation) {
            if (domain.isActive())
              await domain.stop();
            return;
          }
          for (const win of [...this.openWindows.keys()]) {
            try {
              await domain.onMainWindowLoad?.(win);
            }
            catch (error) {
              this.reportError(`windowLoad:${domain.id}`, error);
            }
          }
        }
        catch (error) {
          this.reportError(`domain:start:${domain.id}`, error);
        }
      }
      else if (!shouldEnable && currentlyActive) {
        try {
          for (const win of [...this.openWindows.keys()]) {
            try {
              await domain.onMainWindowUnload?.(win);
            }
            catch (error) {
              this.reportError(`windowUnload:${domain.id}`, error);
            }
          }
          await domain.stop();
        }
        catch (error) {
          this.reportError(`domain:stop:${domain.id}`, error);
        }
      }
    }
    if (!this.disposed && gen === this.generation)
      this.syncBridgeStates();
  }

  onMainWindowLoad(win: Window): Promise<void> {
    if (this.disposed || !win)
      return Promise.resolve();
    const existing = this.openWindows.get(win);
    if (existing)
      return existing;
    const gen = this.generation;
    this.openWindows.set(win, Promise.resolve());
    const task = (async () => {
      for (const domain of this.domains.values()) {
        if (this.disposed || gen !== this.generation || !this.openWindows.has(win))
          return;
        if (!domain.isActive())
          continue;
        try {
          await domain.onMainWindowLoad?.(win);
        }
        catch (error) {
          this.reportError(`windowLoad:${domain.id}`, error);
        }
      }
    })();
    this.openWindows.set(win, task);
    return task;
  }

  async onMainWindowUnload(win: Window): Promise<void> {
    if (!win || !this.openWindows.has(win))
      return;
    this.openWindows.delete(win);
    for (const domain of this.domains.values()) {
      if (!domain.isActive())
        continue;
      try {
        await domain.onMainWindowUnload?.(win);
      }
      catch (error) {
        this.reportError(`windowUnload:${domain.id}`, error);
      }
    }
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise)
      return this.shutdownPromise;
    if (this.disposed)
      return Promise.resolve();
    this.generation++;
    this.disposed = true;
    const task = this.runShutdown().finally(() => {
      if (this.shutdownPromise === task)
        this.shutdownPromise = null;
    });
    this.shutdownPromise = task;
    return task;
  }

  private async runShutdown(): Promise<void> {
    for (const bridge of [...this.bridges].reverse()) {
      if (!this.activeBridges.has(bridge))
        continue;
      this.activeBridges.delete(bridge);
      try {
        bridge.stop();
      }
      catch (error) {
        this.reportError(`bridge:stop:${bridge.id}`, error);
      }
    }
    for (const win of [...this.openWindows.keys()])
      await this.onMainWindowUnload(win);
    for (const domain of [...this.domains.values()].reverse()) {
      if (!domain.isActive())
        continue;
      try {
        await domain.stop();
      }
      catch (error) {
        this.reportError(`domain:stop:${domain.id}`, error);
      }
    }
    this.notifier.dispose();
    await this.disposables.disposeAll(error => this.reportError("dispose", error));
    this.runtime.unregisterAll();
    this.prefs.dispose();
    this.commands.clear();
    this.ports.clear();
    this.bus.clear();
    this.started = false;
    this.initialized = false;
  }
}
