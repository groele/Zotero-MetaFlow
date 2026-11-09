import type { CardContext } from "./types";
import { getString } from "../../utils/locale";
import { createLogger } from "../../utils/logger";
import {
  extractArxivID,
  extractPreprintDOI,
} from "./actions";
import { ensureJournalPaneStyles } from "./styles";

const logger = createLogger("journal-pane-actions");

export function renderPreprintCard(
  { item, body, doc }: CardContext,
  refreshPane: (itemIDs?: number[]) => Promise<void>,
) {
  const arxivID = extractArxivID(item);
  const preprintDOI = extractPreprintDOI(item);
  body.replaceChildren();
  body.style.cssText = "padding:0;margin:0;box-sizing:border-box;";
  ensureJournalPaneStyles(doc || body.ownerDocument);

  const wrap = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  wrap.className = "metaref-journal-pane-wrap";

  const badgeRow = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  badgeRow.setAttribute("style", "display:flex;align-items:center;justify-content:space-between;margin:0 0 10px;gap:8px;");

  const badge = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
  badge.textContent = arxivID ? "arXiv Preprint" : "bioRxiv / medRxiv Preprint";
  badge.setAttribute("style", "display:inline-flex;align-items:center;background:color-mix(in srgb, #b31b1b 15%, transparent);color:#b31b1b;border:1px solid color-mix(in srgb, #b31b1b 30%, transparent);padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;letter-spacing:0.3px;");
  badgeRow.append(badge);

  if (arxivID || preprintDOI) {
    const linkTarget = arxivID ? `https://arxiv.org/abs/${arxivID}` : `https://doi.org/${preprintDOI}`;
    const arxivLink = doc.createElementNS("http://www.w3.org/1999/xhtml", "a") as HTMLAnchorElement;
    arxivLink.textContent = arxivID ? `arXiv:${arxivID}` : `DOI:${preprintDOI}`;
    arxivLink.href = linkTarget;
    arxivLink.setAttribute("target", "_blank");
    arxivLink.setAttribute("rel", "noopener noreferrer");
    arxivLink.setAttribute("style", "font-size:12px;color:var(--accent-blue, #245ac7);text-decoration:none;font-family:ui-monospace, monospace;");
    arxivLink.addEventListener("click", (e) => {
      e.stopPropagation();
      Zotero.launchURL(linkTarget);
    });
    badgeRow.append(arxivLink);
  }
  wrap.append(badgeRow);

  const title = String(item.getField("title") || "").trim();
  if (title) {
    const titleElem = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    titleElem.textContent = title;
    titleElem.setAttribute("style", "font-size:13px;font-weight:600;line-height:1.45;margin-bottom:8px;color:var(--fill-primary);");
    wrap.append(titleElem);
  }

  const desc = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  desc.textContent = getString("preprint-card-description") || "当前条目为 arXiv 预印本。MetaFlow 可自动检索官方出版 DOI，一键转正为期刊/会议论文并保留现有 PDF 批注与笔记。";
  desc.setAttribute("style", "font-size:12px;line-height:1.5;color:var(--fill-secondary);margin-bottom:12px;");
  wrap.append(desc);

  const convertBtn = doc.createElementNS("http://www.w3.org/1999/xhtml", "button") as HTMLButtonElement;
  convertBtn.type = "button";
  convertBtn.textContent = `⚡ ${getString("rule-tool-review-preprint-menu-item") || "检查并转为正式发表版本…"}`;
  convertBtn.setAttribute("style", "display:flex;align-items:center;justify-content:center;gap:6px;width:100%;padding:8px 12px;font-size:13px;font-weight:600;border-radius:6px;background:color-mix(in srgb, var(--accent-blue, #245ac7) 12%, transparent);border:1px solid color-mix(in srgb, var(--accent-blue, #245ac7) 30%, transparent);color:var(--accent-blue, #245ac7);cursor:pointer;");
  convertBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (convertBtn.disabled)
      return;
    convertBtn.disabled = true;
    convertBtn.textContent = `⏳ ${getString("journal-insights-loading") || "正在查询 arXiv 与 CrossRef…"}`;
    try {
      await addon.hooks.onLintInBatch("tool-update-metadata", [item], { review: true });
      await refreshPane([item.id]);
    }
    catch (err) {
      logger.error("Preprint conversion failed:", err);
    }
    finally {
      if (convertBtn.isConnected) {
        convertBtn.disabled = false;
        convertBtn.textContent = `⚡ ${getString("rule-tool-review-preprint-menu-item") || "检查并转为正式发表版本…"}`;
      }
    }
  });
  wrap.append(convertBtn);
  body.replaceChildren(wrap);
}

