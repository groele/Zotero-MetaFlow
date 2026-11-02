/**
 * Academic Journal & Index Systems Unified Facade
 * 集中归口与聚合导出所有学术期刊数据库、排名索引、指标查询与卡片分享能力。
 */

// 1. EasyScholar 学术指标与 61 项权威分区系统
export * from "../easyscholar";

// 2. 学科核心数据库（ESI 与 Nature Index）
export * from "../esi";
// 4. ISO 4 期刊缩写推断与本地反查
export * from "../journal-abbreviation";

export * from "../journal-abbreviation-iso";

// 3. 期刊卡片分享与绘图系统
export * from "../journal-card-share";
export * from "../journal-column-sort";

export * from "../journal-database-error";
// 6. 期刊数据库存储与自定义数据集
export * from "../journal-database-file";
export * from "../journal-datasets";
export * from "../journal-feedback";
// 5. 期刊详情与洞察数据流（Journal Insights & Presentation）
export * from "../journal-insights";
export * from "../journal-insights-presentation";
export * from "../journal-permissions";

export * from "../journal-ranking-index";
export * from "../journal-ranking-rows";
export * from "../journal-source";
export * from "../nature-index";
export * from "../supplemental-journals";
