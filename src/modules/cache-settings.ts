import { cleanExpiredCaches, getCacheUsage } from "../utils/cache-maintenance";
import { ensureMetaFlowCacheDirectory, metaflowCacheDirectory } from "../utils/cache-paths";
import { getString } from "../utils/locale";
import { createLogger } from "../utils/logger";
import { preferenceLifetime, preferenceListeners } from "../utils/preference-listeners";
import { getPref, setPref } from "../utils/prefs";
import { RUNTIME_HISTORY_BYTES, runtimeHistoryDays, runtimeHistoryLimit } from "../utils/runtime-data-policy";
import { flushRuntimeData } from "../utils/runtime-data-storage";
import {
  easyScholarCacheHours,
  semanticScholarCacheHours,
  serviceCacheLimit,
  serviceCacheMaxMiB,
} from "../utils/service-cache-policy";
import { flushServiceCache, resetServiceCacheSession } from "../utils/service-cache-storage";

const logger = createLogger("cache-settings");
const refreshTokens = new WeakMap<Element, number>();

interface CacheNumericSpec {
  id: string;
  key:
    | "cache.easyScholarHours"
    | "cache.semanticScholarHours"
    | "cache.historyDays"
    | "cache.historyLimit"
    | "cache.maxMiB"
    | "cache.maxEntries";
  min: number;
  max: number;
  get: () => number;
}

const CACHE_NUMERIC_SPECS: readonly CacheNumericSpec[] = [
  { id: "metaref-cache-easyscholar-hours", key: "cache.easyScholarHours", min: 1, max: 720, get: easyScholarCacheHours },
  { id: "metaref-cache-semanticscholar-hours", key: "cache.semanticScholarHours", min: 1, max: 720, get: semanticScholarCacheHours },
  { id: "metaref-cache-history-days", key: "cache.historyDays", min: 1, max: 365, get: runtimeHistoryDays },
  { id: "metaref-cache-history-limit", key: "cache.historyLimit", min: 20, max: 2000, get: runtimeHistoryLimit },
  { id: "metaref-cache-max-mib", key: "cache.maxMiB", min: 1, max: 64, get: serviceCacheMaxMiB },
  { id: "metaref-cache-max-entries", key: "cache.maxEntries", min: 64, max: 10000, get: serviceCacheLimit },
];

export function syncCachePathDisplay(pane: Element) {
  const dir = metaflowCacheDirectory();
  const input = pane.querySelector<HTMLInputElement>("#metaref-cache-custom-path");
  if (input) {
    input.value = dir;
    input.title = dir;
  }
  const folderPath = pane.querySelector("#metaref-cache-folder-path");
  if (folderPath)
    folderPath.textContent = getString("cache-folder-path", { args: { path: dir } });
  const policy = pane.querySelector("#metaref-runtime-data-policy");
  if (policy) {
    policy.textContent = getString("runtime-data-policy", {
      args: { days: runtimeHistoryDays(), count: runtimeHistoryLimit(), size: RUNTIME_HISTORY_BYTES / 1024 / 1024 },
    });
  }
}

