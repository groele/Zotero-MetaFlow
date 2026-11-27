import type { PluginKernel } from "../../kernel/plugin-kernel";
import type { Disposable, DomainModule } from "../../kernel/types";
import type { BatchResult } from "../../services/lint/runner";
import type { ServiceContainer } from "../../services/service-container";
import { clearSemanticScholarCache } from "../../services/metadata/tool-update-metadata/services/semantic-scholar-service";
import { AutomaticItems } from "../../utils/automatic-items";
import { createAutomaticWorkflow, runAutomaticWorkflow } from "../../utils/automatic-workflow";
import { logger } from "../../utils/logger";
import { getPref } from "../../utils/prefs";
import { onLintInBatch } from "./batch-dispatch";
import { stopCoreWorkflows } from "./core-workflow";
import { Rules } from "./rules";

function isAddonAlive(): boolean {
  return typeof addon === "undefined" || !addon?.data || addon.data.alive;
}

function dispatchLintInBatch(
  ...args: Parameters<typeof onLintInBatch>
): ReturnType<typeof onLintInBatch> {
  const hostBatch = (globalThis as { addon?: { hooks?: { onLintInBatch?: typeof onLintInBatch } } })
    .addon
    ?.hooks
    ?.onLintInBatch;
  return (hostBatch ?? onLintInBatch)(...args);
}

export class LintEngineDomainModule implements DomainModule {
  public readonly id = "lint-engine" as const;

  private active = false;
  private portDisposer?: Disposable;
  private readonly disposers: Disposable[] = [];
  private readonly automaticItems: AutomaticItems;

  constructor(
    private readonly kernel: PluginKernel,
    private readonly services: ServiceContainer,
  ) {
    this.automaticItems = new AutomaticItems(
      ids => this.processAddedItems(ids),
      () => {
        const configuredDelay = getPref("lint.delayOnAdded");
        return Number.isFinite(configuredDelay) ? Math.max(500, Math.min(60_000, configuredDelay)) : 500;
      },
    );
  }

  public isActive(): boolean {
    return this.active;
  }

  public ensurePortRegistered(): void {
    if (this.portDisposer && this.kernel.ports.has("lint-engine"))
      return;
    this.portDisposer?.();
    this.portDisposer = this.kernel.ports.register("lint-engine", {
      runBatch: (ruleIDs, items, options) => dispatchLintInBatch(
        (typeof ruleIDs === "string" ? ruleIDs : [...ruleIDs]) as Parameters<typeof onLintInBatch>[0],
        items ?? "item",
        options,
      ),
      stopAll: () => this.stopAll(),
      enqueueAddedItems: ids => this.automaticItems.enqueue([...ids]),
      cancelAddedItems: () => this.automaticItems.cancelPending(),
      drainAddedItems: () => this.automaticItems.drain(),
      isSavingPhase: () => (
        ((globalThis as { addon?: { runner?: { stats?: { phase?: string } } } }).addon?.runner?.stats?.phase)
        === "saving"
      ),
    });
  }

  public start(): void {
    if (this.active)
      return;
    this.active = true;
    this.ensurePortRegistered();
    const cleanerDisposer = this.services.cache.registerMemoryCleaner("semantic-scholar", clearSemanticScholarCache);
    this.disposers.push(
      cleanerDisposer,
      this.kernel.commands.register({
        id: "metaflow:check",
        owner: this.id,
        title: "Check and repair metadata",
        action: (items?: Zotero.Item[]) => dispatchLintInBatch("standard", items ?? "item", { core: true }),
      }),
      this.kernel.commands.register({
        id: "metaflow:update",
        owner: this.id,
        title: "Update metadata",
        action: (items?: Zotero.Item[]) => dispatchLintInBatch("tool-update-metadata", items ?? "item", { core: true }),
      }),
    );
  }

  public async stop(): Promise<void> {
    this.active = false;
    this.automaticItems.cancelPending();
    await this.stopAll();
    await this.automaticItems.drain();
    this.portDisposer?.();
    this.portDisposer = undefined;
    while (this.disposers.length > 0)
      this.disposers.pop()?.();
  }

  private async stopAll(): Promise<void> {
    await Promise.all([
      stopCoreWorkflows(),
      (globalThis as { addon?: { runner?: { stop?: () => Promise<void> | void } } }).addon?.runner?.stop?.(),
    ]);
  }

  private async processAddedItems(ids: number[]): Promise<void> {
    const canProcess = (this.active || Boolean(this.portDisposer)) && isAddonAlive() && Boolean(getPref("lint.onAdded"));
    if (!canProcess)
      return;

    const items = Zotero.Items.get(ids).filter((item): item is Zotero.Item => {
      if (!item || !item.isRegularItem() || item.deleted || item.isFeedItem)
        return false;
      if (typeof item.isEditable === "function" && !item.isEditable())
        return false;
      if (!item.getField("title"))
        return false;
      const library = typeof item.libraryID === "number" ? Zotero.Libraries.get(item.libraryID) : undefined;
      if (library && library.libraryType === "group" && !getPref("lint.onGroup"))
        return false;
      return true;
    });

    if (items.length !== 0) {
      const workflow = createAutomaticWorkflow();
      const hostAddon = (globalThis as { addon?: typeof addon }).addon;
      if (hostAddon?.data)
        hostAddon.data.lastAutomaticWorkflow = workflow;
      const reviewPort = this.kernel.ports.get("review-duplicates");
      const journalPort = this.kernel.ports.get("journal-insights");
      await runAutomaticWorkflow(workflow, {
        metadata: async () => (
          getPref("metadata.autoUpdateOnAdded")
            ? await reviewPort?.runReview("tool-review-metadata", items, false, {
              scanPDF: false,
              searchTitle: true,
              repairCreators: getPref("metadata.repairCreators", true) === true,
              overwrite: false,
            }) as BatchResult | undefined
            : undefined
        ),
        format: async () => await dispatchLintInBatch("standard", items, { automatic: true }) as BatchResult | undefined,
        journal: async () => {
          const journalItems = items.filter(item => ["journalArticle", "conferencePaper"].includes(item.itemType));
          if (!getPref("easyscholar.autoUpdateOnAdded", false) || !journalItems.length)
            return;
          const rule = Rules.getByID("tool-update-easyscholar");
          if (!rule || !hostAddon?.runner?.add)
            return;
          const result = await hostAddon.runner.add({ items: journalItems, rules: [rule], silent: true });
          const journalIDs = journalItems.map(item => item.id);
          journalPort?.setUpdateResult(journalIDs, result);
          await journalPort?.refreshPane(journalIDs);
          return result;
        },
      }, () => (this.active || Boolean(this.portDisposer)) && isAddonAlive() && Boolean(getPref("lint.onAdded")));

      if (
        (this.active || Boolean(this.portDisposer))
        && isAddonAlive()
        && getPref("lint.onAdded")
        && !workflow.stages.some(stage => stage.status === "cancelled")
      ) {
        await reviewPort?.processImportedDuplicates(items);
      }
    }
    logger.debug("automatic batch completed for", ids);
  }
}
