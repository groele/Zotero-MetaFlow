import { assert } from "chai";
import { config } from "../../package.json";
import { SemanticScholarService } from "../../src/modules/rules/tool-update-metadata/services/semantic-scholar-service";
import { clearRequestCache, requestServiceGET } from "../../src/utils/http";
import { useHTTPTransport } from "../../src/utils/http-transport";
import { clearStoredServiceCache, flushServiceCache, resetServiceCacheSession } from "../../src/utils/service-cache-storage";

describe("abbreviations, durable cache and quiet completion in Zotero", function () {
  this.timeout(30_000);
  let restoreTransport: (() => void) | undefined;
  const plugin = () => (Zotero as any)[config.addonInstance];
  const prefs = new Map<string, unknown>();
  const items: Zotero.Item[] = [];
  const pref = (key: string, value: string | boolean) => {
    const full = `${config.prefsPrefix}.${key}`;
    if (!prefs.has(full))
      prefs.set(full, Zotero.Prefs.get(full, true));
    Zotero.Prefs.set(full, value, true);
  };
  const create = async (publicationTitle: string, abbr = "") => {
    const item = new Zotero.Item("journalArticle");
    item.setField("title", "Abbreviation integration regression");
    item.setField("publicationTitle", publicationTitle);
    item.setField("journalAbbreviation", abbr);
    await item.saveTx();
    items.push(item);
    return item;
  };

  before(function () {
    restoreTransport = useHTTPTransport((method, url, options) => Zotero.HTTP.request(method, url, options));
    pref("lint.onAdded", false);
    pref("rule.require-journal-abbr.sourceMode", "auto");
    pref("rule.require-journal-abbr.existingPolicy", "known");
    pref("rule.require-journal-abbr.matchMode", "exact");
    pref("rule.require-journal-abbr.profile", "combined");
    pref("rule.require-journal-abbr.letterCase", "keep");
    pref("rule.require-journal-abbr.withDots", true);
    pref("rule.require-journal-abbr.infer", true);
    pref("rule.require-journal-abbr.customDataPath", "");
  });

  after(async function () {
    restoreTransport?.();
    clearRequestCache();
    await clearStoredServiceCache();
    for (const item of items)
      await item.eraseTx();
    for (const [key, value] of prefs) {
      if (value === undefined)
        Zotero.Prefs.clear(key, true);
      else
        Zotero.Prefs.set(key, value as string | boolean, true);
    }
  });

  it("writes verified built-in abbreviations and preserves unknown manual values", async function () {
    const known = await create("Nano Research", "Wrong abbreviation");
    const manual = await create("Unlisted Madeup Journal 78291", "My manual abbreviation");
    await plugin().hooks.onLintInBatch(["require-journal-abbr"], [known, manual]);
    assert.equal(known.getField("journalAbbreviation"), "Nano Res.");
    assert.equal(manual.getField("journalAbbreviation"), "My manual abbreviation");
    assert.equal(plugin().runner.lastResult.failed, 0);
    pref("rule.require-journal-abbr.existingPolicy", "blank");
    await plugin().hooks.onLintInBatch(["require-journal-abbr"], [known]);
    assert.equal(known.getField("journalAbbreviation"), "Nano Res.");
    pref("rule.require-journal-abbr.existingPolicy", "known");
  });

  it("infers ISO 4 offline with the production LTWA asset", async function () {
    const original = Zotero.HTTP.request;
    Zotero.HTTP.request = async (method, url, options) => {
      if (["localhost", "127.0.0.1"].includes(new URL(url).hostname))
        return original(method, url, options);
      throw new Error("ISO 4 must not use the network");
    };
    try {
      pref("rule.require-journal-abbr.sourceMode", "iso4");
      const item = await create("Journal of Experimental Biology");
      await plugin().hooks.onLintInBatch(["require-journal-abbr"], [item]);
      assert.equal(item.getField("journalAbbreviation"), "J. Exp. Biol.");
      assert.equal(plugin().runner.lastResult.failed, 0);
    }
    finally {
      Zotero.HTTP.request = original;
      pref("rule.require-journal-abbr.sourceMode", "auto");
    }
  });

  it("reuses a real profile cache file across session resets without writing API keys", async function () {
    await clearStoredServiceCache();
    clearRequestCache();
    const original = Zotero.HTTP.request;
    let calls = 0;
    Zotero.HTTP.request = async (method, url, options) => {
      if (new URL(url).hostname !== "example.test")
        return original(method, url, options);
      calls++;
      return { status: 200, response: "{\"paperId\":\"durable-fixture\"}", responseText: "{\"paperId\":\"durable-fixture\"}" } as XMLHttpRequest;
    };
    const fetch = () => requestServiceGET("semantic-scholar", "https://example.test/durable-fixture", { headers: { "x-api-key": "fixture-do-not-persist-key" } });
    try {
      await Promise.all([fetch(), fetch(), fetch()]);
      assert.equal(calls, 1);
      await flushServiceCache();
      const path = PathUtils.join((Zotero as any).Profile.dir, "zotero-metaflow-cache", "api-responses-v1.json");
      const text = await IOUtils.readUTF8(path);
      assert.notInclude(text, "fixture-do-not-persist-key");
      assert.include(text, "durable-fixture");
      clearRequestCache();
      resetServiceCacheSession();
      await fetch();
      assert.equal(calls, 1, "restored response avoids a network request");
      clearRequestCache();
      await clearStoredServiceCache();
      await fetch();
      assert.equal(calls, 2, "explicit clear allows a fresh request");
    }
    finally { Zotero.HTTP.request = original; }
  });

  it("shares Semantic Scholar identifier and metadata requests for the same paper", async function () {
    pref("semanticScholarToken", "semantic-fixture-token");
    const original = Zotero.HTTP.request;
    let calls = 0;
    Zotero.HTTP.request = async (method, url, options) => {
      if (new URL(url).hostname !== "api.semanticscholar.org")
        return original(method, url, options);
      calls++;
      const response = JSON.stringify({ paperId: "cache-alias-fixture", title: "Alias fixture", externalIds: { DOI: "10.1234/cache-alias-fixture" } });
      return { status: 200, response, responseText: response } as XMLHttpRequest;
    };
    try {
      const identifiers = { DOI: "10.1234/cache-alias-fixture" };
      const ctx = { item: { itemType: "conferencePaper" } as Zotero.Item, identifiers, isPreprint: false, debug: () => {} };
      await SemanticScholarService.updateIdentifiers!(ctx);
      const data = await SemanticScholarService.fetch!(ctx);
      assert.equal(data?.title, "Alias fixture");
      assert.equal(calls, 1);
    }
    finally { Zotero.HTTP.request = original; }
  });

  it("does not revive a progress notification closed before initialization finishes", async function () {
    pref("lint.notify", true);
    const ui = plugin().runner.ui;
    const initializing = ui.init(false, "Immediate completion fixture");
    const helper = (ui as any).progressWindow;
    ui.close();
    await initializing;
    await Zotero.Promise.delay(300);
    assert.isUndefined((ui as any).progressWindow);
    assert.isFalse((ui as any).running);
    const nativeWindow = helper.lines[0]?._itemText?.ownerDocument?.defaultView;
    if (nativeWindow)
      assert.isTrue(nativeWindow.closed, "a late load cannot restore a completed task notification");
  });

  it("closes a normal success notification after five seconds without mouse interaction", async function () {
    pref("lint.notify", true);
    const ui = plugin().runner.ui;
    await ui.init();
    const helper = (ui as any).progressWindow;
    const nativeWindow = helper.lines[2]._itemText.ownerDocument.defaultView;
    try {
      ui.showFinished(1, 0, 0.1, false, 0, 0, { saved: 1, unchanged: 0, notApplicable: 0, warnings: 0 });
      await Zotero.Promise.delay(500);
      assert.isFalse(nativeWindow.closed, "a success stays visible long enough to read");
      for (const indicator of nativeWindow.document.querySelectorAll("progressmeter, progress, [role='progressbar']"))
        assert.isTrue(indicator.hasAttribute("hidden"), "completed notices do not retain a progress track");
      const parent = Zotero.getMainWindow();
      assert.closeTo(nativeWindow.screenX, parent.screenX + parent.outerWidth - nativeWindow.outerWidth - 25, 2);
      assert.isBelow(nativeWindow.screenY, parent.screenY + parent.outerHeight);
      nativeWindow.dispatchEvent(new nativeWindow.MouseEvent("mouseover", { bubbles: true }));
      await Zotero.Promise.delay(5000);
      assert.isTrue(nativeWindow.closed, "no mouse entry is required to dismiss the notice");
      assert.isFalse(ui.running);
    }
    finally { ui.close(); }
  });

  it("opens the completed report only on click, retaining its original records", async function () {
    pref("lint.notify", true);
    const ui = plugin().runner.ui;
    await ui.init();
    const nativeWindow = (ui as any).progressWindow.lines[2]._itemText.ownerDocument.defaultView;
    const before = new Set(plugin().data.dialogs.values());
    const records = ["tool-review-metadata", "tool-update-easyscholar"].map(ruleID => ({ itemID: 0, title: "Completed task fixture", ruleID, level: "info", message: "Original notification report" }));
    try {
      ui.showFinished(1, 0, 0.1, false, 0, 0, { saved: 1, unchanged: 0, notApplicable: 0, warnings: 0, records, changes: [] });
      await Zotero.Promise.delay(200);
      assert.equal(plugin().data.dialogs.size, before.size, "completion does not open a report");
      nativeWindow.dispatchEvent(new nativeWindow.MouseEvent("mouseup", { bubbles: true, button: 0 }));
      for (let attempt = 0; attempt < 100 && plugin().data.dialogs.size === before.size; attempt++)
        await Zotero.Promise.delay(25);
      assert.isTrue(nativeWindow.closed);
      const report = [...plugin().data.dialogs.values()].find(win => !before.has(win)) as Window;
      assert.exists(report);
      assert.include(report.document.body!.textContent, "Original notification report");
      assert.notInclude(report.document.body!.textContent, "metaref-rule-tool-review-metadata");
      assert.notInclude(report.document.body!.textContent, "metaref-rule-tool-update-easyscholar");
      report.close();
    }
    finally {
      ui.close();
      for (const win of plugin().data.dialogs.values()) {
        if (!before.has(win))
          win.close();
      }
    }
  });
});
