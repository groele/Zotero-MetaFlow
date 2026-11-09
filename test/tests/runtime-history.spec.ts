import { assert } from "chai";
import { config } from "../../package.json";
import { registerPersistenceShutdown } from "../../src/utils/persistence-shutdown";
import { RuntimeDataStore } from "../../src/utils/runtime-data-storage";

// The test store uses an isolated temporary directory, separate from the user's runtime history.
describe("local runtime data persistence", function () {
  this.timeout(60_000);
  const plugin = () => (Zotero as any)[config.addonInstance];
  let directory: string;
  let file: string;
  const stores: RuntimeDataStore[] = [];
  const instance = () => {
    const store = new RuntimeDataStore(file);
    stores.push(store);
    return store;
  };
  const entry = (id: string) => ({ id, at: Date.now(), kind: "metadata", total: 1, processed: 1, saved: 1, failed: 0, warnings: 0, cancelled: false, durationMs: 10, rules: ["tool-review-metadata"], reasons: ["metadata-field-filled"], items: [{ libraryID: 1, key: "ABCDEFGH", saved: true, fields: ["language"], reasons: ["metadata-field-filled"] }], truncated: false });

  beforeEach(async function () {
    directory = PathUtils.join(PathUtils.tempDir, `metaflow-history-test-${Zotero.Utilities.randomString()}`);
    await IOUtils.makeDirectory(directory);
    file = PathUtils.join(directory, "runtime-data.json");
  });

  afterEach(async function () {
    for (const store of stores.splice(0)) {
      for (let attempt = 0; ; attempt++) {
        try {
          await store.flush();
          break;
        }
        catch (error) {
          if (attempt >= 2 || !String(error).includes("NS_ERROR_FILE_ACCESS_DENIED"))
            throw error;
          // Windows may briefly retain a file handle during atomic replacement.
          // Only teardown retries; write-failure assertions in test bodies stay strict.
          await Zotero.Promise.delay(50 * (attempt + 1));
        }
      }
    }
    assert.equal(PathUtils.parent(directory), PathUtils.tempDir);
    await IOUtils.remove(directory, { recursive: true });
  });

  it("atomically persists bounded records and reloads them in a fresh instance", async function () {
    const store = instance();
    const original = { ...entry("one"), message: "private-token", before: "private-value" };
    await store.append(original);
    await store.flush();
    assert.isTrue(await IOUtils.exists(file));
    assert.isFalse(await IOUtils.exists(`${file}.tmp`));
    const text = await IOUtils.readUTF8(file);
    assert.notInclude(text, "private-token");
    assert.notInclude(text, "private-value");
    const loaded = await instance().read();
    assert.equal(loaded.runs[0].items[0].key, "ABCDEFGH");
    assert.deepEqual(loaded.runs[0].items[0].fields, ["language"]);
    await store.append({ ...entry("one"), saved: 2 });
    await store.flush();
    assert.lengthOf((await instance().read()).runs, 1);
  });

  it("marks a persisted running workflow and stage as interrupted after restart", async function () {
    const store = instance();
    await store.append({ ...entry("in-progress"), status: "running", stages: [{ name: "metadata", startedAt: Date.now(), status: "running", processed: 3, saved: 1, failed: 0, warnings: 0, rules: ["tool-review-metadata"], reasons: ["metadata-field-filled"] }] });
    await store.flush();
    const recovered = await instance().read();
    assert.equal(recovered.runs[0].status, "interrupted");
    assert.equal(recovered.runs[0].stages[0].status, "interrupted");
    assert.equal(recovered.runs[0].stages[0].processed, 3);
  });

  it("recovers a corrupt primary from the previous valid snapshot", async function () {
    const store = instance();
    await store.append(entry("first"));
    await store.flush();
    await store.append(entry("second"));
    await store.flush();
    await IOUtils.writeUTF8(file, "{broken");
    const recovered = instance();
    assert.deepEqual((await recovered.read()).runs.map(run => run.id), ["first"]);
    await recovered.append(entry("third"));
    await recovered.flush();
    assert.deepEqual((await instance().read()).runs.map(run => run.id), ["first", "third"]);
    assert.equal((await IOUtils.readJSON(`${file}.bak`) as any).runs[0].id, "first");
  });

  it("keeps a valid backup when the on-disk primary changes after loading", async function () {
    const store = instance();
    await store.append(entry("first"));
    await store.flush();
    await IOUtils.writeUTF8(file, "corrupt while running");
    await store.append(entry("second"));
    await store.flush();
    const backup = await IOUtils.readJSON(`${file}.bak`) as any;
    assert.equal(backup.runs[0].id, "first");
    assert.lengthOf((await instance().read()).runs, 2);
  });

  it("coalesces concurrent flushes of one revision into one primary write", async function () {
    const store = instance();
    const original = IOUtils.writeJSON;
    let writes = 0;
    IOUtils.writeJSON = (async (path: string, ...args: any[]) => {
      if (path === file)
        writes++;
      return (original as any)(path, ...args);
    }) as typeof original;
    try {
      await store.append(entry("one"));
      await Promise.all([store.flush(), store.flush()]);
      assert.equal(writes, 1);
    }
    finally { IOUtils.writeJSON = original; }
  });

  it("serializes clearing after an in-flight write without reviving history in the backup", async function () {
    const store = instance();
    await store.append(entry("before-clear"));
    const original = IOUtils.writeJSON;
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => entered = resolve);
    const blocked = new Promise<void>(resolve => release = resolve);
    let once = true;
    IOUtils.writeJSON = (async (path: string, ...args: any[]) => {
      if (path === file && once) {
        once = false;
        entered();
        await blocked;
      }
      return (original as any)(path, ...args);
    }) as typeof original;
    try {
      const writing = store.flush();
      await started;
      const clearing = store.clear();
      await Zotero.Promise.delay(0);
      release();
      await Promise.all([writing, clearing]);
      assert.isEmpty((await IOUtils.readJSON(file) as any).runs);
      assert.isEmpty((await IOUtils.readJSON(`${file}.bak`) as any).runs);
      await store.append(entry("after-clear"));
      await store.flush();
      assert.deepEqual((await instance().read()).runs.map(run => run.id), ["after-clear"]);
    }
    finally {
      release();
      IOUtils.writeJSON = original;
    }
  });

  it("preserves a newer schema and refuses destructive clearing", async function () {
    await IOUtils.writeJSON(file, { version: 2, future: "retain" });
    const store = instance();
    await store.append(entry("ignored"));
    await store.flush();
    let failure: unknown;
    try {
      await store.clear();
    }
    catch (error) { failure = error; }
    assert.instanceOf(failure, Error);
    assert.equal((await IOUtils.readJSON(file) as any).future, "retain");
  });

  it("clears both primary and recovery history without restoring deleted records", async function () {
    const store = instance();
    await store.append(entry("first"));
    await store.flush();
    await store.append(entry("second"));
    await store.flush();
    await store.clear();
    assert.isEmpty((await instance().read()).runs);
    await IOUtils.writeUTF8(file, "broken");
    assert.isEmpty((await instance().read()).runs);
  });

  it("retains the last good file on write failure and retries successfully", async function () {
    const store = instance();
    await store.append(entry("first"));
    await store.flush();
    const original = IOUtils.writeJSON;
    IOUtils.writeJSON = (async (path: string, ...args: any[]) => {
      if (path === file)
        throw new Error("controlled disk failure");
      return (original as any)(path, ...args);
    }) as typeof original;
    try {
      await store.append(entry("second"));
      let failure: unknown;
      try {
        await store.flush();
      }
      catch (error) { failure = error; }
      assert.instanceOf(failure, Error);
      assert.lengthOf((await IOUtils.readJSON(file) as any).runs, 1);
    }
    finally { IOUtils.writeJSON = original; }
    await store.flush();
    assert.lengthOf((await instance().read()).runs, 2);
  });

  it("waits for pending data writes through a real isolated Gecko shutdown barrier", async function () {
    const { AsyncShutdown } = ChromeUtils.importESModule("resource://gre/modules/AsyncShutdown.sys.mjs") as any;
    const barrier = new AsyncShutdown.Barrier("MetaFlow isolated persistence test");
    const store = instance();
    await store.append(entry("shutdown-write"));
    const unregister = registerPersistenceShutdown(() => store.flush(), barrier.client);
    try {
      await barrier.wait();
      assert.equal((await IOUtils.readJSON(file) as any).runs[0].id, "shutdown-write");
    }
    finally { unregister(); }
  });

  it("records real runner outcomes in the independent profile file without field values", async function () {
    const pref = `${config.prefsPrefix}.lint.onAdded`;
    const previous = Zotero.Prefs.get(pref, true);
    Zotero.Prefs.set(pref, false, true);
    const item = new Zotero.Item("journalArticle");
    item.setField("title", "Private runtime fixture title");
    await item.saveTx();
    try {
      await plugin().runner.add({ items: [item], silent: true, rules: [{ id: "require-language", scope: "item", apply: ({ item, report }: any) => {
        item.setField("language", "en");
        report({ level: "warning", code: "metadata-auto-evidence", message: "api-key=private-runtime-key" });
      } }] });
      await plugin().api.runtimeData.flush();
      const path = plugin().api.runtimeData.path();
      assert.equal(PathUtils.filename(path), "operation-history.json");
      assert.equal(PathUtils.parent(path), PathUtils.join((Zotero as any).Profile.dir, "zotero-metaflow-cache"));
      const text = await IOUtils.readUTF8(path);
      assert.notInclude(text, "private-runtime-key");
      assert.notInclude(text, "Private runtime fixture title");
      const data = await new RuntimeDataStore(path).read();
      const run = [...data.runs].reverse().find(run => run.items.some(row => row.key === item.key))!;
      assert.equal(run.saved, 1);
      assert.include(run.reasons, "metadata-auto-evidence");
      assert.include(run.items.find(row => row.key === item.key)!.fields, "language");
    }
    finally {
      await item.eraseTx();
      if (previous === undefined)
        Zotero.Prefs.clear(pref, true);
      else Zotero.Prefs.set(pref, previous as boolean, true);
    }
  });
});
