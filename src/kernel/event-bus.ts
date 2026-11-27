import type { Disposable, MetaFlowEventMap, MetaFlowEventName } from "./types";

type Listener<K extends MetaFlowEventName> = (payload: MetaFlowEventMap[K]) => void | Promise<void>;

export class TypedEventBus {
  private readonly listeners = new Map<MetaFlowEventName, Set<Listener<any>>>();
  private readonly onError?: (event: string, error: unknown) => void;

  constructor(onError?: (event: string, error: unknown) => void) {
    this.onError = onError;
  }

  on<K extends MetaFlowEventName>(event: K, listener: Listener<K>): Disposable {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
    let active = true;
    return () => {
      if (!active)
        return;
      active = false;
      set.delete(listener);
      if (set.size === 0)
        this.listeners.delete(event);
    };
  }

  emit<K extends MetaFlowEventName>(event: K, payload: MetaFlowEventMap[K]): void {
    const set = this.listeners.get(event);
    if (!set || set.size === 0)
      return;
    for (const listener of [...set]) {
      try {
        const result = listener(payload);
        if (result && typeof (result as Promise<void>).catch === "function") {
          (result as Promise<void>).catch(error => this.onError?.(event, error));
        }
      }
      catch (error) {
        this.onError?.(event, error);
      }
    }
  }

  listenerCount(event?: MetaFlowEventName): number {
    if (event)
      return this.listeners.get(event)?.size ?? 0;
    let total = 0;
    for (const set of this.listeners.values())
      total += set.size;
    return total;
  }

  clear(): void {
    this.listeners.clear();
  }
}
