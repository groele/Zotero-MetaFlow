import type { JournalDatasetKind } from "../utils/journal-datasets";
import { journalDatabaseErrorMessage } from "../utils/journal-database-error";
import { exportJournalDatabase, validateJournalDatabase } from "../utils/journal-database-file";
import { getString } from "../utils/locale";
import { preferenceListeners } from "../utils/preference-listeners";
import { getPref, setPref } from "../utils/prefs";
import { refreshJournalInsights } from "./journal-pane";

export function setupJournalDatabases(pane: Element) {
  const listen = preferenceListeners(pane);
  const syncIndexSelects = () => {
    for (const select of pane.querySelectorAll<HTMLSelectElement>("select[data-index-policy]")) {
      const key = `insights.${select.dataset.indexPolicy}SourcePriority`;
      select.value = String(getPref(key as any, "local-only"));
    }
  };
  for (const select of pane.querySelectorAll<HTMLSelectElement>("select[data-index-policy]")) {
    const key = `insights.${select.dataset.indexPolicy}SourcePriority`;
    select.value = String(getPref(key as any, "local-only"));
    listen(select, "change", () => setPref(key as any, select.value));
  }
  listen(pane, "metaref-preferences-synced", syncIndexSelects);
  for (const kind of ["esi", "nature"] as JournalDatasetKind[]) {
    const key = kind === "esi" ? "insights.esiCustomDataPath" : "insights.natureCustomDataPath";
    const group = pane.querySelector(`[data-journal-database='${kind}']`)!;
    const status = group.querySelector<HTMLElement>(".journal-database-status")!;
    const buttons = [...group.querySelectorAll<HTMLButtonElement>("button")];
    const pathInput = group.querySelector<HTMLInputElement>("input[readonly]")!;
    let busy = false;
    for (const action of ["choose", "validate", "export", "reload", "reset"] as const) {
      const button = action === "reset"
        ? group.querySelector("[data-l10n-id='metaref-settings-custom-data-reset']")!
        : group.querySelector(`#metaref-${kind}-${action}-custom-data-button`)!;
      listen(button, "command", async () => {
        if (busy)
          return;
        busy = true;
        group.setAttribute("data-busy", "true");
        group.setAttribute("aria-busy", "true");
        buttons.forEach(button => button.disabled = true);
        status.textContent = getString("journal-database-working");
        try {
          if (action === "reset") {
            const result = await validateJournalDatabase(kind, "");
            setPref(key, "");
            pathInput.value = "";
            await refreshJournalInsights();
            status.textContent = getString("journal-database-valid", { args: { count: result.journals, source: getString("journal-database-builtin") } });
          }
          else if (action === "export") {
            const path = await new ztoolkit.FilePicker(getString("journal-database-export-title"), "save", [["JSON", "*.json"]], `metaref-${kind}-journals.json`).open();
            if (!path) {
              status.textContent = "";
              return;
            }
            await exportJournalDatabase(kind, path);
            status.textContent = getString("journal-database-exported", { args: { path } });
          }
          else {
            let path = getPref(key);
            if (action === "choose") {
              const selected = await new ztoolkit.FilePicker(getString("journal-database-choose-title"), "open", [["JSON", "*.json"], ["CSV", "*.csv"]], `metaref-${kind}-journals.json`).open();
              if (!selected) {
                status.textContent = "";
                return;
              }
              path = selected;
            }
            const result = await validateJournalDatabase(kind, path);
            if (action === "choose") {
              setPref(key, path);
              pathInput.value = path;
            }
            await refreshJournalInsights();
            status.textContent = getString("journal-database-valid", { args: { count: result.journals, source: path || getString("journal-database-builtin") } });
          }
        }
        catch (error) {
          status.textContent = getString("journal-database-error", { args: { error: journalDatabaseErrorMessage(error) } });
          if (action !== "choose" && action !== "export")
            await refreshJournalInsights().catch(refreshError => ztoolkit.log(refreshError));
        }
        finally {
          busy = false;
          group.removeAttribute("data-busy");
          group.removeAttribute("aria-busy");
          buttons.forEach(button => button.disabled = pathInput.disabled || (button.dataset.resetPath === "true" && !pathInput.value));
        }
      });
    }
  }
}

export function setupJournalShareSettings(pane: Element) {
  const listen = preferenceListeners(pane);
  const modeSelect = pane.querySelector<HTMLSelectElement>("#metaref-insights-share-mode");
  const formatSelect = pane.querySelector<HTMLSelectElement>("#metaref-insights-share-format");
  const formatRow = pane.querySelector<HTMLElement>("#metaref-insights-share-format-row");

  if (modeSelect) {
    modeSelect.value = String(getPref("insights.shareMode" as any, "silent"));
    const updateFormatVisibility = () => {
      const isModal = modeSelect.value === "modal";
      if (formatSelect) {
        formatSelect.disabled = isModal;
      }
      if (formatRow) {
        formatRow.hidden = isModal;
      }
    };
    updateFormatVisibility();
    listen(modeSelect, "change", () => {
      setPref("insights.shareMode" as any, modeSelect.value);
      updateFormatVisibility();
    });
  }

  if (formatSelect) {
    formatSelect.value = String(getPref("insights.shareSilentFormat" as any, "image"));
    listen(formatSelect, "change", () => {
      setPref("insights.shareSilentFormat" as any, formatSelect.value);
    });
  }
  listen(pane, "metaref-preferences-synced", () => {
    if (modeSelect) {
      modeSelect.value = String(getPref("insights.shareMode" as any, "silent"));
      const isModal = modeSelect.value === "modal";
      if (formatSelect)
        formatSelect.disabled = isModal;
      if (formatRow)
        formatRow.hidden = isModal;
    }
    if (formatSelect)
      formatSelect.value = String(getPref("insights.shareSilentFormat" as any, "image"));
  });
}
