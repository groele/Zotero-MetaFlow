import type { ReportInfo } from "../services/lint/reporter";

const publicationFields = new Set(["publicationTitle", "journalAbbreviation", "ISSN", "conferenceName", "proceedingsTitle"]);

export function isJournalFeedback(record: Pick<ReportInfo, "ruleID" | "field" | "code" | "level">) {
  if (record.code === "journal-summary")
    return false;
  return record.level === "error" || record.level === "warning"
    || /journal|publication|conference|easyscholar|query-esi|nature-index/.test(record.ruleID)
    || (record.field !== undefined && publicationFields.has(record.field));
}