export async function refreshCacheUsage(pane: Element) {
  const token = (refreshTokens.get(pane) || 0) + 1;
  refreshTokens.set(pane, token);
  syncCachePathDisplay(pane);
  const status = pane.querySelector("#metaref-cache-usage");
  try {
    const usage = await getCacheUsage();
    if (status && pane.isConnected && refreshTokens.get(pane) === token) {
      status.textContent = getString("cache-usage-summary", {
        args: {
          entries: usage.entries,
          maxEntries: serviceCacheLimit(),
          runs: usage.runs,
          maxRuns: runtimeHistoryLimit(),
          size: (usage.diskBytes / 1024 / 1024).toFixed(2),
          maxSize: serviceCacheMaxMiB(),
        },
      });
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

function setupCacheDirectory(pane: Element) {
  const listen = preferenceListeners(pane);
  const signal = preferenceLifetime(pane);
  const doc = pane.ownerDocument!;
  const input = pane.querySelector<HTMLInputElement>("#metaref-cache-custom-path");
  const button = pane.querySelector<HTMLButtonElement>("#metaref-cache-choose-directory");
  if (!input || !button || !input.parentElement)
    return;
  const row = input.parentElement;
  const status = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  status.id = "metaref-cache-directory-status";
  status.className = "metaref-input-status metaref-custom-data-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  row.appendChild(status);
  input.setAttribute("aria-describedby", [input.getAttribute("aria-describedby"), status.id].filter(Boolean).join(" "));

  const syncAfterBinding = () => {
    void Promise.resolve().then(() => {
      if (!signal.aborted && pane.isConnected && addon.data.alive)
        syncCachePathDisplay(pane);
    });
  };
  syncCachePathDisplay(pane);
  listen(input, "syncfrompreference", syncAfterBinding);
  listen(pane, "syncfrompreference", syncAfterBinding, true);
  listen(pane, "metaref-preferences-synced", () => {
    resetServiceCacheSession();
    syncCachePathDisplay(pane);
    void refreshCacheUsage(pane);
  });

  let busy = false;
  listen(button, "command", async () => {
    if (busy || row.hasAttribute("data-busy"))
      return;
    busy = true;
    row.setAttribute("data-busy", "true");
    row.setAttribute("aria-busy", "true");
    const buttons = [...row.querySelectorAll<HTMLButtonElement>("button")];
    buttons.forEach(btn => btn.disabled = true);
    status.textContent = getString("settings-file-working");
    try {
      const selected = await new ztoolkit.FilePicker(
        getString("cache-directory-choose-title"),
        "folder",
        [],
        undefined,
        doc.defaultView!,
      ).open();
      if (!selected) {
        status.textContent = "";
        return;
      }
      await ensureMetaFlowCacheDirectory(selected);
      const probe = PathUtils.join(selected, `.metaflow-write-probe-${Date.now()}.tmp`);
      await IOUtils.writeUTF8(probe, "ok");
      await IOUtils.remove(probe, { ignoreAbsent: true });
      if (signal.aborted || !pane.isConnected || !addon.data.alive)
        return;
      await flushServiceCache();
      await flushRuntimeData();
      setPref("cache.customDirectory", selected);
      resetServiceCacheSession();
      syncCachePathDisplay(pane);
      const win = doc.defaultView as Window & typeof globalThis;
      input.dispatchEvent(new win.Event("change", { bubbles: true }));
      status.textContent = getString("cache-directory-ready");
      await refreshCacheUsage(pane);
    }
    catch (error) {
      status.textContent = getString("settings-file-error", {
        args: { error: error instanceof Error ? error.message : String(error) },
      });
    }
    finally {
      busy = false;
      row.removeAttribute("data-busy");
      row.removeAttribute("aria-busy");
      buttons.forEach((btn) => {
        btn.disabled = input.disabled || (btn.dataset.resetPath === "true" && !getPref("cache.customDirectory"));
      });
    }
  });
}

function setupCachePolicyInputs(pane: Element) {
  const listen = preferenceListeners(pane);
  for (const spec of CACHE_NUMERIC_SPECS) {
    const input = pane.querySelector<HTMLInputElement>(`#${spec.id}`);
    if (!input)
      continue;
    input.value = String(spec.get());
    const validate = (event: Event) => {
      event.stopImmediatePropagation();
      const raw = input.value.trim();
      const parsed = Number(raw);
      if (!raw || !Number.isInteger(parsed) || parsed < spec.min || parsed > spec.max) {
        input.setAttribute("aria-invalid", "true");
        return;
      }
      input.removeAttribute("aria-invalid");
      setPref(spec.key, parsed);
      if (event.type === "change")
        void cleanExpiredCaches().then(() => refreshCacheUsage(pane));
      else
        void refreshCacheUsage(pane);
    };
    listen(input, "input", validate, true);
    listen(input, "change", validate, true);
    listen(input, "blur", () => {
      if (input.hasAttribute("aria-invalid")) {
        input.value = String(spec.get());
        input.removeAttribute("aria-invalid");
      }
    });
    listen(input, "syncfrompreference", () => {
      void Promise.resolve().then(() => {
        if (!input.hasAttribute("aria-invalid"))
          input.value = String(spec.get());
      });
    });
  }
  listen(pane, "metaref-preferences-synced", () => {
    for (const spec of CACHE_NUMERIC_SPECS) {
      const input = pane.querySelector<HTMLInputElement>(`#${spec.id}`);
      if (input && !input.hasAttribute("aria-invalid"))
        input.value = String(spec.get());
    }
    void refreshCacheUsage(pane);
  });
}

export function setupCacheSettings(pane: Element) {
  setupCacheDirectory(pane);
  setupCachePolicyInputs(pane);
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
