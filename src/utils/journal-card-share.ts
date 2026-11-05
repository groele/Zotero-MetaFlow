import { ClipboardHelper, FilePickerHelper } from "zotero-plugin-toolkit";
import { renderCardCanvas } from "./journal-card-canvas";
import { getString } from "./locale";
import { getPref } from "./prefs";

export { renderCardCanvas } from "./journal-card-canvas";

export interface JournalCardData {
  doc: Document;
  publication: string;
  displayedRankings: { key: string; labelID: string; value: string }[];
  sciRanking?: { key: string; labelID: string; value: string };
  rows: { label: string; value: string; matched?: boolean }[];
  matchBases: string[];
  issn?: string;
}

export function showNativeNotice(message: string, title = "Zotero MetaFlow") {
  try {
    if (typeof ztoolkit !== "undefined" && ztoolkit.ProgressWindow) {
      new ztoolkit.ProgressWindow(title, { closeOnClick: true, closeTime: 2500 })
        .createLine({ text: message })
        .show();
      return;
    }
  }
  catch {}

  try {
    if (typeof Zotero !== "undefined" && (Zotero as any).ProgressWindow) {
      const pw = new (Zotero as any).ProgressWindow({ closeOnClick: true });
      pw.changeHeadline(title);
      pw.addDescription(message);
      pw.show();
      pw.startCloseTimer(2500);
    }
  }
  catch {}
}

/** Backward compatibility alias */
export function showBottomLeftNotice(_doc?: Document, message = "期刊索引图片已复制") {
  showNativeNotice(message);
}

export async function shareJournalCard(data: JournalCardData, options?: { mode?: "silent" | "modal"; silentFormat?: "image" | "text" }): Promise<"image" | "text" | "preview" | "failed"> {
  const { doc, publication } = data;
  if (!doc)
    return "failed";
  const mode = options?.mode || getPref("insights.shareMode" as any, "silent");
  const format = options?.silentFormat || getPref("insights.shareSilentFormat" as any, "image");
  const win = doc.defaultView;
  const cardText = generateCardText(data);
  const canvas = mode === "modal" || format === "image" ? await renderCardCanvas(doc, data) : null;
  if (win?.closed || (typeof addon !== "undefined" && !addon.data.alive))
    return "failed";
  const blobPromise = canvas?.toBlob ? new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png")) : null;
  if (mode === "modal") {
    showShareModal({ doc, win, publication, canvas, cardText, blobPromise, message: getString("journal-share-preview-ready" as any) });
    return "preview";
  }
  let result: "image" | "text" | "failed" = "failed";
  try {
    if (format === "image") {
      await copyCardImage(win, canvas, blobPromise);
      result = "image";
    }
    else {
      await copyTextToClipboard(win, cardText);
      result = "text";
    }
  }
  catch { result = "failed"; }
  const message = getString(`journal-share-${result === "image" ? "image-copied" : result === "text" ? "text-copied" : "failed"}` as any);
  showNativeNotice(message);
  return result;
}

async function copyCardImage(win: Window | null | undefined, canvas: HTMLCanvasElement | null, blobPromise: Promise<Blob | null> | null) {
  if (!canvas)
    throw new Error("Canvas unavailable");
  if (typeof Components !== "undefined") {
    new ClipboardHelper().addImage(canvas.toDataURL("image/png")).copy();
    return;
  }
  const blob = await blobPromise;
  const WindowClipboardItem = (win as any)?.ClipboardItem;
  if (!blob || !WindowClipboardItem || !win?.navigator.clipboard?.write)
    throw new Error("Image clipboard unavailable");
  await win.navigator.clipboard.write([new WindowClipboardItem({ "image/png": blob })]);
}

function generateCardText(data: JournalCardData): string {
  const lines: string[] = [];
  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("【Zotero MetaFlow · 期刊索引卡片】");
  lines.push(`期刊：${data.publication}`);
  lines.push("────────────────────────────");

  if (data.displayedRankings.length > 0) {
    lines.push(`[${getString("journal-rankings-heading" as any) || "评价与指标"}]`);
    for (const r of data.displayedRankings) {
      lines.push(`· ${getString(r.labelID as any)}: ${r.value}`);
    }
    lines.push("");
  }

  const hasIndex = Boolean(data.sciRanking) || data.rows.length > 0 || data.matchBases.length > 0;
  if (hasIndex) {
    lines.push(`[${getString("journal-indexing-heading" as any) || "学科与收录"}]`);
    if (data.sciRanking) {
      lines.push(`· ${getString(data.sciRanking.labelID as any)}: ${data.sciRanking.value}`);
    }
    for (const row of data.rows) {
      lines.push(`· ${row.label}: ${row.value}`);
    }
    for (const basis of data.matchBases) {
      lines.push(`· ${basis}`);
    }
  }

  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("由 Zotero MetaFlow 导出");
  return lines.join("\n");
}

