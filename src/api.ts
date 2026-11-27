import { refreshJournalInsights } from "./domains/journal-insights/journal-pane";
import { refreshDuplicateStats } from "./domains/review-duplicates/duplicate-stats";
import { bulkMergeDuplicates } from "./domains/review-duplicates/review/duplicate-batch";
import { applyDuplicateDecision, findDuplicates } from "./domains/review-duplicates/review/duplicates";
import { mergeNativeDuplicates, planNativeDuplicates } from "./domains/review-duplicates/review/native-duplicates";
import { clearNonDuplicates, exportNonDuplicates, importNonDuplicates, markNonDuplicate } from "./services/duplicates/non-duplicates";
import { probeHostCapabilities } from "./services/host";
import { discoverIdentifiers, inspectMetadata, inspectPreprint, parseArxiv } from "./services/metadata/metadata-inspector";
import { applyReviewedMetadata, createRelatedVersion } from "./services/metadata/review-apply";
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

export default { testing, getHostCapabilities: probeHostCapabilities, runtimeData: { path: runtimeDataPath, cacheDirectory: metaflowCacheDirectory, read: readRuntimeData, clear: clearRuntimeData, flush: flushRuntimeData }, utils, getJournalInsights, exportJournalDatabase, validateJournalDatabase, refreshJournalInsights, getLastAutomaticWorkflow, review: { discoverIdentifiers, inspectMetadata, inspectPreprint, parseArxiv, applyReviewedMetadata, createRelatedVersion, findDuplicates, applyDuplicateDecision, bulkMergeDuplicates, planNativeDuplicates, mergeNativeDuplicates, markNonDuplicate, exportNonDuplicates, importNonDuplicates, clearNonDuplicates, refreshDuplicateStats } };
