import type { AsyncDisposable, Disposable } from "./types";

/**
 * LIFO resource disposer stack.
 * Guarantees idempotent cleanup and isolates per-disposer failures.
 */
export class DisposableStack {
  private readonly items: Disposable[] = [];
  private disposed = false;

  add(disposer: Disposable | null | undefined): Disposable {
    if (!disposer)
      return () => {};
    if (this.disposed) {
      try {
        disposer();
      }
      catch {
        // ignore late dispose error
      }
      return () => {};
    }
    let active = true;
    const wrapped: Disposable = () => {
      if (!active)
        return;
      active = false;
      const idx = this.items.indexOf(wrapped);
      if (idx >= 0)
        this.items.splice(idx, 1);
      disposer();
    };
    this.items.push(wrapped);
    return wrapped;
  }

  get size(): number {
    return this.items.length;
  }

  disposeAll(onError?: (error: unknown) => void): void {
    if (this.disposed)
      return;
    this.disposed = true;
    while (this.items.length > 0) {
      const fn = this.items.pop();
      if (!fn)
        continue;
      try {
        fn();
      }
      catch (error) {
        onError?.(error);
      }
    }
  }

  reset(onError?: (error: unknown) => void): void {
    this.disposeAll(onError);
    this.disposed = false;
  }
}

/**
 * Async LIFO resource disposer stack.
 * Awaits each disposer sequentially in reverse registration order with error isolation.
 */
export class AsyncDisposableStack {
  private readonly items: AsyncDisposable[] = [];
  private disposed = false;
  private disposingPromise: Promise<void> | null = null;

  add(disposer: AsyncDisposable | null | undefined): AsyncDisposable {
    if (!disposer)
      return async () => {};
    if (this.disposed) {
      try {
        const result = disposer();
        if (result && typeof (result as Promise<void>).catch === "function") {
          (result as Promise<void>).catch(() => {
            // ignore late async dispose error
          });
        }
      }
      catch {
        // ignore late sync dispose error
      }
      return async () => {};
    }
    let active = true;
    const wrapped: AsyncDisposable = async () => {
      if (!active)
        return;
      active = false;
      const idx = this.items.indexOf(wrapped);
      if (idx >= 0)
        this.items.splice(idx, 1);
      await disposer();
    };
    this.items.push(wrapped);
    return wrapped;
  }

  get size(): number {
    return this.items.length;
  }

  disposeAll(onError?: (error: unknown) => void): Promise<void> {
    if (this.disposingPromise)
      return this.disposingPromise;
    if (this.disposed)
      return Promise.resolve();
    this.disposed = true;
    this.disposingPromise = (async () => {
      try {
        while (this.items.length > 0) {
          const fn = this.items.pop();
          if (!fn)
            continue;
          try {
            await fn();
          }
          catch (error) {
            onError?.(error);
          }
        }
      }
      finally {
        this.disposingPromise = null;
      }
    })();
    return this.disposingPromise;
  }

  async reset(onError?: (error: unknown) => void): Promise<void> {
    await this.disposeAll(onError);
    this.disposed = false;
  }
}
