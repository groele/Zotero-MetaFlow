import type { ProgressWindowHelper } from "zotero-plugin-toolkit";
import type { FieldChange, ReportInfo } from "./reporter";
import { getString } from "../utils/locale";
import { getPref } from "../utils/prefs";
import { waitUtilAsync } from "../utils/wait";
import { configureCompletionNotice } from "./completion-notice";

import { createReporter } from "./reporter";

export class ProgressUI {
  private progressWindow?: ProgressWindowHelper;
  private _onCancel?: () => void;
  private running = false;

  constructor(options?: { onCancel?: () => void }) {
    this._onCancel = options?.onCancel;
  }

  public close(): void {
    this.progressWindow?.close();
    this.progressWindow = undefined;
    this.running = false;
  }

  public async init(slient?: boolean, coreStatus?: string, coreSubtext?: string): Promise<void> {
    this.close();

    if (slient || !getPref("lint.notify"))
      return;

    this.running = true;
    this.progressWindow = new ztoolkit.ProgressWindow(addon.data.config.addonName, {
      closeOnClick: false,
      closeTime: -1,
    })
      .createLine({
        type: "default",
        text: coreStatus || getString("info-batch-init"),
        progress: 0,
        idx: 0,
      })
      .createLine({
        type: "default",
        text: coreStatus ? (coreSubtext || "") : getString("info-batch-pending-save"),
        progress: 0,
        idx: 1,
      })
      .createLine({
        text: getString("info-batch-break"),
        idx: 2,
      })
      .show();

    const helper = this.progressWindow;
    const lines = (helper as unknown as { lines: { _itemText?: Element; _hbox?: Element }[] }).lines;
    await waitUtilAsync(() => this.progressWindow !== helper || Boolean(lines[2]?._itemText));
    if (this.progressWindow !== helper)
      return;
    const stop = lines[2]?._hbox;
    if (stop) {
      stop.addEventListener("click", this.handleStopRequest as EventListener);
      if (coreStatus) {
        const root = stop.ownerDocument!.documentElement!;
        root.setAttribute("data-metaref-core-progress", "true");
        stop.id = "metaref-core-task-action";
        stop.setAttribute("role", "button");
        stop.setAttribute("tabindex", "0");
        stop.addEventListener("keydown", ((event: KeyboardEvent) => {
          if (event.key === "Enter" || event.key === " ")
            this.handleStopRequest(event);
        }) as EventListener);
        lines[0]._itemText?.setAttribute("aria-live", "polite");
      }
    }
  }

  public updateCoreProgress(text: string): void {
    this.progressWindow?.changeLine({ text, idx: 0 });
  }

  public showCoreFinished(text: string, failed: boolean, openReport: () => Promise<void>): boolean {
    const helper = this.progressWindow;
    if (!helper)
      return false;
    this.running = false;
    helper.changeLine({ type: failed ? "fail" : "default", text, progress: 100, idx: 0 });
    helper.changeLine({ text: "", progress: 100, idx: 1 });
    const lines = (helper as unknown as { lines: { _hbox?: Element }[] }).lines;
    lines[2]?._hbox?.removeEventListener("click", this.handleStopRequest as EventListener);
    lines[0]?._hbox?.ownerDocument?.documentElement?.removeAttribute("data-metaref-core-progress");
    // The completion notice owns the existing window and its lifetime from here.
    this.progressWindow = undefined;
    void configureCompletionNotice(helper, openReport, true);
    return true;
  }

  public updateProgress(current: number, total: number, phase?: "idle" | "linting" | "saving"): void {
    if (!this.progressWindow)
      return;

    const progress = total > 0 ? (current / total) * 100 : 100;

    if (phase === "saving") {
      this.progressWindow.changeLine({
        text: `[${current}/${total}] ${getString("info-batch-saving")}`,
        progress,
        idx: 1,
      });
    }
    else {
      const label = phase === "idle"
        ? getString("info-batch-init")
        : getString("info-batch-running");
      const text = phase === "idle" ? label : `[${current}/${total}] ${label}`;
      this.progressWindow.changeLine({ text, progress, idx: 0 });
    }
  }

  public showError(): void {
    this.progressWindow?.createLine({
      type: "fail",
      text: getString("info-batch-has-error"),
    });
  }

  public showFinished(successCount: number, errorCount: number, duration: number, cancelled = false, skipped = 0, preparationFailed = 0, details?: { saved: number; unchanged: number; notApplicable: number; warnings: number; records?: ReportInfo[]; changes?: FieldChange[] }): void {
    if (!this.progressWindow)
      return;

    this.running = false;
    const text = cancelled
      ? getString("info-batch-cancelled", { args: { processed: successCount + errorCount, skipped } })
      : successCount + errorCount
        ? [
            "[",
            `✔️${successCount}`,
            errorCount ? ` ❌${errorCount}` : "",
            "] ",
            getString("info-batch-finish"),
          ].join("")
        : getString(preparationFailed ? "info-batch-has-error" : "info-batch-no-selected");

    this.progressWindow
      .changeLine({ text, progress: 100, idx: 0 })
      .changeLine({ text: details ? getString("info-batch-details", { args: details }) : "", progress: 100, idx: 1 })
      .changeLine({ text: getString("info-batch-duration", { args: { seconds: duration.toFixed(1) } }), idx: 2 });
    // The stop line becomes a report entry after completion.
    (this.progressWindow as unknown as { lines: { _hbox?: Element }[] }).lines[2]?._hbox?.removeEventListener("click", this.handleStopRequest as EventListener);
    const records = details?.records || [];
    const changes = details?.changes || [];
    const summary = `${text} · ${details ? getString("info-batch-details", { args: details }) : ""}`;
    void configureCompletionNotice(this.progressWindow, () => createReporter(records, changes, summary));
    if (preparationFailed && successCount + errorCount)
      this.showError();
  }

  private handleStopRequest = (ev: Event): void => {
    if (!this.running)
      return;
    this.running = false;
    (ev.currentTarget as Element | null)?.setAttribute("aria-disabled", "true");
    ev.stopPropagation();
    ev.preventDefault();
    this.progressWindow?.changeLine({
      text: getString("info-batch-stop-next"),
      idx: 2,
    });
    this._onCancel?.();
  };
}
