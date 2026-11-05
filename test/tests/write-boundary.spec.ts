import { assert } from "chai";
import { config } from "../../package.json";
import { migrateLegacyTLDR } from "../../src/modules/tldr-migration";

describe("native write eligibility during asynchronous rules", function () {
  this.timeout(30_000);

  it("does not modify an item trashed while its rule waits for an external response", async function () {
    const key = `${config.prefsPrefix}.lint.onAdded`;
    const previous = Zotero.Prefs.get(key, true);
    Zotero.Prefs.set(key, false, true);
    const item = new Zotero.Item("journalArticle");
    item.setField("title", "Native write boundary fixture");
    await item.saveTx({ skipSelect: true });
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(resolve => release = resolve);
    const started = new Promise<void>(resolve => entered = resolve);
    const plugin = (Zotero as any)[config.addonInstance];
    const pending = plugin.runner.add({ items: [item], silent: true, rules: [{ id: "local-write-boundary", scope: "item", async apply({ item }: any) {
      entered();
      await gate;
      item.setField("title", "Forbidden late title");
    } }] });
    try {
      await started;
      await Zotero.Items.trashTx([item.id]);
      release();
      const result = await pending;
      await item.reload(["primaryData", "itemData"], true);
      assert.isTrue(item.deleted);
      assert.equal(item.getField("title"), "Native write boundary fixture");
      assert.equal(result.saved, 0);
      assert.equal(result.failed, 1);
    }
    finally {
      release();
      await pending;
      await item.eraseTx();
      if (previous === undefined)
        Zotero.Prefs.clear(key, true);
      else
        Zotero.Prefs.set(key, previous as boolean, true);
    }
  });

  it("moves legacy Extra into a durable native child note without losing unrelated fields", async function () {
    const key = `${config.prefsPrefix}.lint.onAdded`;
    const previous = Zotero.Prefs.get(key, true);
    Zotero.Prefs.set(key, false, true);
    const item = new Zotero.Item("journalArticle");
    item.setField("title", "Legacy summary boundary fixture");
    const original = "TLDR: Native durable summary\nCitation Key: retained";
    item.setField("extra", original);
    await item.saveTx({ skipSelect: true });
    try {
      assert.isTrue(await migrateLegacyTLDR(item, "Native durable summary", original, () => true));
      await item.reload(["itemData", "childItems"], true);
      assert.equal(item.getField("extra"), "Citation Key: retained");
      const notes = Zotero.Items.get(item.getNotes());
      assert.lengthOf(notes, 1);
      assert.include(notes[0].getNote(), "Native durable summary");
    }
    finally {
      await item.eraseTx();
      Zotero.Prefs.set(key, previous as boolean, true);
    }
  });
});
