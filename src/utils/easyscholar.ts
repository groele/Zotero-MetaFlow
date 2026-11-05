import { clearServiceRequestCache, requestGET, requestServiceGET } from "./http";
import { getPref } from "./prefs";
import { PUBLIC_CACHE_TTL, publicationCacheName, SERVICE_CACHE_TTL } from "./service-cache-policy";

export interface EasyScholarRank {
  natureIndex?: string;
  natureIndexDataset?: string;
  compoundIF?: string;
  comprehensiveIF?: string;
  njauCore?: string;
  njauQuality?: string;
  jcr?: string;
  impactFactor?: string;
  impactFactor5Year?: string;
  casUpgrade?: string;
  casBasic?: string;
  casSmall?: string;
  casTop?: string;
  casWarning?: string;
  sci?: string;
  ssci?: string;
  ei?: string;
  ahci?: string;
  jci?: string;
  esi?: string;
  ajg?: string;
  ccf?: string;
  fms?: string;
  utd24?: string;
  ft50?: string;
  cssci?: string;
  pku?: string;
  cscd?: string;
  technologyCore?: string;
  newSharp?: string;
  newSharpTop?: string;
  newSharpSmall?: string;
  newSharpWarning?: string;
  swufe?: string;
  cufe?: string;
  uibe?: string;
  sdufe?: string;
  xdu?: string;
  swjtu?: string;
  ruc?: string;
  xmu?: string;
  sjtu?: string;
  fdu?: string;
  hhu?: string;
  scu?: string;
  cqu?: string;
  nju?: string;
  xju?: string;
  cug?: string;
  cju?: string;
  zju?: string;
  cpu?: string;
  clsci?: string;
  ccfCustom?: string;
  ami?: string;
  nssf?: string;
  swupl?: string;
  scopus?: string;
  abdc?: string;
  hx?: string;
  coreRankings?: string;
  esci?: string;
  predatoryReports?: string;
}

