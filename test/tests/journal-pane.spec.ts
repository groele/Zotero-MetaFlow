import { assert } from "chai";
import { config } from "../../package.json";
import { mergeEasyScholarExtra } from "../../src/modules/rules/tool-update-easyscholar";
import { EASYSCHOLAR_FIELD_DEFINITIONS } from "../../src/utils/easyscholar";
import { waitForItemTree } from "../helpers/item-tree";

const prefix = config.prefsPrefix;

describe("independent journal insights in Zotero", function () {
  this.timeout(90_000);
  const plugin = () => (Zotero as any)[config.addonInstance];
  const created: Zotero.Item[] = [];
  const key = `${prefix}.insights.showPane`;
  let original: unknown;
  let auto: unknown;
  const autoKey = `${prefix}.lint.onAdded`;

  before(function () {
    original = Zotero.Prefs.get(key, true);
    auto = Zotero.Prefs.get(autoKey, true);
    Zotero.Prefs.set(key, true, true);
    Zotero.Prefs.set(autoKey, false, true);
  });

  after(async function () {
    for (const item of created)
      await item.eraseTx();
    Zotero.Prefs.set(key, original as boolean, true);
    Zotero.Prefs.set(autoKey, auto as boolean, true);
  });
  const create = async (journal: string) => {
    const item = new Zotero.Item("journalArticle");
    item.setField("title", "Independent index test");
    item.setField("publicationTitle", journal);
    item.setField("series", "Manual series");
    item.setField("archive", "Manual archive");
    item.setField("archiveLocation", "Manual identifier");
    item.addTag("user-topic");
    await item.saveTx();
    created.push(item);
    return item;
  };

  const selectItem = async (win: Window & typeof globalThis, item: Zotero.Item) => {
    // Preference fixtures can change 61 column definitions at once. Finish that
    // host schema refresh before simulating the next user selection.
    await waitForItemTree(win);
    await win.ZoteroPane.selectItem(item.id);
    // selectItem resolves after row selection; itemSelected awaits the public pane update.
    await win.ZoteroPane.itemSelected();
    const section = win.document.querySelector("item-pane-custom-section[data-pane*='metaref-journal-insights']") as HTMLElement & { item?: Zotero.Item };
    assert.equal(section.item?.id, item.id, "the native item pane has applied the selection");
  };

  it("keeps SCI under indexing with aligned results at narrow width", async function () {
    const pref = `${prefix}.easyscholar.fields.sci`;
    const previous = Zotero.Prefs.get(pref, true);
    Zotero.Prefs.set(pref, true, true);
    try {
      const item = await create("Physical Review Letters");
      item.setField("ISSN", "0031-9007");
      item.setField("extra", "SCI: 是");
      await item.saveTx();
      const win = Zotero.getMainWindow();
      await selectItem(win, item);
      const section = win.document.querySelector("item-pane-custom-section[data-pane*='metaref-journal-insights']") as any;
      await section._handleRefresh();
      const body = section.querySelector("[data-type='body']") as HTMLElement;
      assert.isNotNull(body.querySelector("[data-journal-indexes] [data-journal-ranking='sci']"));
      assert.isNull(body.querySelector("[data-journal-rankings] [data-journal-ranking='sci']"));
      for (const value of body.querySelectorAll("dd"))
        assert.equal(win.getComputedStyle(value)!.textAlign, "right");
      assert.include(body.querySelector("[data-journal-shared-basis]")?.textContent || "", "0031-9007");
      assert.isFalse((body.querySelector("details") as HTMLDetailsElement).open);
      body.style.width = "280px";
      body.style.boxSizing = "border-box";
      assert.isAtMost(body.scrollWidth, body.clientWidth + 1);
      body.style.removeProperty("width");
      body.style.removeProperty("box-sizing");
    }
    finally {
      Zotero.Prefs.set(pref, previous as boolean, true);
    }
  });

  it("renders its own section and columns without changing item metadata", async function () {
    const item = await create("Physical Review Letters");
    item.setField("ISSN", "0031-9007");
    await item.saveTx();
    const win = Zotero.getMainWindow();
    await selectItem(win, item);
    const section = win.document.querySelector("item-pane-custom-section[data-pane*='metaref-journal-insights']") as any;
    assert.isNotNull(section);
    const collapsedSection = section.querySelector("collapsible-section");
    const summary = section.querySelector("collapsible-section > .head .title-box .summary") as HTMLElement;
    collapsedSection.open = false;
    assert.isFalse(collapsedSection.open, "the journal section is collapsed for the height check");
    assert.equal(win.getComputedStyle(summary).display, "none", "an empty header summary does not reserve a line");
    assert.equal(summary.getBoundingClientRect().height, 0, "the empty summary adds no collapsed-row height");
    const initialBody = section.querySelector("[data-type='body']") as HTMLElement;
    assert.equal(win.getComputedStyle(initialBody).paddingTop, "0px", "the collapsed body has no top padding");
    assert.equal(win.getComputedStyle(initialBody).paddingBottom, "0px", "the collapsed body has no bottom padding");
    const heading = section.querySelector("collapsible-section > .head .title");
    assert.notEqual(win.getComputedStyle(heading!, "::before")?.display, "none", "the journal section shows the unified brand icon");
    await section._handleRefresh();
    const body = section.querySelector("[data-type='body']") as HTMLElement;
    assert.equal(body.querySelector("[data-journal-title]")?.textContent, "Physical Review Letters");
    assert.include(body.textContent!, "ESI");
    assert.include(body.textContent!, "Nature Index");
    assert.equal(body.querySelectorAll("[data-journal-result]").length, 2);
    assert.equal(body.querySelectorAll("[data-journal-sources]").length, 1);
    assert.equal(body.querySelectorAll("dt").length, 2);
    assert.equal(body.querySelectorAll("dd").length, 2);
    assert.equal(body.querySelectorAll("[data-journal-shared-basis]").length, 1, "the same basis is shown once");
    assert.notInclude(body.textContent!, "旧版本");
    assert.notInclude(body.textContent!, "legacy");
    assert.notInclude(body.textContent!, "物理学".concat("ESI"));
    collapsedSection.open = false;
    assert.equal(win.getComputedStyle(body).paddingTop, "0px", "the rendered collapsed body preserves 0 top padding");
    assert.equal(win.getComputedStyle(body).paddingBottom, "0px", "the rendered collapsed body preserves 0 bottom padding");
    collapsedSection.open = true;
    assert.isNull(section.querySelector("[data-type='refresh']"), "no header refresh icon");
    assert.isFalse(section.hidden, "the journal section is initially visible");
    section.scrollIntoView({ block: "start" });
    await Zotero.Promise.delay(100);
    const rect = section.getBoundingClientRect();
    const canvas = win.document.createElementNS("http://www.w3.org/1999/xhtml", "canvas") as HTMLCanvasElement;
    canvas.width = Math.ceil(rect.width);
    canvas.height = Math.ceil(rect.height);
    const context = canvas.getContext("2d")!;
    if ("drawWindow" in context) {
      (context as any).drawWindow(win, rect.left, rect.top, rect.width, rect.height, "rgb(245,245,245)");
      const bytes = Uint8Array.from(atob(canvas.toDataURL("image/png").split(",")[1]), char => char.charCodeAt(0));
      await IOUtils.write(PathUtils.join(PathUtils.tempDir, `metaref-journal-insights-${Zotero.locale}.png`), bytes);
    }
    const before = JSON.stringify(item.toJSON());
    await plugin().hooks.onLintInBatch(["tool-query-esi", "tool-query-nature-index"], [item]);
    assert.equal(JSON.stringify(item.toJSON()), before);
    assert.equal(plugin().runner.lastResult.saved, 0);
    const columns = (Zotero.ItemTreeManager as any).getCustomColumns(undefined, { pluginID: config.addonID });
    const esiColumn = columns.find((column: any) => column.dataKey.endsWith("esiDiscipline"));
    const natureColumn = columns.find((column: any) => column.dataKey.endsWith("natureIndex"));
    assert.include(esiColumn.dataProvider(item), "ESI");
    assert.equal(natureColumn.dataProvider(item), "✓");
    Zotero.Prefs.set(key, false, true);
    await Zotero.Promise.delay(100);
    assert.isTrue(section.hidden, "the section toggle applies immediately");
    Zotero.Prefs.set(key, true, true);
    await Zotero.Promise.delay(100);
    assert.isFalse(section.hidden, "the section can be enabled again immediately");
    item.setField("publicationTitle", "Unknown journal QA");
    item.setField("ISSN", "");
    await item.saveTx();
    await section._handleRefresh();
    assert.equal((await plugin().api.getJournalInsights(item)).esi, "");
    assert.equal(body.querySelector("[data-journal-title]")?.textContent, "Unknown journal QA");
    assert.isFalse((await plugin().api.getJournalInsights(item)).natureIndex);
    assert.isNull(body.querySelector("[data-journal-shared-basis]"), "unmatched results show no successful basis");
    assert.equal(natureColumn.dataProvider(item), "");
    assert.equal(item.getField("series"), "Manual series");
    assert.equal(item.getField("archive"), "Manual archive");
    assert.equal(item.getField("archiveLocation"), "Manual identifier");
    assert.isFalse(item.hasTag("Nature Index"));
    assert.isTrue(item.hasTag("user-topic"));
  });

  it("updates journal rankings silently in the pane and refreshes persisted edits without another request", async function () {
    const item = await create("Nanoscale");
    item.setField("extra", "Manual note");
    await item.saveTx();
    const win = Zotero.getMainWindow();
    await selectItem(win, item);
    const section = win.document.querySelector("item-pane-custom-section[data-pane*='metaref-journal-insights']") as any;
    for (let attempt = 0; attempt < 50 && section.item?.id !== item.id; attempt++)
      await Zotero.Promise.delay(50);
    await section._handleRefresh();
    const body = section.querySelector("[data-type='body']") as HTMLElement;
    const settings = ["easyscholar.secretKey", "easyscholar.clearExtraBeforeUpdate", "easyscholar.updateAbbreviation", "easyscholar.writeToExtra", "easyscholar.fields.jcr", "easyscholar.fields.impactFactor", "metadata.updateJournalInfo"];
    const previous = new Map(settings.map(key => [key, Zotero.Prefs.get(`${prefix}.${key}`, true)]));
    const request = Zotero.HTTP.request;
    let requests = 0;
    let fail = false;
    try {
      Zotero.Prefs.set(`${prefix}.metadata.updateJournalInfo`, true, true);
      Zotero.Prefs.set(`${prefix}.easyscholar.secretKey`, "pane-isolated-key", true);
      Zotero.Prefs.set(`${prefix}.easyscholar.clearExtraBeforeUpdate`, false, true);
      Zotero.Prefs.set(`${prefix}.easyscholar.updateAbbreviation`, false, true);
      Zotero.Prefs.set(`${prefix}.easyscholar.writeToExtra`, false, true);
      Zotero.Prefs.set(`${prefix}.easyscholar.fields.jcr`, true, true);
      Zotero.Prefs.set(`${prefix}.easyscholar.fields.impactFactor`, true, true);
      Zotero.HTTP.request = (async (method: string, url: string, options: any) => {
        if (new URL(url).hostname !== "www.easyscholar.cc")
          return request.call(Zotero.HTTP, method, url, options);
        requests++;
        if (fail)
          return { status: 200, responseText: JSON.stringify({ code: 403, msg: "Controlled failure" }) };
        return { status: 200, responseText: JSON.stringify({ code: 200, data: { officialRank: { all: { sci: "Q1", sciif: "8.4" } } } }) };
      }) as any;
      const dialogCount = plugin().data.dialogs.size;
      assert.equal(requests, 0, "selecting and rendering an item never starts a request");
      body.click();
      await Zotero.Promise.delay(50);
      assert.equal(requests, 0, "clicking the panel body is not the refresh trigger");
      const icon = win.document.querySelector("item-pane-sidenav .btn[data-pane*='metaref-journal-insights']") as HTMLElement;
      assert.isNotNull(icon, "the native sidebar navigation icon exists");
      icon.dispatchEvent(new win.MouseEvent("click", { bubbles: true, button: 0, detail: 1 }));
      icon.dispatchEvent(new win.MouseEvent("click", { bubbles: true, button: 0, detail: 1 }));
      for (let attempt = 0; attempt < 200 && !body.querySelector("[data-journal-ranking='jcr']"); attempt++)
        await Zotero.Promise.delay(50);
      await Zotero.Promise.delay(100);
      assert.equal(plugin().data.dialogs.size, dialogCount, "journal updates do not open a report dialog");
      assert.equal(body.querySelector("[data-journal-ranking='jcr']")?.textContent, "Q1");
      assert.equal(body.querySelector("[data-journal-ranking='impactFactor']")?.textContent, "8.4");
      assert.equal(item.getField("extra"), "Manual note", "rankings are stored in the index when Extra output is disabled");
      assert.equal(requests, 1);
      assert.isNull(body.querySelector("[data-journal-update-status]"), "successful refresh leaves no redundant completion banner");
      section.scrollIntoView({ block: "start" });
      await Zotero.Promise.delay(100);
      const rect = section.getBoundingClientRect();
      const canvas = win.document.createElementNS("http://www.w3.org/1999/xhtml", "canvas") as HTMLCanvasElement;
      canvas.width = Math.ceil(rect.width);
      canvas.height = Math.ceil(rect.height);
      (canvas.getContext("2d") as any).drawWindow(win, rect.left, rect.top, rect.width, rect.height, "rgb(245,245,245)");
      await IOUtils.write(PathUtils.join(PathUtils.tempDir, "metaref-journal-rankings-pane.png"), Uint8Array.from(win.atob(canvas.toDataURL("image/png").split(",")[1]), char => char.charCodeAt(0)));
      item.setField("extra", "CCF: B");
      await item.saveTx();
      for (let attempt = 0; attempt < 40 && !body.querySelector("[data-journal-ranking='ccf']"); attempt++)
        await Zotero.Promise.delay(50);
      assert.equal(body.querySelector("[data-journal-ranking='ccf']")?.textContent, "B");
      assert.equal(body.querySelector("[data-journal-ranking='jcr']")?.textContent, "Q1", "the profile index retains the fetched ranking after Extra is edited");
      assert.equal(body.querySelector("[data-journal-ranking='impactFactor']")?.textContent, "8.4");
      assert.equal(requests, 1, "rendering saved rankings does not query the API");
      const other = await create("Unknown pane QA");
      await selectItem(win, other);
      await section._handleRefresh();
      assert.isNull(body.querySelector("[data-journal-ranking='ccf']"), "switching items clears previous rankings");
      fail = true;
      await plugin().hooks.onLintInBatch("tool-update-easyscholar", [other]);
      assert.equal(plugin().data.dialogs.size, dialogCount, "query errors stay in the pane instead of opening a dialog");
      assert.include(body.querySelector("[data-journal-update-status]")?.textContent || "", "Controlled failure");
      assert.equal(other.getField("extra"), "");
      const originalRefresh = plugin().hooks.onRefreshJournal;
      let automaticCalls = 0;
      let settled = false;
      plugin().hooks.onRefreshJournal = async (...args: unknown[]) => {
        automaticCalls++;
        try {
          return await originalRefresh(...args);
        }
        finally {
          settled = true;
        }
      };
      try {
        icon.dispatchEvent(new win.MouseEvent("click", { bubbles: true, button: 0, detail: 1 }));
        for (let attempt = 0; attempt < 200; attempt++) {
          if (settled)
            break;
          await Zotero.Promise.delay(50);
        }
        assert.isTrue(settled, "automatic completion settles");
        await Zotero.Promise.delay(100);
        icon.dispatchEvent(new win.MouseEvent("click", { bubbles: true, button: 0, detail: 1 }));
        await Zotero.Promise.delay(500);
        assert.equal(automaticCalls, 1, "repeated navigation suppresses an already completed failed lookup");
      }
      finally {
        plugin().hooks.onRefreshJournal = originalRefresh;
      }
    }
    finally {
      Zotero.HTTP.request = request;
      for (const [key, value] of previous)
        Zotero.Prefs.set(`${prefix}.${key}`, value as string | boolean, true);
    }
  });

  it("shows every saved ranking for journals and conferences, with no journal-only claims on conferences", async function () {
    const previous = new Map(EASYSCHOLAR_FIELD_DEFINITIONS.map(field => [field.key, Zotero.Prefs.get(`${prefix}.easyscholar.fields.${field.key}`, true) as boolean]));
    for (const field of EASYSCHOLAR_FIELD_DEFINITIONS)
      Zotero.Prefs.set(`${prefix}.easyscholar.fields.${field.key}`, true, true);
    try {
      const item = await create("All ranking fields QA");
      item.setField("extra", mergeEasyScholarExtra("Manual note", Object.fromEntries(EASYSCHOLAR_FIELD_DEFINITIONS.map(field => [field.key, "QA-A"]))));
      await item.saveTx();
      const win = Zotero.getMainWindow();
      await selectItem(win, item);
      const section = win.document.querySelector("item-pane-custom-section[data-pane*='metaref-journal-insights']") as any;
      await section._handleRefresh();
      const body = section.querySelector("[data-type='body']") as HTMLElement;
      for (const field of EASYSCHOLAR_FIELD_DEFINITIONS.filter(field => field.key !== "esi"))
        assert.equal(body.querySelector(`[data-journal-ranking='${field.key}']`)?.textContent, "QA-A", field.key);
      assert.isNull(body.querySelector("[data-journal-ranking='esi']"), "ESI has only one primary presentation");
      assert.include(body.querySelector("[data-journal-result] dd")?.textContent || "", "QA-A", "saved ESI remains visible when no current category is available");
      const conference = new Zotero.Item("conferencePaper");
      conference.setField("title", "Conference rankings QA");
      conference.setField("proceedingsTitle", "Conference QA");
      conference.setField("extra", "CCF: A\nCORE Rankings: A*\nManual conference note");
      await conference.saveTx();
      created.push(conference);
      await selectItem(win, conference);
      await section._handleRefresh();
      assert.isFalse(section.hidden, "conference rankings use the same pane");
      assert.equal(body.querySelector("[data-journal-title]")?.textContent, "Conference QA");
      assert.equal(body.querySelector("[data-journal-ranking='ccf']")?.textContent, "A");
      assert.equal(body.querySelector("[data-journal-ranking='coreRankings']")?.textContent, "A*");
      assert.lengthOf(body.querySelectorAll("[data-journal-result]"), 0, "ESI and Nature Index remain journal-only");
      assert.isNull(body.querySelector("[data-journal-ranking='jcr']"));
    }
    finally {
      for (const [key, value] of previous)
        Zotero.Prefs.set(`${prefix}.easyscholar.fields.${key}`, value, true);
    }
  });

  it("keeps not-found, disabled and unselected responses distinct from successful updates", async function () {
    this.timeout(120_000);
    const keys = ["insights.natureEnabled", "insights.natureSourcePriority", "easyscholar.secretKey", "easyscholar.updateAbbreviation", "easyscholar.clearExtraBeforeUpdate", ...EASYSCHOLAR_FIELD_DEFINITIONS.map(field => `easyscholar.fields.${field.key}`)];
    const previous = new Map(keys.map(key => [key, Zotero.Prefs.get(`${prefix}.${key}`, true)]));
    const request = Zotero.HTTP.request;
    let mode = "empty";
    let requests = 0;
    try {
      for (const field of EASYSCHOLAR_FIELD_DEFINITIONS)
        Zotero.Prefs.set(`${prefix}.easyscholar.fields.${field.key}`, false, true);
      Zotero.Prefs.set(`${prefix}.insights.natureEnabled`, true, true);
      Zotero.Prefs.set(`${prefix}.insights.natureSourcePriority`, "local-only", true);
      Zotero.Prefs.set(`${prefix}.easyscholar.secretKey`, "status-fixture-key", true);
      Zotero.Prefs.set(`${prefix}.easyscholar.updateAbbreviation`, false, true);
      Zotero.Prefs.set(`${prefix}.easyscholar.clearExtraBeforeUpdate`, false, true);
      Zotero.HTTP.request = (async (method: string, url: string, options: any) => {
        if (new URL(url).hostname !== "www.easyscholar.cc")
          return request.call(Zotero.HTTP, method, url, options);
        requests++;
        return { responseText: JSON.stringify({ code: 200, data: { officialRank: { all: mode === "empty" ? {} : { sciif: "4.5" } } } }) };
      }) as any;
      const win = Zotero.getMainWindow();
      const dialogs = plugin().data.dialogs.size;
      for (const scenario of ["empty", "disabled", "unselected"]) {
        mode = scenario;
        Zotero.Prefs.set(`${prefix}.easyscholar.fields.jcr`, scenario !== "disabled", true);
        const item = await create(`Status ${scenario} QA`);
        item.setField("extra", "Manual preserved note");
        await item.saveTx();
        await selectItem(win, item);
        await plugin().hooks.onLintInBatch("tool-update-easyscholar", [item]);
        const section = win.document.querySelector("item-pane-custom-section[data-pane*='metaref-journal-insights']") as any;
        await section._handleRefresh();
        const record = plugin().runner.lastResult.records.find((record: any) => record.code !== "journal-summary");
        assert.isDefined(record, scenario);
        assert.include(section.textContent!, record.message, `${scenario} has its specific inline outcome`);
        assert.equal(item.getField("extra"), "Manual preserved note");
        assert.equal(plugin().data.dialogs.size, dialogs);
      }
      assert.equal(requests, 2, "disabled fields make no request");
    }
    finally {
      Zotero.HTTP.request = request;
      for (const [key, value] of previous)
        Zotero.Prefs.set(`${prefix}.${key}`, value as string | boolean, true);
    }
  });

  it("refreshes automatic lookup failures in the journal pane", async function () {
    const keys = ["lint.onAdded", "metadata.autoUpdateOnAdded", "easyscholar.autoUpdateOnAdded", "easyscholar.secretKey", ...EASYSCHOLAR_FIELD_DEFINITIONS.map(field => `easyscholar.fields.${field.key}`)];
    const previous = new Map(keys.map(key => [key, Zotero.Prefs.get(`${prefix}.${key}`, true)]));
    const request = Zotero.HTTP.request;
    try {
      for (const field of EASYSCHOLAR_FIELD_DEFINITIONS)
        Zotero.Prefs.set(`${prefix}.easyscholar.fields.${field.key}`, field.key === "jcr", true);
      const item = await create("Automatic status journal QA");
      const win = Zotero.getMainWindow();
      await selectItem(win, item);
      Zotero.Prefs.set(`${prefix}.lint.onAdded`, true, true);
      Zotero.Prefs.set(`${prefix}.metadata.autoUpdateOnAdded`, false, true);
      Zotero.Prefs.set(`${prefix}.easyscholar.autoUpdateOnAdded`, true, true);
      Zotero.Prefs.set(`${prefix}.easyscholar.secretKey`, "automatic-status-fixture-key", true);
      Zotero.HTTP.request = (async (method: string, url: string, options: any) => {
        if (new URL(url).hostname !== "www.easyscholar.cc")
          return request.call(Zotero.HTTP, method, url, options);
        return { responseText: JSON.stringify({ code: 403, msg: "Automatic fixture failure" }) };
      }) as any;
      await plugin().hooks.onNotify("add", "item", [item.id], {});
      const section = win.document.querySelector("item-pane-custom-section[data-pane*='metaref-journal-insights']") as any;
      assert.include(section.querySelector("[data-journal-update-status]")?.textContent || "", "Automatic fixture failure", `section=${section.item?.id} selected=${win.ZoteroPane.getSelectedItems().map(i => i.id)} expected=${item.id} skip=${section.skipRender} hidden=${section.hidden} body=${section.textContent?.slice(0, 130)}`);
    }
    finally {
      Zotero.HTTP.request = request;
      for (const [key, value] of previous)
        Zotero.Prefs.set(`${prefix}.${key}`, value as string | boolean, true);
    }
  });

  it("recognizes the captured 2026 Nature API response in the pane and column", async function () {
    const keys = ["insights.natureSourcePriority", "insights.natureDatasetUUID", "insights.natureEnabled", "easyscholar.secretKey"];
    const previous = new Map(keys.map(key => [key, Zotero.Prefs.get(`${prefix}.${key}`, true)]));
    const request = Zotero.HTTP.request;
    const refreshColumns = Zotero.ItemTreeManager.refreshColumns;
    let columnResets = 0;
    let requests = 0;
    try {
      Zotero.Prefs.set(`${prefix}.insights.natureSourcePriority`, "api-only", true);
      Zotero.Prefs.set(`${prefix}.insights.natureDatasetUUID`, "", true);
      Zotero.Prefs.set(`${prefix}.insights.natureEnabled`, true, true);
      Zotero.Prefs.set(`${prefix}.easyscholar.secretKey`, "nature-2026-isolated-fixture", true);
      Zotero.HTTP.request = (async (method: string, url: string, options: any) => {
        if (new URL(url).hostname !== "www.easyscholar.cc")
          return request.call(Zotero.HTTP, method, url, options);
        requests++;
        return { responseText: JSON.stringify({ code: 200, data: { customRank: { rankInfo: [{ uuid: "1615199999904223232", abbName: "自然指数", oneRankText: " " }], rank: ["1615199999904223232&&&1"] }, officialRank: { all: {} } } }) };
      }) as any;
      const item = await create("Nature 2026 captured response QA");
      const win = Zotero.getMainWindow();
      await selectItem(win, item);
      const section = win.document.querySelector("item-pane-custom-section[data-pane*='metaref-journal-insights']") as any;
      const view = win.ZoteroPane.itemsView;
      const natureColumn = (Zotero.ItemTreeManager as any).getCustomColumns(undefined, { pluginID: config.addonID }).find((column: any) => column.dataKey.endsWith("natureIndex")).dataKey;
      assert.equal(view.getCellText(view.getRowIndexByID(item.id), natureColumn), "", "prime the native row cache before the index update");
      Zotero.ItemTreeManager.refreshColumns = () => {
        columnResets++;
        return refreshColumns.call(Zotero.ItemTreeManager);
      };
      await plugin().hooks.onLintInBatch("tool-query-nature-index", [item]);
      const result = await plugin().api.getJournalInsights(item);
      assert.isTrue(result.natureIndex);
      assert.equal(result.natureSource, "api");
      assert.equal(result.natureAPIDataset, "自然指数");
      await section._handleRefresh();
      for (let attempt = 0; attempt < 50 && !section.textContent?.includes("自然指数"); attempt++)
        await Zotero.Promise.delay(50);
      assert.equal(section.item?.id, item.id, "the journal section follows the selected item");
      assert.deepEqual(win.ZoteroPane.getSelectedItems().map(selected => selected.id), [item.id], "data refresh never restores the previous selection");
      assert.equal(section.querySelector("[data-journal-title]")?.textContent, "Nature 2026 captured response QA");
      assert.notInclude(section.textContent!, "Automatic fixture failure", "the previous item's query failure is not rendered for the current item");
      assert.equal(columnResets, 0, "index value updates redraw rows without rebuilding columns");
      assert.equal(view.getCellText(view.getRowIndexByID(item.id), natureColumn), "✓", "the actual cached native column updates with the pane");
      assert.include(section.textContent!, "自然指数");
      const columns = (Zotero.ItemTreeManager as any).getCustomColumns(undefined, { pluginID: config.addonID });
      assert.isNotEmpty(columns.find((column: any) => column.dataKey.endsWith("natureIndex")).dataProvider(item));
      assert.equal(requests, 1);
      assert.equal(item.getField("extra"), "");
    }
    finally {
      Zotero.ItemTreeManager.refreshColumns = refreshColumns;
      Zotero.HTTP.request = request;
      for (const [key, value] of previous)
        Zotero.Prefs.set(`${prefix}.${key}`, value as string | boolean, true);
    }
  });

  it("keeps the new selection and pane when an older item's API response finishes late", async function () {
    const keys = ["insights.natureSourcePriority", "insights.natureEnabled", "insights.esiSourcePriority", "easyscholar.secretKey"];
    const previous = new Map(keys.map(key => [key, Zotero.Prefs.get(`${prefix}.${key}`, true)]));
    const request = Zotero.HTTP.request;
    let release!: () => void;
    const response = new Promise<void>(resolve => release = resolve);
    let pending: Promise<unknown> | undefined;
    let requests = 0;
    try {
      Zotero.Prefs.set(`${prefix}.insights.natureSourcePriority`, "api-only", true);
      Zotero.Prefs.set(`${prefix}.insights.natureEnabled`, true, true);
      Zotero.Prefs.set(`${prefix}.insights.esiSourcePriority`, "local-only", true);
      Zotero.Prefs.set(`${prefix}.easyscholar.secretKey`, "delayed-selection-fixture", true);
      Zotero.HTTP.request = (async (method: string, url: string, options: any) => {
        if (new URL(url).hostname !== "www.easyscholar.cc")
          return request.call(Zotero.HTTP, method, url, options);
        requests++;
        await response;
        return { responseText: JSON.stringify({ code: 200, data: { customRank: { rankInfo: [{ uuid: "1615199999904223232", abbName: "自然指数", oneRankText: " " }], rank: ["1615199999904223232&&&1"] }, officialRank: { all: {} } } }) };
      }) as any;
      const old = await create("Delayed response journal QA");
      const current = await create("Current selection journal QA");
      const win = Zotero.getMainWindow();
      await selectItem(win, old);
      pending = plugin().hooks.onLintInBatch("tool-query-nature-index", [old]);
      for (let attempt = 0; attempt < 100; attempt++) {
        if (requests)
          break;
        await Zotero.Promise.delay(10);
      }
      assert.equal(requests, 1, "the old item's explicit query is in flight");
      await selectItem(win, current);
      release();
      await pending;
      const section = win.document.querySelector("item-pane-custom-section[data-pane*='metaref-journal-insights']") as any;
      await section._handleRefresh();
      assert.deepEqual(win.ZoteroPane.getSelectedItems().map(item => item.id), [current.id]);
      assert.equal(section.item?.id, current.id);
      assert.equal(section.querySelector("[data-journal-title]")?.textContent, "Current selection journal QA");
      assert.equal(requests, 1, "rendering the new selection does not query online");
    }
    finally {
      release();
      await pending;
      Zotero.HTTP.request = request;
      for (const [key, value] of previous)
        Zotero.Prefs.set(`${prefix}.${key}`, value as string | boolean, true);
    }
  });

  it("honors API/local source priority in the pane and columns without background requests", async function () {
    const keys = ["insights.esiSourcePriority", "insights.natureSourcePriority", "insights.natureDatasetUUID", "easyscholar.secretKey"];
    const previous = new Map(keys.map(key => [key, Zotero.Prefs.get(`${prefix}.${key}`, true)]));
    const request = Zotero.HTTP.request;
    let requests = 0;
    try {
      Zotero.Prefs.set(`${prefix}.insights.esiSourcePriority`, "api-first", true);
      Zotero.Prefs.set(`${prefix}.insights.natureSourcePriority`, "api-first", true);
      Zotero.Prefs.set(`${prefix}.insights.natureDatasetUUID`, "nature-priority-fixture", true);
      Zotero.Prefs.set(`${prefix}.easyscholar.secretKey`, "priority-isolated-key", true);
      Zotero.HTTP.request = (async (method: string, url: string, options: any) => {
        if (new URL(url).hostname !== "www.easyscholar.cc")
          return request.call(Zotero.HTTP, method, url, options);
        requests++;
        return { responseText: JSON.stringify({ code: 200, data: { officialRank: { all: { esi: "CHEMISTRY" } }, customRank: { rankInfo: [{ uuid: "nature-priority-fixture", name: "145 种自然指数统计期刊", oneRankText: "是", twoRankText: "否" }], rank: ["nature-priority-fixture0002"] } } }) };
      }) as any;
      const item = await create("Physical Review Letters");
      item.setField("ISSN", "0031-9007");
      await item.saveTx();
      const win = Zotero.getMainWindow();
      await selectItem(win, item);
      const section = win.document.querySelector("item-pane-custom-section[data-pane*='metaref-journal-insights']") as any;
      await section._handleRefresh();
      assert.equal(requests, 0, "selection and rendering do not query the API");
      await plugin().hooks.onLintInBatch(["tool-query-esi", "tool-query-nature-index"], [item]);
      assert.equal(requests, 1, "the two index commands reuse one API response");
      const resolved = await plugin().api.getJournalInsights(item);
      assert.equal(resolved.esiSource, "api");
      assert.equal(resolved.natureSource, "api");
      assert.deepEqual(resolved.categories, ["CHEMISTRY"]);
      assert.isFalse(resolved.natureIndex, "explicit API nonmembership overrides a positive local match");
      await section._handleRefresh();
      for (let attempt = 0; attempt < 50 && (!section.textContent?.includes("EasyScholar API") || !section.textContent?.includes("145 种自然指数统计期刊")); attempt++)
        await Zotero.Promise.delay(50);
      assert.include(section.textContent!, "EasyScholar API");
      assert.include(section.textContent!, "145 种自然指数统计期刊");
      const columns = (Zotero.ItemTreeManager as any).getCustomColumns(undefined, { pluginID: config.addonID });
      assert.include(columns.find((column: any) => column.dataKey.endsWith("esiDiscipline")).dataProvider(item), "化学");
      assert.equal(columns.find((column: any) => column.dataKey.endsWith("natureIndex")).dataProvider(item), "");
      for (const policy of ["local-first", "local-only"]) {
        Zotero.Prefs.set(`${prefix}.insights.esiSourcePriority`, policy, true);
        Zotero.Prefs.set(`${prefix}.insights.natureSourcePriority`, policy, true);
        await section._handleRefresh();
        const local = await plugin().api.getJournalInsights(item);
        assert.notEqual(local.esiSource, "api");
        assert.isTrue(local.natureIndex);
        assert.equal(requests, 1);
      }
      Zotero.Prefs.set(`${prefix}.insights.esiSourcePriority`, "api-only", true);
      Zotero.Prefs.set(`${prefix}.insights.natureSourcePriority`, "api-only", true);
      const unknown = await create("Unqueried priority journal QA");
      await selectItem(win, unknown);
      await section._handleRefresh();
      const missing = await plugin().api.getJournalInsights(unknown);
      assert.equal(missing.esi, "");
      assert.isUndefined(missing.natureIndex);
      assert.isNotEmpty(missing.natureError || "");
      assert.equal(requests, 1);
    }
    finally {
      Zotero.HTTP.request = request;
      for (const [key, value] of previous)
        Zotero.Prefs.set(`${prefix}.${key}`, value as string, true);
    }
  });
});
