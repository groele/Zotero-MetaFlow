import type { PluginKernel } from "../../kernel/plugin-kernel";
import type { Disposable, DomainModule } from "../../kernel/types";
import type { BatchResult } from "../../services/lint/runner";
import { resolveAddonHost } from "../../kernel/host-globals";
import { ToolUpdateEasyScholar } from "../../services/metadata/easyscholar-rule";
import { cleanupResourcesSync } from "../../utils/cleanup";
import { invalidateEasyScholarTitle } from "../../utils/easyscholar";
import { redrawItemValues } from "../../utils/item-value-refresh";
import { clearJournalInsights, getJournalInsights, loadJournalInsights } from "../../utils/journal-insights";
import { hasEnabledJournalMetrics } from "../../utils/journal-permissions";
import { loadJournalRankingIndex } from "../../utils/journal-ranking-index";
import { logger } from "../../utils/logger";
import { getPref } from "../../utils/prefs";
import { invalidateSupplementalJournalTitle } from "../../utils/supplemental-journals";
import { registerExtraColumns, unregisterExtraColumns } from "./item-tree";
import {
  refreshJournalInsights,
  refreshJournalPane,
  registerJournalPane,
  setJournalUpdateResult,
  unregisterJournalPane,
} from "./journal-pane";

function isAddonAlive(): boolean {
  return typeof addon === "undefined" || !addon?.data || addon.data.alive;
}

export class JournalInsightsDomainModule implements DomainModule {
  public readonly id = "journal-insights" as const;

  private active = false;
  private generation = 0;
  private portDisposer?: Disposable;
  private readonly journalRefreshes = new Map<number, Promise<unknown>>();
  private readonly disposers: Disposable[] = [];

  constructor(private readonly kernel: PluginKernel) {}

  public isActive(): boolean {
    return this.active;
  }

  public async preload(): Promise<void> {
    await Promise.all([loadJournalInsights(), loadJournalRankingIndex()]);
  }

  public ensurePortRegistered(): void {
    if (this.portDisposer && this.kernel.ports.has("journal-insights"))
      return;
    this.portDisposer?.();
    this.portDisposer = this.kernel.ports.register("journal-insights", {
      refreshPane: itemIDs => refreshJournalPane(itemIDs),
      refreshInsights: () => refreshJournalInsights(),
      refreshItemJournal: (item, force = false) => this.refreshItemJournal(item, force),
      setUpdateResult: (itemIDs, result) => setJournalUpdateResult(itemIDs, result as BatchResult | undefined),
      syncExtraColumns: () => registerExtraColumns(),
    });
  }

  public start(): void {
    if (this.active)
      return;
    this.active = true;
    registerExtraColumns();
    registerJournalPane();
    this.ensurePortRegistered();
    this.disposers.push(
      this.kernel.bus.on("journal:refresh-requested", ({ itemIDs, reloadInsights }) => {
        const task = reloadInsights
          ? refreshJournalInsights()
          : refreshJournalPane(itemIDs ? [...itemIDs] : undefined);
        void task.catch(error => logger.error("Failed to handle journal refresh request:", error));
      }),
      this.kernel.commands.register({
        id: "journal:refresh",
        owner: this.id,
        title: "Refresh journal insights",
        action: (item?: Zotero.Item, force = false) => (
          item ? this.refreshItemJournal(item, force) : refreshJournalInsights()
        ),
      }),
    );
  }

  public refreshItemJournal(item: Zotero.Item, force = false): Promise<unknown> {
    if (!this.active || !isAddonAlive())
      return Promise.resolve();
    if (!item || item.deleted || !["journalArticle", "conferencePaper"].includes(item.itemType))
      return Promise.resolve();
    if (!force && (!hasEnabledJournalMetrics() || !item.isEditable()))
      return Promise.resolve();
    const existing = this.journalRefreshes.get(item.id);
    if (existing)
      return existing;
    const gen = this.generation;
    const task = (async () => {
      if (force) {
        clearJournalInsights();
        const title = String(
          item.getField("publicationTitle")
          || item.getField("conferenceName")
          || item.getField("proceedingsTitle")
          || "",
        ).trim();
        if (title) {
          await invalidateEasyScholarTitle(title);
          invalidateSupplementalJournalTitle(title);
        }
      }
      const mode = force
        ? ("all" as const)
        : getPref("rule.tool-update-metadata.option.mode") === "all"
          ? ("all" as const)
          : ("blank" as const);
      const runner = resolveAddonHost()?.runner;
      const result = (hasEnabledJournalMetrics() && item.isEditable() && runner?.add)
        ? await runner.add({
            items: [item],
            rules: [{ ...ToolUpdateEasyScholar, prepare: () => ({ mode }) }],
            silent: true,
          })
        : undefined;
      if (this.active && gen === this.generation && isAddonAlive() && !result?.cancelled) {
        await getJournalInsights(item, { queryAPI: true });
        await redrawItemValues([item.id]);
        setJournalUpdateResult([item.id], result);
        await refreshJournalPane([item.id]);
      }
      return result;
    })().finally(() => {
      if (this.journalRefreshes.get(item.id) === task)
        this.journalRefreshes.delete(item.id);
    });
    this.journalRefreshes.set(item.id, task);
    return task;
  }

  public stop(): void {
    this.active = false;
    this.generation++;
    this.journalRefreshes.clear();
    this.portDisposer?.();
    this.portDisposer = undefined;
    while (this.disposers.length > 0)
      this.disposers.pop()?.();
    cleanupResourcesSync([
      unregisterExtraColumns,
      unregisterJournalPane,
    ], error => logger.error("Journal insights cleanup failed:", error));
  }
}
