import { assert } from "chai";
import { config } from "../../package.json";

const prefix = config.prefsPrefix;

describe("metadata workflow in Zotero", function () {
  this.timeout(30_000);
  let previousAutoLint: unknown;
  const created: Zotero.Item[] = [];
  const plugin = () => (Zotero as any)[config.addonInstance];

  before(function () {
    previousAutoLint = Zotero.Prefs.get(`${prefix}.lint.onAdded`, true);
    Zotero.Prefs.set(`${prefix}.lint.onAdded`, false, true);
  });

  after(async function () {
    for (const item of created)
      await item.eraseTx();
    Zotero.Prefs.set(`${prefix}.lint.onAdded`, previousAutoLint as boolean, true);
  });

  const create = async (title: string, type: _ZoteroTypes.Item.ItemType = "journalArticle") => {
    const item = new Zotero.Item(type as ConstructorParameters<typeof Zotero.Item>[0]);
    item.setField("title", title);
    await item.saveTx();
    created.push(item);
    return item;
  };

  it("persists formulas in a single batch, including book titles and duplicate inputs", async function () {
    const article = await create("MoS2 / WS2: Optical properties");
    const book = await create("Chemistry of Fe(NO3)3", "book");
    await plugin().hooks.onLintInBatch(["correct-title-chemical-formula", "correct-title-chemical-formula", "require-short-title"], [article, article, book]);
    assert.equal(article.getField("title", false, true), "MoS<sub>2</sub>/WS<sub>2</sub>: Optical properties", JSON.stringify(plugin().runner.lastResult));
    assert.equal(article.getField("shortTitle", false, true), "MoS<sub>2</sub>/WS<sub>2</sub>");
    assert.equal(book.getField("title", false, true), "Chemistry of Fe(NO<sub>3</sub>)<sub>3</sub>");
    assert.isFalse(article.hasChanged());
    assert.isFalse(book.hasChanged());
    await plugin().hooks.onLintInBatch("correct-title-chemical-formula", [article, book]);
    assert.isFalse(article.hasChanged());
    assert.isFalse(book.hasChanged());
  });

  it("applies the formula shortcut only once and leaves unrelated input fields alone", async function () {
    const item = await create("MoS2 heterostructure");
    const win = Zotero.getMainWindow();
    await win.ZoteroPane.selectItem(item.id);
    const target = win.document.getElementById("zotero-items-tree") as HTMLElement;
    target.focus();
    target.dispatchEvent(new win.KeyboardEvent("keydown", {
      key: "s",
      code: "KeyS",
      ctrlKey: !Zotero.isMac,
      metaKey: Zotero.isMac,
      altKey: true,
      bubbles: true,
      cancelable: true,
    }));
    await plugin().runner.add({ items: [], rules: [], silent: true });
    assert.equal(item.getField("title", false, true), "MoS<sub>2</sub> heterostructure");

    const input = win.document.createElement("textarea");
    input.value = "H2O";
    win.document.documentElement!.appendChild(input);
    input.focus();
    input.setSelectionRange(1, 2);
    input.dispatchEvent(new win.KeyboardEvent("keydown", {
      key: "=",
      code: "Equal",
      ctrlKey: !Zotero.isMac,
      metaKey: Zotero.isMac,
      bubbles: true,
      cancelable: true,
    }));
    assert.equal(input.value, "H2O");
    input.remove();
  });

  it("shows the automatic rule and records, rejects conflicts, disables and resets shortcuts", async function () {
    const panes = (Zotero.PreferencePanes as any).pluginPanes;
    const pane = panes.find((entry: any) => entry.pluginID === config.addonID);
    assert.isDefined(pane);
    const win = Zotero.Utilities.Internal.openPreferences(pane.id)! as Window & typeof globalThis;
    assert.isNotNull(win);
    try {
      for (let attempt = 0; attempt < 100 && !win.document.getElementById("metaref-shortcut-chemicalFormula"); attempt++)
        await Zotero.Promise.delay(100);
      await (win as any).Zotero_Preferences.waitForFirstPaneLoad();
      const doc = win.document;
      await doc.l10n!.translateFragment(doc.getElementById("metaref")!);
      const metarefPane = doc.getElementById("metaref")!;
      const autoCheck = metarefPane.querySelector(`[preference='${prefix}.lint.onAdded']`) as XULElement & { checked: boolean };
      const groupAutoCheck = metarefPane.querySelector(`[preference='${prefix}.lint.onGroup']`) as XULElement & { disabled: boolean };
      const originalAutoCheck = Zotero.Prefs.get(`${prefix}.lint.onAdded`, true) as boolean;
      assert.isNotNull(autoCheck, "automatic processing has a visible setting control");
      assert.isNotNull(groupAutoCheck, "group-library processing has its own dependent control");
      assert.include(autoCheck.closest("label")!.textContent!, config.addonName, "the setting uses the plugin feature prefix");
      autoCheck.checked = false;
      autoCheck.dispatchEvent(new win.Event("command", { bubbles: true }));
      assert.isFalse(Zotero.Prefs.get(`${prefix}.lint.onAdded`, true), "turning the switch off persists immediately");
      assert.isTrue(groupAutoCheck.disabled, "group processing is disabled while automatic processing is off");
      autoCheck.checked = true;
      autoCheck.dispatchEvent(new win.Event("command", { bubbles: true }));
      assert.isTrue(Zotero.Prefs.get(`${prefix}.lint.onAdded`, true), "turning the switch on persists immediately");
      assert.isFalse(groupAutoCheck.disabled, "group processing can be configured when automatic processing is on");
      Zotero.Prefs.set(`${prefix}.lint.onAdded`, originalAutoCheck, true);
      await plugin().hooks.onPrefsEvent("load", { window: win });
      await plugin().hooks.onPrefsEvent("load", { window: win });
      assert.lengthOf(metarefPane.querySelectorAll(".metaref-shortcut-actions"), 12, "reloading the pane must not duplicate shortcut buttons");
      assert.isNull(metarefPane.querySelector(".metaref-settings-search, .metaref-settings-jump"));
      const resets = metarefPane.querySelectorAll("button[data-l10n-id='metaref-settings-custom-data-reset']");
      assert.lengthOf(resets, 5);
      const resetRow = metarefPane.querySelector("#metaref-title-choose-custom-data-button")!.parentElement!;
      const resetFile = resetRow.querySelector("button[data-l10n-id='metaref-settings-custom-data-reset']")!;
      const resetPath = resetRow.querySelector("input[preference]") as HTMLInputElement;
      const resetPref = resetPath.getAttribute("preference")!;
      const originalPath = Zotero.Prefs.get(resetPref, true);
      try {
        Zotero.Prefs.set(resetPref, "missing-qa.csv", true);
        resetFile.dispatchEvent(new win.Event("command", { bubbles: true }));
        assert.equal(Zotero.Prefs.get(resetPref, true), "");
        assert.equal(resetPath.value, "");
      }
      finally {
        Zotero.Prefs.set(resetPref, originalPath as string, true);
      }
      const concurrency = metarefPane.querySelector<HTMLInputElement>(`[preference='${prefix}.lint.numConcurrent']`)!;
      assert.equal(concurrency.min, "1");
      assert.equal(concurrency.max, "16");
      for (const id of ["section-item-description", "section-creators", "section-conference"]) {
        const heading = metarefPane.querySelector(`[data-l10n-id='metaref-${id}']`);
        assert.isNotNull(heading, `collapsible settings group ${id} should be present`);
        assert.isNotEmpty(heading!.textContent!.trim(), `collapsible settings group ${id} should be localized`);
      }
      const creatorsHeading = metarefPane.querySelector("[data-l10n-id='metaref-section-creators']")!;
      const creatorsGroup = creatorsHeading.closest("details") as HTMLDetailsElement;
      assert.isFalse(creatorsGroup.open, "less frequently changed creator rules should start collapsed");
      assert.isNotNull(creatorsGroup.querySelector(`[preference='${prefix}.rule.require-creators']`), "collapsed rules remain registered in the panel");
      creatorsGroup.querySelector<HTMLElement>("summary")!.click();
      assert.isTrue(creatorsGroup.open, "selecting a group heading should expand the group");
      creatorsGroup.querySelector<HTMLElement>("summary")!.click();
      assert.isFalse(creatorsGroup.open, "selecting the heading again should collapse the group");
      const preferenceKeys = [...metarefPane.querySelectorAll<HTMLElement>("[preference]")]
        .map(element => element.getAttribute("preference"));
      assert.equal(new Set(preferenceKeys).size, preferenceKeys.length, "each preference should have one visible control");
      const controlIDs = [...metarefPane.querySelectorAll<HTMLElement>("[id]")].map(element => element.id);
      assert.equal(new Set(controlIDs).size, controlIDs.length, "settings controls should have unique IDs");
      for (const id of ["menu-group-maintenance", "section-article-abbreviation", "section-article-esi", "section-article-pagination", "workflow-update-heading", "metadata-provider-options", "section-about"]) {
        const heading = metarefPane.querySelector(`[data-l10n-id='metaref-${id}']`);
        assert.isNotNull(heading, `settings group ${id} should be present`);
        assert.isNotEmpty(heading!.textContent!.trim(), `settings group ${id} should be localized`);
      }
      assert.notInclude(metarefPane.querySelector("[data-l10n-id='metaref-menu-group-maintenance']")!.textContent!, "子菜单");
      assert.equal(metarefPane.querySelector<HTMLInputElement>(`[preference='${prefix}.semanticScholarToken']`)?.type, "password", "the API key should be masked in the settings panel");
      const rule = doc.querySelector(`[preference='${prefix}.rule.correct-title-chemical-formula']`) as XULElement;
      assert.isNotNull(rule);
      assert.isNotEmpty(rule.closest("label")!.textContent!.trim());
      (rule as any).checked = true;
      rule.dispatchEvent(new win.Event("command", { bubbles: true }));
      assert.isTrue(Zotero.Prefs.get(`${prefix}.rule.correct-title-chemical-formula`, true));
      const spaces = metarefPane.querySelector<HTMLInputElement>(`[preference='${prefix}.rule.correct-title-chemical-formula.normalize-spaces']`)!;
      assert.isFalse(spaces.disabled);
      (rule as any).checked = false;
      rule.dispatchEvent(new win.Event("command", { bubbles: true }));
      assert.isTrue(spaces.disabled);
      (rule as any).checked = true;
      rule.dispatchEvent(new win.Event("command", { bubbles: true }));
      const input = doc.getElementById("metaref-shortcut-chemicalFormula") as HTMLInputElement;
      assert.isNotNull(input);
      const reset = input.parentElement!.querySelector("button[data-l10n-id='metaref-shortcut-reset']")!;
      assert.equal(input.value, "accel,alt,S", "initial shortcut value");
      input.value = "accel,b,c";
      input.dispatchEvent(new win.Event("input", { bubbles: true }));
      assert.equal(input.value, "accel,alt,S", "invalid paste restores shortcut value");
      assert.equal(Zotero.Prefs.get(`${prefix}.shortcut.chemicalFormula`, true), "accel,alt,S");
      reset.dispatchEvent(new win.Event("command", { bubbles: true }));
      win.resizeTo(780, 720);
      await Zotero.Promise.delay(100);
      for (const row of doc.querySelectorAll<HTMLElement>(".metaref-shortcut-row")) {
        assert.isAtMost(row.scrollWidth, row.clientWidth + 1, "shortcut row must wrap inside preferences");
      }
      const list = doc.querySelector<HTMLElement>(".metaref-shortcut-list")!;
      await doc.fonts.ready;
      win.resizeTo(1000, 760);
      const layouts = [];
      for (const width of [570, 470, 350]) {
        list.style.width = `${width}px`;
        list.scrollIntoView({ block: "center" });
        const rows = [...list.querySelectorAll<HTMLElement>(".metaref-shortcut-row")];
        const expectedTracks = width > 520 ? 1 : width > 380 ? 2 : 3;
        // Native style/container-query resolution can lag the resize. A fixed
        // sleep can sample `none` or zero-sized content before layout settles.
        let ready = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          list.getBoundingClientRect();
          ready = rows.length > 0 && rows.every((row) => {
            const style = win.getComputedStyle(row);
            if (!style)
              return false;
            const tracks = style.gridTemplateRows.split(/\s+/).map(Number.parseFloat);
            return row.getBoundingClientRect().width > 0 && tracks.length === expectedTracks
              && tracks.every(value => Number.isFinite(value) && value >= 0);
          });
          if (ready)
            break;
          await Zotero.Promise.delay(25);
        }
        assert.isTrue(ready, `native shortcut layout settles at ${width}px`);
        const metrics = rows.map((row: HTMLElement) => {
          const rect = row.getBoundingClientRect();
          const buttons = [...row.querySelectorAll<HTMLElement>(".metaref-shortcut-action")];
          const [clear, reset] = buttons.map(button => button.getBoundingClientRect());
          assert.isAtMost(Math.abs(clear.top - reset.top), 1, "action buttons stay together");
          assert.isAtMost(reset.right, rect.right + 1, "actions remain within the row");
          assert.isAtMost(row.scrollWidth, row.clientWidth + 1, "row does not overflow");
          const style = win.getComputedStyle(row);
          if (!style)
            throw new Error("Native shortcut computed style is unavailable");
          const tracks = style.gridTemplateRows.split(/\s+/).map(Number.parseFloat);
          assert.lengthOf(tracks, expectedTracks, "shortcut row uses only its responsive content tracks");
          assert.isTrue(tracks.every(value => Number.isFinite(value) && value >= 0), "resolved tracks have valid dimensions");
          if (tracks.includes(0)) {
            assert.isTrue(tracks.slice(0, -1).every(value => value > 0), "control tracks remain visible");
            assert.isEmpty(row.querySelector(".metaref-shortcut-preview")!.textContent!.trim(), "only an empty disabled-shortcut preview can collapse");
          }
          const fontSize = Number.parseFloat(style.fontSize);
          const padding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
          const borders = Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.borderBottomWidth);
          const gap = Number.parseFloat(style.rowGap);
          assert.isAtMost(padding, fontSize * 0.65, "compact spacing must not grow independently of text size");
          assert.isAtMost(gap, fontSize * 0.65, "responsive track spacing remains compact");
          const contentHeight = tracks.reduce((sum, value) => sum + value, 0) + gap * (tracks.length - 1);
          assert.closeTo(rect.height, contentHeight + padding + borders, 1, "row fits native controls without extra blank space");
          assert.isAtMost(row.scrollHeight, row.clientHeight + 1, "native control content is not vertically clipped");
          return { height: rect.height, width: rect.width, tracks, fontSize, buttonTop: clear.top, resetTop: reset.top };
        });
        const rect = list.getBoundingClientRect();
        const screenshotPath = PathUtils.join(PathUtils.tempDir, `metaref-shortcuts-${Zotero.locale}-${width}.png`);
        const canvas = doc.createElementNS("http://www.w3.org/1999/xhtml", "canvas") as HTMLCanvasElement;
        canvas.width = Math.ceil(rect.width);
        canvas.height = Math.ceil(rect.height);
        const context = canvas.getContext("2d")!;
        if ("drawWindow" in context) {
          (context as any).drawWindow(win, rect.left, rect.top, rect.width, rect.height, "rgb(245,245,245)");
          const bytes = Uint8Array.from(win.atob(canvas.toDataURL("image/png").split(",")[1]), char => char.charCodeAt(0));
          await IOUtils.write(screenshotPath, bytes);
        }
        layouts.push({ width, listHeight: rect.height, metrics, screenshotPath });
      }
      await Zotero.File.putContentsAsync(PathUtils.join(Zotero.DataDirectory.dir, "shortcut-layout.json"), JSON.stringify(layouts));
      list.style.removeProperty("width");
      for (const field of doc.querySelectorAll<HTMLInputElement>(".metaref-shortcut-input")) {
        assert.match(field.id, /^metaref-shortcut-/);
        assert.isNotNull(field.parentElement?.querySelector("button[data-l10n-id='metaref-shortcut-reset']"));
      }
      const event = (key: string, code: string, extra = {}) => new win.KeyboardEvent("keydown", {
        key,
        code,
        ctrlKey: !Zotero.isMac,
        metaKey: Zotero.isMac,
        altKey: true,
        bubbles: true,
        cancelable: true,
        ...extra,
      });
      input.focus();
      input.dispatchEvent(event("j", "KeyJ"));
      assert.equal(Zotero.Prefs.get(`${prefix}.shortcut.chemicalFormula`, true), "accel,alt,J");
      input.focus();
      input.dispatchEvent(event("l", "KeyL"));
      assert.equal(input.getAttribute("aria-invalid"), "true");
      assert.equal(Zotero.Prefs.get(`${prefix}.shortcut.chemicalFormula`, true), "accel,alt,J");
      input.dispatchEvent(event("Backspace", "Backspace", { ctrlKey: false, metaKey: false, altKey: false }));
      assert.equal(Zotero.Prefs.get(`${prefix}.shortcut.chemicalFormula`, true), "");
      reset.dispatchEvent(new win.Event("command", { bubbles: true }));
      assert.equal(Zotero.Prefs.get(`${prefix}.shortcut.chemicalFormula`, true), "accel,alt,S");
      assert.equal(input.value, "accel,alt,S", "reset restores shortcut value");
    }
    finally {
      Zotero.Prefs.clear(`${prefix}.shortcut.chemicalFormula`, true);
      Zotero.Prefs.clear(`${prefix}.rule.correct-title-chemical-formula`, true);
      win.close();
    }
  });

  it("formats the actual title editor selection and toggles only the requested tag", async function () {
    const item = await create("H2O");
    const win = Zotero.getMainWindow();
    await win.ZoteroPane.selectItem(item.id);
    const field = win.document.querySelector("item-pane-header .title editable-text");
    assert.isNotNull(field);
    const editor = field!.querySelector("textarea") as HTMLTextAreaElement;
    assert.isNotNull(editor);
    editor.focus();
    editor.setSelectionRange(1, 2);
    const press = (repeat = false) => editor.dispatchEvent(new win.KeyboardEvent("keydown", {
      key: "=",
      code: "Equal",
      ctrlKey: !Zotero.isMac,
      metaKey: Zotero.isMac,
      repeat,
      bubbles: true,
      cancelable: true,
    }));
    press();
    assert.equal(editor.value, "H<sub>2</sub>O");
    press(true);
    assert.equal(editor.value, "H<sub>2</sub>O");
    press();
    assert.equal(editor.value, "H2O");
    editor.value = "<i>2</i>";
    editor.setSelectionRange(0, editor.value.length);
    plugin().hooks.onShortcuts("subscript", win);
    assert.equal(editor.value, "<sub><i>2</i></sub>");
    plugin().hooks.onShortcuts("subscript", win);
    assert.equal(editor.value, "<i>2</i>");
    editor.setSelectionRange(0, 0);
    plugin().hooks.onShortcuts("subscript", win);
    assert.equal(editor.value, "<i>2</i>", "a collapsed selection never inserts empty markup");
    editor.value = "H2O";
    editor.dispatchEvent(new win.Event("input", { bubbles: true }));
    editor.blur();
  });

  it("continues healthy rules after preparation failures and primitive apply errors", async function () {
    const item = await create("initial");
    await plugin().runner.add({ items: [item, item], silent: true, rules: [
      {
        id: "test-prepare",
        scope: "item",
        prepare() { throw new Error("expected preparation failure"); },
        apply() { throw new Error("must be skipped"); },
      },
      {
        id: "test-apply",
        scope: "item",
        apply() {
          // eslint-disable-next-line prefer-promise-reject-errors -- Exercise primitive rejection handling from third-party rules.
          return Promise.reject(null);
        },
      },
      { id: "test-sibling", scope: "item", apply({ item: target }: { item: Zotero.Item }) { target.setField("title", "saved sibling"); } },
    ] });
    assert.equal(item.getField("title"), "saved sibling");
    assert.isFalse(item.hasChanged());
    for (const dialog of plugin().data.dialogs.values())
      dialog.close();
    await plugin().runner.add({ items: [], rules: [], silent: true });
  });
});
