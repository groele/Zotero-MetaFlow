import { metaflowCacheDirectory } from "./cache-paths";
import { createLogger } from "./logger";
import { flushRuntimeData, getRuntimeDataStatus, readRuntimeData } from "./runtime-data-storage";
import { flushServiceCache, getServiceCacheStatus } from "./service-cache-storage";

const logger = createLogger("cache-maintenance");
let interval: ReturnType<typeof setInterval> | undefined;
let maintenance: Promise<void> | undefined;

export async function getCacheUsage() {
  const [api, history, runtime] = await Promise.all([getServiceCacheStatus(), readRuntimeData(), getRuntimeDataStatus()]);
  let diskBytes = 0;
  // Only owned cache files are inspected; other files in this folder are untouched.
  for (const name of ["api-responses-v1.json", "api-responses-v1.json.tmp", "operation-history-v1.json", "operation-history-v1.json.bak", "operation-history-v1.json.tmp", "operation-history-v1.json.bak.tmp"]) {
    const file = PathUtils.join(metaflowCacheDirectory(), name);
    try {
      if (await IOUtils.exists(file))
        diskBytes += (await IOUtils.stat(file)).size || 0;
    }
    catch (error) {
      if (await IOUtils.exists(file))
        throw error;
    }
  }
  return { ...api, readOnly: api.readOnly || runtime.readOnly, runs: history.runs.length, diskBytes };
}

export function cleanExpiredCaches(): Promise<void> {
  if (maintenance)
    return maintenance;
  maintenance = (async () => {
    await readRuntimeData();
    const results = await Promise.allSettled([flushServiceCache(), flushRuntimeData()]);
    if (results.some(result => result.status === "rejected" || result.value === false))
      throw new Error("Cache maintenance could not persist all data");
  })().finally(() => { maintenance = undefined; });
  return maintenance;
}

export function startCacheMaintenance() {
  if (interval)
    return;
  const run = () => void cleanExpiredCaches().catch(error => logger.debug("Cache maintenance failed", error));
  interval = setInterval(run, 10 * 60_000);
  run();
}

export async function stopCacheMaintenance() {
  clearInterval(interval);
  interval = undefined;
  await maintenance?.catch(error => logger.debug("Cache maintenance stopped after failure", error));
}
