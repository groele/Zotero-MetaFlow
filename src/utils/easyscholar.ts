import type { EasyScholarRank } from "./easyscholar-fields";
import { EASYSCHOLAR_FIELD_DEFINITIONS } from "./easyscholar-fields";
import { clearServiceRequestCache, invalidateServiceRequest, requestGET, requestServiceGET } from "./http";
import { extractResponseJournalIdentity, matchesJournalIdentity } from "./journal-identity";
import { getPref } from "./prefs";
import { PUBLIC_CACHE_TTL, publicationCacheName, SERVICE_CACHE_TTL } from "./service-cache-policy";

export * from "./easyscholar-fields";
function sanitizeEasyScholarMessage(message: string, secretKey: string): string {
  const secrets = [secretKey, encodeURIComponent(secretKey)].filter(Boolean);
  return secrets.reduce((result, secret) => result.replaceAll(secret, "[redacted]"), message);
}

export type EasyScholarConnectionResult
  = | { status: "success" }
    | { status: "unconfigured" }
    | { status: "error"; message: string };

export type EasyScholarResult
  = | { status: "success"; data: EasyScholarRank }
    | { status: "not-found" }
    | { status: "unconfigured" }
    | { status: "error"; message: string };

const cache = new Map<string, { expires: number; result: EasyScholarResult; issns?: string[] }>();
const CACHE_TTL = SERVICE_CACHE_TTL;
const MAX_CACHE_SIZE = 256;

function value(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const raw = record[key] ?? record[key.replace(/\s+/g, "")];
    if ((typeof raw === "string" || typeof raw === "boolean" || (typeof raw === "number" && Number.isFinite(raw))) && String(raw).trim())
      return String(raw).trim();
  }
}

function membership(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  const result = value(record, ...keys);
  if (!result)
    return undefined;
  if (/^(?:否|no|false|0|未收录|不收录)$/i.test(result))
    return "否";
  return /^(?:[是1]|yes|true|y|收录|SCIE?|EI|UTD24|FT50|Q[1-4](?:\s*区)?)$/i.test(result) ? "是" : undefined;
}

const CUSTOM_RANK_FIELDS = EASYSCHOLAR_FIELD_DEFINITIONS.filter(field => field.source === "custom");
export const EASYSCHOLAR_NATURE_DATASET_UUID = "1615199999904223232";
const CUSTOM_LEVEL_KEYS = ["oneRankText", "twoRankText", "threeRankText", "fourRankText", "fiveRankText"];

function customRankLevel(ranks: unknown[], uuid: string): number | undefined {
  for (const rank of ranks) {
    if (typeof rank !== "string")
      continue;
    const match = rank.match(/^(.*?)(&&&|000)([1-5])$/);
    if (match?.[1] === uuid)
      return Number(match[3]);
  }
}

function parseCustomRank(raw: unknown): Partial<EasyScholarRank> {
  if (!raw || typeof raw !== "object")
    return {};
  const customRank = raw as { rankInfo?: Array<Record<string, unknown>>; rank?: unknown[] };
  const rankInfo = Array.isArray(customRank.rankInfo) ? customRank.rankInfo : [];
  const ranks = Array.isArray(customRank.rank) ? customRank.rank : [];
  const output: Partial<EasyScholarRank> = {};
  for (const field of CUSTOM_RANK_FIELDS) {
    const info = rankInfo.find(entry => entry && typeof entry === "object" && entry.uuid === field.uuid);
    const level = customRankLevel(ranks, field.uuid);
    if (!info || !level)
      continue;
    const text = value(info, CUSTOM_LEVEL_KEYS[level - 1]);
    if (text)
      (output as Record<string, string>)[field.key] = ["clsci", "scopus", "esci", "predatoryReports"].includes(field.key) ? membership(info, CUSTOM_LEVEL_KEYS[level - 1]) || "是" : text;
  }
  return output;
}

