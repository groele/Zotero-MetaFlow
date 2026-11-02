import { getString } from "../utils/locale";
import { preferenceListeners } from "../utils/preference-listeners";
import { getPref, setPref } from "../utils/prefs";

export function setupAbbreviationSettings(pane: Element) {
  const group = pane.querySelector("#metaref-journal-abbreviation-settings");
  const rules = pane.querySelector("[data-l10n-id$='section-rules']")?.closest("groupbox");
  if (group && rules)
    pane.insertBefore(group, rules);
  const metrics = pane.querySelector("#metaref-easyscholar-settings");
  if (metrics && rules)
    pane.insertBefore(metrics, rules);
  for (const select of pane.querySelectorAll<HTMLSelectElement>("select[data-abbr-option]")) {
    const key = `rule.require-journal-abbr.${select.dataset.abbrOption}`;
    select.value = String(getPref(key as any, select.options[0].value));
    preferenceListeners(pane)(select, "change", () => setPref(key as any, select.value));
  }
}

export function setupIntegrationStatus(pane: Element) {
  const button = pane.querySelector("#metaref-integration-status");
  if (!button)
    return;
  preferenceListeners(pane)(button, "command", () => {
    const summary = Zotero.Prefs.get(`${addon.data.config.prefsPrefix}.integration.greenfrogMigrationSummary`, true);
    let migrated = 0;
    let skipped = 0;
    if (typeof summary === "string") {
      try {
        const parsed = JSON.parse(summary);
        migrated = Number.isFinite(parsed.copied) ? parsed.copied : 0;
        skipped = Array.isArray(parsed.skipped) ? parsed.skipped.length : 0;
      }
      catch {
        skipped = 1;
      }
    }
    const workflow = addon.data.lastAutomaticWorkflow;
    const stages = workflow?.stages.map(stage => getString("integration-stage-result", { args: {
      phase: getString(`integration-phase-${stage.phase}` as any),
      status: getString(`integration-state-${stage.status}` as any),
      saved: stage.saved || 0,
      failed: stage.failed || 0,
    } })).join("\n") || getString("integration-no-workflow");
    Zotero.alert(
      pane.ownerDocument!.defaultView!,
      getString("integration-status-button"),
      `${getString("integration-migration-result", { args: { migrated, skipped } })}\n\n${stages}\n\n${getString("integration-undo-description")}`,
    );
  });
}
