import { assert } from "chai";
import { config } from "../../package.json";
import { Rules } from "../../src/modules/rules";

describe("commercial metadata evidence and import consistency", function () {
  this.timeout(60_000);
  const plugin = () => (Zotero as any)[config.addonInstance];
  const saved = new Map<string, unknown>();
  const created: number[] = [];
  let Search: typeof Zotero.Translate.Search;
  let request: typeof Zotero.HTTP.request;
  let calls = 0;
  const pref = (key: string, value: boolean | number | string) => {
    const name = `${config.prefsPrefix}.${key}`;
    if (!saved.has(name))
      saved.set(name, Zotero.Prefs.get(name, true));
    Zotero.Prefs.set(name, value, true);
  };
  const create = async (doi = "10.1234/commercial-evidence") => {
    const item = new Zotero.Item("journalArticle");
    item.setField("title", "Commercial metadata fixture");
    item.setField("DOI", doi);
    await item.saveTx();
    created.push(item.id);
    return item;
  };

  beforeEach(function () {
    Search = Zotero.Translate.Search;
    request = Zotero.HTTP.request;
    Zotero.HTTP.request = (async (method: string, url: string, options: any) => {
      if (new URL(url).hostname === "localhost")
        return request.call(Zotero.HTTP, method, url, options);
      throw new Error("Unexpected external request in controlled metadata tests");
    }) as any;
    calls = 0;
    for (const rule of Rules.getStandard())
      pref(`rule.${rule.id}`, false);
    for (const key of ["lint.onAdded", "lint.notify", "workflow.formatAfterUpdate", "metadata.updateJournalInfo", "workflow.reviewDuplicatesOnUpdate", "metadata.repairCreators", "workflow.scanPDF", "workflow.searchTitle", "easyscholar.autoUpdateOnAdded"])
      pref(key, false);
    pref("workflow.updateBibliographic", true);
    pref("duplicates.defaultAction", "cancel");
    Zotero.Translate.Search = class {
      setIdentifier() {}
      setSearch() {}
      setTranslator() {}
      async getTranslators() { return ["controlled"]; }
      async translate() {
        calls++;
        return [{ itemType: "journalArticle", title: "Commercial metadata fixture", DOI: "10.1234/commercial-evidence", date: "2026", publicationTitle: "Commercial Journal", creators: [{ creatorType: "author", firstName: "Jane", lastName: "Doe" }] }];
      }
    } as any;
  });

  afterEach(async function () {
    pref("lint.onAdded", false);
    Zotero.Translate.Search = Search;
    Zotero.HTTP.request = request;
    await plugin().runner.add({ items: [], rules: [], silent: true });
    for (const id of created.splice(0).reverse()) {
      const item = await Zotero.Items.getAsync(id);
      if (item)
        await item.eraseTx();
    }
    for (const [key, value] of saved) {
      if (value === undefined)
        Zotero.Prefs.clear(key, true);
      else Zotero.Prefs.set(key, value as any, true);
    }
    saved.clear();
  });

  it("does not let a shared DOI response upgrade PDF evidence into an explicit item identifier", async function () {
    const explicit = await create();
    const pdfOnly = await create("");
    const fixture = Zotero.Prefs.get("metaref.test.fixturePath", true) as string;
    const attachment = await Zotero.Attachments.importFromFile({ file: PathUtils.join(fixture, "pages-three.pdf"), parentItemID: pdfOnly.id });
    await IOUtils.writeUTF8(Zotero.Fulltext.getItemCacheFile(attachment).path, "DOI: 10.1234/commercial-evidence");
    pref("workflow.scanPDF", true);
    const result = await plugin().hooks.onLintInBatch("tool-update-metadata", [explicit, pdfOnly], { review: true });
    assert.equal(explicit.getField("date"), "2026");
    assert.equal(pdfOnly.getField("DOI"), "", "the PDF candidate still requires independent year or author evidence");
    assert.equal(pdfOnly.getField("date"), "");
    assert.isTrue(result.records.some((row: any) => row.itemID === pdfOnly.id && row.code === "metadata-auto-evidence"));
    assert.equal(calls, 1);
  });

  it("shares a failed lookup within one batch without permanently caching the failure", async function () {
    const items = [await create(), await create(), await create()];
    Zotero.Translate.Search = class {
      setIdentifier() {}
      setTranslator() {}
      async getTranslators() { return ["controlled"]; }
      async translate() {
        calls++;
        throw new Error("Controlled provider outage");
      }
    } as any;
    await plugin().hooks.onLintInBatch("tool-update-metadata", items, { review: true });
    assert.equal(calls, 1, "the same failed request is not repeated for duplicate identifiers");
    await plugin().hooks.onLintInBatch("tool-update-metadata", items, { review: true });
    assert.equal(calls, 2, "a new user command retries the lookup");
  });

  it("respects the disabled author option during automatic import", async function () {
    const item = await create();
    pref("metadata.autoUpdateOnAdded", true);
    pref("lint.onAdded", true);
    await plugin().hooks.onNotify("add", "item", [item.id], {});
    assert.equal(item.getField("date"), "2026");
    assert.isEmpty(item.getCreators(), "automatic import uses the same author policy as manual filling");
    assert.isNull(Zotero.getMainWindow().document.getElementById("metaref-metadata-review"));
  });

  it("skips a title-only lookup locally when no independent corroboration can exist", async function () {
    const item = await create("");
    pref("workflow.searchTitle", true);
    const result = await plugin().hooks.onLintInBatch("tool-update-metadata", [item], { review: true });
    assert.equal(calls, 0);
    assert.equal(item.getField("DOI"), "");
    assert.isTrue(result.records.some((row: any) => row.code === "metadata-auto-evidence"));
  });

  it("preserves disabled authors even for an explicit overwrite-mode rule call", async function () {
    const item = await create();
    const creators = [{ creatorType: "author" as const, firstName: "Original", lastName: "Doe" }];
    item.setCreators(creators);
    await item.saveTx();
    pref("rule.tool-update-metadata.option.mode", "all");
    await plugin().hooks.onLintInBatch("tool-update-metadata", [item]);
    assert.deepEqual((item.toJSON() as any).creators, creators);
    assert.equal(item.getField("date"), "2026");
  });

  it("does not share a context-dependent title rejection with another year's item", async function () {
    const earlier = await create("");
    const matching = await create("");
    const creators = [{ creatorType: "author" as const, firstName: "Jane", lastName: "Doe" }];
    earlier.setField("date", "2025");
    earlier.setCreators(creators);
    matching.setField("date", "2026");
    matching.setCreators(creators);
    await earlier.saveTx();
    await matching.saveTx();
    pref("workflow.searchTitle", true);
    await plugin().hooks.onLintInBatch("tool-update-metadata", [earlier, matching], { review: true });
    assert.equal(earlier.getField("DOI"), "");
    assert.equal(matching.getField("DOI"), "10.1234/commercial-evidence");
    assert.equal(calls, 2);
  });

  it("bounds concurrent metadata preparation and preserves each identifier's result", async function () {
    pref("lint.numConcurrent", 4);
    let active = 0;
    let maximum = 0;
    Zotero.Translate.Search = class {
      identifiers: any;
      setIdentifier(value: any) { this.identifiers = value; }
      setTranslator() {}
      async getTranslators() { return ["controlled"]; }
      async translate() {
        calls++;
        maximum = Math.max(maximum, ++active);
        await Zotero.Promise.delay(250);
        active--;
        return [{ itemType: "journalArticle", title: "Commercial metadata fixture", DOI: this.identifiers.DOI, date: "2026" }];
      }
    } as any;
    const items = [];
    for (let index = 0; index < 6; index++)
      items.push(await create(`10.1234/commercial-concurrent-${index}`));
    const result = await plugin().hooks.onLintInBatch("tool-update-metadata", items, { review: true });
    assert.equal(calls, 6);
    assert.isAbove(maximum, 1);
    assert.isAtMost(maximum, 4);
    assert.equal(result.saved, 6);
    items.forEach((item, index) => {
      assert.equal(item.getField("DOI"), `10.1234/commercial-concurrent-${index}`);
      assert.equal(item.getField("date"), "2026");
    });
  });
});
