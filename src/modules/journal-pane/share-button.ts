import type { BatchResult } from "../runner";
import { shareJournalCard, showNativeNotice } from "../../utils/journal-card-share";
import { hasEnabledJournalMetrics } from "../../utils/journal-permissions";
import { getString } from "../../utils/locale";

import { createCheckSvgIcon, createRefreshSvgIcon, createShareSvgIcon } from "./icons";

export function setupRefreshButton(doc: Document, item: Zotero.Item): HTMLButtonElement {
  const refreshBtn = doc.createElementNS("http://www.w3.org/1999/xhtml", "button") as HTMLButtonElement;
  refreshBtn.setAttribute("data-journal-refresh", "true");
  refreshBtn.type = "button";
  refreshBtn.title = getString("journal-refresh-rankings");
  refreshBtn.setAttribute("aria-label", refreshBtn.title);
  refreshBtn.style.cssText = "display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;min-width:30px;padding:0;margin:0;border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:8px;background:color-mix(in srgb,currentColor 2%,transparent);color:var(--fill-secondary);cursor:pointer;flex-shrink:0;";
  refreshBtn.append(createRefreshSvgIcon(doc));

  refreshBtn.addEventListener("click", async (e: Event) => {
    e.stopPropagation();
    if (refreshBtn.disabled)
      return;
    const hostBody = (refreshBtn.closest("[data-type='body']") || refreshBtn.closest(".metaref-journal-pane-wrap")?.parentElement || refreshBtn.parentElement) as HTMLElement | null;
    refreshBtn.disabled = true;
    refreshBtn.setAttribute("aria-busy", "true");
    refreshBtn.removeAttribute("data-refresh-success");
    refreshBtn.replaceChildren(createRefreshSvgIcon(doc));
    refreshBtn.title = getString("journal-refresh-busy");
    refreshBtn.setAttribute("aria-label", refreshBtn.title);
    const reduced = doc.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    const spinAnimation = !reduced
      ? refreshBtn.firstElementChild?.animate?.([
          { transform: "rotate(0deg)", opacity: 0.95 },
          { transform: "rotate(360deg)", opacity: 0.55 },
        ], { duration: 700, iterations: Infinity })
      : undefined;
    try {
      const result = await (addon.hooks as any).onRefreshJournal?.(item, true) as BatchResult | undefined;
      const pubTitle = String(item.getField("publicationTitle") || item.getField("conferenceName") || item.getField("proceedingsTitle") || item.getField("title") || getString("journal-insights-unnamed")).trim();
      const warningOrError = result?.records?.find(r => r.itemID === item.id && (r.level === "error" || r.level === "warning"));
      const noticeMessage = warningOrError?.message
        || getString(hasEnabledJournalMetrics() ? "journal-refresh-done" : "journal-refresh-local-only", { args: { title: pubTitle } });
      showNativeNotice(noticeMessage);

      const targetBtn = (refreshBtn.isConnected
        ? refreshBtn
        : hostBody?.querySelector<HTMLButtonElement>("button[data-journal-refresh='true']")) || undefined;
      if (targetBtn && targetBtn.isConnected) {
        targetBtn.title = noticeMessage;
        targetBtn.setAttribute("aria-label", noticeMessage);
        if (!warningOrError) {
          targetBtn.setAttribute("data-refresh-success", "true");
          targetBtn.replaceChildren(createCheckSvgIcon(doc));
          if (!reduced) {
            targetBtn.firstElementChild?.animate?.(
              [{ transform: "scale(.8)", opacity: 0.4 }, { transform: "scale(1)", opacity: 1 }],
              { duration: 180, easing: "ease-out" },
            );
          }
          const resetTimer = doc.defaultView?.setTimeout(() => {
            if (!targetBtn.isConnected)
              return;
            targetBtn.removeAttribute("data-refresh-success");
            targetBtn.replaceChildren(createRefreshSvgIcon(doc));
            targetBtn.title = getString("journal-refresh-rankings");
            targetBtn.setAttribute("aria-label", targetBtn.title);
          }, 1600);
          doc.defaultView?.addEventListener("unload", () => doc.defaultView?.clearTimeout(resetTimer), { once: true });
        }
      }
    }
    finally {
      spinAnimation?.cancel();
      if (refreshBtn.isConnected) {
        refreshBtn.disabled = false;
        refreshBtn.removeAttribute("aria-busy");
      }
    }
  });
  return refreshBtn;
}

