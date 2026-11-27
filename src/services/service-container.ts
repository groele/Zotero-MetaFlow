import type { PluginKernel } from "../kernel/plugin-kernel";
import type { Disposable, NotifierEventPayload } from "../kernel/types";
import type { CacheClearTarget } from "./cache-coordinator";
import { clearDuplicateSearchCache } from "../utils/duplicate-search-cache";
import { bumpLintPrefsRevision, invalidateItemLintFingerprint } from "../utils/lint-fingerprint-cache";
import { CacheCoordinatorService } from "./cache-coordinator";

const FINGERPRINT_INVALIDATION_EVENTS = new Set(["modify", "delete", "trash"]);
const DUPLICATE_CACHE_RESET_EVENTS = new Set(["add", "modify", "delete", "trash", "refresh"]);

export class ServiceContainer {
  public readonly cache: CacheCoordinatorService;
  private readonly disposables: Disposable[] = [];

  constructor(private readonly kernel: PluginKernel) {
    this.cache = new CacheCoordinatorService();
  }

  public init(): void {
    if (this.disposables.length > 0 || this.kernel.isDisposed)
      return;

    const prefsSub = this.kernel.bus.on("prefs:changed", () => {
      bumpLintPrefsRevision();
    });
    const cacheSub = this.kernel.bus.on(
      "cache:clear-requested",
      ({ target }: { target: CacheClearTarget }) => this.cache.clearByTarget(target),
    );
    const notifierSub = this.kernel.notifier.subscribe(["item"], (ev: NotifierEventPayload) => {
      if (ev.type !== "item")
        return;
      if (FINGERPRINT_INVALIDATION_EVENTS.has(ev.event)) {
        for (const id of ev.ids || []) {
          const numericId = Number(id);
          if (Number.isFinite(numericId) && numericId > 0)
            invalidateItemLintFingerprint(numericId);
        }
      }
      if (DUPLICATE_CACHE_RESET_EVENTS.has(ev.event))
        clearDuplicateSearchCache();
    });

    this.disposables.push(prefsSub, cacheSub, notifierSub);
  }

  public dispose(): void {
    while (this.disposables.length > 0)
      this.disposables.pop()?.();
  }
}
