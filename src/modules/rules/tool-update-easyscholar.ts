import type { EasyScholarField, EasyScholarRank } from "../../utils/easyscholar";
import { EASYSCHOLAR_EXTRA_ALIASES, EASYSCHOLAR_FIELD_DEFINITIONS, EASYSCHOLAR_OUTPUT_FIELDS, fetchEasyScholarRank, isEasyScholarFieldEnabled } from "../../utils/easyscholar";
import { watchItemFields } from "../../utils/field-conflicts";
import { extractValidISSNs } from "../../utils/journal-identity";
import { readJournalRankingIndex, saveJournalRankingIndex } from "../../utils/journal-ranking-index";
import { readJournalRankingValues } from "../../utils/journal-ranking-rows";
import { runJournalSource } from "../../utils/journal-source";
import { getString } from "../../utils/locale";
import { getPref } from "../../utils/prefs";
import { fetchSupplementalJournalRank } from "../../utils/supplemental-journals";
import { defineRule } from "./rule-base";

const EXTRA_FIELDS = EASYSCHOLAR_FIELD_DEFINITIONS.map(({ key, extraKey }) => [key, extraKey] as const);
const MEMBERSHIP_FIELDS = new Set<EasyScholarField>([
  "sci",
  "ssci",
  "ei",
  "utd24",
  "ft50",
  "cssci",
  "pku",
  "cscd",
  "technologyCore",
]);

function formatFieldValue(key: EasyScholarField, value: string): string {
  if (MEMBERSHIP_FIELDS.has(key)) {
    if (/^(?:否|no|false|0)$/i.test(value.trim()))
      return "";
    if (/^(?:是|yes|true|1)$/i.test(value.trim()))
      return "是";
  }
  return value.trim();
}

export function getEnabledEasyScholarFields(): Set<EasyScholarField> {
  return new Set(EASYSCHOLAR_OUTPUT_FIELDS.filter(isEasyScholarFieldEnabled));
}

export function clearSelectedJournalExtra(extra: string, fields: ReadonlySet<EasyScholarField>): string {
  const keys = new Set(EASYSCHOLAR_FIELD_DEFINITIONS.filter(field => fields.has(field.key))
    .flatMap(field => [field.extraKey, ...EASYSCHOLAR_EXTRA_ALIASES[field.key] || []]));
  return extra.split(/\r?\n/).filter((line) => {
    const separator = line.search(/[:：]/);
    return separator < 0 || !keys.has(line.slice(0, separator).trim());
  }).join("\n");
}

function isNegativeMembership(value: string): boolean {
  return /^(?:否|no|false|0)$/i.test(value.trim());
}

function mergeExtra(existing: string, data: EasyScholarRank, enabledFields: ReadonlySet<EasyScholarField> = new Set(EASYSCHOLAR_OUTPUT_FIELDS), mode: "blank" | "all" = "all"): string {
  const updates = new Map<string, string | null>();
  const populated = new Set(existing.split(/\r?\n/).flatMap((line) => {
    const separator = line.search(/[:：]/);
    return separator >= 0 && line.slice(separator + 1).trim() ? [line.slice(0, separator).trim()] : [];
  }));
  for (const [dataKey, extraKey] of EXTRA_FIELDS) {
    if (!enabledFields.has(dataKey))
      continue;
    if (mode === "blank" && [extraKey, ...EASYSCHOLAR_EXTRA_ALIASES[dataKey] || []].some(key => populated.has(key)))
      continue;
    const value = data[dataKey];
    if (value === undefined)
      continue;
    const formatted = formatFieldValue(dataKey, value);
    if (formatted) {
      for (const alias of EASYSCHOLAR_EXTRA_ALIASES[dataKey] || [])
        updates.set(alias, null);
      updates.set(extraKey, formatted);
    }
    else if (MEMBERSHIP_FIELDS.has(dataKey) && isNegativeMembership(value)) {
      for (const alias of EASYSCHOLAR_EXTRA_ALIASES[dataKey] || [])
        updates.set(alias, null);
      updates.set(extraKey, null);
    }
  }
  if (enabledFields.has("ccf") && enabledFields.has("ccfCustom") && data.ccfCustom && !data.ccf && !/^CCF\s*[:：]\s*\S/m.test(existing))
    updates.set("CCF", data.ccfCustom.trim());
  const lines = existing.split(/\r?\n/);
  const kept = lines.filter((line) => {
    const separator = line.search(/[:：]/);
    return separator < 0 || !updates.has(line.slice(0, separator).trim());
  });
  for (const [key, value] of updates) {
    if (value !== null)
      kept.push(`${key}: ${value}`);
  }
  return kept.filter((line, index, all) => line || index < all.length - 1).join("\n").trim();
}

