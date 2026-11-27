import type { TagElementProps } from "zotero-plugin-toolkit";
import { getString } from "../../../utils/locale";

const panels = new Set<() => void>();

export function closeReviewPanels() {
  for (const close of [...panels])
    close();
}

/** A docked review surface: no new window, modal loop, or blocked item tree. */
export function useReviewPanel(signal?: AbortSignal) {
  let currentClose: (() => void) | undefined;
  const cells: TagElementProps[] = [];
  const buttons: { label: string; id?: string; callback?: () => void }[] = [];
  const dialog = {
    addCell(_row: number, _column: number, props: TagElementProps) {
      cells.push(props);
      return dialog;
    },
    addButton(label: string, id?: string, options?: { callback: () => void }) {
      buttons.push({ label, id, callback: options?.callback });
      return dialog;
    },
  };
  async function openAndWaitClose(title: string) {
    signal?.throwIfAborted();
    const win = Zotero.getMainWindow();
    const doc = win.document;
    const host = doc.getElementById("zotero-items-pane");
    if (!host)
      throw new Error(getString("review-panel-unavailable"));
    const previousFocus = doc.activeElement as HTMLElement | null;
    const panel = ztoolkit.UI.createElement(doc, "section", {
      properties: { id: "metaref-review-panel" },
      attributes: { "aria-label": `${addon.data.config.addonName}: ${title}` },
      styles: { flex: "0 0 auto", minHeight: "0", maxHeight: "55vh", overflow: "auto", borderTop: "1px solid var(--fill-quinary)", background: "var(--material-background)", color: "var(--fill-primary)", padding: "12px", boxSizing: "border-box", fontSize: "13px" },
    });
    let finish!: () => void;
    const done = new Promise<void>(resolve => finish = resolve);
    const close = () => {
      const restoreFocus = panel.contains(doc.activeElement);
      panel.remove();
      panels.delete(close);
      signal?.removeEventListener("abort", close);
      win.removeEventListener("unload", close);
      if (previousFocus?.isConnected && restoreFocus)
        previousFocus.focus();
      finish();
    };
    currentClose = close;
    const details = ztoolkit.UI.createElement(doc, "details", { properties: { open: true } });
    details.append(ztoolkit.UI.createElement(doc, "summary", { properties: { textContent: `${addon.data.config.addonName} · ${title}` }, styles: { fontWeight: "bold", cursor: "pointer", paddingBottom: "8px" } }));
    const body = ztoolkit.UI.createElement(doc, "div");
    for (const cell of cells)
      ztoolkit.UI.appendElement(cell, body);
    details.append(body);
    const footer = ztoolkit.UI.createElement(doc, "div", { styles: { display: "flex", gap: "8px", flexWrap: "wrap", position: "sticky", bottom: "0", padding: "8px 0", background: "var(--material-background)" } });
    for (const button of buttons) {
      footer.append(ztoolkit.UI.createElement(doc, "button", { attributes: { type: "button" }, properties: { id: button.id || "", textContent: button.label, onclick: () => {
        button.callback?.();
        close();
      } } }));
    }
    body.append(footer);
    panel.append(details);
    panels.add(close);
    signal?.addEventListener("abort", close, { once: true });
    win.addEventListener("unload", close, { once: true });
    host.append(panel);
    if (signal?.aborted || !addon.data.alive)
      close();
    await done;
    signal?.throwIfAborted();
  }
  return { dialog, openAndWaitClose, close: () => currentClose?.() };
}
