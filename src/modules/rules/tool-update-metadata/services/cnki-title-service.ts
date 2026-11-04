import { requestHTTP } from "../../../../utils/http";
import { titlesAgree } from "../policy";
import { defineService } from "./base-service";
import { doTranslate, transform } from "./translate-service";

// CNKI title lookup follows Green Frog's public search flow without copying its embedded cookies.
export const CnkiTitleService = defineService({
  id: "cnki-title-service",
  name: "CNKI title search",
  cooldown: 1000,
  shouldApply: ({ item, identifiers }) => !identifiers.DOI && /\p{Script=Han}/u.test(String(item.getField("title") || "")),
  async fetch({ item, signal }) {
    const title = String(item.getField("title") || "").replace(/<[^>]*>/g, "").trim();
    const query = { Platform: "", DBCode: "CFLS", KuaKuCode: "CJFQ,CCND,CIPD,CDMD", QNode: { QGroup: [{ Key: "Subject", Logic: 1, Items: [{ Title: "篇名", Name: "TI", Value: title, Operate: "%=", BlurType: "" }], ChildItems: [] }] } };
    const body = new URLSearchParams({ IsSearch: "true", QueryJson: JSON.stringify(query), PageName: "defaultresult", DBCode: "CFLS", CurPage: "1", RecordsCntPerPage: "20", CurDisplayMode: "listmode", CurrSortField: "RELEVANT", CurrSortFieldType: "desc", IsSentenceSearch: "false" }).toString();
    const response = await requestHTTP("POST", "https://kns.cnki.net/kns8/Brief/GetGridTableHtml", { body, headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" } }, signal);
    const Parser = ((typeof Zotero !== "undefined" && typeof Zotero.getMainWindow === "function" && (Zotero.getMainWindow() as any)?.DOMParser) || DOMParser) as typeof DOMParser;
    const doc = new Parser().parseFromString(response.responseText || "", "text/html");
    const candidates = [...doc.querySelectorAll<HTMLAnchorElement>("a[href]")].filter(anchor => titlesAgree(title, anchor.textContent || ""));
    const urls = [...new Set(candidates.map(anchor => new URL(anchor.getAttribute("href")!, "https://kns.cnki.net/").href))]
      .filter((value) => {
        const url = new URL(value);
        return url.protocol === "https:" && (url.hostname === "cnki.net" || url.hostname.endsWith(".cnki.net"));
      });
    if (urls.length !== 1)
      return undefined;
    signal?.throwIfAborted();
    const documents = await Zotero.HTTP.processDocuments(urls[0], doc => doc);
    signal?.throwIfAborted();
    const translate = new Zotero.Translate.Web();
    translate.setDocument(documents[0]);
    return await doTranslate(translate);
  },
  transform,
});