export function summarizeEasyScholarChanges(before: string, after: string) {
  const keys = new Set<string>([...EXTRA_FIELDS.map(([, key]) => key), ...Object.values(EASYSCHOLAR_EXTRA_ALIASES).flat(), "CCF"]);
  const read = (text: string) => {
    const values = new Map<string, string[]>();
    for (const line of text.split(/\r?\n/)) {
      const separator = line.search(/[:：]/);
      const key = line.slice(0, separator).trim();
      if (separator < 0 || !keys.has(key))
        continue;
      values.set(key, [...values.get(key) || [], line.slice(separator + 1).trim()]);
    }
    return values;
  };
  const oldValues = read(before);
  const newValues = read(after);
  const summary = { added: 0, updated: 0, removed: 0 };
  for (const key of new Set([...oldValues.keys(), ...newValues.keys()])) {
    if (!oldValues.has(key))
      summary.added++;
    else if (!newValues.has(key))
      summary.removed++;
    else if (JSON.stringify(oldValues.get(key)) !== JSON.stringify(newValues.get(key)))
      summary.updated++;
  }
  return summary;
}

function summarizeRankingMaps(before: ReadonlyMap<EasyScholarField, string>, after: ReadonlyMap<EasyScholarField, string>) {
  const summary = { added: 0, updated: 0, removed: 0 };
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    if (!before.has(key))
      summary.added++;
    else if (!after.has(key))
      summary.removed++;
    else if (before.get(key) !== after.get(key))
      summary.updated++;
  }
  return summary;
}

