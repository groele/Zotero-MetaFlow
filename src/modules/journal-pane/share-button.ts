import { shareJournalCard } from "../../utils/journal-card-share";
import { getString } from "../../utils/locale";

import { createCheckSvgIcon, createShareSvgIcon } from "./icons";

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