export const EASYSCHOLAR_FIELD_DEFINITIONS = [
  { key: "jcr", extraKey: "JCR 分区", label: "JCR Quartile", source: "official" },
  { key: "casUpgrade", extraKey: "中科院分区升级版", label: "CAS Quartile (Upgraded)", source: "official" },
  { key: "casBasic", extraKey: "中科院分区基础版", label: "CAS Quartile (Basic)", source: "official" },
  { key: "casSmall", extraKey: "中科院升级版小类分区", label: "CAS Small Category", source: "official" },
  { key: "casTop", extraKey: "中科院升级版 Top 分区", label: "CAS Top Category", source: "official" },
  { key: "casWarning", extraKey: "中科院预警", label: "CAS Warning", source: "official" },
  { key: "newSharp", extraKey: "新锐分区", label: "NewSharp Ranking", source: "official" },
  { key: "newSharpTop", extraKey: "新锐 Top 分区", label: "NewSharp Top Category", source: "official" },
  { key: "newSharpSmall", extraKey: "新锐小类分区", label: "NewSharp Small Category", source: "official" },
  { key: "newSharpWarning", extraKey: "新锐预警", label: "NewSharp Warning", source: "official" },
  { key: "impactFactor", extraKey: "影响因子", label: "Impact Factor", source: "official" },
  { key: "impactFactor5Year", extraKey: "5 年影响因子", label: "5-Year Impact Factor", source: "official" },
  { key: "sci", extraKey: "SCI", label: "SCI", source: "official" },
  { key: "ssci", extraKey: "SSCI", label: "SSCI", source: "official" },
  { key: "ei", extraKey: "EI", label: "EI", source: "official" },
  { key: "ahci", extraKey: "AHCI", label: "AHCI", source: "official" },
  { key: "jci", extraKey: "JCI", label: "JCI", source: "official" },
  { key: "esi", extraKey: "ESI", label: "ESI", source: "official" },
  { key: "ajg", extraKey: "AJG", label: "AJG", source: "official" },
  { key: "ccf", extraKey: "CCF", label: "CCF", source: "official" },
  { key: "fms", extraKey: "FMS", label: "FMS", source: "official" },
  { key: "utd24", extraKey: "UTD24", label: "UTD24", source: "official" },
  { key: "ft50", extraKey: "FT50", label: "FT50", source: "official" },
  { key: "cssci", extraKey: "CSSCI/南大核心", label: "CSSCI / Nanjing University Core", source: "official" },
  { key: "pku", extraKey: "中文核心期刊/北大核心", label: "PKU Core", source: "official" },
  { key: "cscd", extraKey: "CSCD", label: "CSCD", source: "official" },
  { key: "technologyCore", extraKey: "中国科技核心期刊", label: "Chinese Science & Technology Core", source: "official" },
  { key: "swufe", extraKey: "西南财经大学", label: "Southwestern University of Finance and Economics", source: "official", group: "university" },
  { key: "cufe", extraKey: "中央财经大学", label: "Central University of Finance and Economics", source: "official", group: "university" },
  { key: "uibe", extraKey: "对外经济贸易大学", label: "University of International Business and Economics", source: "official", group: "university" },
  { key: "sdufe", extraKey: "山东财经大学", label: "Shandong University of Finance and Economics", source: "official", group: "university" },
  { key: "xdu", extraKey: "西安电子科技大学", label: "Xidian University", source: "official", group: "university" },
  { key: "swjtu", extraKey: "西南交通大学", label: "Southwest Jiaotong University", source: "official", group: "university" },
  { key: "ruc", extraKey: "中国人民大学", label: "Renmin University of China", source: "official", group: "university" },
  { key: "xmu", extraKey: "厦门大学", label: "Xiamen University", source: "official", group: "university" },
  { key: "sjtu", extraKey: "上海交通大学", label: "Shanghai Jiao Tong University", source: "official", group: "university" },
  { key: "fdu", extraKey: "复旦大学", label: "Fudan University", source: "official", group: "university" },
  { key: "hhu", extraKey: "河海大学", label: "Hohai University", source: "official", group: "university" },
  { key: "scu", extraKey: "四川大学", label: "Sichuan University", source: "official", group: "university" },
  { key: "cqu", extraKey: "重庆大学", label: "Chongqing University", source: "official", group: "university" },
  { key: "nju", extraKey: "南京大学", label: "Nanjing University", source: "official", group: "university" },
  { key: "xju", extraKey: "新疆大学", label: "Xinjiang University", source: "official", group: "university" },
  { key: "cug", extraKey: "中国地质大学", label: "China University of Geosciences", source: "official", group: "university" },
  { key: "cju", extraKey: "长江大学", label: "Yangtze University", source: "official", group: "university" },
  { key: "zju", extraKey: "浙江大学", label: "Zhejiang University", source: "official", group: "university" },
  { key: "cpu", extraKey: "中国药科大学", label: "China Pharmaceutical University", source: "official", group: "university" },
  { key: "clsci", extraKey: "CLSCI", label: "CLSCI", source: "custom", uuid: "1642199434173014016" },
  { key: "ccfCustom", extraKey: "CCF 推荐目录", label: "CCF Recommended List", source: "custom", uuid: "1614919989423271936" },
  { key: "ami", extraKey: "AMI", label: "AMI", source: "custom", uuid: "1648920625629810688" },
  { key: "nssf", extraKey: "NSSF", label: "National Social Science Fund", source: "custom", uuid: "1648936694851489792" },
  { key: "swupl", extraKey: "西南政法大学", label: "Southwest University of Political Science and Law", source: "custom", uuid: "1652662162603773952" },
  { key: "scopus", extraKey: "Scopus", label: "Scopus", source: "custom", uuid: "1635615726460694528" },
  { key: "abdc", extraKey: "ABDC", label: "ABDC", source: "custom", uuid: "1613183594358972416" },
  { key: "hx", extraKey: "HX", label: "HX", source: "custom", uuid: "1630107627939360768" },
  { key: "coreRankings", extraKey: "CORE Rankings", label: "CORE Rankings", source: "custom", uuid: "1671898121325117440" },
  { key: "esci", extraKey: "ESCI", label: "ESCI", source: "custom", uuid: "1704511887208226816" },
  { key: "predatoryReports", extraKey: "掠夺性期刊预警", label: "Predatory Reports", source: "custom", uuid: "1667045962800594944" },
  { key: "compoundIF", extraKey: "复合影响因子", label: "复合影响因子", source: "supplemental" },
  { key: "comprehensiveIF", extraKey: "综合影响因子", label: "综合影响因子", source: "supplemental" },
  { key: "njauCore", extraKey: "南农核心", label: "南农核心", source: "supplemental" },
  { key: "njauQuality", extraKey: "南农高质量", label: "南农高质量", source: "supplemental" },
] as const;

