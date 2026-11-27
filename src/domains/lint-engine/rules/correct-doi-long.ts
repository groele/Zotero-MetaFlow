import { defineRule } from "../../../services/lint/rule-base";
import { watchItemFields } from "../../../utils/field-conflicts";
import { requestCachedGET } from "../../../utils/http";
import { getString } from "../../../utils/locale";

export const CorrectDOILong = defineRule({
  id: "correct-doi-long",
  scope: "field",
  targetItemField: "DOI",
  cooldown: 20, //  The rate limit is 50 requests per second.
  async apply({ item, debug, report, signal }) {
    const doi = item.getField("DOI");
    if (!doi)
      return;

    const cleanDOI = Zotero.Utilities.cleanDOI(doi);
    if (!cleanDOI)
      return;
    const unchanged = watchItemFields(item, ["DOI"], report);

    if (/^10\/\S+$/.test(cleanDOI)) {
      debug("ShortDOI detected, resolving to long DOI");
      const result = await makeRequest(cleanDOI, signal);
      if (!unchanged())
        return;
      const longDOI = getLongDOI(result);
      if (longDOI) {
        item.setField("DOI", longDOI);
        await ztoolkit.ExtraField.setExtraField(item, "short-doi", cleanDOI, { save: false });
      }
      else {
        report({
          level: "error",
          message: getString("rule-doi-unresolvable"),
        });
      }
    }
    else {
      debug("Already a long DOI; no resolution is needed");
    }
  },
});

const ErrorCodeMessage: Record<number, string> = {
  1: "Success",
  2: "Error. Something unexpected went wrong during DOI name resolution. (HTTP 500 Internal Server Error)",
  100: "Handle Not Found. (HTTP 404 Not Found)",
  200: "Values Not Found. The Handle Record exists but the required elements do not exist.",
};

async function makeRequest(doi: string, signal?: AbortSignal): Promise<Result> {
  const url = `https://doi.org/api/handles/${encodeURIComponent(doi)}`;
  const req = await requestCachedGET(url, {
    responseType: "json",
  }, signal);

  if (req.status !== 200) {
    throw new Error(`DOI API request failed: ${req.status}`);
  }

  const result: Result = req.response;
  if (result && result.responseCode !== 1) {
    throw new Error(`DOI resolve failed: ${ErrorCodeMessage[result.responseCode]}`);
  }

  return result;
}

function getLongDOI(result: Result): string | undefined {
  const longDOI = result.values
    .find(v => v.type === "HS_ALIAS")
    ?.data
    .value
    .toLocaleLowerCase();
  return longDOI;
}

/**
 *
 * @see https://www.doi.org/doi-handbook/HTML/rest-api-response-format.html
 *
 * @example
 *
 * GET: https://doi.org/api/handles/10/p54k
 * {
      "responseCode": 1,
      "handle": "10/p54k",
      "values": [
        {
          "index": 100,
          "type": "HS_ADMIN",
          "data": {
            "format": "admin",
            "value": {
              "handle": "0.NA/10",
              "index": 200,
              "permissions": "011111110010"
            }
          },
          "ttl": 86400,
          "timestamp": "2025-09-16T04:52:06Z"
        },
        {
          "index": 1,
          "type": "HS_ALIAS",
          "data": {
            "format": "string",
            "value": "10.1021/JACS.5C01100"
          },
          "ttl": 86400,
          "timestamp": "2025-09-16T04:52:06Z"
        }
      ]
    }
 *
 *
    GET https://doi.org/api/handles/10.1021/jacs.5c01100
    {
      "responseCode": 1,
      "handle": "10.1021/jacs.5c01100",
      "values": [
        {
          "index": 1,
          "type": "URL",
          "data": {
            "format": "string",
            "value": "https://pubs.acs.org/doi/10.1021/jacs.5c01100"
          },
          "ttl": 86400,
          "timestamp": "2025-02-28T14:08:23Z"
        },
        {
          "index": 700050,
          "type": "700050",
          "data": {
            "format": "string",
            "value": "2025031202241500560"
          },
          "ttl": 86400,
          "timestamp": "2025-03-12T09:29:26Z"
        },
        {
          "index": 100,
          "type": "HS_ADMIN",
          "data": {
            "format": "admin",
            "value": {
              "handle": "0.na/10.1021",
              "index": 200,
              "permissions": "111111110010"
            }
          },
          "ttl": 86400,
          "timestamp": "2025-02-28T14:08:23Z"
        }
      ]
    }
 */
interface Result {
  responseCode: number;
  values: {
    index: number;
    type: string | "URL" | "HS_ADMIN";
    data: {
      format: string;
      value: string;
      handle?: string;
    };
    ttl: number;
    timestamp: string;
  }[];
}
