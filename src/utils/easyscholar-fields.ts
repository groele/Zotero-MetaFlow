import { getPref } from "./prefs";

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
