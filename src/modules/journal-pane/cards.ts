import type { JournalInsights } from "../../utils/journal-insights";
import type { CardContext, CardRenderOptions } from "./types";
import { isEasyScholarFieldEnabled } from "../../utils/easyscholar";
import { cachedJournalInsights, getJournalInsights } from "../../utils/journal-insights";
import { presentJournalInsights } from "../../utils/journal-insights-presentation";
import { isJournalIndexEnabled } from "../../utils/journal-permissions";
import { journalRankingRows } from "../../utils/journal-ranking-rows";
import { getString } from "../../utils/locale";
import { createLogger } from "../../utils/logger";
import {
  isUnconvertedArxivPreprint,
  isUnconvertedBiorxivPreprint,
  isUnrevivedSnapshot,
  supportsRankings,
  supportsSection,
} from "./actions";
import { renderPreprintCard, renderSnapshotCard } from "./quick-actions";
import { isJournalPaneItemCurrent } from "./section-context";

import { setupRefreshButton, setupShareButton } from "./share-button";
import { ensureJournalPaneStyles } from "./styles";

export type { CardContext, CardRenderOptions } from "./types";

const logger = createLogger("journal-pane-cards");

export async function renderJournalPaneCard(
  context: _ZoteroTypes.ItemPaneManagerSection.SectionHookArgs,
  options: CardRenderOptions,
) {
  const { item, body, doc } = context;
  if (item && !isJournalPaneItemCurrent(body, item))
    return;
  if (!item || !supportsSection(item)) {
    body.replaceChildren();
    return;
  }

  const cardCtx: CardContext = { item, body, doc };

  // 1. 若为未转正的 arXiv / bioRxiv / medRxiv 预印本，渲染专属快捷转正卡片
  if (isUnconvertedArxivPreprint(item) || isUnconvertedBiorxivPreprint(item)) {
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
    if (!addon.data.alive || options.renders.get(body) !== token || !isJournalPaneItemCurrent(body, item))
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
  if (!addon.data.alive || options.renders.get(body) !== token || !isJournalPaneItemCurrent(body, item))
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

  const actionGroup = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  actionGroup.setAttribute("style", "display:inline-flex;align-items:center;gap:6px;flex-shrink:0;");
  if (supportsRankings(item) && typeof item.isEditable === "function" && item.isEditable()) {
    actionGroup.append(setupRefreshButton(doc, item));
  }
  actionGroup.append(shareBtn);

  headerRow.append(journalTitle, actionGroup);
  container.append(headerRow);

  const noticeMatch = extraText.match(/^Editorial Notice:\s*(Retracted|Expression of Concern|Correction)(?:\s*\(([^)]+)\))?/im);
  const titleRetracted = /^(?:\[(?:retracted|withdrawn)\]|retracted\s*:)/i.test(itemTitle);
  if (noticeMatch || titleRetracted) {
    const rawKind = (noticeMatch?.[1] || "Retracted").toLowerCase();
    const kind = rawKind.includes("concern") ? "concern" : rawKind.includes("correction") ? "correction" : "retracted";
    const noticeDOI = noticeMatch?.[2]?.trim();
    const isRed = kind === "retracted";
    const color = isRed ? "#c62828" : "#d97706";
    const banner = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    banner.setAttribute("data-editorial-notice", kind);
    banner.setAttribute("role", "alert");
    banner.setAttribute("style", `display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 12px;padding:6px 10px;border-radius:6px;font-size:12px;font-weight:600;background:color-mix(in srgb, ${color} 12%, transparent);color:${color};border:1px solid color-mix(in srgb, ${color} 28%, transparent);`);
    const labelText = kind === "retracted"
      ? (getString("editorial-notice-retracted" as any) || "⚠️ 学术预警：该文献已被撤稿 (Retracted)")
      : kind === "concern"
        ? (getString("editorial-notice-concern" as any) || "⚠️ 学术预警：该文献存在关切声明 (Expression of Concern)")
        : (getString("editorial-notice-correction" as any) || "ℹ️ 该文献存在官方勘误/更正记录 (Correction)");
    banner.append(text("span", labelText));
    if (noticeDOI) {
      const link = doc.createElementNS("http://www.w3.org/1999/xhtml", "a") as HTMLAnchorElement;
      link.textContent = noticeDOI;
      link.href = `https://doi.org/${noticeDOI}`;
      link.setAttribute("style", `color:${color};text-decoration:underline;font-family:ui-monospace,monospace;font-size:11px;flex-shrink:0;`);
      link.addEventListener("click", (e) => {
        e.stopPropagation();
        Zotero.launchURL(`https://doi.org/${noticeDOI}`);
      });
      banner.append(link);
    }
    container.append(banner);
  }

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
