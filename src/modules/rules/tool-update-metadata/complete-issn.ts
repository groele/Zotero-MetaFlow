import { getString } from "../../../utils/locale";
import { defineRule } from "../rule-base";
import { extractIdentifiers } from "./identifiers";
import { resolveMissingISSN, wasISSNResolutionAttempted } from "./issn-resolver";

/** Runs after review so rejected or unavailable article metadata does not block ISSN. */
export const CompleteMissingISSN = defineRule({
  id: "tool-update-metadata",
  category: "tool",
  scope: "item",
  targetItemTypes: ["journalArticle"],
  async apply({ item, signal, debug, report }) {
    if (String(item.getField("ISSN") || "").trim())
      return;
    const original = ["DOI", "publicationTitle", "ISSN"].map(field => String(item.getField(field) || ""));
    const doi = extractIdentifiers(item).DOI;
    if (wasISSNResolutionAttempted(item, doi, original[1])) {
      report({ level: "warning", field: "ISSN", code: "issn-unresolved", message: getString("journal-issn-unresolved" as any) });
      return;
    }
    const resolved = await resolveMissingISSN({ doi, publicationTitle: original[1], signal, debug });
    signal?.throwIfAborted();
    if (!resolved) {
      report({ level: "warning", field: "ISSN", code: "issn-unresolved", message: getString("journal-issn-unresolved" as any) });
      return;
    }
    if (["DOI", "publicationTitle", "ISSN"].some((field, index) => String(item.getField(field) || "") !== original[index])) {
      report({ level: "warning", field: "ISSN", message: getString("rule-tool-update-metadata-edited", { args: { field: "ISSN / DOI / publicationTitle" } }) });
      return;
    }
    item.setField("ISSN", resolved.issn);
    report({ level: "info", field: "ISSN", source: resolved.source, message: getString("rule-tool-update-metadata-field-source", { args: { field: "ISSN", source: resolved.source } }) });
  },
});