export function parseEasyScholarRank(raw: unknown, customRank?: unknown, natureDatasetUUID = ""): EasyScholarRank {
  const data = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  return {
    jcr: ["sci", "SCI", "ssci", "SSCI", "JCR 分区", "jcr", "JCR"].map(key => value(data, key)).find(rank => rank && /\bQ[1-4]\b|^[1-4一二三四]\s*区$/i.test(rank)),
    impactFactor: value(data, "sciif", "if", "影响因子"),
    impactFactor5Year: value(data, "sciif5", "if5", "5 年影响因子"),
    casUpgrade: value(data, "sciUp", "中科院分区升级版", "中科院升级版"),
    casBasic: value(data, "sciBase", "中科院基础版", "中科院分区基础版"),
    casSmall: value(data, "sciUpSmall", "中科院升级版小类分区"),
    casTop: value(data, "sciUpTop", "中科院升级版 Top 分区", "中科院 Top"),
    casWarning: value(data, "sciwarn", "中科院预警", "预警期刊"),
    newSharp: value(data, "xr", "新锐分区"),
    newSharpTop: value(data, "xrTop", "新锐 Top 分区"),
    newSharpSmall: value(data, "xrSmall", "新锐小类分区"),
    newSharpWarning: value(data, "xrWarn", "新锐预警"),
    sci: membership(data, "sci", "SCI"),
    ssci: value(data, "ssci", "SSCI"),
    ei: membership(data, "eii", "ei", "EI"),
    ahci: value(data, "ahci", "AHCI"),
    jci: value(data, "jci", "JCI"),
    esi: value(data, "esi", "ESI"),
    ajg: value(data, "ajg", "AJG"),
    ccf: value(data, "ccf", "CCF"),
    fms: value(data, "fms", "FMS"),
    utd24: membership(data, "utd24", "UTD24"),
    ft50: membership(data, "ft50", "FT50"),
    cssci: value(data, "cssci", "CSSCI", "CSSCI/南大核心"),
    pku: value(data, "pku", "pkucore", "北大核心"),
    cscd: value(data, "cscd", "CSCD"),
    technologyCore: value(data, "zhongguokejihexin", "中国科技核心期刊", "科技核心"),
    swufe: value(data, "swufe"),
    cufe: value(data, "cufe"),
    uibe: value(data, "uibe"),
    sdufe: value(data, "sdufe"),
    xdu: value(data, "xdu"),
    swjtu: value(data, "swjtu"),
    ruc: value(data, "ruc"),
    xmu: value(data, "xmu"),
    sjtu: value(data, "sjtu"),
    fdu: value(data, "fdu"),
    hhu: value(data, "hhu"),
    scu: value(data, "scu"),
    cqu: value(data, "cqu"),
    nju: value(data, "nju"),
    xju: value(data, "xju"),
    cug: value(data, "cug"),
    cju: value(data, "cju"),
    zju: value(data, "zju"),
    cpu: value(data, "cpu"),
    ...parseCustomRank(customRank),
    ...parseNatureDataset(customRank, natureDatasetUUID),
  };
}

function parseNatureDataset(raw: unknown, uuid: string): Partial<EasyScholarRank> {
  if (!raw || typeof raw !== "object")
    return {};
  const custom = raw as { rankInfo?: Record<string, unknown>[]; rank?: unknown[] };
  if (!Array.isArray(custom.rankInfo) || !Array.isArray(custom.rank))
    return {};
  const name = (entry: Record<string, unknown>) => value(entry, "name", "rankName", "datasetName")
    || value(entry, "abbName") || (entry.uuid === EASYSCHOLAR_NATURE_DATASET_UUID ? "Nature Index" : "");
  const info = custom.rankInfo.find(entry => entry && (uuid
    ? String(entry.uuid) === uuid
    : entry.uuid === EASYSCHOLAR_NATURE_DATASET_UUID
      || /^(?:\d+\s*种)?自然指数(?:统计)?期刊(?:\s*[-—–]\s*\d{4})?$|^Nature Index(?: Journals)?(?:\s*[-—–]\s*\d{4})?$/i.test(name(entry).trim())));
  if (!info || typeof info.uuid !== "string")
    return {};
  const level = customRankLevel(custom.rank, info.uuid);
  if (!level)
    return {};
  const rawText = info[CUSTOM_LEVEL_KEYS[level - 1]];
  if (rawText !== undefined && typeof rawText !== "string")
    return {};
  return { natureIndex: /^(?:否|no|false|0|不收录|未收录)$/i.test((rawText || "").trim()) ? "否" : "是", natureIndexDataset: name(info) || info.uuid };
}

function rankCacheKey(title: string) {
  return `${(getPref("easyscholar.secretKey") || "").trim()}\n${publicationCacheName(title)}\n${getPref("insights.natureDatasetUUID" as any, "")}`;
}

export function peekEasyScholarRank(title: string, expectedISSNs?: readonly string[]): EasyScholarResult | undefined {
  const key = rankCacheKey(title);
  const entry = cache.get(key);
  if (!entry || entry.expires <= Date.now()) {
    cache.delete(key);
    return;
  }
  cache.delete(key);
  cache.set(key, entry);
  if (entry.result.status === "success" && !matchesJournalIdentity(title, expectedISSNs, entry.issns?.length ? [{ issn: entry.issns.join(" ") }] : []))
    return { status: "not-found" };
  return entry.result;
}

