// autocorrect-disable
import { assert } from "chai";
import { config } from "../../package.json";
import { EASYSCHOLAR_FIELD_DEFINITIONS } from "../../src/utils/easyscholar";
import { journalNumericDisplayValue } from "../../src/utils/journal-column-sort";

describe("complete journal metric columns", function () {
  this.timeout(30_000);
  const created: Zotero.Item[] = [];
  let automatic: unknown;
  const fieldPrefs = new Map<string, boolean>();

  before(function () {
    for (const field of EASYSCHOLAR_FIELD_DEFINITIONS) {
      const key = `${config.prefsPrefix}.easyscholar.fields.${field.key}`;
      fieldPrefs.set(key, Zotero.Prefs.get(key, true) as boolean);
      Zotero.Prefs.set(key, true, true);
    }
    automatic = Zotero.Prefs.get(`${config.prefsPrefix}.lint.onAdded`, true);
    Zotero.Prefs.set(`${config.prefsPrefix}.lint.onAdded`, false, true);
  });

  after(async function () {
    for (const item of created)
      await item.eraseTx();
    for (const [key, value] of fieldPrefs)
      Zotero.Prefs.set(key, value, true);
    Zotero.Prefs.set(`${config.prefsPrefix}.lint.onAdded`, automatic as boolean, true);
  });

  it("offers every metric through the native column API and renders the saved values without requests", async function () {
    const item = new Zotero.Item("journalArticle");
    item.setField("title", "All journal metric columns");
    item.setField("publicationTitle", "MetaFlow unmatched journal column fixture");
    item.setField("extra", EASYSCHOLAR_FIELD_DEFINITIONS.map(field => `${field.extraKey}：${field.key === "impactFactor" ? "34.9" : "QA value"}`).join("\n"));
    await item.saveTx();
    created.push(item);
    const columns = (Zotero.ItemTreeManager as any).getCustomColumns(undefined, { pluginID: config.addonID });
    assert.lengthOf(columns, 68);
    const request = Zotero.HTTP.request;
    let requests = 0;
    try {
      Zotero.HTTP.request = (async () => {
        requests++;
        throw new Error("Column rendering must remain offline");
      }) as any;
      for (const field of EASYSCHOLAR_FIELD_DEFINITIONS) {
        const column = columns.find((column: any) => column.dataKey.endsWith(field.key === "esi" ? "esiDiscipline" : `easyScholar-${field.key}`));
        assert.exists(column, field.key);
        assert.isTrue(column.showInColumnPicker);
        const data = column.dataProvider(item);
        const expected = field.key === "impactFactor" ? "34.9" : "QA value";
        assert.equal(journalNumericDisplayValue(data), expected, field.key);
        if (column.renderCell) {
          const cell = column.renderCell(0, data, { className: "fixture" }, false, Zotero.getMainWindow().document);
          assert.equal(cell.textContent, expected, `${field.key} visible cell`);
        }
      }
      assert.equal(requests, 0);
      item.setField("extra", "JCR分区: Q3\nJCR 分区：Q1\n影响因子：9.8");
      await item.saveTx();
      const jcr = columns.find((column: any) => column.dataKey.endsWith("easyScholar-jcr"));
      assert.equal(jcr.dataProvider(item), "Q1");
    }
    finally {
      Zotero.HTTP.request = request;
    }
  });

  it("sorts impact factors numerically with Zotero's own collation", async function () {
    const column = (Zotero.ItemTreeManager as any).getCustomColumns(undefined, { pluginID: config.addonID }).find((column: any) => column.dataKey.endsWith("easyScholar-impactFactor"));
    const values = ["34.9", "9.8", "9.11", "100", "2.5"];
    const data: string[] = [];
    for (const value of values) {
      const item = new Zotero.Item("journalArticle");
      item.setField("title", `Impact factor ${value}`);
      item.setField("extra", `影响因子: ${value}`);
      await item.saveTx();
      created.push(item);
      data.push(column.dataProvider(item));
    }
    const collation = Zotero.getLocaleCollation() as unknown as { compareString: (strength: number, a: string, b: string) => number };
    const sorted = data.sort((a, b) => collation.compareString(1, a, b)).map(journalNumericDisplayValue);
    assert.deepEqual(sorted, ["2.5", "9.11", "9.8", "34.9", "100"]);
  });

  it("enforces master selections in the live pane, registry and direct actions while preserving saved data", async function () {
    const keys = ["insights.natureEnabled", "easyscholar.columns.jcr", "easyscholar.clearExtraBeforeUpdate", ...EASYSCHOLAR_FIELD_DEFINITIONS.map(field => `easyscholar.fields.${field.key}`)];
    const previous = new Map(keys.map(key => [key, Zotero.Prefs.get(`${config.prefsPrefix}.${key}`, true)]));
    const set = (key: string, value: boolean) => Zotero.Prefs.set(`${config.prefsPrefix}.${key}`, value, true);
    const columns = () => (Zotero.ItemTreeManager as any).getCustomColumns(undefined, { pluginID: config.addonID });
    const wait = async (condition: () => boolean) => {
      for (let attempt = 0; attempt < 100 && !condition(); attempt++)
        await Zotero.Promise.delay(30);
      assert.isTrue(condition());
    };
    const item = new Zotero.Item("journalArticle");
    item.setField("title", "Master selections fixture");
    item.setField("publicationTitle", "Nature Nanotechnology");
    item.setField("extra", "JCR 分区: Q1\n中科院分区基础版: 工程技术1区\n影响因子: 34.9\nManual note");
    await item.saveTx();
    created.push(item);
    const snapshot = String(item.getField("extra"));
    const request = Zotero.HTTP.request;
    let requests = 0;
    try {
      for (const field of EASYSCHOLAR_FIELD_DEFINITIONS)
        set(`easyscholar.fields.${field.key}`, ["casBasic", "impactFactor"].includes(field.key));
      set("insights.natureEnabled", false);
      set("easyscholar.columns.jcr", true);
      set("easyscholar.clearExtraBeforeUpdate", true);
      await wait(() => columns().length === 4);
      assert.isFalse(columns().some((column: any) => column.dataKey.endsWith("easyScholar-jcr")));
      const win = Zotero.getMainWindow();
      await win.ZoteroPane.selectItem(item.id);
      const section = win.document.querySelector("item-pane-custom-section[data-pane*='metaref-journal-insights']") as any;
      await section._handleRefresh();
      const body = section.querySelector("[data-type='body']") as HTMLElement;
      assert.equal(body.querySelector("[data-journal-ranking='impactFactor']")?.textContent, "34.9");
      assert.isNull(body.querySelector("[data-journal-ranking='jcr']"));
      assert.lengthOf(body.querySelectorAll("[data-journal-result]"), 0);
      set("easyscholar.fields.jcr", true);
      await wait(() => columns().some((column: any) => column.dataKey.endsWith("easyScholar-jcr")));
      await section._handleRefresh();
      assert.equal(body.querySelector("[data-journal-ranking='jcr']")?.textContent, "Q1");
      set("easyscholar.fields.jcr", false);
      set("easyscholar.fields.impactFactor", false);
      set("easyscholar.fields.casBasic", false);
      await wait(() => columns().length === 2);
      Zotero.HTTP.request = (async () => {
        requests++;
        throw new Error("Disabled metrics must not query services");
      }) as any;
      const plugin = (Zotero as any)[config.addonInstance];
      await plugin.hooks.onRefreshJournal(item);
      await plugin.hooks.onLintInBatch(["tool-update-easyscholar", "tool-query-esi", "tool-query-nature-index"], [item]);
      assert.equal(requests, 0);
      assert.equal(item.getField("extra"), snapshot);
      assert.isTrue(section.hidden);
    }
    finally {
      Zotero.HTTP.request = request;
      for (const [key, value] of previous)
        Zotero.Prefs.set(`${config.prefsPrefix}.${key}`, value as boolean, true);
      await wait(() => columns().length === 68);
    }
  });
});
