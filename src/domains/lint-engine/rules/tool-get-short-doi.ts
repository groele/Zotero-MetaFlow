import { defineRule } from "../../../services/lint/rule-base";
import { watchItemFields } from "../../../utils/field-conflicts";
import { requestCachedGET } from "../../../utils/http";
import { getString } from "../../../utils/locale";

/**
 *
 * @example
 *
 * GET https://shortdoi.org/10.1021/jacs.5c01100?format=json
 * {
 *   "DOI":"10.1021/jacs.5c01100",
 *   "ShortDOI":"10/p54k",
 *   "IsNew":false
 * }
 */
interface Result {
  DOI: string;
  ShortDOI: string;
  IsNew: boolean;
}

export const ToolGetShortDOI = defineRule({
  id: "tool-get-short-doi",
  scope: "field",
  targetItemField: "DOI",
  category: "tool",
  targetItemTypes: ["journalArticle", "conferencePaper"],
  cooldown: 20, //  The rate limit is 50 requests per second.

  async apply({ item, report, debug, signal }) {
    const doi = item.getField("DOI");
    if (!doi || typeof doi !== "string") {
      report({ level: "warning", message: getString("rule-doi-missing") });
      return;
    }

    const cleanDOI = Zotero.Utilities.cleanDOI(doi);
    if (!cleanDOI) {
      report({ level: "warning", message: getString("rule-doi-invalid") });
      return;
    }

    const exists = ztoolkit.ExtraField.getExtraField(item, "short-doi");
    if (exists) {
      return;
    }

    const url = `https://shortdoi.org/${encodeURIComponent(cleanDOI)}?format=json`;
    const unchanged = watchItemFields(item, ["DOI"], report);
    const req = await requestCachedGET(url, {}, signal);

    if (!unchanged() || ztoolkit.ExtraField.getExtraField(item, "short-doi") !== exists)
      return;

    if (req.status !== 200) {
      report({ level: "warning", message: getString("rule-short-doi-failed", { args: { status: req.status } }) });
      return;
    }

    if (!req.responseText) {
      return;
    }

    const json: Result = JSON.parse(req.responseText);
    if (json.ShortDOI) {
      debug("ShortDOI obtained:", json.ShortDOI);
      await ztoolkit.ExtraField.setExtraField(item, "short-doi", json.ShortDOI, { save: false });
    }
    else {
      report({ level: "warning", message: getString("rule-short-doi-empty") });
    }
  },
});
