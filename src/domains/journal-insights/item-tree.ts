import { extractTLDRFromItem } from "../../services/metadata/tool-update-metadata/tldr";
import { cleanupResourcesSync } from "../../utils/cleanup";
import { EASYSCHOLAR_FIELD_DEFINITIONS, getEasyScholarFieldMessageID, isEasyScholarFieldEnabled } from "../../utils/easyscholar";
import { journalNumericDisplayValue, journalNumericSortValue } from "../../utils/journal-column-sort";
import { cachedJournalInsights } from "../../utils/journal-insights";
import { presentJournalInsights } from "../../utils/journal-insights-presentation";
import { isJournalIndexEnabled } from "../../utils/journal-permissions";
import * as journalRankingIndex from "../../utils/journal-ranking-index";
import { readJournalRankingValues } from "../../utils/journal-ranking-rows";
import { getString } from "../../utils/locale";
import { logger } from "../../utils/logger";
import { getPref } from "../../utils/prefs";

const registeredColumns: string[] = [];
const indexColumns = new Map<string, string>();
const easyScholarColumns = new Map<string, { id: string; main: boolean }>();
let rankingCache = new WeakMap<Zotero.Item, {
  extra: string;
  issn: string;
  title: string;
  revision: number;
  values: ReturnType<typeof readJournalRankingValues>;
  merged: ReturnType<typeof journalRankingIndex.readJournalRankingIndex>;
}>();
const numericFields = new Set(["impactFactor", "impactFactor5Year", "jci", "compoundIF", "comprehensiveIF"]);

function mergedRankings(item: Zotero.Item) {
  const extra = String(item.getField("extra") || "");
  const issn = String(item.getField("ISSN") || "");
  const title = String(
    item.itemType === "conferencePaper"
      ? item.getField("proceedingsTitle") || item.getField("conferenceName") || ""
      : item.getField("publicationTitle") || "",
  );
  const revision = "getJournalRankingIndexRevision" in journalRankingIndex && typeof journalRankingIndex.getJournalRankingIndexRevision === "function"
    ? journalRankingIndex.getJournalRankingIndexRevision()
    : 0;
  let cached = rankingCache.get(item);
  if (!cached || cached.extra !== extra || cached.issn !== issn || cached.title !== title || cached.revision !== revision) {
    const values = cached && cached.extra === extra ? cached.values : readJournalRankingValues(extra);
    const merged = journalRankingIndex.readJournalRankingIndex(item, values);
    cached = { extra, issn, title, revision, values, merged };
    rankingCache.set(item, cached);
  }
  return cached.merged;
}

export function registerExtraColumns() {
  registerEasyScholarColumns();
  registerIndexColumns();
  if (registeredColumns.length)
    return;
  const abbreviationColumn = Zotero.ItemTreeManager.registerColumn({
    dataKey: "abbr",
    label: getString("field-abbr"),
    dataProvider: (item, _dataKey) => {
      if (!addon?.data?.alive || !ztoolkit?.ExtraField)
        return "";
      if (item.itemType === "journalArticle")
        return item.getField("journalAbbreviation");
      else if (item.itemType === "thesis")
        return item.getField("university");
      else if (item.itemType === "patent")
        return item.getField("country");
      else if (item.itemType === "conferencePaper")
        return ztoolkit.ExtraField.getExtraField(item, "shortConferenceName") || "";
      else
        return ztoolkit.ExtraField.getExtraField(item, "abbr") || "";
    },
    pluginID: addon.data.config.addonID,
    zoteroPersist: ["width", "hidden", "sortDirection"],
  });
  if (abbreviationColumn)
    registeredColumns.push(abbreviationColumn);
  const tldrColumn = Zotero.ItemTreeManager.registerColumn({
    dataKey: "tldr",
    label: getString("field-tldr") || "撷论",
    dataProvider: (item, _dataKey) => {
      if (!addon?.data?.alive || !item)
        return "";
      return extractTLDRFromItem(item) || "";
    },
    pluginID: addon.data.config.addonID,
    zoteroPersist: ["width", "hidden", "sortDirection"],
  });
  if (tldrColumn)
    registeredColumns.push(tldrColumn);
}