async function request(url: string, signal?: AbortSignal, fresh = false) {
  const response = await (fresh ? requestGET(url, { timeout: 15_000 }, signal) : requestServiceGET("easyscholar", url, { timeout: 15_000 }, signal));
  const parsed = typeof response.response === "object" && response.response !== null ? response.response : JSON.parse(response.responseText || (typeof response.response === "string" ? response.response : "") || "{}");
  return { ...parsed, _metaflowCacheExpires: Number((response as any)._metaflowCacheExpires) || Date.now() + CACHE_TTL } as { code?: number; msg?: string; _metaflowCacheExpires: number; data?: { officialRank?: { all?: unknown }; customRank?: unknown } };
}

function createRequestURL(secretKey: string, title: string): string {
  const url = new URL("https://www.easyscholar.cc/open/getPublicationRank");
  url.searchParams.set("secretKey", secretKey);
  url.searchParams.set("publicationName", title);
  return url.href;
}

export async function testEasyScholarConnection(secretKey: string, signal?: AbortSignal): Promise<EasyScholarConnectionResult> {
  const key = secretKey.trim();
  if (!key)
    return { status: "unconfigured" };
  try {
    const response = await request(createRequestURL(key, "Nature"), signal, true);
    return response.code === 200
      ? { status: "success" }
      : { status: "error", message: sanitizeEasyScholarMessage(response.msg || `EasyScholar error (${response.code ?? "unknown"})`, key) };
  }
  catch {
    signal?.throwIfAborted();
    return { status: "error", message: "Network request failed" };
  }
}

export async function fetchEasyScholarRank(title: string, signal?: AbortSignal, expectedISSNs?: readonly string[]): Promise<EasyScholarResult> {
  const secretKey = (getPref("easyscholar.secretKey") || "").trim();
  if (!secretKey)
    return { status: "unconfigured" };
  const normalizedTitle = title.trim();
  if (!normalizedTitle)
    return { status: "not-found" };

  const natureDatasetUUID = String(getPref("insights.natureDatasetUUID" as any, "") || "").trim();
  const cacheKey = rankCacheKey(normalizedTitle);
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    cache.delete(cacheKey);
    cache.set(cacheKey, cached);
    if (cached.result.status === "success" && !matchesJournalIdentity(normalizedTitle, expectedISSNs, cached.issns?.length ? [{ issn: cached.issns.join(" ") }] : []))
      return { status: "not-found" };
    return cached.result;
  }

  try {
    const response = await request(createRequestURL(secretKey, normalizedTitle), signal);
    if (response.code !== 200)
      return { status: "error", message: sanitizeEasyScholarMessage(response.msg || `EasyScholar error (${response.code ?? "unknown"})`, secretKey) };
    const rawRank = response.data?.officialRank?.all;
    const rawCustomRank = response.data?.customRank;
    if ((!rawRank || typeof rawRank !== "object") && (!rawCustomRank || typeof rawCustomRank !== "object"))
      return remember(cacheKey, { status: "not-found" }, response._metaflowCacheExpires);
    const identityRecords = [response.data, rawRank];
    const returnedIdentity = extractResponseJournalIdentity(identityRecords);
    if (!matchesJournalIdentity(normalizedTitle, expectedISSNs, identityRecords)) {
      if (!returnedIdentity.issns.length)
        return remember(cacheKey, { status: "not-found" }, response._metaflowCacheExpires);
      return { status: "not-found" };
    }
    const data = parseEasyScholarRank(rawRank, rawCustomRank, natureDatasetUUID);
    if (!Object.values(data).some(value => value?.trim()))
      return remember(cacheKey, { status: "not-found" }, response._metaflowCacheExpires);
    const result: EasyScholarResult = { status: "success", data };
    return remember(cacheKey, result, response._metaflowCacheExpires, returnedIdentity.issns);
  }
  catch (error) {
    signal?.throwIfAborted();
    return { status: "error", message: sanitizeEasyScholarMessage(error instanceof Error ? error.message : String(error), secretKey) };
  }
}

function remember(key: string, result: EasyScholarResult, expires: number, issns?: string[]): EasyScholarResult {
  cache.delete(key);
  for (const [old, entry] of cache) {
    if (entry.expires <= Date.now())
      cache.delete(old);
  }
  if (cache.size >= MAX_CACHE_SIZE)
    cache.delete(cache.keys().next().value!);
  cache.set(key, { expires: Math.min(expires, Date.now() + (result.status === "not-found" ? PUBLIC_CACHE_TTL : CACHE_TTL)), result, ...issns?.length && { issns } });
  return result;
}

export async function invalidateEasyScholarTitle(title: string) {
  const normalizedTitle = title.trim();
  if (!normalizedTitle)
    return;
  cache.delete(rankCacheKey(normalizedTitle));
  const secretKey = (getPref("easyscholar.secretKey") || "").trim();
  if (secretKey)
    await invalidateServiceRequest("easyscholar", createRequestURL(secretKey, normalizedTitle), { timeout: 15_000 });
}

export function clearEasyScholarCache() {
  cache.clear();
  clearServiceRequestCache("easyscholar");
}