async function copyTextToClipboard(win: Window | null | undefined, text: string) {
  try {
    if (typeof Components !== "undefined" && (Components as any)?.classes) {
      const helper = (Components.classes as any)["@mozilla.org/widget/clipboardhelper;1"].getService(
        (Components.interfaces as any).nsIClipboardHelper,
      );
      helper.copyString(text);
      return;
    }
  }
  catch {}

  const nav = win?.navigator as any;
  if (nav?.clipboard?.writeText) {
    await nav.clipboard.writeText(text);
    return;
  }
  throw new Error("Text clipboard unavailable");
}

export async function saveJournalCardImage(canvas: HTMLCanvasElement, publication: string, choosePath?: () => Promise<string | false>): Promise<boolean> {
  const filename = `${publication.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || "journal"}.png`;
  const path = await (choosePath ? choosePath() : new FilePickerHelper(getString("journal-share-save-image" as any), "save", [["PNG", "*.png"]], filename, canvas.ownerDocument!.defaultView!).open());
  if (!path)
    return false;
  const base64 = canvas.toDataURL("image/png").split(",")[1];
  const bytes = Uint8Array.from(canvas.ownerDocument!.defaultView!.atob(base64), char => char.charCodeAt(0));
  await IOUtils.write(path, bytes);
  return true;
}

interface ModalOptions {
  doc: Document;
  win: Window | null | undefined;
  publication: string;
  canvas: HTMLCanvasElement | null;
  cardText: string;
  blobPromise: Promise<Blob | null> | null;
  message: string;
}

const shareDialogs = new Map<Document, () => void>();
export function closeJournalShareDialogs() {
  for (const close of shareDialogs.values())
    close();
}

