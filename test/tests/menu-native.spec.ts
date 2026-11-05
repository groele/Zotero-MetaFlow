import { assert } from "chai";
import { config } from "../../package.json";

const key = `${config.prefsPrefix}.lint.onAdded`;

describe("native flat menu commands", function () {
  this.timeout(30_000);
  const plugin = () => (Zotero as any)[config.addonInstance];
  const items: Zotero.Item[] = [];
  let original: unknown;
  let compact: unknown;
  let chemicalMenuVisible: unknown;

  before(function () {
    original = Zotero.Prefs.get(key, true);
    Zotero.Prefs.set(key, false, true);
    compact = Zotero.Prefs.get(`${config.prefsPrefix}.menu.compact`, true);
    Zotero.Prefs.set(`${config.prefsPrefix}.menu.compact`, false, true);
    chemicalMenuVisible = Zotero.Prefs.get(`${config.prefsPrefix}.menu.correct-title-chemical-formula`, true);
    Zotero.Prefs.set(`${config.prefsPrefix}.menu.correct-title-chemical-formula`, true, true);
  });

  after(async function () {
    for (const item of items)
      await item.eraseTx();
    Zotero.Prefs.set(key, original as boolean, true);
    Zotero.Prefs.set(`${config.prefsPrefix}.menu.compact`, compact as boolean, true);
    Zotero.Prefs.set(`${config.prefsPrefix}.menu.correct-title-chemical-formula`, chemicalMenuVisible as boolean, true);
  });

  afterEach(async function () {
    for (const dialog of plugin().data.dialogs.values())
      dialog.close();
    const win = Zotero.getMainWindow();
    const popup = win.document.getElementById("zotero-itemmenu") as any;
    const root = popup.querySelector("menu[data-l10n-id='metaref-menuitem-label']") as any;
    const sub = root?.querySelector("menupopup") as any;
    if (root && (root.open || sub?.state !== "closed")) {
      root.open = false;
      sub?.hidePopup();
      if (sub)
        await wait(() => sub.state === "closed", "submenu cleanup");
    }
    popup.hidePopup();
    await wait(() => popup.state === "closed", "menu cleanup");
  });
  async function wait(condition: () => boolean, label = "native command") {
    for (let attempt = 0; attempt < 200 && !condition(); attempt++)
      await Zotero.Promise.delay(50);
    const windows = [...plugin().data.dialogs].map(([id, window]: [string, Window]) => ({ id, closed: window.closed, title: window.document?.title }));
    assert.isTrue(condition(), `${label} must complete; tracked=${JSON.stringify(windows)}`);
  }

  function activateMenuItem(_win: Window, command: XULElement): boolean {
    const popup = command.parentElement as any;
    popup.activateItem(command);
    return true;
  }

  async function closeMenu(popup: any, sub: any) {
    const root = popup.querySelector("menu[data-l10n-id='metaref-menuitem-label']") as any;
    if (root?.open || sub.state !== "closed") {
      root.open = false;
      sub.hidePopup();
      await wait(() => sub.state === "closed", "submenu close");
    }
    popup.hidePopup();
    await wait(() => popup.state === "closed", "menu close");
  }

  beforeEach(async function () {
    for (const dialog of plugin().data.dialogs.values())
      dialog.close();
    await wait(() => plugin().data.dialogs.size === 0, "earlier report cleanup");
  });

  const menu = async () => {
    // Isolate menu focus from timed native notices left by earlier commands.
    Zotero.ProgressWindowSet.closeAll();
    const win = Zotero.getMainWindow();
    win.focus();
    await wait(() => win.document.hasFocus(), "main window focus");
    // Earlier settings suites may still be rebuilding their column definitions.
    await Promise.resolve();
    await Zotero.Notifier.trigger("refresh", "itemtree", [], {});
    if (items[0]) {
      await win.ZoteroPane.selectItem(items[0].id);
      await win.ZoteroPane.itemSelected();
      assert.deepEqual(win.ZoteroPane.getSelectedItems().map(item => item.id), [items[0].id]);
    }
    const popup = win.document.getElementById("zotero-itemmenu") as any;
    popup.hidePopup();
    await wait(() => popup.state === "closed", "previous popup closing");
    (win as any).windowUtils.sendMouseEvent("mousemove", 0, 0, 0, 0, 0);
    await win.ZoteroPane.buildItemContextMenu();
    const show = async (target: any, open: () => void, label: string) => {
      const shown = new Promise<void>((resolve) => {
        const listener = (event: Event) => {
          if (event.target === target) {
            target.removeEventListener("popupshown", listener);
            resolve();
          }
        };
        target.addEventListener("popupshown", listener);
      });
      open();
      await Promise.race([shown, Zotero.Promise.delay(10_000).then(() => {
        throw new Error(`${label} did not emit popupshown (state=${target.state})`);
      })]);
    };
    await show(popup, () => popup.openPopup(win.document.getElementById("zotero-items-tree"), "after_start", 0, 0, true), "Main popup");
    await wait(() => Boolean(popup.querySelector("menu[data-l10n-id='metaref-menuitem-label']")), "native menu initialization");
    const root = popup.querySelector("menu[data-l10n-id='metaref-menuitem-label']") as any;
    assert.isFalse(root.disabled);
    const sub = root.querySelector("menupopup") as any;
    await show(sub, () => sub.openPopup(root, "end_before", 0, 0, false, false), "MetaFlow submenu");
    assert.equal(sub.querySelectorAll(":scope > menu").length, 0, "no nested menu arrows");
    assert.equal(sub.querySelectorAll(":scope > menuitem").length, 33);
    for (const entry of [root, ...sub.querySelectorAll("menuitem"), ...popup.querySelectorAll(":scope > menuitem[data-l10n-id^='metaref-']")]) {
      assert.include(entry.style.getPropertyValue("--custom-menu-icon-light"), "metaref-16.svg", "all MetaFlow menu entries have the selected icon");
      assert.include(entry.style.getPropertyValue("--custom-menu-icon-dark"), "metaref-16.svg");
      assert.isTrue(entry.classList.contains(entry.localName === "menu" ? "menu-iconic" : "menuitem-iconic"));
    }
    return { win, popup, sub };
  };

  it("loads the packaged brand icons at their declared sizes", async function () {
    const win = Zotero.getMainWindow();
    const entry = (Zotero.PreferencePanes as any).pluginPanes.find((pane: any) => pane.pluginID === config.addonID);
    const icons = `${entry.src.slice(0, entry.src.lastIndexOf("/") + 1)}icons/`;
    for (const size of [16, 32, 48, 96, 128, 256, 512]) {
      const image = new win.Image();
      image.src = `${icons}metaref-${size}.png`;
      await image.decode();
      assert.equal(image.naturalWidth, size);
      assert.equal(image.naturalHeight, size);
    }
    const image = new win.Image();
    image.src = `${icons}metaref-16.svg`;
    await image.decode();
    assert.equal(image.naturalWidth, 16);
    assert.equal(image.naturalHeight, 16);
  });

  it("runs a formatter from its actual menu element on two consecutive openings", async function () {
    const item = new Zotero.Item("journalArticle");
    item.setField("publicationTitle", "Physical Review Letters");
    item.setField("title", "Native MoS2");
    await item.saveTx();
    items.push(item);
    const win = Zotero.getMainWindow();
    await win.ZoteroPane.selectItem(item.id);
    for (let run = 0; run < 2; run++) {
      item.setField("title", `Native ${run} MoS2`);
      await item.saveTx();
      const { popup, sub } = await menu();
      const command = sub.querySelector("menuitem[data-l10n-id='metaref-rule-correct-title-chemical-formula-menu-item']") as any;
      assert.isFalse(command.disabled);
      assert.isFalse(command.hidden, "the tested formatter is explicitly enabled in the menu");
      const commandObserved = activateMenuItem(win, command);
      await closeMenu(popup, sub);
      await wait(
        () => item.getField("title", false, true) === `Native ${run} MoS<sub>2</sub>` && !item.hasChanged(),
        `formatter run ${run + 1} (title=${item.getField("title", false, true)}, changed=${item.hasChanged()}, nativeCommand=${commandObserved})`,
      );
      await (plugin().runner as any).runningQueue;
    }
  });

  it("shows visible results for both index commands without saving item metadata", async function () {
    this.timeout(60_000);
    const item = items[0];
    const snapshot = JSON.stringify(item.toJSON());
    const commands = [["rule-tool-query-esi-menu-item", "ESI"], ["tool-query-nature-index-menu-item", "Nature Index"]];
    for (const [id, expected] of [...commands, ...commands, ...commands]) {
      const { win, popup, sub } = await menu();
      const command = sub.querySelector(`menuitem[data-l10n-id='metaref-${id}']`) as any;
      assert.isFalse(command.disabled);
      activateMenuItem(win, command);
      await closeMenu(popup, sub);
      const section = win.document.querySelector("item-pane-custom-section[data-pane*='metaref-journal-insights']") as any;
      await section._handleRefresh();
      assert.include(section.textContent!, expected);
      assert.equal(JSON.stringify(item.toJSON()), snapshot);
      assert.equal(plugin().data.dialogs.size, 0, "index results stay in the item pane");
    }
  });

  it("shows a user-pinned command only at the first context-menu level and still executes it once", async function () {
    const pref = `${config.prefsPrefix}.menu.primary.correct-title-chemical-formula`;
    const previous = Zotero.Prefs.get(pref, true);
    const item = items[0];
    item.setField("title", "Pinned MoS2");
    await item.saveTx();
    try {
      Zotero.Prefs.set(pref, true, true);
      const { win, popup, sub } = await menu();
      const selector = "menuitem[data-l10n-id='metaref-rule-correct-title-chemical-formula-menu-item']";
      const nested = sub.querySelector(selector) as HTMLElement;
      const primary = popup.querySelector(`:scope > ${selector}`) as HTMLElement;
      assert.isTrue(nested.hidden);
      assert.isNotNull(primary);
      assert.isFalse(primary.hidden);
      activateMenuItem(win, primary);
      await closeMenu(popup, sub);
      await wait(() => item.getField("title", false, true) === "Pinned MoS<sub>2</sub>" && !item.hasChanged());
    }
    finally {
      if (previous === undefined)
        Zotero.Prefs.clear(pref, true);
      else
        Zotero.Prefs.set(pref, previous as boolean, true);
    }
  });
});
