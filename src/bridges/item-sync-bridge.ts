import type { PluginKernel } from "../kernel/plugin-kernel";
import type { BridgeModule, Disposable } from "../kernel/types";

export class ItemSyncBridge implements BridgeModule {
  public readonly id = "item-sync" as const;
  public readonly requires = ["journal-insights", "workspace-ui"] as const;

  private readonly pendingModifyIDs = new Set<number>();
  private readonly disposers: Disposable[] = [];
  private pendingModifyFlush?: Promise<void>;
  private active = false;

  constructor(private readonly kernel: PluginKernel) {}

  public start(): void {
    if (this.active)
      return;
    this.active = true;
    this.disposers.push(
      this.kernel.bus.on("notifier:event", ({ event, type, ids }) => {
        if (!this.active || event !== "modify" || type !== "item")
          return;
        for (const id of ids) {
          const numericId = Number(id);
          if (Number.isFinite(numericId) && numericId > 0)
            this.pendingModifyIDs.add(numericId);
        }
        if (this.kernel.ports.get("lint-engine")?.isSavingPhase())
          return;
        void this.flushPendingModifies();
      }),
      this.kernel.bus.on("tldr:updated", ({ itemIDs }) => {
        if (!this.active)
          return;
        void this.kernel.ports.get("journal-insights")?.refreshPane([...itemIDs]);
      }),
    );
  }

  public flushPendingModifies(): Promise<void> | undefined {
    if (this.pendingModifyFlush)
      return this.pendingModifyFlush;
    if (!this.active || !this.pendingModifyIDs.size)
      return undefined;
    this.pendingModifyFlush = Promise.resolve().then(async () => {
      this.pendingModifyFlush = undefined;
      if (!this.active || !this.pendingModifyIDs.size)
        return;
      const batchIDs = [...this.pendingModifyIDs];
      this.pendingModifyIDs.clear();
      await this.kernel.ports.get("journal-insights")?.refreshPane(batchIDs);
      this.kernel.ports.get("workspace-ui")?.refreshTldrRow();
    });
    return this.pendingModifyFlush;
  }

  public clearPending(): void {
    this.pendingModifyIDs.clear();
    this.pendingModifyFlush = undefined;
  }

  public stop(): void {
    this.active = false;
    this.clearPending();
    while (this.disposers.length > 0)
      this.disposers.pop()?.();
  }
}
