import type { ProgressWindowHelper, TagElementProps } from "zotero-plugin-toolkit";
import { useDialog } from "../utils/dialog";
import { getString } from "../utils/locale";
import { createLogger } from "../utils/logger";
import { getPref } from "../utils/prefs";
import { reportPage } from "../utils/report-view";
import { waitUtilAsync } from "../utils/wait";
import { configureCompletionNotice } from "./completion-notice";
import { Rules } from "./rules";

export interface FieldChange {
  itemID: number;
  ruleID: string;
  field: string;
  before: unknown;
  after: unknown;
  source?: string;
  saved: boolean;
}

export interface ReportInfo {
  code?: string;
  level?: "info" | "warning" | "error";
  label?: string;
  message: string;
  action?: {
    label: string;
    callback: () => void | Promise<void>;
  };
  itemID: number;
  title: string;
  ruleID: string;
  field?: string;
  source?: string;
}

export function createReporter(infos: ReportInfo[], changes: FieldChange[] = [], summary?: string) {
  const entries = new Map<number, { itemID: number; title: string; infos: ReportInfo[]; changes: FieldChange[] }>();
  const entryFor = (itemID: number, title?: string) => {
    if (!entries.has(itemID)) {
      const item = itemID && Zotero.Items.get(itemID);
      entries.set(itemID, { itemID, title: title ?? (item ? item.getDisplayTitle() : String(itemID)), infos: [], changes: [] });
    }
    return entries.get(itemID)!;
  };
  infos.forEach(info => entryFor(info.itemID, info.title).infos.push(info));
  changes.forEach(change => entryFor(change.itemID).changes.push(change));

  const indexed = [...entries.values()].map(entry => ({
    ...entry,
    search: [entry.itemID, entry.title, ...entry.infos.flatMap(info => [info.ruleID, info.message, info.source]), ...entry.changes.flatMap(change => [change.field, change.source])].join(" ").normalize("NFKC").toLowerCase(),
  }));
  let page = 0;
  const initial = reportPage(indexed);

  const { dialog, openAndWaitClose, close } = useDialog(new ztoolkit.Dialog(1, 1));
  dialog.addCell(0, 0, {
    tag: "div",
    styles: {
      display: "flex",
      flexDirection: "column",
      gap: "16px",
      fontFamily: "Segoe UI, sans-serif",
      fontSize: "14px",
    },
    children: [...(summary ? [{ tag: "p", properties: { textContent: summary } } satisfies TagElementProps] : []), {
      tag: "button",
      properties: {
        id: "metaref-report-export",
        textContent: getString("report-export"),
        onclick: async (event: Event) => {
          const button = event.currentTarget as HTMLButtonElement;
          button.disabled = true;
          try {
            const path = await new ztoolkit.FilePicker(getString("report-export"), "save", [["JSON", "*.json"]], "metaflow-report.json").open();
            if (path)
              await Zotero.File.putContentsAsync(path, JSON.stringify({ reports: infos.map(({ action, ...info }) => info), changes }, null, 2));
          }
          catch (error) {
            button.textContent = getString("report-export-failed");
            createLogger("reporter").error("Report export failed:", error);
          }
          finally {
            button.disabled = false;
          }
        },
      },
    }, {
      tag: "div",
      styles: { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" },
      children: [{
        tag: "input",
        attributes: { "type": "search", "aria-label": getString("report-search") },
        properties: { id: "metaref-report-search", placeholder: getString("report-search"), oninput: () => refresh(true) },
      }, {
        tag: "select",
        attributes: { "aria-label": getString("report-filter") },
        properties: { id: "metaref-report-filter", onchange: () => refresh(true) },
        children: ["all", "warning", "error", "changed"].map(value => ({
          tag: "option",
          properties: { value, textContent: getString(`report-filter-${value}` as Parameters<typeof getString>[0]) },
        })),
      }, {
        tag: "button",
        properties: { id: "metaref-report-previous", textContent: getString("report-previous"), disabled: true, onclick: () => {
          page--;
          refresh();
        } },
      }, {
        tag: "span",
        attributes: { "aria-live": "polite", "role": "status" },
        properties: { id: "metaref-report-page", textContent: pageText(initial) },
      }, {
        tag: "button",
        properties: { id: "metaref-report-next", textContent: getString("report-next"), disabled: initial.pageCount <= 1, onclick: () => {
          page++;
          refresh();
        } },
      }],
    }, {
      tag: "div",
      properties: { id: "metaref-report-entries" },
      styles: { display: "flex", flexDirection: "column", gap: "12px" },
      children: initial.entries.map(createEntry),
    }],
  });

  function pageText(result: ReturnType<typeof reportPage>) {
    return getString("report-page", { args: { page: result.page + 1, pages: result.pageCount, count: result.total } });
  }

  function refresh(reset = false) {
    const doc = dialog.window.document;
    const query = (doc.getElementById("metaref-report-search") as HTMLInputElement).value;
    const filter = (doc.getElementById("metaref-report-filter") as HTMLSelectElement).value;
    const result = reportPage(indexed, query, filter, reset ? 0 : page);
    page = result.page;
    const host = doc.getElementById("metaref-report-entries")!;
    host.replaceChildren();
    for (const entry of result.entries)
      ztoolkit.UI.appendElement(createEntry(entry), host);
    doc.getElementById("metaref-report-page")!.textContent = pageText(result);
    (doc.getElementById("metaref-report-previous") as HTMLButtonElement).disabled = page === 0;
    (doc.getElementById("metaref-report-next") as HTMLButtonElement).disabled = page + 1 >= result.pageCount;
  }

  function createEntry(entry: (typeof indexed)[number]): TagElementProps {
    return {
      tag: "div",
      attributes: { "data-metaref-report-item": String(entry.itemID) },
      styles: {
        border: "var(--material-border)",
        borderRadius: "8px",
        padding: "10px",
        backgroundColor: "var(--material-background)",
      },
      children: [
        {
          tag: "button",
          attributes: { type: "button" },
          properties: {
            textContent: entry.itemID ? `${entry.itemID} - ${entry.title}` : entry.title,
          },
          styles: {
            fontWeight: "bold",
            marginBottom: "8px",
            display: "block",
            fontSize: "15px",
            color: "var(--fill-primary)",
            textDecoration: "none",
            textAlign: "left",
            border: "none",
            background: "transparent",
            padding: "0",
            cursor: "pointer",
          },
          listeners: [
            {
              type: "click",
              listener: () => {
                if (entry.itemID)
                  Zotero.getActiveZoteroPane()?.selectItem(entry.itemID);
              },
            },
          ],
        },
        ...entry.infos.map(createRuleResultRows),
        ...entry.changes.map(change => ({
          tag: "details",
          children: [{ tag: "summary", properties: { textContent: `${change.field}${change.source ? ` · ${change.source}` : ""}` } }, {
            tag: "pre",
            properties: { textContent: JSON.stringify({ before: change.before, after: change.after, saved: change.saved }, null, 2) },
            styles: { whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
          }],
        } satisfies TagElementProps)),
      ],
    };
  }

  function createRuleResultRows(info: ReportInfo): TagElementProps {
    return {
      tag: "div",
      styles: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "6px 8px",
        borderRadius: "6px",
        minHeight: "2rem",
        backgroundColor:
          info.level === "info"
            ? "transparent"
            : info.level === "error"
              ? "rgba(255, 0, 0, 0.08)"
              : "rgba(255, 165, 0, 0.08)",
        marginBottom: "6px",
      },
      children: [
        {
          tag: "a",
          properties: {
            textContent: info.label ?? (Rules.getByID(info.ruleID as ID) ? getString((Rules.getByID(info.ruleID as ID)!.nameKey || `rule-${info.ruleID}`) as Parameters<typeof getString>[0]) : info.ruleID),
          // href: `https://github.com/groele/Zotero-MetaFlow/blob/main/docs/rules/${info.ruleID}.md`,
          },
          styles: {
            fontWeight: "bold",
            color: info.level === "info" ? "var(--fill-primary)" : info.level === "error" ? "var(--accent-red)" : "var(--accent-orange)",
            minWidth: "80px",
            textDecoration: "none",
          },
        },
        {
          tag: "label",
          properties: {
            textContent: info.message,
          },
          styles: {
            flex: "1",
            color: "var(--fill-primary)",
            fontSize: "13px",
            lineHeight: "1.4",
            whiteSpace: "pre-line",
          },
        },
        {
          tag: "button",
          styles: {
            display: info.action ? "inline-block" : "none",
            padding: "4px 10px",
            border: "none",
            cursor: "pointer",
            fontSize: "12px",
          },
          properties: {
            textContent: info.action?.label,
            onclick: async (event: Event) => {
              const button = event.currentTarget as HTMLButtonElement;
              if (button.disabled)
                return;
              button.disabled = true;
              try {
                await info.action?.callback();
              }
              catch (error) {
                createLogger("reporter").error("Report action failed:", error);
                return;
              }
              finally {
                button.disabled = false;
              }

              // If only one rule reports an issue for an item,
              // close the dialog when clicking the button
              if (infos.length === 1) {
                close();
              }
            },
          },
        },
      ],
    };
  }

  return openAndWaitClose(addon.data.config.addonName);
}

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

  public async init(slient?: boolean, coreStatus?: string): Promise<void> {
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
        text: coreStatus ? "" : getString("info-batch-pending-save"),
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