function showShareModal(opts: ModalOptions) {
  const { doc, win, publication, canvas, cardText, blobPromise } = opts;
  shareDialogs.get(doc)?.();
  const overlay = doc.createElementNS("http://www.w3.org/1999/xhtml", "div") as HTMLElement;
  overlay.setAttribute("id", "metaflow-share-card-modal");
  overlay.setAttribute("style", [
    "position:fixed",
    "top:0",
    "left:0",
    "width:100vw",
    "height:100vh",
    "background:rgba(15,23,42,0.65)",
    "backdrop-filter:blur(4px)",
    "z-index:999999",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "padding:20px",
    "box-sizing:border-box",
    "font-family:system-ui,-apple-system,BlinkMacSystemFont,'Microsoft YaHei',sans-serif",
  ].join(";"));

  const container = doc.createElementNS("http://www.w3.org/1999/xhtml", "div") as HTMLElement;
  container.setAttribute("style", [
    "background:var(--material-background,#ffffff)",
    "color:var(--fill-primary,#0f172a)",
    "border-radius:12px",
    "box-shadow:0 20px 25px -5px rgba(0,0,0,0.2),0 10px 10px -5px rgba(0,0,0,0.1)",
    "max-width:440px",
    "width:100%",
    "max-height:90vh",
    "display:flex",
    "flex-direction:column",
    "overflow:hidden",
  ].join(";"));

  // Top Bar
  const topBar = doc.createElementNS("http://www.w3.org/1999/xhtml", "div") as HTMLElement;
  topBar.setAttribute("style", "display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--fill-quinary,#e2e8f0);");
  const modalTitle = doc.createElementNS("http://www.w3.org/1999/xhtml", "div") as HTMLElement;
  modalTitle.textContent = getString("journal-share-card" as any) || "分享期刊卡片";
  modalTitle.setAttribute("style", "font-size:14px;font-weight:600;");

  container.setAttribute("role", "dialog");
  container.setAttribute("aria-modal", "true");
  modalTitle.id = "metaflow-share-dialog-title";
  container.setAttribute("aria-labelledby", modalTitle.id);
  const previousFocus = doc.activeElement as HTMLElement | null;
  const closeBtn = doc.createElementNS("http://www.w3.org/1999/xhtml", "button") as HTMLButtonElement;
  closeBtn.textContent = "✕";
  closeBtn.setAttribute("aria-label", getString("journal-share-close" as any));
  closeBtn.setAttribute("type", "button");
  closeBtn.setAttribute("style", "border:none;background:transparent;font-size:16px;color:var(--fill-secondary,#64748b);cursor:pointer;padding:4px 8px;border-radius:4px;");
  const escHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
    if (e.key === "Tab") {
      const buttons = [...container.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
      const next = (buttons.indexOf(doc.activeElement as HTMLButtonElement) + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
      e.preventDefault();
      buttons[next]?.focus();
    }
  };
  function close() {
    overlay.remove();
    shareDialogs.delete(doc);
    doc.removeEventListener("keydown", escHandler);
    win?.removeEventListener("unload", close);
    previousFocus?.focus();
  }
  shareDialogs.set(doc, close);
  closeBtn.addEventListener("click", close);

  topBar.append(modalTitle, closeBtn);

  // Toast Notice Bar
  const toastBar = doc.createElementNS("http://www.w3.org/1999/xhtml", "div") as HTMLElement;
  toastBar.textContent = opts.message;
  toastBar.setAttribute("role", "status");
  toastBar.setAttribute("style", "background:color-mix(in srgb,currentColor 4%,transparent);color:var(--fill-primary);font-size:13px;padding:8px 16px;text-align:center;font-weight:500;border-bottom:1px solid #d1fae5;");

  // Preview Body
  const previewBody = doc.createElementNS("http://www.w3.org/1999/xhtml", "div") as HTMLElement;
  previewBody.setAttribute("style", "padding:16px;overflow-y:auto;display:flex;justify-content:center;align-items:center;background:var(--fill-quinary,#f8fafc);");

  if (canvas) {
    const img = doc.createElementNS("http://www.w3.org/1999/xhtml", "img") as HTMLImageElement;
    img.alt = publication;
    img.src = canvas.toDataURL("image/png");
    img.setAttribute("style", "max-width:100%;max-height:480px;height:auto;border-radius:10px;box-shadow:0 4px 6px -1px rgba(0,0,0,0.1);");
    previewBody.append(img);
  }
  else {
    const pre = doc.createElementNS("http://www.w3.org/1999/xhtml", "pre") as HTMLElement;
    pre.textContent = cardText;
    pre.setAttribute("style", "white-space:pre-wrap;font-size:12px;margin:0;padding:12px;background:#ffffff;border-radius:8px;");
    previewBody.append(pre);
  }

  // Action Buttons Footer
  const footer = doc.createElementNS("http://www.w3.org/1999/xhtml", "div") as HTMLElement;
  footer.setAttribute("style", "display:flex;gap:8px;padding:12px 16px;border-top:1px solid var(--fill-quinary,#e2e8f0);justify-content:flex-end;flex-wrap:wrap;");

  const btnStyle = "padding:6px 12px;border-radius:6px;font-size:13px;cursor:pointer;border:1px solid var(--fill-quinary,#cbd5e1);background:var(--material-background,#ffffff);color:var(--fill-primary,#1e293b);font-weight:500;transition:all 0.15s ease;";

  // Button 1: Copy Image
  const copyImgBtn = doc.createElementNS("http://www.w3.org/1999/xhtml", "button") as HTMLButtonElement;
  copyImgBtn.textContent = getString("journal-share-copy-image" as any);
  copyImgBtn.setAttribute("type", "button");
  copyImgBtn.setAttribute("style", btnStyle);
  copyImgBtn.addEventListener("click", () => {
    void (async () => {
      copyImgBtn.disabled = true;
      try {
        await copyCardImage(win, canvas, blobPromise);
        toastBar.textContent = getString("journal-share-image-copied" as any);
      }
      catch { toastBar.textContent = getString("journal-share-failed" as any); }
      finally { copyImgBtn.disabled = !canvas; }
    })();
  });

  // Button 2: Save Image
  const saveImgBtn = doc.createElementNS("http://www.w3.org/1999/xhtml", "button") as HTMLButtonElement;
  saveImgBtn.textContent = getString("journal-share-save-image" as any);
  saveImgBtn.setAttribute("type", "button");
  saveImgBtn.setAttribute("style", btnStyle);
  saveImgBtn.disabled = !canvas;
  copyImgBtn.disabled = !canvas;
  saveImgBtn.addEventListener("click", async () => {
    if (!canvas || saveImgBtn.disabled)
      return;
    saveImgBtn.disabled = true;
    try {
      if (await saveJournalCardImage(canvas, publication))
        toastBar.textContent = getString("journal-share-saved" as any);
    }
    catch { toastBar.textContent = getString("journal-share-save-failed" as any); }
    finally { saveImgBtn.disabled = false; }
  });

  // Button 3: Copy Text
  const copyTxtBtn = doc.createElementNS("http://www.w3.org/1999/xhtml", "button") as HTMLButtonElement;
  copyTxtBtn.textContent = getString("journal-share-copy-text" as any);
  copyTxtBtn.setAttribute("type", "button");
  copyTxtBtn.setAttribute("style", btnStyle);
  copyTxtBtn.addEventListener("click", async () => {
    try {
      await copyTextToClipboard(win, cardText);
      toastBar.textContent = getString("journal-share-text-copied" as any);
    }
    catch { toastBar.textContent = getString("journal-share-failed" as any); }
  });

  footer.append(copyImgBtn, saveImgBtn, copyTxtBtn);

  container.append(topBar, toastBar, previewBody, footer);
  overlay.append(container);

  // Close when clicking backdrop
  overlay.addEventListener("click", (e: MouseEvent) => {
    if (e.target === overlay)
      close();
  });

  doc.addEventListener("keydown", escHandler);
  win?.addEventListener("unload", close, { once: true });

  const host = doc.getElementById("zotero-pane") || doc.documentElement || doc.body;
  host?.append(overlay);
  closeBtn.focus();
}
