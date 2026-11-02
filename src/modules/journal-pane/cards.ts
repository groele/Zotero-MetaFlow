import type { JournalInsights } from "../../utils/journal-insights";
import { isEasyScholarFieldEnabled } from "../../utils/easyscholar";
import { shareJournalCard } from "../../utils/journal-card-share";
import { cachedJournalInsights, getJournalInsights } from "../../utils/journal-insights";
import { presentJournalInsights } from "../../utils/journal-insights-presentation";
import { isJournalIndexEnabled } from "../../utils/journal-permissions";
import { journalRankingRows } from "../../utils/journal-ranking-rows";
import { getString } from "../../utils/locale";
import { createLogger } from "../../utils/logger";
import { extractTLDRFromItem } from "../rules/tool-update-metadata/tldr";
import {
  extractArxivID,
  isUnconvertedArxivPreprint,
  isUnrevivedSnapshot,
  supportsRankings,
  supportsSection,
} from "./actions";
import { createCheckSvgIcon, createShareSvgIcon } from "./icons";
import { ensureJournalPaneStyles } from "./styles";

const logger = createLogger("journal-pane-cards");

export interface CardContext {
  item: Zotero.Item;
  body: HTMLElement;
  doc: Document;
}

export interface CardRenderOptions {
  queryMessages: Map<number, { level?: string; message: string }[]>;
  renders: WeakMap<HTMLElement, object>;
  refreshJournalPane: (itemIDs?: number[]) => Promise<void>;
}

export async function renderJournalPaneCard(
  context: _ZoteroTypes.ItemPaneManagerSection.SectionHookArgs,
  options: CardRenderOptions,
) {
  const { item, body, doc } = context;
  if (!item || !supportsSection(item)) {
    body.replaceChildren();
    return;
  }

  const cardCtx: CardContext = { item, body, doc };

  // 1. 若为未转正的 arXiv 预印本，渲染专属快捷转正卡片
  if (isUnconvertedArxivPreprint(item)) {
    renderPreprintCard(cardCtx, options.refreshJournalPane);
    return;
  }

  // 2. 若为未复活的剪藏网页快照，渲染专属一键嗅探复活卡片
  if (isUnrevivedSnapshot(item)) {
    renderSnapshotCard(cardCtx, options.refreshJournalPane);
    return;
  }

  // 3. 常规期刊 / 会议文献指标面板渲染
  await renderInsightsCard(cardCtx, options);
}

