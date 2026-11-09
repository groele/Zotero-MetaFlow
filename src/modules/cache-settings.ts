import { cleanExpiredCaches, getCacheUsage } from "../utils/cache-maintenance";
import { getString } from "../utils/locale";
import { createLogger } from "../utils/logger";
import { preferenceListeners } from "../utils/preference-listeners";

const logger = createLogger("cache-settings");
const refreshTokens = new WeakMap<Element, number>();

export async function refreshCacheUsage(pane: Element) {
  const token = (refreshTokens.get(pane) || 0) + 1;
  refreshTokens.set(pane, token);
  const status = pane.querySelector("#metaref-cache-usage");
  try {
    const usage = await getCacheUsage();
    if (status && pane.isConnected && refreshTokens.get(pane) === token) {
      status.textContent = getString("cache-usage-summary", { args: { entries: usage.entries, runs: usage.runs, size: (usage.diskBytes / 1024 / 1024).toFixed(2) } });
      if (usage.writeFailed || usage.readOnly)
        status.textContent += ` ${getString(usage.readOnly ? "cache-format-protected" : "cache-maintenance-failed")}`;
    }
  }
  catch (error) {
    logger.debug("Cannot read cache usage", error);
    if (status && pane.isConnected && refreshTokens.get(pane) === token)
      status.textContent = getString("cache-maintenance-failed");
  }
}

export function setupCacheSettings(pane: Element) {
  const cleanup = pane.querySelector<HTMLButtonElement>("#metaref-clean-expired-cache");
  const refresh = pane.querySelector("#metaref-refresh-cache-usage");
  if (refresh)
    preferenceListeners(pane)(refresh, "command", () => refreshCacheUsage(pane));
  if (cleanup) {
    preferenceListeners(pane)(cleanup, "command", async () => {
      if (cleanup.disabled)
        return;
      cleanup.disabled = true;
      try {
        await cleanExpiredCaches();
        await refreshCacheUsage(pane);
      }
      catch (error) {
        logger.debug("Cannot clean expired cache", error);
        const status = pane.querySelector("#metaref-cache-usage");
        if (status && pane.isConnected)
          status.textContent = getString("cache-maintenance-failed");
      }
      finally { cleanup.disabled = false; }
    });
  }
  void refreshCacheUsage(pane);
}
