export function createAbortController(): AbortController {
  let hostWindow: any;
  try {
    hostWindow = typeof Zotero !== "undefined" && typeof Zotero.getMainWindow === "function"
      ? Zotero.getMainWindow()
      : undefined;
  }
  catch {
    hostWindow = undefined;
  }
  const Controller = hostWindow?.AbortController || AbortController;
  return new Controller();
}

export async function runWithDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  signal?.throwIfAborted();
  const controller = createAbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onParentAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", onParentAbort, { once: true });
  if (signal?.aborted)
    onParentAbort();

  const deadline = timeoutMs > 0
    ? new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(timeoutMessage);
          controller.abort(error);
          reject(error);
        }, timeoutMs);
      })
    : undefined;

  const cancelled = signal
    ? new Promise<never>((_, reject) => {
        if (signal.aborted) {
          reject(signal.reason);
          return;
        }
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      })
    : undefined;

  try {
    const task = Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return operation(controller.signal);
    });
    const racers: Promise<T>[] = [task];
    if (deadline)
      racers.push(deadline);
    if (cancelled)
      racers.push(cancelled);
    return await Promise.race(racers);
  }
  catch (error) {
    if (!controller.signal.aborted)
      controller.abort(error);
    throw error;
  }
  finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onParentAbort);
    if (!controller.signal.aborted)
      controller.abort(new Error("Operation has finished"));
  }
}

/** Prevent a timed-out rule from changing the live item or reporting into a later batch. */
export async function executeRule<T extends object>(
  item: T,
  apply: (item: T, signal: AbortSignal) => Promise<void>,
  timeout = 60_000,
  createController: () => AbortController = createAbortController,
  onMutation: (mutate: () => unknown) => unknown = mutate => mutate(),
  owner?: AbortSignal,
): Promise<void> {
  const controller = createController();
  const guarded = new Proxy(item, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (typeof value !== "function")
        return value;
      return (...args: unknown[]) => {
        if (/^(?:set|add|remove|erase|save|fromJSON|reload)/.test(String(key))) {
          controller.signal.throwIfAborted();
          if (/^(?:save|erase|reload)/.test(String(key)))
            throw new Error("Rules must use the runner's save boundary");
          return onMutation(() => value.apply(target, args));
        }
        return value.apply(target, args);
      };
    },
    set(target, key, value) {
      controller.signal.throwIfAborted();
      return onMutation(() => Reflect.set(target, key, value, target)) as boolean;
    },
    deleteProperty(target, key) {
      controller.signal.throwIfAborted();
      return onMutation(() => Reflect.deleteProperty(target, key)) as boolean;
    },
    defineProperty(target, key, descriptor) {
      controller.signal.throwIfAborted();
      return onMutation(() => Reflect.defineProperty(target, key, descriptor)) as boolean;
    },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => {
      controller.abort(owner?.reason);
      reject(owner?.reason);
    };
    owner?.addEventListener("abort", abort, { once: true });
    if (owner?.aborted)
      abort();
  });
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`Rule timed out after ${timeout}ms`);
      controller.abort(error);
      reject(error);
    }, timeout);
  });
  try {
    await Promise.race([Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return apply(guarded, controller.signal);
    }), deadline, cancelled]);
  }
  catch (error) {
    controller.abort(error);
    throw error;
  }
  finally {
    clearTimeout(timer);
    owner?.removeEventListener("abort", abort);
    if (!controller.signal.aborted)
      controller.abort(new Error("Rule execution has finished"));
  }
}

export function normalizedConcurrency(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(1, Math.min(16, Math.floor(value)))
    : 1;
}

/** Let cancellation release a queue even when an external operation never settles. */
export async function waitForOperation<T>(operation: () => T | Promise<T>, signal: AbortSignal, timeout = 0): Promise<T> {
  signal.throwIfAborted();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (timeout > 0)
      timer = setTimeout(() => reject(new Error(`Preparation timed out after ${timeout}ms`)), timeout);
  });
  try {
    return await Promise.race([Promise.resolve().then(() => {
      signal.throwIfAborted();
      return operation();
    }), cancelled]);
  }
  finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}

export function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
