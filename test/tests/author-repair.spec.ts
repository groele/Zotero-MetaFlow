// autocorrect-disable
import { assert } from "chai";
import { config } from "../../package.json";
import { Rules } from "../../src/modules/rules";

describe("manual author repair in both MetaFlow actions", function () {
  this.timeout(30_000);
  const plugin = () => (Zotero as any)[config.addonInstance];
  const savedPrefs = new Map<string, unknown>();
  const items: Zotero.Item[] = [];
  const authors: _ZoteroTypes.Item.CreatorJSON[] = [{ creatorType: "author", firstName: "Ada", lastName: "RepairFixtureLovelace" }, { creatorType: "author", firstName: "Grace", lastName: "RepairFixtureHopper" }];
  let Search: typeof Zotero.Translate.Search;
  let translations = 0;
  const pref = (key: string, value: boolean | string) => {
    const full = `${config.prefsPrefix}.${key}`;
    if (!savedPrefs.has(full))
      savedPrefs.set(full, Zotero.Prefs.get(full, true));
    Zotero.Prefs.set(full, value, true);
  };

  before(function () {
    pref("lint.onAdded", false);
    pref("metadata.repairCreators", true);
    pref("workflow.updateMetadata", false);
    pref("workflow.remoteAuthorsOnCheck", true);
    pref("workflow.updateJournalRankings", false);
    pref("rule.tool-update-metadata.option.mode", "blank");
    for (const rule of Rules.getStandard())
      pref(`rule.${rule.id}`, rule.id === "require-creators");
    Search = Zotero.Translate.Search;
    Zotero.Translate.Search = class {
      setSearch() {}
      setIdentifier() {}
      setTranslator() {}
      async getTranslators() { return [{}]; }
      async translate(options: any) {
        assert.isFalse(options.libraryID);
        translations++;
        return [{ itemType: "journalArticle", DOI: "10.1234/author-repair", title: "Author repair regression", date: "2025", publicationTitle: "Verified journal", creators: authors }];
      }
    } as any;
  });

  after(async function () {
    Zotero.Translate.Search = Search;
    for (const item of items)
      await item.eraseTx();
    for (const [key, value] of savedPrefs) {
      if (value === undefined)
        Zotero.Prefs.clear(key, true);
      else
        Zotero.Prefs.set(key, value as string | boolean, true);
    }
  });
  const create = async (doi = true) => {
    const item = new Zotero.Item("journalArticle");
    item.setField("title", "Author repair regression");
    item.setField("date", "2024");
    item.setField("publicationTitle", "Manual journal");
    if (doi)
      item.setField("DOI", "10.1234/author-repair");
    await item.saveTx();
    items.push(item);
    return item;
  };

  it("restores deleted or incorrect authors through tool-update-metadata while preserving ordinary fields", async function () {
    const item = await create();
    for (const existing of [[], [authors[0]], [{ creatorType: "author", lastName: "Incorrect surname" }]]) {
      item.setCreators(existing as _ZoteroTypes.Item.CreatorJSON[]);
      await item.saveTx();
      await plugin().hooks.onLintInBatch("tool-update-metadata", [item]);
      await item.reload(["itemData", "creators"], true);
      assert.deepEqual((item.toJSON() as any).creators, authors);
      assert.equal(item.getField("date"), "2024");
      assert.equal(item.getField("publicationTitle"), "Manual journal");
      assert.equal(plugin().runner.lastResult.failed, 0);
      assert.isTrue(plugin().runner.lastResult.changes.some((change: any) => change.field === "creators"));
    }
  });

  it("supports identity-checked title lookup when the DOI is absent", async function () {
    const item = await create(false);
    await plugin().hooks.onLintInBatch("tool-update-metadata", [item]);
    assert.deepEqual((item.toJSON() as any).creators, authors);
    assert.equal(item.getField("DOI"), "10.1234/author-repair", "online metadata update fills the independently verified missing DOI");
  });

  it("includes journal rankings in metadata updates and obeys blank versus all mode", async function () {
    const request = Zotero.HTTP.request;
    const writeToExtra = Zotero.Prefs.get(`${config.prefsPrefix}.easyscholar.writeToExtra`, true) === true;
    let requests = 0;
    pref("metadata.updateJournalInfo", true);
    pref("easyscholar.secretKey", "unified-metadata-isolated-key");
    pref("easyscholar.writeToExtra", true);
    pref("easyscholar.fields.jcr", true);
    pref("easyscholar.fields.impactFactor", true);
    Zotero.HTTP.request = (async (method: string, url: string, options: any) => {
      if (new URL(url).hostname !== "www.easyscholar.cc")
        return request.call(Zotero.HTTP, method, url, options);
      requests++;
      return { status: 200, responseText: JSON.stringify({ code: 200, data: { officialRank: { all: { sci: "Q1", sciif: "8.4" } } } }) };
    }) as any;
    try {
      const item = await create();
      item.setField("extra", "JCR 分区: Q3\nManual note");
      await item.saveTx();
      await plugin().hooks.onLintInBatch("tool-update-metadata", [item]);
      assert.include(item.getField("extra"), "JCR 分区: Q3");
      assert.include(item.getField("extra"), "8.4");
      assert.equal(requests, 1);
      pref("rule.tool-update-metadata.option.mode", "all");
      await plugin().hooks.onLintInBatch("tool-update-metadata", [item]);
      assert.include(item.getField("extra"), "JCR 分区: Q1");
      assert.include(item.getField("extra"), "Manual note");
      assert.equal(requests, 2, "the changed journal title uses its own response cache entry");
      await plugin().hooks.onLintInBatch("tool-update-metadata", [item]);
      assert.equal(requests, 2, "repeated metadata updates reuse journal responses");
    }
    finally {
      Zotero.HTTP.request = request;
      pref("metadata.updateJournalInfo", false);
      pref("easyscholar.writeToExtra", writeToExtra);
      pref("rule.tool-update-metadata.option.mode", "blank");
    }
  });

  it("respects the switch when remote author repair is disabled", async function () {
    pref("metadata.repairCreators", false);
    try {
      const item = await create();
      const partial = [authors[0]];
      item.setCreators(partial);
      await item.saveTx();
      const before = translations;
      await plugin().hooks.onLintInBatch("standard", [item]);
      assert.equal(translations, before);
      await plugin().hooks.onLintInBatch("tool-update-metadata", [item]);
      assert.deepEqual((item.toJSON() as any).creators, partial);
    }
    finally { pref("metadata.repairCreators", true); }
  });
});