function registerIndexColumns() {
  for (const [key, label, kind, property] of [
    ["natureIndex", "field-nature-index", "nature", "value"],
    ["esiMatch", "field-esi-match", "esi", "basis"],
    ["natureMatch", "field-nature-match", "nature", "basis"],
    ["esiSource", "field-esi-source", "esi", "source"],
    ["natureSource", "field-nature-source", "nature", "source"],
  ] as const) {
    const existing = indexColumns.get(key);
    if (!isJournalIndexEnabled(kind)) {
      if (existing && Zotero.ItemTreeManager.isCustomColumn(existing))
        Zotero.ItemTreeManager.unregisterColumn(existing);
      indexColumns.delete(key);
      continue;
    }
    if (existing && Zotero.ItemTreeManager.isCustomColumn(existing))
      continue;
    const id = Zotero.ItemTreeManager.registerColumn({
      dataKey: key,
      label: getString(label),
      columnPickerSubMenu: key !== "natureIndex",
      dataProvider: (item) => {
        if (!addon.data.alive || !isJournalIndexEnabled(kind) || item.itemType !== "journalArticle")
          return "";
        const result = cachedJournalInsights(item);
        if (!result)
          return "";
        if (key === "natureIndex")
          return result.natureIndex ? "✓" : "";
        return presentJournalInsights(result, Zotero.locale)[kind === "esi" ? 0 : 1][property];
      },
      pluginID: addon.data.config.addonID,
      zoteroPersist: ["width", "hidden", "sortDirection"],
    });
    if (id)
      indexColumns.set(key, id);
  }
}

export function registerEasyScholarColumns() {
  if (!addon?.data?.alive || !Zotero.ItemTreeManager)
    return;
  for (const field of EASYSCHOLAR_FIELD_DEFINITIONS) {
    const existing = easyScholarColumns.get(field.key);
    if (!isEasyScholarFieldEnabled(field.key)) {
      if (existing && Zotero.ItemTreeManager.isCustomColumn(existing.id))
        Zotero.ItemTreeManager.unregisterColumn(existing.id);
      easyScholarColumns.delete(field.key);
      continue;
    }
    const enabled = getPref(`easyscholar.columns.${field.key}` as any, field.key === "esi") === true;
    if (existing && existing.main === enabled && Zotero.ItemTreeManager.isCustomColumn(existing.id))
      continue;
    if (existing && Zotero.ItemTreeManager.isCustomColumn(existing.id))
      Zotero.ItemTreeManager.unregisterColumn(existing.id);
    const registered = Zotero.ItemTreeManager.registerColumn({
      dataKey: field.key === "esi" ? "esiDiscipline" : `easyScholar-${field.key}`,
      label: getString(field.key === "esi" ? "field-esi" : getEasyScholarFieldMessageID(field.key) as any),
      columnPickerSubMenu: !enabled,
      dataProvider: (item: Zotero.Item) => {
        if (!addon.data.alive || !isEasyScholarFieldEnabled(field.key) || !["journalArticle", "conferencePaper"].includes(item.itemType) || (field.key === "esi" && item.itemType !== "journalArticle"))
          return "";
        const saved = mergedRankings(item).get(field.key) || "";
        return field.key === "esi" ? cachedJournalInsights(item)?.esi || saved : numericFields.has(field.key) ? journalNumericSortValue(saved) : saved;
      },
      ...numericFields.has(field.key) && { renderCell: (_index: number, value: string, column: { className: string }, _first: boolean, doc: Document) => {
        const cell = doc.createElementNS("http://www.w3.org/1999/xhtml", "span") as HTMLSpanElement;
        cell.className = `cell ${column.className}`;
        cell.textContent = journalNumericDisplayValue(value);
        return cell;
      } },
      pluginID: addon.data.config.addonID,
      zoteroPersist: ["width", "hidden", "sortDirection"],
    });
    if (registered)
      easyScholarColumns.set(field.key, { id: registered, main: enabled });
  }
}

export function unregisterExtraColumns() {
  const easyScholarIDs = [...easyScholarColumns.values()].map(column => column.id).concat([...indexColumns.values()]);
  indexColumns.clear();
  easyScholarColumns.clear();
  rankingCache = new WeakMap();
  cleanupResourcesSync(easyScholarIDs.map(id => () => Zotero.ItemTreeManager.unregisterColumn(id)), error => logger.error("EasyScholar column cleanup failed:", error));
  cleanupResourcesSync(registeredColumns.splice(0).map(id => () => Zotero.ItemTreeManager.unregisterColumn(id)), error => logger.error("Column cleanup failed:", error));
}