export function setupShareButton(
  doc: Document,
  data: {
    publication: string;
    displayedRankings: { key: string; labelID: string; value: string }[];
    sciRanking?: { key: string; labelID: string; value: string };
    rows: { label: string; value: string; matched?: boolean; basis?: string; source?: string }[];
    matchBases: string[];
    issn: string;
  },
): HTMLButtonElement {
  const shareBtn = doc.createElementNS("http://www.w3.org/1999/xhtml", "button") as HTMLButtonElement;
  shareBtn.setAttribute("data-journal-share", "true");
  shareBtn.type = "button";
  shareBtn.title = getString("journal-share-card" as any);
  shareBtn.setAttribute("aria-label", shareBtn.title);
  shareBtn.style.cssText = "display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;min-width:30px;padding:0;margin:0;border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:8px;background:color-mix(in srgb,currentColor 2%,transparent);color:var(--fill-secondary);cursor:pointer;flex-shrink:0;";

  shareBtn.append(createShareSvgIcon(doc));
  let successAnimation: Animation | undefined;
  let resetTimer: number | undefined;
  const clearSuccess = () => {
    successAnimation?.cancel();
    doc.defaultView?.clearTimeout(resetTimer);
    doc.defaultView?.removeEventListener("unload", clearSuccess);
    resetTimer = undefined;
    successAnimation = undefined;
  };

  shareBtn.addEventListener("click", async (e: Event) => {
    e.stopPropagation();
    if (shareBtn.disabled)
      return;
    clearSuccess();
    shareBtn.removeAttribute("data-share-success");
    shareBtn.replaceChildren(createShareSvgIcon(doc));
    shareBtn.disabled = true;
    shareBtn.setAttribute("aria-busy", "true");
    shareBtn.title = getString("journal-share-busy" as any);
    const reduced = doc.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    const animation = !reduced
      ? shareBtn.firstElementChild?.animate?.([
          { transform: "translateY(0)", opacity: 1 },
          { transform: "translateY(-3px)", opacity: 0.5 },
          { transform: "translateY(0)", opacity: 1 },
        ], { duration: 700, iterations: Infinity })
      : undefined;
    try {
      const result = await shareJournalCard({
        doc,
        publication: data.publication || getString("journal-insights-unnamed"),
        displayedRankings: data.displayedRankings,
        sciRanking: data.sciRanking,
        rows: data.rows,
        matchBases: data.matchBases,
        issn: data.issn,
      });
      if (!shareBtn.isConnected)
        return;
      const key = result === "preview" ? "preview-ready" : result === "failed" ? "failed" : result === "image" ? "image-copied" : "text-copied";
      shareBtn.title = getString(`journal-share-${key}` as any);
      shareBtn.setAttribute("aria-label", shareBtn.title);
      shareBtn.replaceChildren(["failed", "preview"].includes(result) ? createShareSvgIcon(doc) : createCheckSvgIcon(doc));
      if (result === "image" || result === "text") {
        shareBtn.setAttribute("data-share-success", "true");
        const icon = shareBtn.firstElementChild!;
        successAnimation = icon.animate(reduced
          ? [{ opacity: 1 }, { opacity: 1 }]
          : [
              { opacity: 1, offset: 0 },
              { opacity: 1, offset: 0.88 },
              { opacity: 0, offset: 1 },
            ], { duration: 1600 });
        resetTimer = doc.defaultView?.setTimeout(() => {
          clearSuccess();
          shareBtn.removeAttribute("data-share-success");
          shareBtn.replaceChildren(createShareSvgIcon(doc));
          shareBtn.title = getString("journal-share-card" as any);
          shareBtn.setAttribute("aria-label", shareBtn.title);
        }, 1600);
        doc.defaultView?.addEventListener("unload", clearSuccess, { once: true });
      }
      if (!reduced && (result === "image" || result === "text"))
        shareBtn.firstElementChild?.animate?.([{ transform: "scale(.8)", opacity: 0.4 }, { transform: "scale(1)", opacity: 1 }], { duration: 180, easing: "ease-out" });
    }
    finally {
      animation?.cancel();
      shareBtn.disabled = false;
      shareBtn.removeAttribute("aria-busy");
    }
  });

  return shareBtn;
}
