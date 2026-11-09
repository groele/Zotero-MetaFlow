import { assert } from "chai";
import { config } from "../../package.json";
import { EASYSCHOLAR_FIELD_DEFINITIONS } from "../../src/utils/easyscholar";
import { withThrottle } from "../../src/utils/throttle";

describe("system recovery and cancellation safety", function () {
  this.timeout(45_000);
  const plugin = () => (Zotero as any)[config.addonInstance];
  const created: Zotero.Item[] = [];
  let auto: unknown;

  before(function () {
    auto = Zotero.Prefs.get(`${config.prefsPrefix}.lint.onAdded`, true);
    Zotero.Prefs.set(`${config.prefsPrefix}.lint.onAdded`, false, true);
  });

  after(async function () {
    for (const item of created)
      await item.eraseTx();
    if (auto === undefined)
      Zotero.Prefs.clear(`${config.prefsPrefix}.lint.onAdded`, true);
    else
      Zotero.Prefs.set(`${config.prefsPrefix}.lint.onAdded`, auto as boolean, true);
  });
  const wait = async (check: () => boolean) => {
    for (let i = 0; i < 200; i++) {
      if (check())
        return;
      await Zotero.Promise.delay(25);
    }
    throw new Error("System safety acceptance timed out");
  };

  for (const field of ["extra", "title"]) {
    it(`preserves a concurrently committed ${field} after a real SQLite transaction rollback`, async function () {
      const item = new Zotero.Item("journalArticle");
      item.setField("title", "Original transaction title");
      await item.saveTx();
      created.push(item);
      const transaction = Zotero.DB.executeTransaction;
      let inject = true;
      (Zotero.DB as any).executeTransaction = async function (fn: () => Promise<void>, ...args: unknown[]) {
        if (!inject)
          return (transaction as any).call(this, fn, ...args);
        inject = false;
        try {
          await transaction.call(this, async () => {
            await fn();
            throw new Error("Injected transaction rollback");
          });
        }
        catch (error) {
          assert.include(String(error), "Injected transaction rollback");
        }
        await item.reload(["primaryData", "itemData"], true);
        item.setField(field, "New manual value");
        await transaction.call(this, () => item.save({ skipSelect: true }));
        throw new Error("Another writer committed before retry");
      };
      try {
        const apply = ({ item: target }: { item: Zotero.Item }) => {
          target.setField("title", "Formatted transaction title");
        };
        const result = await plugin().runner.add({ items: [item], silent: true, rules: [{ id: "system-save-retry", scope: "item", apply }] });
        await item.reload(["primaryData", "itemData"], true);
        assert.equal(item.getField(field), "New manual value");
        if (field === "extra") {
          assert.equal(item.getField("title"), "Formatted transaction title");
          assert.equal(result.saved, 1);
          assert.equal(result.failed, 0);
        }
        else {
          assert.equal(result.saved, 0);
          assert.equal(result.failed, 1);
          const conflict = result.records.find((record: any) => record.code === "item-save-conflict");
          assert.exists(conflict);
          assert.notInclude(conflict.message, "report-save-conflict");
          assert.isFalse(result.changes[0].saved);
        }
      }
      finally { Zotero.DB.executeTransaction = transaction; }
    });
  }

  it("cancels queued Gecko-signal work before its cooldown and lets the next request use the freed slot", async function () {
    const main = Zotero.getMainWindow() as unknown as Window & typeof globalThis;
    const starts: string[] = [];
    const request = withThrottle(async (name: string, _signal?: AbortSignal) => {
      starts.push(name);
    }, 100, (_name, signal) => signal);
    await request("first");
    const controller = new main.AbortController();
    const abandoned = request("cancelled", controller.signal).then(() => false, () => true);
    controller.abort(new Error("Native cancel"));
    assert.isTrue(await abandoned);
    await request("next");
    assert.deepEqual(starts, ["first", "next"]);
  });

  it("reports a disk-cache clear failure in native preferences and re-enables retry", async function () {
    const entry = (Zotero.PreferencePanes as any).pluginPanes.find((pane: any) => pane.pluginID === config.addonID);
    const win = Zotero.Utilities.Internal.openPreferences(entry.id)! as Window & typeof globalThis;
    await wait(() => Boolean(win.document.getElementById("metaref-clear-api-cache")));
    await (win as any).Zotero_Preferences.waitForFirstPaneLoad();
    const button = win.document.getElementById("metaref-clear-api-cache")!;
    const status = win.document.getElementById("metaref-api-cache-status")!;
    await wait(() => win.getComputedStyle(button)?.fontSize === "14px");
    const buttonStyle = win.getComputedStyle(button);
    const statusStyle = win.getComputedStyle(status);
    if (!buttonStyle || !statusStyle)
      throw new Error("Cache controls have no computed style");
    assert.equal(buttonStyle.fontSize, "14px");
    assert.isAtLeast(Number.parseFloat(statusStyle.fontSize), 13);
    const profile = (Zotero as any).Profile.dir as string;
    assert.include(profile.replaceAll("\\", "/"), "/.scaffold/test/profile");
    const cacheDirectory = PathUtils.join(profile, "zotero-metaflow-cache");
    const file = PathUtils.join(cacheDirectory, "api-responses-v1.json");
    const obstruction = `${file}.tmp`;
    assert.equal(PathUtils.parent(obstruction), cacheDirectory);
    assert.isFalse(await IOUtils.exists(obstruction));
    const previous = await IOUtils.exists(file) ? await IOUtils.readUTF8(file) : undefined;
    await IOUtils.makeDirectory(obstruction);
    assert.equal((await IOUtils.stat(obstruction)).type, "directory");
    try {
      button.dispatchEvent(new win.Event("command", { bubbles: true }));
      assert.isTrue(button.hasAttribute("disabled"));
      await wait(() => !button.hasAttribute("disabled"));
      assert.match(status.textContent || "", /磁盘缓存|disk cache/);
      if (previous !== undefined)
        assert.equal(await IOUtils.readUTF8(file), previous, "failed clear preserves the existing disk cache");
      await IOUtils.remove(obstruction);
      button.dispatchEvent(new win.Event("command", { bubbles: true }));
      await wait(() => !button.hasAttribute("disabled"));
      assert.match(status.textContent || "", /已清除|cache cleared/);
      assert.equal(status.getAttribute("aria-live"), "polite");
      assert.isEmpty((await IOUtils.readJSON(file) as any).entries);
    }
    finally {
      await IOUtils.remove(obstruction, { ignoreAbsent: true });
      win.close();
    }
  });

  describe("journal snapshot integrity", function () {
    let request: typeof Zotero.HTTP.request;
    let rank: Record<string, string>;
    const preferences = new Map<string, unknown>();
    const set = (key: string, value: boolean | string) => {
      const full = `${config.prefsPrefix}.${key}`;
      preferences.set(full, Zotero.Prefs.get(full, true));
      Zotero.Prefs.set(full, value, true);
    };

    beforeEach(function () {
      rank = { sci: "Q1" };
      set("easyscholar.secretKey", `system-index-${Zotero.Utilities.randomString()}`);
      set("easyscholar.writeToExtra", false);
      set("easyscholar.updateAbbreviation", false);
      set("insights.showPane", true);
      const fields = new Set(["jcr", "sci", "ccf"]);
      for (const field of EASYSCHOLAR_FIELD_DEFINITIONS)
        set(`easyscholar.fields.${field.key}`, fields.has(field.key));
      request = Zotero.HTTP.request;
      (Zotero.HTTP as any).request = async (method: string, url: string, options: unknown) => {
        if (String(url).startsWith("https://www.easyscholar.cc/")) {
          const body = JSON.stringify({ code: 200, data: { officialRank: { all: rank } } });
          return { status: 200, response: body, responseText: body };
        }
        return (request as any).call(Zotero.HTTP, method, url, options);
      };
    });

    afterEach(function () {
      Zotero.HTTP.request = request;
      for (const [key, value] of preferences) {
        if (value === undefined)
          Zotero.Prefs.clear(key, true);
        else
          Zotero.Prefs.set(key, value as boolean | string, true);
      }
      preferences.clear();
    });
    const create = async (title: string, issn: string, extra = "Manual index note") => {
      const item = new Zotero.Item("journalArticle");
      item.setField("title", "System index safety fixture");
      item.setField("publicationTitle", title);
      item.setField("ISSN", issn);
      item.setField("extra", extra);
      await item.saveTx();
      created.push(item);
      return item;
    };
    const column = (item: Zotero.Item, key: string) => {
      const columns = (Zotero.ItemTreeManager as any).getCustomColumns(undefined, { pluginID: config.addonID });
      return columns.find((entry: any) => entry.dataKey.endsWith(`easyScholar-${key}`)).dataProvider(item);
    };
    const update = async (item: Zotero.Item) => {
      await plugin().hooks.onLintInBatch("tool-update-easyscholar", [item]);
      assert.equal(plugin().runner.lastResult.failed, 0);
    };

    it("refreshes the other known ISSN and its former title after a single-ISSN update", async function () {
      const both = await create("System alias original", "9292-3101; 9292-3102");
      const electronic = await create("System alias original", "9292-3102");
      const titleOnly = await create("System alias original", "");
      await update(both);
      rank = { sci: "Q2" };
      const corrected = await create("System alias corrected", "9292-3101");
      await update(corrected);
      assert.equal(column(electronic, "jcr"), "Q2");
      assert.equal(column(titleOnly, "jcr"), "Q2");
      assert.equal(electronic.getField("extra"), "Manual index note");
    });

    it("keeps a negative membership out of both the column and pane without erasing Extra", async function () {
      rank = { sci: "否" };
      const extra = "SCI: 是\nCCF: B\nManual index note";
      const item = await create("System removed membership", "9292-3201", extra);
      await update(item);
      assert.equal(column(item, "sci"), "");
      assert.equal(column(item, "jcr"), "", "membership flags are not quartiles");
      assert.equal(column(item, "ccf"), "B");
      assert.equal(item.getField("extra"), extra);
      const win = Zotero.getMainWindow();
      await win.ZoteroPane.selectItem(item.id);
      const section = win.document.querySelector("item-pane-custom-section[data-pane*='metaref-journal-insights']") as any;
      assert.exists(section);
      await section._handleRefresh();
      assert.isNull(section.querySelector("[data-journal-ranking='sci']"));
      assert.isNull(section.querySelector("[data-journal-ranking='jcr']"));
      assert.equal(section.querySelector("[data-journal-ranking='ccf']")?.textContent, "B");
    });
  });
});
