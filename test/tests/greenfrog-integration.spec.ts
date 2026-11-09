import { assert } from "chai";
import { config } from "../../package.json";
import { Rules } from "../../src/modules/rules";
import { EASYSCHOLAR_FIELD_DEFINITIONS } from "../../src/utils/easyscholar";

describe("green Frog integration in Zotero", function () {
  this.timeout(30000);
  const plugin = () => (Zotero as any)[config.addonInstance];
  const pref = (key: string) => `${config.prefsPrefix}.${key}`;
  const created: Zotero.Item[] = [];
  let automatic: boolean;

  before(function () {
    automatic = Zotero.Prefs.get(pref("lint.onAdded"), true) as boolean;
    Zotero.Prefs.set(pref("lint.onAdded"), false, true);
  });

  after(async function () {
    Zotero.Prefs.set(pref("lint.onAdded"), false, true);
    for (const item of created)
      await item.eraseTx();
    Zotero.Prefs.set(pref("lint.onAdded"), automatic, true);
  });

  afterEach(async function () {
    for (const dialog of plugin().data.dialogs.values())
      dialog.close();
    await Zotero.Promise.delay(100);
  });

  it("translates all generated controls, persists output choices and toggles real columns", async function () {
    const entry = (Zotero.PreferencePanes as any).pluginPanes.find((pane: any) => pane.pluginID === config.addonID);
    const win = Zotero.Utilities.Internal.openPreferences(entry.id)! as Window & typeof globalThis;
    const originalChoices = new Map(EASYSCHOLAR_FIELD_DEFINITIONS.flatMap(field => ["fields", "columns"].map((kind) => {
      const key = pref(`easyscholar.${kind}.${field.key}`);
      return [key, Zotero.Prefs.get(key, true)] as const;
    })));
    const oldField = Zotero.Prefs.get(pref("easyscholar.fields.swufe"), true) as boolean;
    const oldColumn = Zotero.Prefs.get(pref("easyscholar.columns.jcr"), true) as boolean;
    try {
      for (let attempt = 0; attempt < 100 && !win.document.getElementById("metaref-shortcut-profileDirectory"); attempt++)
        await Zotero.Promise.delay(50);
      await (win as any).Zotero_Preferences.waitForFirstPaneLoad();
      const pane = win.document.getElementById(config.addonRef)!;
      await win.document.l10n!.translateFragment(pane);
      win.resizeTo(920, 800);
      const journalSettings = pane.querySelector("#metaref-easyscholar-settings") as HTMLElement;
      for (let ancestor = journalSettings.parentElement; ancestor; ancestor = ancestor.parentElement) {
        if (ancestor.localName === "details")
          (ancestor as HTMLDetailsElement).open = true;
      }
      const rankInput = journalSettings.querySelector<HTMLInputElement>("input[preference$='.easyscholar.fields.jcr']")!;
      const card = rankInput.closest("details") as HTMLDetailsElement;
      const summary = card.querySelector("summary")!;
      summary.click();
      assert.isFalse(card.open, "function cards collapse from the header");
      summary.click();
      assert.isTrue(card.open);
      journalSettings.scrollIntoView({ block: "start" });
      await Zotero.Promise.delay(100);
      const grid = rankInput.closest(".metaref-choice-grid")!;
      for (let attempt = 0; attempt < 100 && !grid.children[0].getBoundingClientRect().width; attempt++)
        await Zotero.Promise.delay(50);
      const cells = [...grid.children].map(child => child.getBoundingClientRect());
      assert.isAbove(cells[1].left, cells[0].left + 100, "options occupy two distinct columns");
      assert.closeTo(cells[0].top, cells[1].top, 1, "the two columns align by row");
      assert.isAtLeast(rankInput.getBoundingClientRect().width, 15, "the checkbox itself is visible");
      const oldRank = rankInput.checked;
      rankInput.click();
      assert.equal(Zotero.Prefs.get(pref("easyscholar.fields.jcr"), true), !oldRank);
      rankInput.click();
      assert.equal(Zotero.Prefs.get(pref("easyscholar.fields.jcr"), true), oldRank);
      assert.isAtMost(pane.scrollWidth, pane.clientWidth + 1);
      const canvas = win.document.createElementNS("http://www.w3.org/1999/xhtml", "canvas") as HTMLCanvasElement;
      canvas.width = win.innerWidth;
      canvas.height = win.innerHeight;
      (canvas.getContext("2d") as any).drawWindow(win, 0, 0, canvas.width, canvas.height, "rgb(245,245,245)");
      await IOUtils.write(PathUtils.join(PathUtils.tempDir, "metaref-es-cards-two-column.png"), Uint8Array.from(win.atob(canvas.toDataURL("image/png").split(",")[1]), char => char.charCodeAt(0)));
      for (const field of EASYSCHOLAR_FIELD_DEFINITIONS) {
        for (const kind of ["fields", "columns"]) {
          const master = pane.querySelector<HTMLInputElement>(`input[preference='${pref(`easyscholar.fields.${field.key}`)}']`)!;
          const masterWasEnabled = master.checked;
          if (kind === "columns" && !masterWasEnabled)
            master.click();
          const key = pref(`easyscholar.${kind}.${field.key}`);
          const control = pane.querySelector<HTMLInputElement>(`input[preference='${key}']`)!;
          assert.isNotNull(control, `${kind}.${field.key} has a control`);
          const previous = control.checked;
          control.click();
          assert.equal(Zotero.Prefs.get(key, true), !previous, `${kind}.${field.key} persists`);
          const column = () => (Zotero.ItemTreeManager as any).getCustomColumns(undefined, { pluginID: config.addonID }).find((entry: any) => entry.dataKey.endsWith(field.key === "esi" ? "esiDiscipline" : `easyScholar-${field.key}`));
          if (kind === "columns")
            assert.equal(!column().columnPickerSubMenu, !previous, `${field.key} main-menu placement follows the switch`);
          control.click();
          assert.equal(Zotero.Prefs.get(key, true), previous);
          if (kind === "columns")
            assert.equal(!column().columnPickerSubMenu, previous, `${field.key} main-menu placement is restored`);
          if (kind === "columns" && !masterWasEnabled) {
            master.click();
            assert.notExists(column(), `${field.key} disappears when its master switch is disabled`);
          }
        }
      }
      const statusButton = pane.querySelector("#metaref-integration-status")!;
      assert.isNotEmpty(statusButton.getAttribute("label") || "");
      const alert = Zotero.alert;
      let statusText = "";
      try {
        Zotero.alert = ((_win: any, _title: string, message: string) => {
          statusText = message;
        }) as any;
        statusButton.dispatchEvent(new win.Event("command", { bubbles: true }));
        assert.isNotEmpty(statusText);
      }
      finally {
        Zotero.alert = alert;
      }
      const controls = pane.querySelectorAll("#metaref-easyscholar-university-fields input, #metaref-easyscholar-custom-fields input, #metaref-easyscholar-supplemental-fields input, #metaref-easyscholar-columns input");
      assert.lengthOf(controls, 95);
      for (const control of controls)
        assert.isNotEmpty(control.closest("label")?.textContent?.trim() || "", control.getAttribute("preference") || "missing preference");
      const field = pane.querySelector(`[preference='${pref("easyscholar.fields.swufe")}']`) as XULElement & { checked: boolean };
      field.checked = !oldField;
      field.dispatchEvent(new win.Event("command", { bubbles: true }));
      assert.equal(Zotero.Prefs.get(pref("easyscholar.fields.swufe"), true), !oldField);
      const column = pane.querySelector(`[preference='${pref("easyscholar.columns.jcr")}']`) as XULElement & { checked: boolean };
      column.checked = true;
      column.dispatchEvent(new win.Event("command", { bubbles: true }));
      const columns = () => (Zotero.ItemTreeManager as any).getCustomColumns(undefined, { pluginID: config.addonID });
      assert.isTrue(columns().some((entry: any) => entry.dataKey.includes("easyScholar-jcr")));
      column.checked = false;
      column.dispatchEvent(new win.Event("command", { bubbles: true }));
      assert.isTrue(columns().find((entry: any) => entry.dataKey.includes("easyScholar-jcr")).columnPickerSubMenu);
    }
    finally {
      for (const [key, value] of originalChoices)
        Zotero.Prefs.set(key, value as boolean, true);
      Zotero.Prefs.set(pref("easyscholar.fields.swufe"), oldField, true);
      Zotero.Prefs.set(pref("easyscholar.columns.jcr"), oldColumn, true);
      win.close();
    }
  });

  it("saves author annotations, swaps and literal replacements through the batch boundary", async function () {
    const item = new Zotero.Item("journalArticle");
    item.setField("title", "MoS2 study");
    item.setField("publicationTitle", "Old Journal");
    item.setCreators([{ creatorType: "author", firstName: "Ada", lastName: "Lovelace" }, { creatorType: "author", name: "Research Group" }]);
    await item.saveTx();
    created.push(item);
    await plugin().runner.add({ items: [item], silent: true, rules: [{ id: "integration-author-style", scope: "item", async apply() {
      await plugin().runner.applyRuleByID(item, "tool-creators-style", { action: "both", name: "Ada Lovelace" });
    } }] });
    assert.equal(item.getCreators()[0].lastName, "<b>Lovelace</b>*");
    assert.equal(plugin().runner.lastResult.saved, 1);
    await plugin().runner.add({ items: [item], silent: true, rules: [{ id: "integration-maintenance", scope: "item", async apply() {
      await plugin().runner.applyRuleByID(item, "tool-creators-style", { action: "removeAll", name: "" });
      await plugin().runner.applyRuleByID(item, "tool-creators-swap", {});
      await plugin().runner.applyRuleByID(item, "tool-title-replace", { find: "MoS2", replacement: "$&", all: false });
      await plugin().runner.applyRuleByID(item, "tool-publication-replace", { find: "Old", replacement: "New", all: true });
    } }] });
    assert.equal(item.getCreators()[0].lastName, "Ada");
    assert.equal(item.getCreators()[0].firstName, "Lovelace");
    assert.equal(item.getCreators()[1].lastName, "Research Group");
    assert.equal(item.getField("title"), "$& study");
    assert.equal(item.getField("publicationTitle"), "New Journal");
    assert.isFalse(item.hasChanged());
    assert.equal(plugin().runner.lastResult.saved, 1);
  });

  it("cancels complete Extra clearing before mutation and saves only after confirmation", async function () {
    const item = created[0];
    item.setField("extra", "Manual note\nCustom: keep");
    await item.saveTx();
    const win = Zotero.getMainWindow();
    const confirm = win.confirm;
    try {
      win.confirm = () => false;
      await plugin().hooks.onLintInBatch("tool-clear-all-extra", [item]);
      assert.equal(item.getField("extra"), "Manual note\nCustom: keep");
      assert.isTrue(plugin().runner.lastResult.cancelled);
      win.confirm = () => true;
      await plugin().hooks.onLintInBatch("tool-clear-all-extra", [item]);
      assert.equal(item.getField("extra"), "");
      assert.equal(plugin().runner.lastResult.saved, 1);
    }
    finally {
      win.confirm = confirm;
    }
  });

  it("fills missing metadata automatically without a settings dialog", async function () {
    const previous = new Map(["lint.onAdded", "metadata.autoUpdateOnAdded", "metadata.repairCreators", "easyscholar.autoUpdateOnAdded", "rule.require-journal-abbr.infer", "rule.correct-doi-long"].map(key => [key, Zotero.Prefs.get(pref(key), true)]));
    const OriginalSearch = Zotero.Translate.Search;
    const item = new Zotero.Item("journalArticle");
    item.setField("title", "Automatic metadata test");
    item.setField("DOI", "10.1234/automatic-qa");
    await item.saveTx();
    created.push(item);
    (Zotero.Translate as any).Search = class {
      setIdentifier() {}
      setSearch() {}
      setTranslator() {}
      async getTranslators() { return ["integration-qa"]; }
      async translate() { return [{ itemType: "journalArticle", title: "Automatic metadata test", DOI: "10.1234/automatic-qa", date: "2025", publicationTitle: "Automatic QA Journal", creators: [{ creatorType: "author", firstName: "Ada", lastName: "Lovelace" }] }]; }
    };
    try {
      Zotero.Prefs.set(pref("lint.onAdded"), true, true);
      Zotero.Prefs.set(pref("metadata.autoUpdateOnAdded"), true, true);
      Zotero.Prefs.set(pref("metadata.repairCreators"), true, true);
      Zotero.Prefs.set(pref("easyscholar.autoUpdateOnAdded"), false, true);
      Zotero.Prefs.set(pref("rule.require-journal-abbr.infer"), false, true);
      Zotero.Prefs.set(pref("rule.correct-doi-long"), false, true);
      await plugin().hooks.onNotify("add", "item", [item.id], {});
      assert.equal(item.getField("date"), "2025");
      assert.equal(item.getField("publicationTitle"), "Automatic QA Journal");
      assert.lengthOf(item.getCreators(), 1);
      assert.isFalse(item.hasChanged());
      const workflow = plugin().api.getLastAutomaticWorkflow();
      assert.equal(workflow.undoScope, "stage");
      assert.deepEqual(workflow.stages.map((stage: any) => stage.phase), ["metadata", "format", "journal"]);
      assert.deepEqual(workflow.stages.map((stage: any) => stage.status), ["complete", "complete", "skipped"], JSON.stringify(plugin().runner.lastResult.records.map((row: any) => ({ rule: row.ruleID, code: row.code, message: row.message }))));
    }
    finally {
      (Zotero.Translate as any).Search = OriginalSearch;
      for (const [key, value] of previous)
        Zotero.Prefs.set(pref(key), value as boolean, true);
    }
  });

  it("composes metadata retrieval and existing formatters in the main workflow without a second settings dialog", async function () {
    const keys = [...Rules.getStandard().map(rule => `rule.${rule.id}`), "workflow.updateMetadata", "workflow.updateJournalRankings", "workflow.updateBibliographic", "workflow.formatAfterUpdate", "metadata.updateJournalInfo", "workflow.tldrEnabled"];
    const previous = new Map(keys.map(key => [key, Zotero.Prefs.get(pref(key), true)]));
    const Search = Zotero.Translate.Search;
    const item = new Zotero.Item("journalArticle");
    item.setField("title", "Combined workflow test.");
    item.setField("DOI", "10.1234/combined-qa");
    await item.saveTx();
    created.push(item);
    try {
      for (const key of keys)
        Zotero.Prefs.set(pref(key), false, true);
      Zotero.Prefs.set(pref("workflow.updateMetadata"), true, true);
      Zotero.Prefs.set(pref("workflow.updateBibliographic"), true, true);
      Zotero.Prefs.set(pref("workflow.formatAfterUpdate"), true, true);
      Zotero.Prefs.set(pref("rule.no-title-trailing-dot"), true, true);
      Zotero.Translate.Search = class {
        setIdentifier() {}
        setSearch() {}
        setTranslator() {}
        async getTranslators() { return [{}]; }
        async translate() { return [{ itemType: "journalArticle", title: "Combined workflow test.", DOI: "10.1234/combined-qa", date: "2025", publicationTitle: "Combined QA", volume: "1", issue: "2", pages: "3-4", abstractNote: "QA abstract", creators: [{ creatorType: "author", firstName: "Ada", lastName: "Lovelace" }] }]; }
      } as any;
      await plugin().hooks.onLintInBatch("tool-update-metadata", [item], { core: true });
      assert.equal(item.getField("date"), "2025");
      assert.equal(item.getField("title"), "Combined workflow test");
      assert.equal(plugin().runner.lastResult.saved, 1);
      assert.equal(plugin().runner.lastResult.failed, 0);
      assert.isTrue(plugin().runner.lastResult.changes.some((change: any) => change.ruleID === "tool-review-metadata"));
      assert.isTrue(plugin().runner.lastResult.changes.some((change: any) => change.ruleID === "no-title-trailing-dot"));
    }
    finally {
      Zotero.Translate.Search = Search;
      for (const [key, value] of previous) {
        if (value === undefined)
          Zotero.Prefs.clear(pref(key), true);
        else
          Zotero.Prefs.set(pref(key), value as boolean, true);
      }
    }
  });

  it("skips all ranking requests when outputs are disabled and preserves partial success after a source deadline", async function () {
    this.timeout(90_000);
    const keys = EASYSCHOLAR_FIELD_DEFINITIONS.map(field => `easyscholar.fields.${field.key}`);
    keys.push("easyscholar.secretKey", "easyscholar.clearExtraBeforeUpdate", "easyscholar.writeToExtra");
    const previous = new Map(keys.map(key => [key, Zotero.Prefs.get(pref(key), true)]));
    const request = Zotero.HTTP.request;
    const item = new Zotero.Item("journalArticle");
    item.setField("title", "Source deadline QA");
    item.setField("publicationTitle", "Deadline QA Journal");
    const originalExtra = ["Manual note", ["南农高质量", String.fromCharCode(58), " old"].join("")].join("\n");
    item.setField("extra", originalExtra);
    await item.saveTx();
    created.push(item);
    let requests = 0;
    try {
      for (const key of keys.filter(key => key.startsWith("easyscholar.fields.")))
        Zotero.Prefs.set(pref(key), false, true);
      Zotero.Prefs.set(pref("easyscholar.secretKey"), "isolated-qa-key", true);
      Zotero.Prefs.set(pref("easyscholar.clearExtraBeforeUpdate"), true, true);
      Zotero.Prefs.set(pref("easyscholar.writeToExtra"), true, true);
      Zotero.HTTP.request = (async (method: string, url: string, options: any) => {
        if (!["www.easyscholar.cc", "phq.njau.edu.cn"].includes(new URL(url).hostname))
          return request.call(Zotero.HTTP, method, url, options);
        requests++;
        if (url.includes("njau.edu.cn"))
          return new Promise(() => {});
        assert.include(url, "easyscholar.cc");
        return { status: 200, responseText: JSON.stringify({ code: 200, data: { officialRank: { all: { sciif: "8.4" } } } }) };
      }) as any;
      const run = () => plugin().runner.add({ items: [item], silent: true, rules: [{ id: "deadline-integration-qa", scope: "item", async apply() {
        await plugin().runner.applyRuleByID(item, "tool-update-easyscholar", {});
      } }] });
      await run();
      assert.equal(requests, 0);
      assert.equal(item.getField("extra"), originalExtra);
      Zotero.Prefs.set(pref("easyscholar.fields.impactFactor"), true, true);
      Zotero.Prefs.set(pref("easyscholar.fields.njauQuality"), true, true);
      await run();
      assert.equal(requests, 2);
      assert.include(item.getField("extra"), "8.4");
      assert.include(item.getField("extra"), "Manual note");
      assert.include(item.getField("extra"), originalExtra.split("\n")[1], "a failed supplemental source retains its saved ranking even in replacement-clearing mode");
      assert.equal(plugin().runner.lastResult.saved, 1);
      assert.isAbove(plugin().runner.lastResult.warnings, 0);
      assert.isFalse(item.hasChanged());
    }
    finally {
      Zotero.HTTP.request = request;
      for (const [key, value] of previous)
        Zotero.Prefs.set(pref(key), value as boolean | string, true);
    }
  });
});
