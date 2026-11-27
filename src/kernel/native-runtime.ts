import type { Disposable } from "./types";

type HostFunction = (...args: any[]) => any;
type PatchOwner = Record<string, unknown>;

interface PatchEntry {
  owner: PatchOwner;
  key: string;
  original: HostFunction;
  active: boolean;
  wrapper: HostFunction;
}

/**
 * Host adapter with idempotent per-patch disposers and safe wrapper-chain restoration.
 */
export class NativeRuntime {
  private readonly patches = new Set<PatchEntry>();
  private readonly patchByWrapper = new WeakMap<HostFunction, PatchEntry>();

  private restoreOriginal(entry: PatchEntry): HostFunction {
    let original = entry.original;
    let previous = this.patchByWrapper.get(original);
    while (previous && !previous.active) {
      original = previous.original;
      previous = this.patchByWrapper.get(original);
    }
    return original;
  }

  patch(
    owner: PatchOwner,
    key: string,
    _ownerName: string,
    createWrapper: (original: (...args: any[]) => any) => (...args: any[]) => any,
  ): Disposable {
    if (!owner || typeof owner[key] !== "function")
      throw new TypeError(`Cannot wrap ${key}`);
    const original = owner[key] as HostFunction;
    const delegate = createWrapper(original);
    if (typeof delegate !== "function")
      throw new TypeError(`Invalid wrapper for ${key}`);
    const entry: PatchEntry = { owner, key, original, active: true, wrapper: original };
    entry.wrapper = function (this: unknown, ...args: any[]) {
      return Reflect.apply(entry.active ? delegate : original, this, args);
    };
    owner[key] = entry.wrapper;
    this.patches.add(entry);
    this.patchByWrapper.set(entry.wrapper, entry);
    return () => {
      if (!entry.active)
        return;
      entry.active = false;
      if (owner[key] === entry.wrapper)
        owner[key] = this.restoreOriginal(entry);
      this.patches.delete(entry);
    };
  }

  unregisterAll(): void {
    for (const entry of [...this.patches].reverse()) {
      entry.active = false;
      if (entry.owner[entry.key] === entry.wrapper)
        entry.owner[entry.key] = this.restoreOriginal(entry);
    }
    this.patches.clear();
  }

  get pendingPatchCount(): number {
    return this.patches.size;
  }
}
