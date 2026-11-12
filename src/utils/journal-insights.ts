import type { EasyScholarResult } from "./easyscholar";
import type { ESILookupMaps } from "./esi";
import type { NatureIndexLookupMaps } from "./nature-index";
import { DataLoader } from "./data-loader";
import { fetchEasyScholarRank, peekEasyScholarRank } from "./easyscholar";
import { ESI_CATEGORIES, formatESICategories, matchESICategories } from "./esi";
import { journalDatabaseErrorMessage } from "./journal-database-error";
import { extractValidISSNs } from "./journal-identity";
import { isJournalIndexEnabled } from "./journal-permissions";
import { readJournalRankingIndex } from "./journal-ranking-index";
import { isNatureIndexJournal } from "./nature-index";
import { getPref } from "./prefs";

interface IndexData {
  path: string;
  naturePath: string;
  esi?: ESILookupMaps;
  nature?: NatureIndexLookupMaps;
  esiError?: string;
  natureError?: string;
  customFallback?: string;
  natureFallback?: string;
}
export interface JournalInsights {
  categories: string[];
  esi: string;
  natureIndex: boolean | undefined;
  esiSource: "custom" | "builtin" | "api" | "saved";
  esiAPIWarning?: string;
  natureAPIWarning?: string;
  natureAPIDataset?: string;
  natureSource: "custom" | "builtin" | "api";
  esiError?: string;
  natureError?: string;
  customFallback?: string;
  natureFallback?: string;
  esiBasis?: "ISSN" | "publicationTitle" | "journalAbbreviation" | "API" | "saved";
  natureBasis?: "ISSN" | "publicationTitle" | "journalAbbreviation" | "API";
}
let currentPath: string | undefined;
let pending: Promise<IndexData> | undefined;
let loaded: IndexData | undefined;
let generation: object | undefined;
const message = journalDatabaseErrorMessage;
const paths = () => [getPref("insights.esiCustomDataPath") || "", getPref("insights.natureCustomDataPath") || ""] as const;
const indexConfiguration = () => JSON.stringify([...paths(), isJournalIndexEnabled("esi"), isJournalIndexEnabled("nature")]);

export function clearJournalInsights() {
  DataLoader.clearCache();
  currentPath = undefined;
  pending = undefined;
  loaded = undefined;
  generation = undefined;
}

export function loadJournalInsights(): Promise<IndexData> {
  const [path, naturePath] = paths();
  const key = indexConfiguration();
  if (pending && currentPath === key)
    return pending;
  currentPath = key;
  loaded = undefined;
  const token = {};
  generation = token;
  const task: Promise<IndexData> = (async () => {
    const data: IndexData = { path, naturePath };
    await Promise.all([
      (async () => {
        if (!isJournalIndexEnabled("esi"))
          return;
        try {
          data.esi = await DataLoader.getESIJournalMaps(path);
        }
        catch (error) {
          if (path) {
            data.customFallback = message(error);
            try {
              data.esi = await DataLoader.getESIJournalMaps();
            }
            catch (fallbackError) { data.esiError = message(fallbackError); }
          }
          else {
            data.esiError = message(error);
          }
        }
      })(),
      (async () => {
        if (!isJournalIndexEnabled("nature"))
          return;
        try {
          data.nature = await DataLoader.getNatureIndexJournalMaps(naturePath);
        }
        catch (error) {
          if (naturePath) {
            data.natureFallback = message(error);
            try {
              data.nature = await DataLoader.getNatureIndexJournalMaps();
            }
            catch (fallbackError) { data.natureError = message(fallbackError); }
          }
          else { data.natureError = message(error); }
        }
      })(),
    ]);
    if (generation === token)
      loaded = data;
    return data;
  })();
  pending = task;
  return task;
}

export function cachedJournalInsights(item: Zotero.Item): JournalInsights | undefined {
  if (currentPath !== indexConfiguration() || !loaded)
    return undefined;
  return calculate(item, loaded);
}
export async function getJournalInsights(item: Zotero.Item, options: { queryAPI?: boolean; signal?: AbortSignal } = {}): Promise<JournalInsights> {
  const data = await loadJournalInsights();
  const local = calculateLocal(item, data);
  const title = String(item.getField("publicationTitle") || "").trim();
  const expectedISSNs = extractValidISSNs(item.getField("ISSN"));
  const wantsAPI = ["esi", "nature"].some((kind) => {
    if (!isJournalIndexEnabled(kind as "esi" | "nature"))
      return false;
    const policy = sourcePriority(kind);
    return policy === "api-first" || policy === "api-only" || (policy === "local-first" && (kind === "esi" ? !local.categories.length : !local.natureIndex));
  });
  const response = options.queryAPI && item.itemType === "journalArticle" && title && wantsAPI
    ? await fetchEasyScholarRank(title, options.signal, expectedISSNs)
    : peekEasyScholarRank(title, expectedISSNs);
  return resolveJournalSources(local, response);
}
function calculate(item: Zotero.Item, data: IndexData): JournalInsights {
  const expectedISSNs = extractValidISSNs(item.getField("ISSN"));
  return resolveJournalSources(calculateLocal(item, data), peekEasyScholarRank(String(item.getField("publicationTitle") || ""), expectedISSNs));
}

