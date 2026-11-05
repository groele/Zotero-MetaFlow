import { homepage } from "../../package.json";
import { clearEasyScholarCache } from "../utils/easyscholar";
import { getString } from "../utils/locale";
import { createLogger } from "../utils/logger";
import { preferenceListeners, releasePreferenceListeners } from "../utils/preference-listeners";
import { watchPreferencePane } from "../utils/preference-window";
import { clearStoredServiceCache } from "../utils/service-cache-storage";
import { clearSupplementalJournalCache } from "../utils/supplemental-journals";
import { setupBatchFeedback } from "./batch-feedback";
import { setupCustomDataFiles } from "./custom-data-settings";
import { setupDuplicateSettings } from "./duplicate-settings";
import { setupJournalDatabases, setupJournalShareSettings } from "./journal-database-settings";
import { clearSemanticScholarCache } from "./rules/tool-update-metadata/services/semantic-scholar-service";
import { setupAbbreviationSettings, setupIntegrationStatus } from "./settings-abbrev";
import { organizeSettingsModules, setupFunctionCards } from "./settings-cards";
import { setupCustomDataReset, setupDependencies } from "./settings-dependencies";
import { setupEasyScholarConnectionTest, setupEasyScholarSettings } from "./settings-easyscholar";
import { setupMenuSettings } from "./settings-menu";
import { setupSettingsPanel } from "./settings-panel";
import { setupShortcutInputs } from "./settings-shortcuts";
import { setupToolCenter } from "./tool-center";
import { setupWorkflowSettings } from "./workflow-settings";

const logger = createLogger("preference");
const initializedPanes = new WeakSet<Element>();
const preferenceWindows = new Map<Window, () => void>();
let preferenceRegistration: Promise<string> | undefined;

export async function registerPrefs() {
  if (preferenceRegistration)
    return preferenceRegistration;
  const src = `${rootURI}content/preferences.xhtml`;
  const existing = (Zotero.PreferencePanes as any).pluginPanes.filter((pane: any) => pane.pluginID === addon.data.config.addonID);
  const current = existing.find((pane: any) => pane.src === src);
  for (const pane of existing) {
    if (pane !== current)
      Zotero.PreferencePanes.unregister(pane.id);
  }
  if (current)
    return current.id as string;
  preferenceRegistration = Zotero.PreferencePanes.register({
    id: "metaref-settings",
    pluginID: addon.data.config.addonID,
    src,
    scripts: [`${rootURI}content/scripts/preferences.js`],
    defaultXUL: true,
    label: getString("prefs-title"),
    image: `${rootURI}/content/icons/metaref-96.png`,
    stylesheets: [`${rootURI}/content/preferences.css`],
    helpURL: homepage,
  });
  try {
    const id = await preferenceRegistration;
    if (!addon.data.alive)
      Zotero.PreferencePanes.unregister(id);
    return id;
  }
  catch (error) {
    preferenceRegistration = undefined;
    throw error;
  }
}

export function registerPrefsWindow(win: Window) {
  if (preferenceWindows.has(win) || !addon.data.alive)
    return;
  const stopWatching = watchPreferencePane(win, addon.data.config.addonRef, registerPrefsScripts);
  const cleanup = () => {
    stopWatching();
    releasePreferenceListeners(win.document);
    win.removeEventListener("unload", cleanup);
    preferenceWindows.delete(win);
    if (addon.data.prefs?.window === win)
      addon.data.prefs = undefined;
  };
  win.addEventListener("unload", cleanup, { once: true });
  preferenceWindows.set(win, cleanup);
}

export function unregisterPrefsWindows() {
  for (const cleanup of preferenceWindows.values())
    cleanup();
  releasePreferenceListeners();
  preferenceRegistration = undefined;
  for (const pane of (Zotero.PreferencePanes as any).pluginPanes.filter((pane: any) => pane.pluginID === addon.data.config.addonID))
    Zotero.PreferencePanes.unregister(pane.id);
}

export function registerPrefsScripts(_window: Window) {
  if (!addon.data.alive)
    return;
  if (!addon.data.prefs) {
    addon.data.prefs = {
      window: _window,
    };
  }
  else {
    addon.data.prefs.window = _window;
  }

  const pane = _window.document.getElementById(addon.data.config.addonRef);
  if (!pane || initializedPanes.has(pane))
    return;
  initializedPanes.add(pane);

  // 1. 各功能与业务设置卡片排布与组装
  setupAbbreviationSettings(pane);
  setupMenuSettings(pane);
  organizeSettingsModules(pane);
  setupEasyScholarSettings(pane);
  setupWorkflowSettings(pane);
  setupToolCenter(pane);
  setupDuplicateSettings(pane);
  setupFunctionCards(pane);
  setupCustomDataReset(pane);
  setupCustomDataFiles(pane);
  setupJournalDatabases(pane);
  setupJournalShareSettings(pane);
  setupDependencies(pane);
  setupEasyScholarConnectionTest(pane);
  setupShortcutInputs(pane);
  setupSettingsPanel(pane);
  setupBatchFeedback(pane);

  // 2. API 缓存清理动作
  const cacheButton = pane.querySelector("#metaref-clear-api-cache");
  if (cacheButton) {
    preferenceListeners(pane)(cacheButton, "command", async () => {
      if (cacheButton.hasAttribute("disabled"))
        return;
      const status = pane.querySelector("#metaref-api-cache-status")!;
      (cacheButton as HTMLButtonElement).disabled = true;
      status.textContent = getString("api-cache-clearing");
      try {
        clearEasyScholarCache();
        clearSemanticScholarCache();
        clearSupplementalJournalCache();
        await clearStoredServiceCache(undefined, true);
        if (pane.isConnected && addon.data.alive)
          status.textContent = getString("api-cache-cleared");
      }
      catch (error) {
        logger.error("API cache clear failed", error);
        if (pane.isConnected && addon.data.alive)
          status.textContent = getString("api-cache-clear-failed");
      }
      finally {
        cacheButton.removeAttribute("disabled");
      }
    });
  }

  // 3. 集成与迁移状态弹窗
  setupIntegrationStatus(pane);
}
