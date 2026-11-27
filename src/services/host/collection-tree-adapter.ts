import type { NativeRuntime } from "../../kernel/native-runtime";
import type { Disposable } from "../../kernel/types";
import { resolveZoteroHost } from "../../kernel/host-globals";

export function patchCollectionTreeDuplicateStats(
  runtime: NativeRuntime | undefined,
  formatSuffix: (libraryID: number | undefined) => string | null,
): Disposable {
  const prototype = resolveZoteroHost()?.CollectionTreeRow?.prototype as
    | { getName?: (...args: any[]) => unknown }
    | undefined;
  if (!prototype || typeof prototype.getName !== "function")
    return () => {};

  const createWrapper = (previous: (...args: any[]) => unknown) => {
    return function (this: any, ...args: any[]) {
      const title = previous.apply(this, args);
      if (typeof this?.isDuplicates !== "function" || !this.isDuplicates())
        return title;
      const libraryID = typeof this?.ref?.libraryID === "number" ? this.ref.libraryID : undefined;
      const suffix = formatSuffix(libraryID);
      if (!suffix)
        return title;
      return `${String(title)} ${suffix}`;
    };
  };

  if (runtime)
    return runtime.patch(prototype, "getName", "CollectionTreeRow", createWrapper);

  const previous = prototype.getName;
  const wrapped = createWrapper(previous);
  prototype.getName = wrapped;
  let disposed = false;
  return () => {
    if (disposed)
      return;
    disposed = true;
    if (prototype.getName === wrapped)
      prototype.getName = previous;
  };
}