function calculateLocal(item: Zotero.Item, data: IndexData): JournalInsights {
  const result: JournalInsights = {
    categories: [],
    esi: "",
    natureIndex: data.nature ? false : undefined,
    esiSource: data.path && !data.customFallback ? "custom" : "builtin",
    natureSource: data.naturePath && !data.natureFallback ? "custom" : "builtin",
    esiError: data.esiError,
    natureError: data.natureError,
    customFallback: data.customFallback,
    natureFallback: data.natureFallback,
  };
  if (item.itemType !== "journalArticle")
    return result;
  const fields = [
    ["ISSN", "issn"],
    ["publicationTitle", "publicationTitle"],
    ["journalAbbreviation", "journalAbbreviation"],
  ] as const;
  for (const [field, key] of fields) {
    const value = item.getField(field) as string;
    if (!value)
      continue;
    if (data.esi && !result.categories.length) {
      const categories = matchESICategories({ [key]: value, maps: data.esi });
      if (categories?.length) {
        result.categories = [...categories];
        result.esiBasis = field;
      }
    }
    if (data.nature && !result.natureIndex && isNatureIndexJournal({ [key]: value, maps: data.nature })) {
      result.natureIndex = true;
      result.natureBasis = field;
    }
  }
  if (!result.categories.length) {
    const savedCategories = apiESICategories(readJournalRankingIndex(item).get("esi") || "");
    if (savedCategories.length) {
      result.categories = savedCategories;
      result.esiSource = "saved";
      result.esiBasis = "saved";
    }
  }
  result.esi = formatESICategories(result.categories, getPref("insights.esiFormat") || "{subject}ESI");
  return result;
}

export function apiESICategories(value: string): string[] {
  const lookup = new Map(Object.entries(ESI_CATEGORIES).flatMap(([key, names]) => [key, names.zh, names.en].map(name => [name.toUpperCase(), key] as const)));
  const parse = (part: string): string[] => {
    const normalized = part.trim().replace(/ESI$/i, "").trim().toUpperCase();
    const exact = lookup.get(normalized);
    return exact ? [exact] : normalized.split(/[,、]/).map(name => lookup.get(name.trim())).filter((key): key is string => Boolean(key));
  };
  return [...new Set(value.split(/[;；|]/).flatMap(parse))];
}

export function resolveJournalSources(local: JournalInsights, response?: EasyScholarResult): JournalInsights {
  const result = { ...local, categories: [...local.categories] };
  const api = response?.status === "success" ? response.data : undefined;
  const categories = apiESICategories(api?.esi || "");
  const nature = api?.natureIndex === "是" ? true : api?.natureIndex === "否" ? false : undefined;
  for (const kind of ["esi", "nature"] as const) {
    if (!isJournalIndexEnabled(kind)) {
      if (kind === "esi") {
        result.categories = [];
        result.esi = "";
        result.esiBasis = undefined;
        result.esiAPIWarning = undefined;
      }
      else {
        result.natureIndex = undefined;
        result.natureBasis = undefined;
        result.natureAPIWarning = undefined;
      }
      continue;
    }
    const policy = sourcePriority(kind);
    if (policy === "local-only" || (policy === "local-first" && (kind === "esi" ? local.categories.length > 0 : local.natureIndex === true)))
      continue;
    const available = kind === "esi" ? categories.length > 0 : nature !== undefined;
    if (available) {
      if (kind === "esi") {
        result.categories = categories;
        result.esi = formatESICategories(categories, getPref("insights.esiFormat") || "{subject}ESI");
        result.esiSource = "api";
        result.esiBasis = "API";
        result.esiError = undefined;
        result.customFallback = undefined;
      }
      else {
        result.natureIndex = nature;
        result.natureSource = "api";
        result.natureBasis = "API";
        result.natureAPIDataset = api?.natureIndexDataset;
        result.natureError = undefined;
        result.natureFallback = undefined;
      }
    }
    else if (policy === "api-only") {
      if (kind === "esi") {
        result.categories = [];
        result.esi = "";
        result.esiSource = "api";
        result.esiError = "journal-insights-api-missing";
        result.esiBasis = undefined;
      }
      else {
        result.natureIndex = undefined;
        result.natureSource = "api";
        result.natureError = "journal-insights-api-missing";
        result.natureBasis = undefined;
      }
    }
    else {
      if (kind === "esi")
        result.esiAPIWarning = "journal-insights-api-fallback";
      else
        result.natureAPIWarning = "journal-insights-api-fallback";
    }
  }
  return result;
}

function sourcePriority(kind: string): string {
  const value = getPref(`insights.${kind}SourcePriority` as any, "local-only");
  return typeof value === "string" && ["api-first", "local-first", "api-only", "local-only"].includes(value) ? value : "local-only";
}
