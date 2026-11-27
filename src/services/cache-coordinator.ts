import type { Disposable } from "../kernel/types";
import { resolveZoteroHost } from "../kernel/host-globals";
import { startCacheMaintenance, stopCacheMaintenance } from "../utils/cache-maintenance";
import { clearDuplicateSearchCache } from "../utils/duplicate-search-cache";
import { clearEasyScholarCache } from "../utils/easyscholar";
import { clearRequestCache } from "../utils/http";
import { clearJournalInsights } from "../utils/journal-insights";
import { flushJournalRankingIndex, resetJournalRankingIndex } from "../utils/journal-ranking-index";
import { clearLintFingerprintCache } from "../utils/lint-fingerprint-cache";
import { flushRuntimeData } from "../utils/runtime-data-storage";
import { clearStoredServiceCache, flushServiceCache } from "../utils/service-cache-storage";
import { clearSupplementalJournalCache } from "../utils/supplemental-journals";

export type CacheClearTarget = "memory" | "persistent" | "all";

export class CacheCoordinatorService {
  private readonly memoryCleaners = new Map<string, () => void>();
  private readonly persistentCleaners = new Map<string, () => Promise<void>>();

  public registerMemoryCleaner(id: string, fn: () => void): Disposable {
    this.memoryCleaners.set(id, fn);
    return () => {
      if (this.memoryCleaners.get(id) === fn)
        this.memoryCleaners.delete(id);
    };
  }

  public registerPersistentCleaner(id: string, fn: () => Promise<void>): Disposable {
    this.persistentCleaners.set(id, fn);
    return () => {
      if (this.persistentCleaners.get(id) === fn)
        this.persistentCleaners.delete(id);
    };
  }

  public clearMemoryCaches(): void {
    clearRequestCache();
    clearEasyScholarCache();
    clearSupplementalJournalCache();
    clearLintFingerprintCache();
    clearDuplicateSearchCache();
    this.runMemoryCleaners();
  }

  public async clearApiCaches(): Promise<void> {
    clearRequestCache();
    clearEasyScholarCache();
    clearSupplementalJournalCache();
    this.runMemoryCleaners();
    await clearStoredServiceCache(undefined, true);
    await this.runPersistentCleaners();
  }

  public async clearByTarget(target: CacheClearTarget): Promise<void> {
    if (target === "memory") {
      this.clearMemoryCaches();
      return;
    }
    if (target === "persistent") {
      await clearStoredServiceCache(undefined, true);
      await this.runPersistentCleaners();
      return;
    }
    this.clearMemoryCaches();
    await clearStoredServiceCache(undefined, true);
    await this.runPersistentCleaners();
  }

  public startMaintenance(): void {
    startCacheMaintenance();
  }

  public stopMaintenance(): Promise<void> {
    return stopCacheMaintenance();
  }

  public async flushAllPersistence(): Promise<void> {
    await stopCacheMaintenance();
    const results = await Promise.allSettled([
      flushRuntimeData(),
      flushServiceCache(),
      flushJournalRankingIndex(),
    ]);
    const debug = resolveZoteroHost()?.debug;
    for (const result of results) {
      if (result.status === "rejected" && typeof debug === "function")
        debug(`[MetaFlow shutdown persistence] ${String(result.reason)}`);
    }
  }

  public resetInMemoryIndexes(): void {
    resetJournalRankingIndex();
    clearJournalInsights();
  }

  private runMemoryCleaners(): void {
    for (const cleaner of this.memoryCleaners.values())
      cleaner();
  }

  private async runPersistentCleaners(): Promise<void> {
    for (const cleaner of this.persistentCleaners.values())
      await cleaner();
  }
}