export function renderSnapshotCard(
  { item, body, doc }: CardContext,
  refreshPane: (itemIDs?: number[]) => Promise<void>,
) {
  body.replaceChildren();
  body.style.cssText = "padding:0;margin:0;box-sizing:border-box;";
  ensureJournalPaneStyles(doc || body.ownerDocument);

  const wrap = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  wrap.className = "metaref-journal-pane-wrap";

  const badgeRow = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  badgeRow.setAttribute("style", "display:flex;align-items:center;justify-content:space-between;margin:0 0 10px;gap:8px;");

  const badge = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
  badge.textContent = `🌐 ${getString("snapshot-card-badge") || "网页快照 / 剪藏条目"}`;
  badge.setAttribute("style", "display:inline-flex;align-items:center;background:color-mix(in srgb, var(--accent-blue, #0284c7) 15%, transparent);color:var(--accent-blue, #0284c7);border:1px solid color-mix(in srgb, var(--accent-blue, #0284c7) 30%, transparent);padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;letter-spacing:0.3px;");
  badgeRow.append(badge);

  const url = String(item.getField("url") || "").trim();
  if (url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        const host = parsed.hostname;
        const link = doc.createElementNS("http://www.w3.org/1999/xhtml", "a") as HTMLAnchorElement;
        link.textContent = host;
        link.href = url;
        link.setAttribute("target", "_blank");
        link.setAttribute("rel", "noopener noreferrer");
        link.setAttribute("style", "font-size:12px;color:var(--accent-blue, #245ac7);text-decoration:none;font-family:ui-monospace, monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:140px;");
        link.addEventListener("click", (e) => {
          e.stopPropagation();
          Zotero.launchURL(url);
        });
        badgeRow.append(link);
      }
    }
    catch {
      // invalid URL string, skip host link
    }
  }
  wrap.append(badgeRow);

  const title = String(item.getField("title") || "").trim();
  if (title) {
    const titleElem = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    titleElem.textContent = title;
    titleElem.setAttribute("style", "font-size:13px;font-weight:600;line-height:1.45;margin-bottom:8px;color:var(--fill-primary);");
    wrap.append(titleElem);
  }

  const desc = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  desc.textContent = getString("snapshot-card-description") || "当前条目为剪藏网页快照。MetaFlow 可自动从本地 HTML 快照或原始网页中嗅探学术标识（DOI / arXiv ID / PMID），一键升级为正式学术文献条目并补齐元数据。";
  desc.setAttribute("style", "font-size:12px;line-height:1.5;color:var(--fill-secondary);margin-bottom:12px;");
  wrap.append(desc);

  const reviveBtn = doc.createElementNS("http://www.w3.org/1999/xhtml", "button") as HTMLButtonElement;
  reviveBtn.type = "button";
  reviveBtn.textContent = `🌐 ${getString("snapshot-card-button") || "一键嗅探并复活为学术论文…"}`;
  reviveBtn.setAttribute("style", "display:flex;align-items:center;justify-content:center;gap:6px;width:100%;padding:8px 12px;font-size:13px;font-weight:600;border-radius:6px;background:color-mix(in srgb, var(--accent-blue, #0284c7) 12%, transparent);border:1px solid color-mix(in srgb, var(--accent-blue, #0284c7) 30%, transparent);color:var(--accent-blue, #0284c7);cursor:pointer;");
  reviveBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (reviveBtn.disabled)
      return;
    reviveBtn.disabled = true;
    reviveBtn.textContent = `⏳ ${getString("journal-insights-loading") || "正在嗅探快照元数据…"}`;
    try {
      await addon.hooks.onLintInBatch("tool-update-metadata", [item], { review: true });
      await refreshPane([item.id]);
    }
    catch (err) {
      logger.error("Snapshot revival failed:", err);
    }
    finally {
      if (reviveBtn.isConnected) {
        reviveBtn.disabled = false;
        reviveBtn.textContent = `🌐 ${getString("snapshot-card-button") || "一键嗅探并复活为学术论文…"}`;
      }
    }
  });
  wrap.append(reviveBtn);
  body.replaceChildren(wrap);
}
