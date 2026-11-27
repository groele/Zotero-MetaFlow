import type { PluginKernel } from "../kernel/plugin-kernel";
import type { BridgeModule, Disposable, NotifierEventPayload } from "../kernel/types";

export class AutomaticIngestBridge implements BridgeModule {
  public readonly id = "automatic-ingest" as const;
  public readonly requires = ["lint-engine"] as const;

  private active = false;
  private disposer?: Disposable;
  private pendingIngest?: Promise<void>;

  constructor(private readonly kernel: PluginKernel) {}

  public start(): void {
    if (this.active)
      return;
    this.active = true;
    this.disposer = this.kernel.bus.on("notifier:event", (payload) => {
      const task = this.handleNotifierEvent(payload).finally(() => {
        if (this.pendingIngest === task)
          this.pendingIngest = undefined;
      });
      this.pendingIngest = task;
    });
  }

  public flushPendingIngest(): Promise<void> | undefined {
    return this.pendingIngest;
  }

  public async handleNotifierEvent(payload: NotifierEventPayload): Promise<void> {
    if (!this.active)
      return;
    const { event, type, ids, extraData } = payload;
    if (event !== "add" || type !== "item" || extraData?.skipAutoSync)
      return;
    if (!this.kernel.prefs.get("lint.onAdded", true))
      return;
    await this.kernel.ports.get("lint-engine")?.enqueueAddedItems(ids);
  }

  public stop(): void {
    this.active = false;
    this.pendingIngest = undefined;
    this.disposer?.();
    this.disposer = undefined;
  }
}