function renderPreprintCard(
  { item, body, doc }: CardContext,
  refreshPane: (itemIDs?: number[]) => Promise<void>,
) {
  const arxivID = extractArxivID(item);
  body.replaceChildren();
  body.style.cssText = "padding:0;margin:0;box-sizing:border-box;";
  ensureJournalPaneStyles(doc || body.ownerDocument);

  const wrap = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  wrap.className = "metaref-journal-pane-wrap";

  const badgeRow = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  badgeRow.setAttribute("style", "display:flex;align-items:center;justify-content:space-between;margin:0 0 10px;gap:8px;");

  const badge = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
  badge.textContent = "arXiv Preprint";
  badge.setAttribute("style", "display:inline-flex;align-items:center;background:color-mix(in srgb, #b31b1b 15%, transparent);color:#b31b1b;border:1px solid color-mix(in srgb, #b31b1b 30%, transparent);padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;letter-spacing:0.3px;");
  badgeRow.append(badge);

  if (arxivID) {
    const arxivLink = doc.createElementNS("http://www.w3.org/1999/xhtml", "a") as HTMLAnchorElement;
    arxivLink.textContent = `arXiv:${arxivID}`;
    arxivLink.href = `https://arxiv.org/abs/${arxivID}`;
    arxivLink.setAttribute("target", "_blank");
    arxivLink.setAttribute("rel", "noopener noreferrer");
    arxivLink.setAttribute("style", "font-size:12px;color:var(--accent-blue, #245ac7);text-decoration:none;font-family:ui-monospace, monospace;");
    arxivLink.addEventListener("click", (e) => {
      e.stopPropagation();
      Zotero.launchURL(`https://arxiv.org/abs/${arxivID}`);
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

  const tldr = extractTLDRFromItem(item);
  if (tldr) {
    wrap.append(createTLDRBox(doc, tldr));
  }

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

function renderSnapshotCard(
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

  const tldr = extractTLDRFromItem(item);
  if (tldr) {
    wrap.append(createTLDRBox(doc, tldr));
  }

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

function createTLDRBox(doc: Document, tldr: string): HTMLElement {
  const tldrBox = doc.createElementNS("http://www.w3.org/1999/xhtml", "div") as HTMLElement;
  tldrBox.setAttribute("style", "margin:0 0 12px;padding:8px 10px;background:color-mix(in srgb, var(--accent-blue, #245ac7) 8%, transparent);border-radius:6px;border-left:3px solid var(--accent-blue, #245ac7);font-size:12px;line-height:1.5;color:var(--fill-primary);");
  const tldrHead = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  tldrHead.setAttribute("style", "font-size:11px;font-weight:600;color:var(--accent-blue, #245ac7);margin-bottom:4px;display:flex;align-items:center;justify-content:space-between;");
  const headTitle = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
  headTitle.textContent = `💡 ${getString("journal-insights-tldr-heading") || "核心论点 (TL;DR)"}`;
  const headSrc = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
  headSrc.textContent = "Semantic Scholar";
  headSrc.setAttribute("style", "font-size:10px;font-weight:400;opacity:0.75;");
  tldrHead.append(headTitle, headSrc);
  const tldrBody = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  tldrBody.textContent = tldr;
  tldrBox.append(tldrHead, tldrBody);
  return tldrBox;
}

async function renderInsightsCard(
  { item, body, doc }: CardContext,
  options: CardRenderOptions,
) {
  const token = {};
  options.renders.set(body, token);
  let result: JournalInsights | undefined;
  try {
    result = cachedJournalInsights(item) ?? await getJournalInsights(item);
  }
  catch (error) {
    logger.error("Failed to load journal insights in render:", error);
    if (!addon.data.alive || options.renders.get(body) !== token || !body.isConnected)
      return;
    body.replaceChildren();
    body.style.cssText = "padding:0;margin:0;box-sizing:border-box;";
    ensureJournalPaneStyles(doc || body.ownerDocument);
    const errWrap = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    errWrap.className = "metaref-journal-pane-wrap";
    const errNotice = doc.createElementNS("http://www.w3.org/1999/xhtml", "div") as HTMLElement;
    errNotice.textContent = getString("journal-rankings-refresh-failed");
    errNotice.setAttribute("style", "font-size:12px;color:var(--accent-orange);");
    errWrap.append(errNotice);
    body.append(errWrap);
    return;
  }
  if (!addon.data.alive || options.renders.get(body) !== token || !body.isConnected)
    return;

  body.replaceChildren();
  body.style.cssText = "padding:0;margin:0;box-sizing:border-box;";
  ensureJournalPaneStyles(doc || body.ownerDocument);

  const container = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  container.className = "metaref-journal-pane-wrap";

  const issn = String(item.getField("ISSN") || "").trim();
  const rows = item.itemType === "journalArticle"
    ? presentJournalInsights(result, Zotero.locale).map((row, index) => {
        const matchBasis = index === 0 ? result.esiBasis : result.natureBasis;
        return matchBasis === "ISSN" && row.basis && issn
          ? { ...row, basis: getString("journal-insights-match-issn-detail", { args: { issn } }) }
          : row;
      }).filter((_row, index) => isJournalIndexEnabled(index === 0 ? "esi" : "nature"))
    : [];

  const text = (tag: string, value: string, style = "") => {
    const node = doc.createElementNS("http://www.w3.org/1999/xhtml", tag);
    node.textContent = value;
    node.setAttribute("style", style);
    return node;
  };

  const publication = String(item.getField(item.itemType === "conferencePaper" ? "proceedingsTitle" : "publicationTitle") || "").trim();
  const rankings = journalRankingRows(String(item.getField("extra") || ""), item);
  const savedESI = rankings.find(row => row.key === "esi");
  if (isJournalIndexEnabled("esi") && rows.length && savedESI && !result.categories.length) {
    rows[0] = { ...rows[0], value: savedESI.value, matched: true, basis: "", source: getString("journal-insights-saved-source") };
  }
  const matchBases = [...new Set(rows.map(row => row.basis).filter(Boolean))];
  const sciRanking = rankings.find(row => row.key === "sci" && isEasyScholarFieldEnabled(row.key));
  const hasIndexResults = rows.length > 0 || Boolean(sciRanking);
  const displayedRankings = rankings.filter(row => row.key !== "sci" && isEasyScholarFieldEnabled(row.key) && (item.itemType !== "journalArticle" || row.key !== "esi"));

  // 头部标题与分享按钮
  const headerRow = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  headerRow.setAttribute("style", "display:flex;align-items:center;justify-content:space-between;margin:0 0 12px;gap:8px;");
  const itemTitle = String(item.getField("title") || "").trim();
  const headingText = publication || itemTitle || getString("journal-insights-unnamed");
  const journalTitle = text("h2", headingText, "font-size:14px;font-weight:600;margin:0;line-height:1.5;white-space:pre-wrap;flex:1;min-width:0;");
  journalTitle.setAttribute("data-journal-title", "true");

  const extraText = String(item.getField("extra") || "");
  if (extraText.includes("MetaFlow preprint")) {
    const convertedBadge = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
    convertedBadge.textContent = getString("preprint-converted-badge") || "已由 arXiv 转正";
    convertedBadge.setAttribute("style", "display:inline-flex;align-items:center;margin-left:8px;font-size:11px;font-weight:600;padding:1px 6px;border-radius:4px;background:color-mix(in srgb, #2e7d32 15%, transparent);color:#2e7d32;border:1px solid color-mix(in srgb, #2e7d32 30%, transparent);vertical-align:middle;");
    journalTitle.append(convertedBadge);
  }
  else if (extraText.includes("MetaFlow revived from")) {
    const revivedBadge = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
    revivedBadge.textContent = getString("snapshot-revived-badge") || "已由网页快照复活";
    revivedBadge.setAttribute("style", "display:inline-flex;align-items:center;margin-left:8px;font-size:11px;font-weight:600;padding:1px 6px;border-radius:4px;background:color-mix(in srgb, var(--accent-blue, #0284c7) 15%, transparent);color:var(--accent-blue, #0284c7);border:1px solid color-mix(in srgb, var(--accent-blue, #0284c7) 30%, transparent);vertical-align:middle;");
    journalTitle.append(revivedBadge);
  }

  const shareBtn = setupShareButton(doc, {
    publication,
    displayedRankings,
    sciRanking,
    rows,
    matchBases,
    issn,
  });

  headerRow.append(journalTitle, shareBtn);
  container.append(headerRow);

  // 评价与指标区 (EasyScholar Rankings)
  if (supportsRankings(item) || hasIndexResults) {
    const rankingSection = text("section", "", "margin:0;");
    rankingSection.setAttribute("title", getString("journal-rankings-saved-note"));
    rankingSection.setAttribute("data-journal-rankings", "true");
    rankingSection.append(text("h3", getString("journal-rankings-heading"), "font-size:14px;margin:0 0 12px;font-weight:600;"));
    const messages = options.queryMessages.get(item.id)?.filter(message => message.message !== getString("journal-rankings-query-complete"));
    if (messages?.length) {
      const status = text("div", "", "font-size:12px;margin-bottom:10px;");
      status.setAttribute("data-journal-update-status", "true");
      status.setAttribute("role", "status");
      for (const message of messages)
        status.append(text("div", message.message, `color:${message.level === "warning" || message.level === "error" ? "var(--accent-orange)" : "var(--fill-secondary)"};`));
      rankingSection.append(status);
    }
    if (displayedRankings.length) {
      const fields = text("dl", "", "margin:0;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.15fr);gap:12px 24px;");
      for (const ranking of displayedRankings) {
        const label = text("dt", getString(ranking.labelID as any), "margin:0;font-size:13px;color:var(--fill-secondary);");
        const value = text("dd", ranking.value, "margin:0;min-width:0;font-size:14px;font-weight:600;white-space:pre-wrap;text-align:right;");
        value.setAttribute("data-journal-ranking", ranking.key);
        fields.append(label, value);
      }
      rankingSection.append(fields);
    }
    else {
      rankingSection.append(text("div", getString("journal-rankings-empty"), "font-size:12px;color:var(--fill-secondary);"));
    }
    container.append(rankingSection);
  }

  // TLDR 核心论点展示
  const tldr = extractTLDRFromItem(item);
  if (tldr) {
    const tldrSection = doc.createElementNS("http://www.w3.org/1999/xhtml", "section");
    tldrSection.setAttribute("data-journal-tldr", "true");
    const tldrMargin = (supportsRankings(item) || hasIndexResults) ? "margin-top:14px;" : "margin-top:4px;";
    tldrSection.setAttribute("style", `${tldrMargin}padding:10px 12px;background:color-mix(in srgb, var(--accent-blue, #245ac7) 6%, transparent);border-radius:6px;border-left:3px solid var(--accent-blue, #245ac7);`);
    const tldrHeader = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    tldrHeader.setAttribute("style", "display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;gap:8px;");
    const tldrTitle = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
    tldrTitle.textContent = `💡 ${getString("journal-insights-tldr-heading") || "核心论点 (TL;DR)"}`;
    tldrTitle.setAttribute("style", "font-size:12px;font-weight:600;color:var(--accent-blue, #245ac7);");
    const tldrSource = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
    tldrSource.textContent = "Semantic Scholar";
    tldrSource.setAttribute("style", "font-size:10px;color:var(--fill-secondary);opacity:0.8;");
    tldrHeader.append(tldrTitle, tldrSource);
    const tldrBody = doc.createElementNS("http://www.w3.org/1999/xhtml", "p");
    tldrBody.textContent = tldr;
    tldrBody.setAttribute("style", "font-size:13px;line-height:1.55;margin:0;color:var(--fill-primary);white-space:pre-wrap;");
    tldrSection.append(tldrHeader, tldrBody);
    container.append(tldrSection);
  }

  // 学科索引区 (ESI / Nature Index)
  const indexSection = text("section", "", "margin-top:16px;padding-top:12px;border-top:1px solid var(--fill-quinary);");
  indexSection.setAttribute("data-journal-indexes", "true");
  if (hasIndexResults)
    indexSection.append(text("h3", getString("journal-indexing-heading"), "font-size:14px;margin:0 0 12px;font-weight:600;"));
  const results = text("dl", "", "margin:0;display:grid;gap:12px;");
  if (sciRanking) {
    const node = text("div", "", "display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.15fr);column-gap:24px;align-items:baseline;");
    const value = text("dd", sciRanking.value, "margin:0;min-width:0;font-size:14px;font-weight:600;text-align:right;white-space:pre-wrap;");
    value.setAttribute("data-journal-ranking", sciRanking.key);
    node.append(text("dt", getString(sciRanking.labelID as any), "margin:0;font-size:13px;color:var(--fill-secondary);"), value);
    results.append(node);
  }
  for (const row of rows) {
    const node = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    node.setAttribute("data-journal-result", row.label);
    node.setAttribute("style", "display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.15fr);column-gap:24px;align-items:baseline;");
    const value = text("dd", "", "margin:0;min-width:0;text-align:right;");
    value.append(text("div", row.value, row.matched ? "font-size:14px;font-weight:600;" : "font-size:13px;color:var(--fill-secondary);"));
    node.append(text("dt", row.label, "margin:0;font-size:13px;color:var(--fill-secondary);"), value);
    if (row.warning)
      node.append(text("div", row.warning, "grid-column:1 / -1;font-size:12px;line-height:1.6;color:var(--accent-orange);margin-top:4px;"));
    results.append(node);
  }
  if (hasIndexResults)
    indexSection.append(results);
  if (matchBases.length) {
    const basis = text("div", "", "font-size:12px;color:var(--fill-secondary);margin-top:12px;min-width:0;");
    basis.setAttribute("data-journal-shared-basis", "true");
    for (const matchBasis of matchBases) {
      const line = text("div", "", "display:flex;gap:16px;align-items:baseline;white-space:nowrap;overflow:hidden;line-height:1.6;");
      line.setAttribute("title", matchBasis);
      if (issn && matchBasis === getString("journal-insights-match-issn-detail", { args: { issn } })) {
        line.append(text("span", getString("journal-insights-match-detail", { args: { basis: getString("journal-insights-basis-ISSN") } }), "flex-shrink:0;"));
        const number = text("span", issn, "flex:1;min-width:0;text-align:right;overflow:hidden;text-overflow:ellipsis;");
        number.setAttribute("data-journal-issn", "true");
        line.append(number);
      }
      else {
        line.append(text("span", matchBasis, "min-width:0;overflow:hidden;text-overflow:ellipsis;"));
      }
      basis.append(line);
    }
    indexSection.append(basis);
  }
  const sources = text("details", "", "margin-top:14px;font-size:12px;color:var(--fill-secondary);line-height:1.6;");
  sources.setAttribute("data-journal-sources", "true");
  sources.append(text("summary", getString("journal-insights-source"), "cursor:pointer;"), ...rows.map(row => text("div", row.source, "margin-top:4px;")));
  const note = text("div", getString("journal-insights-scope-note"), "margin-top:8px;");
  note.setAttribute("title", getString("journal-insights-boundary"));
  sources.append(note);
  if (rows.length)
    indexSection.append(sources);
  if (hasIndexResults)
    container.append(indexSection);
  body.append(container);
}

function setupShareButton(
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