export type EasyScholarField = (typeof EASYSCHOLAR_FIELD_DEFINITIONS)[number]["key"];
export const EASYSCHOLAR_EXTRA_ALIASES: Partial<Record<EasyScholarField, readonly string[]>> = {
  jcr: ["JCR\u5206\u533A"],
  impactFactor5Year: ["5\u5E74\u5F71\u54CD\u56E0\u5B50"],
  casTop: ["\u4E2D\u79D1\u9662\u5347\u7EA7\u7248Top\u5206\u533A"],
  newSharpTop: ["\u65B0\u9510Top\u5206\u533A"],
  swupl: ["SWUPL"],
  coreRankings: ["CORE\u8BC4\u7EA7"],
};
export const EASYSCHOLAR_OUTPUT_FIELDS: ReadonlyArray<EasyScholarField> = EASYSCHOLAR_FIELD_DEFINITIONS.map(field => field.key);
export const EASYSCHOLAR_DEFAULT_FIELDS: ReadonlySet<EasyScholarField> = new Set([
  "jcr",
  "casUpgrade",
  "casBasic",
  "casSmall",
  "casTop",
  "casWarning",
  "impactFactor",
  "impactFactor5Year",
  "sci",
  "ssci",
  "ei",
  "ahci",
  "jci",
  "esi",
  "ajg",
  "ccf",
  "fms",
  "utd24",
  "ft50",
  "cssci",
  "pku",
  "cscd",
  "technologyCore",
]);

export function isEasyScholarFieldEnabled(key: EasyScholarField): boolean {
  return getPref(`easyscholar.fields.${key}` as any, EASYSCHOLAR_DEFAULT_FIELDS.has(key)) === true;
}

const FIELD_MESSAGE_SUFFIX: Partial<Record<EasyScholarField, string>> = {
  compoundIF: "compound-if",
  comprehensiveIF: "comprehensive-if",
  njauCore: "njau-core",
  njauQuality: "njau-quality",

  casUpgrade: "cas-upgrade",
  casBasic: "cas-basic",
  casSmall: "cas-small",
  casTop: "cas-top",
  casWarning: "cas-warning",
  impactFactor: "if",
  impactFactor5Year: "if5",
  technologyCore: "technology-core",
  ccfCustom: "ccf-custom",
  coreRankings: "core-rankings",
  predatoryReports: "predatory-reports",
  newSharp: "new-sharp",
  newSharpTop: "new-sharp-top",
  newSharpSmall: "new-sharp-small",
  newSharpWarning: "new-sharp-warning",
};

export function getEasyScholarFieldMessageID(key: EasyScholarField): string {
  return `easyscholar-field-${FIELD_MESSAGE_SUFFIX[key] || key}`;
}

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

const cache = new Map<string, { expires: number; result: EasyScholarResult }>();
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

export function peekEasyScholarRank(title: string): EasyScholarResult | undefined {
  const key = rankCacheKey(title);
  const entry = cache.get(key);
  if (!entry || entry.expires <= Date.now()) {
    cache.delete(key);
    return;
  }
  cache.delete(key);
  cache.set(key, entry);
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

export async function fetchEasyScholarRank(title: string, signal?: AbortSignal): Promise<EasyScholarResult> {
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
    const data = parseEasyScholarRank(rawRank, rawCustomRank, natureDatasetUUID);
    if (!Object.values(data).some(value => value?.trim()))
      return remember(cacheKey, { status: "not-found" }, response._metaflowCacheExpires);
    const result: EasyScholarResult = { status: "success", data };
    return remember(cacheKey, result, response._metaflowCacheExpires);
  }
  catch (error) {
    signal?.throwIfAborted();
    return { status: "error", message: sanitizeEasyScholarMessage(error instanceof Error ? error.message : String(error), secretKey) };
  }
}

function remember(key: string, result: EasyScholarResult, expires: number): EasyScholarResult {
  cache.delete(key);
  for (const [old, entry] of cache) {
    if (entry.expires <= Date.now())
      cache.delete(old);
  }
  if (cache.size >= MAX_CACHE_SIZE)
    cache.delete(cache.keys().next().value!);
  cache.set(key, { expires: Math.min(expires, Date.now() + (result.status === "not-found" ? PUBLIC_CACHE_TTL : CACHE_TTL)), result });
  return result;
}

export function clearEasyScholarCache() {
  cache.clear();
  clearServiceRequestCache("easyscholar");
}
