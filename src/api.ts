import { refreshDuplicateStats } from "./modules/duplicate-stats";
import { refreshJournalInsights } from "./modules/journal-pane";
import { applyReviewedMetadata, createRelatedVersion } from "./modules/review/apply";
import { bulkMergeDuplicates } from "./modules/review/duplicate-batch";
import { applyDuplicateDecision, findDuplicates } from "./modules/review/duplicates";
import { discoverIdentifiers, inspectMetadata, inspectPreprint, parseArxiv } from "./modules/review/metadata";
import { mergeNativeDuplicates, planNativeDuplicates } from "./modules/review/native-duplicates";
import { clearNonDuplicates, exportNonDuplicates, importNonDuplicates, markNonDuplicate } from "./modules/review/non-duplicates";
import { metaflowCacheDirectory } from "./utils/cache-paths";
import { requestHTTP } from "./utils/http";
import { useHTTPTransport } from "./utils/http-transport";
import { exportJournalDatabase, validateJournalDatabase } from "./utils/journal-database-file";
import { getJournalInsights } from "./utils/journal-insights";
import { clearRuntimeData, flushRuntimeData, readRuntimeData, runtimeDataPath } from "./utils/runtime-data-storage";
import { getTextLanguage } from "./utils/str";

const utils = { getTextLanguage };
const testing = typeof __env__ !== "undefined" && __env__ !== "production" ? { useHTTPTransport, requestHTTP } : undefined;

function getLastAutomaticWorkflow() {
  return addon.data.lastAutomaticWorkflow ? JSON.parse(JSON.stringify(addon.data.lastAutomaticWorkflow)) : undefined;
}

export default { testing, runtimeData: { path: runtimeDataPath, cacheDirectory: metaflowCacheDirectory, read: readRuntimeData, clear: clearRuntimeData, flush: flushRuntimeData }, utils, getJournalInsights, exportJournalDatabase, validateJournalDatabase, refreshJournalInsights, getLastAutomaticWorkflow, review: { discoverIdentifiers, inspectMetadata, inspectPreprint, parseArxiv, applyReviewedMetadata, createRelatedVersion, findDuplicates, applyDuplicateDecision, bulkMergeDuplicates, planNativeDuplicates, mergeNativeDuplicates, markNonDuplicate, exportNonDuplicates, importNonDuplicates, clearNonDuplicates, refreshDuplicateStats } };
