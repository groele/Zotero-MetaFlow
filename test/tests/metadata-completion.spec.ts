import { assert } from "chai";
import { config } from "../../package.json";
import response from "../data/crossref-nanolett-waveguides.json";

describe("missing metadata from the captured Nano Letters record", function () {
  this.timeout(30_000);
  const plugin = () => (Zotero as any)[config.addonInstance];
  const prefs = new Map<string, unknown>();
  const items: Zotero.Item[] = [];
  const title = "Polarization engineering of second-harmonic generation in 3R-MoS<sub>2</sub> waveguides";
  let originalRequest: typeof Zotero.HTTP.request;
  let calls = 0;
  const pref = (key: string, value: boolean | string) => {
    const full = `${config.prefsPrefix}.${key}`;
    if (!prefs.has(full))
      prefs.set(full, Zotero.Prefs.get(full, true));
    Zotero.Prefs.set(full, value, true);
  };

  before(function () {
    for (const key of ["lint.onAdded", "workflow.updateVersions", "workflow.formatAfterUpdate", "workflow.tldrEnabled", "metadata.updateJournalInfo", "workflow.reviewDuplicatesOnUpdate"])
      pref(key, false);
    pref("workflow.updateBibliographic", true);
    pref("metadata.repairCreators", true);
    pref("rule.tool-update-metadata.option.mode", "blank");
    originalRequest = Zotero.HTTP.request;
    Zotero.HTTP.request = (async (method: any, url: string, options: any) => {
      const target = new URL(url);
      if (["localhost", "127.0.0.1"].includes(target.hostname))
        return originalRequest.call(Zotero.HTTP, method, url, options);
      if (target.hostname === "api.crossref.org") {
        calls++;
        const text = JSON.stringify(response);
        return { status: 200, response: text, responseText: text };
      }
      throw new Error(`Unexpected fixture request: ${target.origin}${target.pathname}`);
    }) as any;
  });

  after(async function () {
    Zotero.HTTP.request = originalRequest;
    for (const item of items)
      await item.eraseTx();
    for (const [key, value] of prefs) {
      if (value === undefined)
        Zotero.Prefs.clear(key, true);
      else
        Zotero.Prefs.set(key, value as any, true);
    }
  });

  async function create(doi = response.message.DOI) {
    const item = new Zotero.Item("journalArticle");
    const creators = response.message.author.map(author => ({ creatorType: "author" as const, firstName: author.given, lastName: author.family }));
    creators[0].firstName = "";
    creators[1].lastName = "";
    item.setCreators(creators);
    for (const [field, value] of Object.entries({ title, DOI: doi, date: "2026-07-22", volume: "26", issue: "28", pages: "9051-9058", journalAbbreviation: "Nano Lett.", abstractNote: "Keep the existing local abstract." }))
      item.setField(field as any, value);
    await item.saveTx({ skipSelect: true });
    items.push(item);
    return item;
  }

  it("fills journal and complete authors through the actual core update and native save boundary", async function () {
    const item = await create();
    const result = await plugin().hooks.onLintInBatch("tool-update-metadata", [item], { core: true });
    await item.reload(["itemData", "creators"], true);
    assert.equal(item.getField("publicationTitle"), "Nano Letters");
    assert.equal(item.getCreators()[0].firstName, "Renkang");
    assert.equal(item.getCreators()[0].lastName, "Song");
    assert.equal(item.getCreators()[1].firstName, "Junbo");
    assert.equal(item.getCreators()[1].lastName, "Xu");
    assert.lengthOf(item.getCreators(), response.message.author.length);
    assert.equal(item.getField("title", false, true), title);
    assert.equal(item.getField("date"), "2026-07-22");
    assert.equal(item.getField("pages"), "9051-9058");
    assert.equal(item.getField("abstractNote"), "Keep the existing local abstract.");
    assert.isAbove(result.saved, 0);
    assert.isTrue(result.records.some((record: any) => record.field === "publicationTitle"));
  });

  it("fills the missing journal without modifying creators when author repair is disabled", async function () {
    pref("metadata.repairCreators", false);
    const item = await create();
    const creators = JSON.stringify(item.getCreators());
    await plugin().hooks.onLintInBatch("tool-update-metadata", [item], { core: true });
    await item.reload(["itemData", "creators"], true);
    assert.equal(item.getField("publicationTitle"), "Nano Letters");
    assert.equal(JSON.stringify(item.getCreators()), creators);
    pref("metadata.repairCreators", true);
  });

  it("does not fill fields using a response for a different DOI", async function () {
    const item = await create("10.1234/missing-field-identity-guard");
    const original = JSON.stringify(item.toJSON());
    const result = await plugin().hooks.onLintInBatch("tool-update-metadata", [item], { core: true });
    assert.equal(JSON.stringify(item.toJSON()), original);
    assert.equal(result.saved, 0);
    assert.isTrue(result.records.some((record: any) => record.code === "metadata-auto-blocked"));
  });

  it("keeps the bibliographic update switch authoritative", async function () {
    pref("workflow.updateBibliographic", false);
    const item = await create();
    const before = calls;
    await plugin().hooks.onLintInBatch("tool-update-metadata", [item], { core: true });
    assert.equal(calls, before);
    assert.isEmpty(String(item.getField("publicationTitle") || ""));
    pref("workflow.updateBibliographic", true);
  });
});
