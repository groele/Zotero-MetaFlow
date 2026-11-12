import { assert } from "chai";
import { config } from "../../package.json";
import { EASYSCHOLAR_FIELD_DEFINITIONS } from "../../src/utils/easyscholar";

describe("core command execution and optional costs", function () {
  this.timeout(60_000);
  const plugin = () => (Zotero as any)[config.addonInstance];
  const saved = new Map<string, unknown>();
  const created: number[] = [];
  const pref = (key: string, value: string | boolean) => {
    const full = `${config.prefsPrefix}.${key}`;
    if (!saved.has(full))
      saved.set(full, Zotero.Prefs.get(full, true));
    Zotero.Prefs.set(full, value, true);
  };
  let Search: typeof Zotero.Translate.Search;
  let request: typeof Zotero.HTTP.request;
  let alert: typeof Zotero.alert;
  let translations = 0;
  let requests = 0;
  let providerRequests: string[] = [];
  let requestedJournals: string[] = [];
  let response: any;
  const create = async (title = "Core workflow fixture.", doi = "10.1234/core-workflow") => {
    const item = new Zotero.Item("journalArticle");
    item.setField("title", title);
    item.setField("DOI", doi);
    await item.saveTx();
    created.push(item.id);
    return item;
  };
  const dialog = async (selector: string) => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const main = Zotero.getMainWindow();
      const win = main.document.querySelector(selector) ? main : undefined;
      if (win)
        return win;
      await Zotero.Promise.delay(25);
    }
    throw new Error("Core metadata review did not open");
  };

  const progressNotice = async () => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const win = [...Services.wm.getEnumerator("") as unknown as Iterable<Window>]
        .find(win => !win.closed && win.document.documentElement?.hasAttribute("data-metaref-core-progress"));
      if (win)
        return win;
      await Zotero.Promise.delay(25);
    }
    throw new Error("Native core progress did not open");
  };

  before(function () {
    Search = Zotero.Translate.Search;
    request = Zotero.HTTP.request;
    alert = Zotero.alert;
  });

  beforeEach(function () {
    pref("lint.notify", true);
    translations = requests = 0;
    requestedJournals = [];
    providerRequests = [];
    for (const key of ["lint.onAdded", "workflow.updateMetadata", "workflow.remoteAuthorsOnCheck", "workflow.updateJournalRankings", "workflow.reviewDuplicatesOnCheck", "workflow.reviewDuplicatesOnUpdate", "workflow.scanPDF", "workflow.searchTitle", "metadata.updateJournalInfo"])
      pref(key, false);
    pref("workflow.updateBibliographic", true);
    pref("workflow.formatAfterUpdate", true);
    pref("rule.tool-update-metadata.option.mode", "blank");
    pref("rule.no-title-trailing-dot", true);
    pref("rule.no-item-duplication", false);
    response = { ISSN: "1530-6984", itemType: "journalArticle", title: "Core workflow fixture.", DOI: "10.1234/core-workflow", date: "2026", creators: [{ creatorType: "author", firstName: "Jane", lastName: "Doe" }] };
    (Zotero.Translate as any).Search = function () {
      return { setIdentifier() {}, setSearch() {}, getTranslators: async () => ["controlled"], setTranslator() {}, translate: async () => {
        translations++;
        return [structuredClone(response)];
      } };
    };
    (Zotero.HTTP as any).request = async (_method: string, url: string, options: any) => {
      if (url.startsWith("http://localhost:"))
        return request.call(Zotero.HTTP, _method, url, options);
      const target = new URL(url);
      // The host retraction service shares HTTP.request and is independent of MetaFlow.
      // Keep this exact first-party endpoint separate from all plugin provider calls.
      if (target.origin === "https://api.zotero.org" && target.pathname === "/retractions/search")
        return request.call(Zotero.HTTP, _method, url, options);
      providerRequests.push(target.origin + target.pathname);
      if (url.includes("crossref.org") || url.includes("semanticscholar.org"))
        return { status: 404, responseText: "{}" };
      requests++;
      if (!url.includes("easyscholar.cc")) {
        const target = new URL(url);
        requestedJournals.push(`unexpected: ${target.origin}${target.pathname}`);
      }
      assert.include(url, "easyscholar.cc", "fallback searches do not silently contact another service");
      requestedJournals.push(new URL(url).searchParams.get("publicationName") || "unknown journal");
      return { status: 200, responseText: JSON.stringify({ code: 200, data: { officialRank: { all: { sci: "Q1" } } } }) };
    };
    (Zotero as any).alert = () => {};
  });

  afterEach(async function () {
    (Zotero.Translate as any).Search = Search;
    Zotero.HTTP.request = request;
    Zotero.alert = alert;
    (Zotero.getMainWindow().document.getElementById("metaref-review-cancel") as HTMLButtonElement | null)?.click();
    for (const win of plugin().data.dialogs.values())
      win.close();
    await plugin().runner.add({ items: [], rules: [], silent: true });
    for (const id of created.splice(0).reverse()) {
      const item = await Zotero.Items.getAsync(id);
      if (item)
        await item.eraseTx();
    }
    for (const [key, value] of saved) {
      if (value === undefined)
        Zotero.Prefs.clear(key, true);
      else
        Zotero.Prefs.set(key, value as any, true);
    }
    saved.clear();
  });

  it("checks locally without querying identifiers, authors or journal providers", async function () {
    const item = await create();
    await plugin().hooks.onLintInBatch("standard", [item], { core: true });
    assert.equal(item.getField("title"), "Core workflow fixture");
    assert.equal(translations, 0, "local repair must not invoke a translator");
    assert.deepEqual(providerRequests, [], "local repair must not contact any external provider");
    assert.equal(requests, 0, `local repair must not query a journal provider: ${requestedJournals.join(", ")}`);
  });

  it("honors local and cloud priority in both core commands without bypassing DOI verification", async function () {
    pref("workflow.updateMetadata", true);
    pref("workflow.formatAfterUpdate", false);
    response.title = "Verified cloud title";
    for (const command of ["standard", "tool-update-metadata"]) {
      const item = await create("Local corrected title");
      item.setField("date", "2025");
      item.setField("publicationTitle", "Local corrected journal");
      await item.saveTx();
      response.publicationTitle = "Verified Cloud Journal";
      pref("rule.tool-update-metadata.option.mode", "blank");
      await plugin().hooks.onLintInBatch(command, [item], command === "standard" ? { core: true } : { review: true });
      assert.equal(item.getField("title"), "Local corrected title");
      assert.equal(item.getField("date"), "2025");
      if (command === "standard") {
        assert.equal(item.getField("publicationTitle"), "Local Corrected Journal", "the local publication-title rule normalizes capitalization");
        continue;
      }
      pref("rule.tool-update-metadata.option.mode", "all");
      await plugin().hooks.onLintInBatch(command, [item], { review: true });
      await item.reload(["itemData", "creators"], true);
      assert.equal(item.getField("title"), response.title);
      assert.equal(item.getField("date"), "2026");
      assert.equal(item.getField("publicationTitle"), "Verified Cloud Journal");
      assert.isTrue(plugin().runner.lastResult.records.some((record: any) => record.code === "metadata-cloud-priority"));
      const correctDOI = response.DOI;
      response.DOI = "10.1234/wrong-work";
      response.title = "Contradictory DOI title";
      try {
        await plugin().hooks.onLintInBatch(command, [item], command === "standard" ? { core: true } : { review: true });
        assert.equal(item.getField("DOI"), correctDOI);
        assert.notEqual(item.getField("title"), response.title);
        assert.isTrue(plugin().runner.lastResult.records.some((record: any) => record.code === "metadata-auto-blocked"));
      }
      finally {
        response.DOI = correctDOI;
        response.title = "Verified cloud title";
      }
    }
  });

  it("reuses the running window for completion and opens details only on click", async function () {
    pref("lint.notify", true);
    const item = await create();
    const before = plugin().data.dialogs.size;
    const runner = plugin().runner;
    const add = runner.add;
    let release!: () => void;
    const gate = new Promise<void>(resolve => release = resolve);
    runner.add = async function (...args: any[]) {
      await gate;
      return add.apply(this, args);
    };
    let running: Window;
    const pending = plugin().hooks.onLintInBatch("standard", [item], { core: true });
    try {
      running = await progressNotice();
      release();
      await pending;
    }
    finally {
      release();
      runner.add = add;
      await pending;
    }
    const notices = () => [...Services.wm.getEnumerator("") as unknown as Iterable<Window>]
      .filter(win => !win.closed && win.document.documentElement?.hasAttribute("data-metaref-completion"));
    for (let attempt = 0; attempt < 100 && !notices().length; attempt++)
      await Zotero.Promise.delay(25);
    assert.lengthOf(notices(), 1);
    assert.equal(plugin().data.dialogs.size, before);
    assert.isNull(Zotero.getMainWindow().document.querySelector("#metaref-core-task"));
    const notice = notices()[0];
    assert.strictEqual(notice, running!, "completion updates the same native window without reopening it");
    assert.isFalse(notice.document.documentElement!.hasAttribute("data-metaref-core-progress"));
    assert.equal(notice.document.querySelector("#metaref-core-task-action")?.getAttribute("hidden"), "true");
    const content = notice.document.getElementById("zotero-progress-text-box")!;
    content.dispatchEvent(new (notice as any).KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    for (let attempt = 0; attempt < 100 && plugin().data.dialogs.size === before; attempt++)
      await Zotero.Promise.delay(25);
    assert.isTrue(notice.closed);
    assert.equal(plugin().data.dialogs.size, before + 1);
  });

  it("stops a core task waiting for the runner without cancelling or modifying another task", async function () {
    const other = await create("Background task", "10.1234/background-task");
    const target = await create();
    let started!: () => void;
    let release!: () => void;
    const entered = new Promise<void>(resolve => started = resolve);
    const gate = new Promise<void>(resolve => release = resolve);
    const background = plugin().runner.add({ items: [other], silent: true, rules: [{ id: "require-language", scope: "item", async apply({ item }: any) {
      started();
      await gate;
      item.setField("language", "en");
    } }] });
    await entered;
    const pending = plugin().hooks.onLintInBatch("standard", [target], { core: true });
    try {
      for (let attempt = 0; attempt < 100 && !plugin().data.activeCoreWorkflow; attempt++)
        await Zotero.Promise.delay(10);
      const notice = await progressNotice();
      const stop = notice.document.querySelector<HTMLElement>("#metaref-core-task-action")!;
      assert.isNotNull(stop);
      stop.dispatchEvent(new (notice as any).MouseEvent("click", { bubbles: true }));
    }
    finally { release(); }
    assert.isFalse((await background).cancelled);
    assert.equal(other.getField("language"), "en");
    const result = await pending;
    assert.isTrue(result.cancelled);
    assert.equal(result.saved, 0);
    assert.equal(result.failed, 0);
    assert.equal(target.getField("title"), "Core workflow fixture.");
  });

  it("retains saved journal outcomes when presentation refresh fails", async function () {
    const item = await create();
    item.setField("publicationTitle", "Commercial feedback failure fixture");
    await item.saveTx();
    pref("workflow.updateBibliographic", false);
    pref("workflow.formatAfterUpdate", false);
    pref("metadata.updateJournalInfo", true);
    pref("easyscholar.secretKey", "feedback-failure-test-key");
    pref("easyscholar.writeToExtra", true);
    for (const field of EASYSCHOLAR_FIELD_DEFINITIONS)
      pref(`easyscholar.fields.${field.key}`, field.key === "sci");
    const original = Zotero.Notifier.trigger;
    Zotero.Notifier.trigger = (async (event: string, type: string, ids: number[], ...args: any[]) => {
      if (event === "redraw" && type === "item" && ids.includes(item.id))
        throw new Error("Injected presentation failure");
      return original.call(Zotero.Notifier, event, type, ids, ...args);
    }) as typeof Zotero.Notifier.trigger;
    try {
      const result = await plugin().hooks.onLintInBatch("tool-update-metadata", [item], { review: true });
      assert.equal(result.saved, 1, "a presentation error cannot erase committed outcomes");
      assert.equal(result.preparationFailed, 0);
      assert.isTrue(result.records.some((record: any) => record.code === "journal-refresh-failed" && record.level === "warning"));
      assert.include(item.getField("extra"), "SCI: 是");
      assert.deepEqual(plugin().data.lastCoreWorkflow.stages.map((entry: any) => entry.stage), ["journal"]);
    }
    finally { Zotero.Notifier.trigger = original; }
  });

  it("keeps one complete result and runtime record without double-counting saves", async function () {
    const item = await create();
    const dialogs = plugin().data.dialogs.size;
    const runtime = plugin().api.runtimeData;
    await runtime.flush();
    const before = new Set((await runtime.read()).runs.map((run: any) => run.id));
    const result = await plugin().hooks.onLintInBatch("tool-update-metadata", [item, item], { review: true });
    assert.equal(result.total, 1);
    assert.equal(result.saved, 1, "metadata and formatting save the same reference only once in the summary");
    assert.isTrue(result.changes.some((change: any) => change.field === "date"));
    assert.isTrue(result.changes.some((change: any) => change.field === "title"));
    assert.strictEqual(plugin().runner.lastResult, result);
    assert.strictEqual(plugin().data.lastCoreWorkflow.lastResult, result);
    await runtime.flush();
    const added = (await runtime.read()).runs.filter((run: any) => !before.has(run.id));
    assert.lengthOf(added, 1, "stage saves do not create redundant history entries");
    assert.equal(added[0].kind, "core-update");
    const doc = Zotero.getMainWindow().document;
    assert.isNull(doc.getElementById("metaref-core-task"), "completed tasks remove their inline controls");
    assert.equal(plugin().data.dialogs.size, dialogs, "completion does not open a detailed report");
  });

  it("shows native progress without an inline bar and stops later stages without a metadata confirmation window", async function () {
    const item = await create();
    const doc = Zotero.getMainWindow().document;
    (Zotero.Translate as any).Search = function () {
      return { setIdentifier() {}, getTranslators: async () => ["controlled"], setTranslator() {}, translate: async () => {
        assert.equal(plugin().data.activeCoreWorkflow.stage, "metadata");
        const notice = await progressNotice();
        const stop = notice.document.querySelector<HTMLElement>("#metaref-core-task-action")!;
        assert.isNotNull(stop);
        assert.isNull(doc.getElementById("metaref-core-task"), "running commands never add a bottom bar");
        assert.isNotNull(notice.document.querySelector("[aria-live=\"polite\"]"));
        assert.isNull(doc.getElementById("metaref-metadata-review"));
        stop.dispatchEvent(new (notice as any).MouseEvent("click", { bubbles: true }));
        assert.equal(stop.getAttribute("aria-disabled"), "true");
        return [structuredClone(response)];
      } };
    };
    const result = await plugin().hooks.onLintInBatch("tool-update-metadata", [item], { review: true });
    assert.isTrue(result.cancelled);
    assert.isUndefined(plugin().data.activeCoreWorkflow);
    assert.equal(item.getField("title"), "Core workflow fixture.");
    assert.deepEqual(plugin().data.lastCoreWorkflow.stages.map((entry: any) => entry.stage), ["metadata"]);
  });

  it("does not return a stale result when all update stages are disabled", async function () {
    const item = await create();
    await plugin().hooks.onLintInBatch("standard", [item], { core: true });
    pref("workflow.updateBibliographic", false);
    pref("workflow.formatAfterUpdate", false);
    const result = await plugin().hooks.onLintInBatch("tool-update-metadata", [item], { review: true });
    assert.equal(result.processed, 0);
    assert.isEmpty(result.records);
    assert.isEmpty(plugin().data.lastCoreWorkflow.stages);
    assert.strictEqual(plugin().runner.lastResult, result);
    assert.isNull(Zotero.getMainWindow().document.getElementById("metaref-core-task"));
  });

  it("queues different core commands as complete workflows without interleaving their stages", async function () {
    const item = await create();
    const runner = plugin().runner;
    const original = runner.add;
    const order: string[] = [];
    runner.add = function (options: any) {
      order.push(plugin().data.activeCoreWorkflow.command);
      return original.call(this, options);
    };
    try {
      const update = plugin().hooks.onLintInBatch("tool-update-metadata", [item], { review: true });
      const check = plugin().hooks.onLintInBatch("standard", [item], { core: true });
      const results = await Promise.all([update, check]);
      assert.deepEqual(order, ["update", "update", "check"]);
      assert.isTrue(results[0].changes.some((change: any) => change.field === "date"));
      assert.isFalse(results[1].changes.some((change: any) => change.field === "date"));
      assert.isUndefined(plugin().data.activeCoreWorkflow);
    }
    finally { runner.add = original; }
  });

  it("combines full metadata and enabled author repair once and coalesces repeated clicks", async function () {
    const item = await create();
    pref("workflow.updateMetadata", true);
    pref("workflow.remoteAuthorsOnCheck", true);
    pref("metadata.repairCreators", true);
    const first = plugin().hooks.onLintInBatch("tool-update-metadata", [item], { core: true });
    const second = plugin().hooks.onLintInBatch("tool-update-metadata", [item], { core: true });
    await Promise.all([first, second]);
    await Promise.all([first, second]);
    assert.equal(translations, 1);
    assert.equal(item.getField("title"), "Core workflow fixture");
    assert.equal(item.getField("date"), "2026");
    assert.equal(item.getCreators()[0].lastName, "Doe", "the current author-repair switch takes effect in the online workflow");
    const workflow = plugin().data.lastCoreWorkflow;
    assert.deepEqual(workflow.stages.map((entry: any) => entry.stage), ["metadata", "format"]);
    assert.isTrue(workflow.stages[0].result.changes.some((change: any) => change.field === "date"), "later formatting retains earlier metadata evidence");
  });

  it("stops following stages when automatic metadata lookup is cancelled", async function () {
    const item = await create();
    pref("metadata.updateJournalInfo", true);
    (Zotero.Translate as any).Search = function () {
      return { setIdentifier() {}, getTranslators: async () => ["controlled"], setTranslator() {}, translate: async () => {
        plugin().runner.cancel();
        return [structuredClone(response)];
      } };
    };
    const result = await plugin().hooks.onLintInBatch("tool-update-metadata", [item], { review: true });
    assert.isTrue(result.cancelled);
    assert.equal(item.getField("title"), "Core workflow fixture.");
    assert.equal(requests, 0);
  });

  it("formats after an accepted update without adding another metadata or duplicate scan", async function () {
    const item = await create();
    pref("rule.no-item-duplication", true);
    const runner = plugin().runner;
    const original = runner.add;
    const batches: string[][] = [];
    runner.add = function (options: any) {
      batches.push(options.rules.map((rule: any) => rule.id));
      return original.call(this, options);
    };
    try {
      const pending = plugin().hooks.onLintInBatch("tool-update-metadata", [item], { review: true });
      await pending;
      assert.equal(item.getField("title"), "Core workflow fixture");
      assert.equal(item.getField("date"), "2026");
      assert.equal(translations, 1);
      assert.lengthOf(batches, 2);
      assert.deepEqual(batches[0], ["tool-review-metadata", "tool-update-metadata"]);
      assert.equal(item.getField("ISSN"), "1530-6984", "the review persists ISSN before the missing-ISSN fallback");
      for (const id of ["no-item-duplication", "tool-update-metadata", "correct-doi-long"])
        assert.notInclude(batches[1], id);
      assert.deepEqual(plugin().data.lastCoreWorkflow.stages.map((entry: any) => entry.stage), ["metadata", "format"]);
    }
    finally { runner.add = original; }
  });

  it("updates journal metrics even when bibliographic review and formatting are disabled", async function () {
    const item = await create();
    item.setField("publicationTitle", "Core Workflow Metrics Fixture");
    item.setField("date", "2026");
    await item.saveTx();
    pref("workflow.updateBibliographic", false);
    pref("workflow.formatAfterUpdate", false);
    pref("metadata.updateJournalInfo", true);
    pref("easyscholar.secretKey", "core-workflow-test-key");
    pref("easyscholar.writeToExtra", true);
    pref("insights.natureEnabled", false);
    for (const field of EASYSCHOLAR_FIELD_DEFINITIONS)
      pref(`easyscholar.fields.${field.key}`, field.key === "sci");
    await plugin().hooks.onLintInBatch("tool-update-metadata", [item], { review: true });
    assert.equal(translations, 0);
    assert.equal(requests, 1, `journal requests: ${requestedJournals.join(", ")}`);
    assert.include(item.getField("extra"), "SCI: 是");
    assert.equal(item.getField("title"), "Core workflow fixture.");
    pref("workflow.updateBibliographic", true);
    const pending = plugin().hooks.onLintInBatch("tool-update-metadata", [item], { review: true });
    const result = await pending;
    assert.isTrue(result.records.some((record: any) => record.code === "journal-summary"), "unchanged bibliography does not suppress the metrics stage");
    assert.equal(requests, 1, `the second metrics lookup reuses its cached response: ${requestedJournals.join(", ")}`);
  });

  it("does not search by title or scan PDF caches when both fallback options are disabled", async function () {
    const item = await create("No identifier fixture", "");
    const fixture = Zotero.Prefs.get("metaref.test.fixturePath", true) as string;
    const attachment = await Zotero.Attachments.importFromFile({ file: PathUtils.join(fixture, "pages-three.pdf"), parentItemID: item.id });
    await IOUtils.writeUTF8(Zotero.Fulltext.getItemCacheFile(attachment).path, "DOI: 10.1234/core-pdf-fallback");
    assert.isEmpty(await plugin().api.review.discoverIdentifiers(item, undefined, false));
    pref("lint.notify", true);
    translations = requests = 0;
    pref("workflow.formatAfterUpdate", false);
    const pending = plugin().hooks.onLintInBatch("tool-update-metadata", [item], { review: true });
    await pending;
    assert.equal(translations + requests, 0);
    assert.equal(item.getField("DOI"), "");
  });

  it("automatically fills from a PDF only when enabled and independently corroborated", async function () {
    const item = await create("Core workflow fixture.", "");
    item.setField("date", "2026");
    await item.saveTx();
    const fixture = Zotero.Prefs.get("metaref.test.fixturePath", true) as string;
    const attachment = await Zotero.Attachments.importFromFile({ file: PathUtils.join(fixture, "pages-three.pdf"), parentItemID: item.id });
    await IOUtils.writeUTF8(Zotero.Fulltext.getItemCacheFile(attachment).path, "DOI: 10.1234/core-workflow");
    pref("workflow.scanPDF", true);
    pref("workflow.formatAfterUpdate", false);
    translations = 0;
    await plugin().hooks.onLintInBatch("tool-update-metadata", [item], { review: true });
    assert.equal(translations, 1);
    assert.equal(item.getField("DOI"), "10.1234/core-workflow");
    assert.isNull(Zotero.getMainWindow().document.getElementById("metaref-review-panel"));
  });

  it("only snapshots matching duplicate candidates, retaining full freshness checks", async function () {
    const left = await create("Candidate", "10.1234/core-dupe");
    const right = await create("Candidate", "10.1234/core-dupe");
    const unrelated = await create("Unrelated", "10.1234/core-unrelated");
    const original = unrelated.toJSON;
    unrelated.toJSON = () => {
      throw new Error("An unrelated item's full metadata should not be serialized");
    };
    try {
      const pairs = await plugin().api.review.findDuplicates([left]);
      assert.lengthOf(pairs, 1);
      assert.equal(pairs[0].right.id, right.id);
      assert.equal(pairs[0].left.data.key, left.key, "matching candidates still carry complete snapshots");
    }
    finally { unrelated.toJSON = original; }
  });

  it("allows a title lookup only after its fallback option is enabled", async function () {
    const item = await create("Core workflow fixture.", "");
    item.setField("date", "2026");
    item.setCreators([{ creatorType: "author", firstName: "Jane", lastName: "Doe" }]);
    await item.saveTx();
    pref("workflow.searchTitle", true);
    pref("workflow.formatAfterUpdate", false);
    const pending = plugin().hooks.onLintInBatch("tool-update-metadata", [item], { review: true });
    await pending;
    assert.equal(translations, 1);
    assert.equal(item.getField("DOI"), "10.1234/core-workflow");
  });

  it("does not look up a linked publication until version lookup is enabled", async function () {
    const item = new Zotero.Item("preprint");
    item.setField("title", "Core workflow fixture.");
    item.setField("url", "https://arxiv.org/abs/2610.65432v1");
    await item.saveTx();
    created.push(item.id);
    pref("workflow.formatAfterUpdate", false);
    (Zotero.HTTP as any).request = async () => ({ status: 200, response: "<feed xmlns=\"http://www.w3.org/2005/Atom\" xmlns:arxiv=\"http://arxiv.org/schemas/atom\"><entry><id>https://arxiv.org/abs/2610.65432v1</id><title>Core workflow fixture.</title><published>2026-10-01</published><arxiv:doi>10.1234/core-workflow</arxiv:doi></entry></feed>" });
    for (const enabled of [false, true]) {
      pref("workflow.updateVersions", enabled);
      const pending = plugin().hooks.onLintInBatch("tool-update-metadata", [item], { review: true });
      await pending;
      assert.equal(translations, enabled ? 1 : 0);
    }
    assert.equal(item.itemType, "preprint");
    for (const key of item.relatedItems) {
      const published = Zotero.Items.getByLibraryAndKey(item.libraryID, key);
      if (published)
        created.push(published.id);
    }
  });

  const prepareVersion = async (format = false) => {
    const item = new Zotero.Item("preprint");
    item.setField("title", "Core workflow fixture.");
    item.setField("url", "https://arxiv.org/abs/2610.65432v1");
    item.setCreators([{ creatorType: "author", firstName: "Local", lastName: "Doe" }]);
    await item.saveTx();
    created.push(item.id);
    pref("workflow.updateVersions", true);
    pref("workflow.formatAfterUpdate", format);
    pref("metadata.repairCreators", false);
    (Zotero.HTTP as any).request = async () => ({ status: 200, response: "<feed xmlns=\"http://www.w3.org/2005/Atom\" xmlns:arxiv=\"http://arxiv.org/schemas/atom\"><entry><id>https://arxiv.org/abs/2610.65432v1</id><title>Core workflow fixture.</title><published>2026-10-01</published><arxiv:doi>10.1234/core-workflow</arxiv:doi></entry></feed>" });
    return { item, run: () => plugin().hooks.onLintInBatch("tool-update-metadata", [item], { review: true }) };
  };

  it("automatically links a publication while respecting the disabled author switch", async function () {
    const { item, run } = await prepareVersion();
    const result = await run();
    assert.equal(result.failed, 0);
    assert.equal(result.saved, 1);
    assert.equal(result.changed, 1);
    assert.equal(item.itemType, "preprint");
    assert.lengthOf(item.relatedItems, 1);
    const published = Zotero.Items.getByLibraryAndKey(item.libraryID, item.relatedItems[0])!;
    if (!published)
      throw new Error("The fixture publication was not created");
    created.push(published.id);
    assert.equal(published.getCreators()[0].firstName, "Local");
    assert.isTrue(result.records.some((record: any) => record.code === "version-related"));
    assert.isTrue(result.changes.some((change: any) => change.field === "relations" && change.saved));
    assert.isNull(Zotero.getMainWindow().document.getElementById("metaref-review-panel"));
  });

  it("rejects a related-version response after an intervening manual edit", async function () {
    const { item, run } = await prepareVersion();
    const original = Zotero.Search.prototype.search;
    Zotero.Search.prototype.search = (async function (this: Zotero.Search, ...args: Parameters<typeof original>) {
      item.setField("extra", "An edit made during lookup");
      await item.saveTx();
      return original.apply(this, args);
    }) as typeof original;
    try {
      const result = await run();
      assert.equal(result.failed, 1);
      assert.equal(result.saved, 0);
      assert.isEmpty(item.relatedItems);
      assert.equal(item.getField("extra"), "An edit made during lookup");
      assert.isTrue(result.records.some((record: any) => record.code === "version-related-failed"));
    }
    finally { Zotero.Search.prototype.search = original; }
  });

  it("propagates cancellation during related-publication lookup before formatting", async function () {
    const { item, run } = await prepareVersion(true);
    const original = Zotero.Search.prototype.search;
    Zotero.Search.prototype.search = (async function (this: Zotero.Search, ...args: Parameters<typeof original>) {
      plugin().runner.cancel();
      return original.apply(this, args);
    }) as typeof original;
    try {
      const result = await run();
      assert.isTrue(result.cancelled);
      assert.isEmpty(item.relatedItems);
      assert.equal(item.getField("title"), "Core workflow fixture.");
      assert.equal(result.saved, 0);
    }
    finally { Zotero.Search.prototype.search = original; }
  });

  it("retains decisions in the combined report when duplicate review is the only enabled stage", async function () {
    pref("workflow.updateBibliographic", false);
    pref("workflow.formatAfterUpdate", false);
    pref("workflow.reviewDuplicatesOnUpdate", true);
    pref("duplicates.nonDuplicatePairs", "[]");
    const a = await create("Duplicate-only fixture", "10.1234/duplicate-only");
    await create("Duplicate-only fixture", "10.1234/duplicate-only");
    const pending = plugin().hooks.onLintInBatch("tool-update-metadata", [a], { review: true });
    const win = await dialog("#metaref-duplicate-review");
    const action = win.document.getElementById("metaref-duplicate-action") as HTMLSelectElement;
    action.value = "notDuplicate";
    action.dispatchEvent(new (win as any).Event("change", { bubbles: true }));
    (win.document.getElementById("metaref-duplicate-apply") as HTMLButtonElement).click();
    const result = await pending;
    assert.equal(result.processed, 2);
    assert.equal(result.saved, 0);
    assert.isFalse(result.cancelled);
    assert.lengthOf(result.records, 1);
    assert.deepEqual(plugin().data.lastCoreWorkflow.stages.map((entry: any) => entry.stage), ["duplicates"]);
    assert.isEmpty(await plugin().api.review.findDuplicates([a]));
  });

  it("reports cancellation when duplicate review is the only enabled core stage", async function () {
    pref("workflow.updateBibliographic", false);
    pref("workflow.formatAfterUpdate", false);
    pref("workflow.reviewDuplicatesOnUpdate", true);
    const a = await create("Cancelled duplicate fixture", "10.1234/cancelled-duplicate-only");
    await create("Cancelled duplicate fixture", "10.1234/cancelled-duplicate-only");
    const pending = plugin().hooks.onLintInBatch("tool-update-metadata", [a], { review: true });
    const win = await dialog("#metaref-duplicate-review");
    (win.document.getElementById("metaref-review-cancel") as HTMLButtonElement).click();
    const result = await pending;
    assert.isTrue(result.cancelled);
    assert.equal(result.saved, 0);
    assert.equal(result.processed, 0);
    assert.isTrue(result.records.some((record: any) => record.level === "warning"));
  });
});
