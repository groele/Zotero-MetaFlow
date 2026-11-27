import type { TypedEventBus } from "./event-bus";
import type { Disposable, NotifierEventPayload } from "./types";

type NotifierCallback = (payload: NotifierEventPayload) => void | Promise<void>;

export interface UnifiedNotifierHubOptions {
  observerID?: string;
  priority?: number;
  isAlive?: () => boolean;
  onHostNotify?: (payload: NotifierEventPayload) => void | Promise<void>;
  onError?: (error: unknown) => void;
}

/**
 * Single global Zotero.Notifier registration shared across domains.
 */
export class UnifiedNotifierHub {
  private readonly bus: TypedEventBus;
  private readonly observerID: string;
  private readonly priority: number;
  private readonly isAlive?: () => boolean;
  private readonly onHostNotify?: (payload: NotifierEventPayload) => void | Promise<void>;
  private readonly onError?: (error: unknown) => void;
  private readonly listeners = new Map<string, Set<NotifierCallback>>();
  private registeredID: string | number | null = null;
  private started = false;

  constructor(bus: TypedEventBus, options: UnifiedNotifierHubOptions = {}) {
    this.bus = bus;
    this.observerID = options.observerID ?? "metaref";
    this.priority = options.priority ?? 666;
    this.isAlive = options.isAlive;
    this.onHostNotify = options.onHostNotify;
    this.onError = options.onError;
  }

  get isStarted(): boolean {
    return this.started;
  }

  start(): void {
    if (this.started)
      return;
    const notifier = (globalThis as any).Zotero?.Notifier;
    if (!notifier?.registerObserver)
      return;
    const id = notifier.registerObserver(
      {
        notify: (
          event: string,
          type: string,
          ids: Array<string | number>,
          extraData?: Record<string, unknown>,
        ) => {
          if (this.isAlive && !this.isAlive()) {
            this.stop();
            return;
          }
          const payload: NotifierEventPayload = {
            event,
            type,
            ids: Array.isArray(ids) ? [...ids] : [],
            extraData,
          };
          const task = this.onHostNotify
            ? Promise.resolve().then(() => this.onHostNotify!(payload))
            : this.dispatch(payload);
          void task.catch((error) => {
            this.onError?.(error);
          });
        },
      },
      ["item"],
      this.observerID,
      this.priority,
    );
    this.registeredID = id ?? this.observerID;
    this.started = true;
  }

  subscribe(types: readonly string[], callback: NotifierCallback): Disposable {
    for (const type of types) {
      let set = this.listeners.get(type);
      if (!set) {
        set = new Set();
        this.listeners.set(type, set);
      }
      set.add(callback);
    }
    let active = true;
    return () => {
      if (!active)
        return;
      active = false;
      for (const type of types) {
        const set = this.listeners.get(type);
        set?.delete(callback);
        if (set && set.size === 0)
          this.listeners.delete(type);
      }
    };
  }

  async dispatch(payload: NotifierEventPayload): Promise<void> {
    this.bus.emit("notifier:event", payload);
    const set = this.listeners.get(payload.type);
    if (!set || set.size === 0)
      return;
    await Promise.all(
      [...set].map(async (cb) => {
        try {
          await cb(payload);
        }
        catch (error) {
          this.onError?.(error);
        }
      }),
    );
  }

  stop(): void {
    if (this.started && this.registeredID !== null) {
      try {
        (globalThis as any).Zotero?.Notifier?.unregisterObserver?.(this.registeredID);
      }
      catch {
        // ignore unregister error
      }
    }
    this.registeredID = null;
    this.started = false;
  }

  restart(): void {
    this.stop();
    this.start();
  }

  dispose(): void {
    this.stop();
    this.listeners.clear();
  }
}