export const ToolUpdateEasyScholar = defineRule<{ mode?: "blank" | "all" }>({
  id: "tool-update-easyscholar",
  scope: "item",
  category: "tool",
  cooldown: 0,
  timeout: 30_000,
  targetItemTypes: ["journalArticle", "conferencePaper"],
  getItemMenu: () => ({ l10nID: "rule-tool-update-easyscholar-menu-item" }),
  async apply({ item, options, debug, report, signal }) {
    const title = String(item.getField("publicationTitle") || item.getField("conferenceName") || item.getField("proceedingsTitle") || "").trim();
    if (!title) {
      report({ level: "warning", message: getString("rule-tool-update-easyscholar-no-title") });
      return;
    }
    const unchanged = watchItemFields(item, ["publicationTitle", "conferenceName", "proceedingsTitle"], report);
    const originalRankings = readJournalRankingIndex(item, readJournalRankingValues(String(item.getField("extra") || "")));
    const enabledFields = getEnabledEasyScholarFields();
    if (!enabledFields.size) {
      report({ level: "info", message: getString("rule-tool-update-easyscholar-disabled") });
      return;
    }
    const expectedISSNs = extractValidISSNs(item.getField("ISSN"));
    const needsEasyScholar = EASYSCHOLAR_FIELD_DEFINITIONS.some(field => field.source !== "supplemental" && enabledFields.has(field.key));
    const [result, supplemental] = await Promise.all([
      needsEasyScholar
        ? runJournalSource(sourceSignal => fetchEasyScholarRank(title, sourceSignal, expectedISSNs), signal)
            .catch(() => ({ status: "error" as const, message: getString("rule-tool-update-easyscholar-source-deadline") }))
        : Promise.resolve({ status: "skipped" as const }),
      fetchSupplementalJournalRank(title, enabledFields, signal, expectedISSNs),
    ]);
    signal?.throwIfAborted();
    if (!unchanged())
      return;
    for (const key of enabledFields) {
      if (!isEasyScholarFieldEnabled(key))
        enabledFields.delete(key);
    }
    if (!enabledFields.size)
      return;
    if (supplemental.errors.length)
      report({ level: "warning", message: getString("rule-tool-update-easyscholar-supplemental-failed", { args: { error: supplemental.errors.join("; ") } }) });
    const hasSupplemental = Object.values(supplemental.data).some(Boolean);
    if (result.status === "unconfigured") {
      report({ level: "warning", message: getString("rule-tool-update-easyscholar-unconfigured") });
      if (!hasSupplemental)
        return;
    }
    if (result.status === "not-found") {
      report({ level: "info", message: getString("rule-tool-update-easyscholar-not-found", { args: { title } }) });
      if (!hasSupplemental)
        return;
    }
    if (result.status === "error") {
      report({ level: "warning", message: getString("rule-tool-update-easyscholar-failed", { args: { error: result.message } }) });
      if (!hasSupplemental)
        return;
    }
    const data = { ...result.status === "success" ? result.data : {}, ...supplemental.data };
    const returned = EXTRA_FIELDS.filter(([key]) => data[key]?.trim()).length;
    const selected = EXTRA_FIELDS.filter(([key]) => enabledFields.has(key) && data[key]?.trim()).length;
    if (!selected)
      report({ level: "info", message: getString("rule-tool-update-easyscholar-no-selected-results") });
    const current = String(item.getField("extra") || "");
    const currentRankings = readJournalRankingIndex(item, readJournalRankingValues(current));
    const edited = [...enabledFields].filter(key => originalRankings.get(key) !== currentRankings.get(key));
    if (edited.length) {
      edited.forEach(key => enabledFields.delete(key));
      report({ level: "warning", message: getString("rule-fields-edited", { args: { fields: edited.join(", ") } }) });
    }
    const mode = options.mode || "all";
    const indexFields = new Set([...enabledFields].filter(key => mode !== "blank" || !originalRankings.has(key)));
    const persistence = await saveJournalRankingIndex(item, data, indexFields, mode);
    if (persistence?.sessionOnly)
      report({ level: "warning", code: "journal-index-session-only", message: getString("rule-tool-update-easyscholar-session-only") });
    if (!getPref("easyscholar.writeToExtra", false)) {
      const after = readJournalRankingIndex(item, readJournalRankingValues(current));
      const changes = summarizeRankingMaps(originalRankings, after);
      debug(`${title}: returned ${returned}, selected ${selected}; MetaFlow index changes: ${JSON.stringify(changes)}.`);
      report({ level: "info", code: "journal-summary", message: getString("rule-tool-update-easyscholar-summary", { args: { title, returned, selected, ...changes } }) });
      return;
    }
    const clearable = new Set(EASYSCHOLAR_FIELD_DEFINITIONS.filter(field => enabledFields.has(field.key)
      && (field.source === "supplemental" ? data[field.key] !== undefined : result.status === "success")).map(field => field.key));
    const base = getPref("easyscholar.clearExtraBeforeUpdate") && selected && options.mode !== "blank"
      ? clearSelectedJournalExtra(current, clearable)
      : current;
    const updated = mergeExtra(base, data, indexFields, mode);
    const changes = summarizeEasyScholarChanges(current, updated);
    const summary = getString("rule-tool-update-easyscholar-summary", { args: { title, returned, selected, ...changes } });
    if (updated === current.trim()) {
      report({ level: "info", code: "journal-summary", message: summary });
      return;
    }
    item.setField("extra", updated);
    debug(`${title}: returned ${returned}, selected ${selected}; Extra changes: ${JSON.stringify(changes)}.`);
    report({ level: "info", code: "journal-summary", message: summary });
  },
});

export { mergeExtra as mergeEasyScholarExtra };
