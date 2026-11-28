import { assert } from "chai";
import { config } from "../../package.json";
import { waitForItemTree } from "../helpers/item-tree";

const prefix = config.prefsPrefix;
const pref = (key: string) => `${prefix}.${key}`;

describe("actions pane and settings toggle in Zotero", function () {
  this.timeout(60_000);
  const created: Zotero.Item[] = [];
  let previousAuto: unknown;
  let previousShowPane: unknown;
  let previousPanePos: unknown;
  let previousSidenavOrder: unknown;

  before(function () {
    previousAuto = Zotero.Prefs.get(pref("lint.onAdded"), true);
    previousShowPane = Zotero.Prefs.get(pref("workflow.showActionsPane"), true);
    previousPanePos = Zotero.Prefs.get(pref("workflow.actionsPanePosition"), true);
    previousSidenavOrder = Zotero.Prefs.get("sidenav.order");
    Zotero.Prefs.set(pref("lint.onAdded"), false, true);
    Zotero.Prefs.set(pref("workflow.showActionsPane"), true, true);
  });

  after(async function () {
    for (const item of created)
      await item.eraseTx();
    Zotero.Prefs.set(pref("lint.onAdded"), previousAuto as boolean, true);
    Zotero.Prefs.set(pref("workflow.showActionsPane"), previousShowPane as boolean, true);
    Zotero.Prefs.set(pref("workflow.actionsPanePosition"), (previousPanePos as string) ?? "after-journal", true);
    if (typeof previousSidenavOrder === "string")
      Zotero.Prefs.set("sidenav.order", previousSidenavOrder);
    else
      Zotero.Prefs.clear("sidenav.order");
  });

  it("renders both core action buttons in the sidebar, runs them on click, and toggles via settings", async function () {
    const item = new Zotero.Item("journalArticle");
    item.setField("title", "a sample metadata check.");
    item.setField("language", "en");
    item.setField("DOI", "10.1000/actions-pane-e2e");
    await item.saveTx();
    created.push(item);

    const win = Zotero.getMainWindow();
    await waitForItemTree(win);
    await win.ZoteroPane.selectItem(item.id);
    await win.ZoteroPane.itemSelected();

    const section = win.document.querySelector("item-pane-custom-section[data-pane*='metaref-actions']") as any;
    assert.isNotNull(section, "actions sidebar section is registered");
    assert.equal(section.item?.id, item.id);
    await section._handleRefresh();
    assert.isFalse(section.hidden, "actions section is visible for a writable regular item");

    const sidenavBtn = win.document.querySelector<HTMLElement>("#zotero-view-item-sidenav .btn[data-pane*='metaref-actions']")!;
    assert.isNotNull(sidenavBtn, "actions sidenav icon button is mounted");
    assert.isFalse(sidenavBtn.parentElement!.hidden, "actions sidenav button wrapper is visible");
    assert.include(sidenavBtn.style.getPropertyValue("--custom-sidenav-icon-light"), "metaref-actions.svg");
    assert.isAbove(sidenavBtn.getBoundingClientRect().width, 0, "actions sidenav button has visible width");
    assert.isAbove(sidenavBtn.getBoundingClientRect().height, 0, "actions sidenav button has visible height");

    const body = section.querySelector("[data-type='body']") as HTMLElement;
    const checkBtn = body.querySelector<HTMLButtonElement>("[data-metaref-action='check']")!;
    const updateBtn = body.querySelector<HTMLButtonElement>("[data-metaref-action='update']")!;
    assert.isNotNull(checkBtn);
    assert.isNotNull(updateBtn);
    assert.isAbove(checkBtn.getBoundingClientRect().height, 28, "check button is not clamped to Zotero's 25px default max-height");
    assert.isAbove(updateBtn.getBoundingClientRect().height, 28, "update button is not clamped to Zotero's 25px default max-height");
    assert.equal(checkBtn.querySelectorAll(".metaref-action-icon rect, .metaref-action-icon path").length, 3);
    assert.equal(updateBtn.querySelectorAll(".metaref-action-icon path").length, 2);

    checkBtn.click();
    for (let attempt = 0; attempt < 120 && (item.getField("title") === "a sample metadata check." || body.querySelector<HTMLButtonElement>("[data-metaref-action='update']")?.disabled !== false); attempt++)
      await Zotero.Promise.delay(50);
    assert.notEqual(item.getField("title"), "a sample metadata check.");

    const plugin = (Zotero as any)[config.addonInstance];
    const originalBatch = plugin.hooks.onLintInBatch;
    let updateCalls = 0;
    let resolveUpdate!: () => void;
    const updateDone = new Promise<void>(resolve => resolveUpdate = resolve);
    plugin.hooks.onLintInBatch = async (ruleIDs: unknown, items: unknown, context: unknown) => {
      if (ruleIDs === "tool-update-metadata" || (Array.isArray(ruleIDs) && ruleIDs.includes("tool-update-metadata"))) {
        updateCalls++;
        assert.deepEqual(context, { review: true });
        resolveUpdate();
        return { saved: 0, failed: 0, preparationFailed: 0, cancelled: false, records: [] };
      }
      return originalBatch(ruleIDs, items, context);
    };
    try {
      const refreshedUpdateBtn = body.querySelector<HTMLButtonElement>("[data-metaref-action='update']")!;
      assert.isFalse(refreshedUpdateBtn.disabled, "Update Metadata button is re-enabled after check completes");
      refreshedUpdateBtn.click();
      await Promise.race([updateDone, Zotero.Promise.delay(5000)]);
      assert.equal(updateCalls, 1, "clicking Update Metadata button triggers tool-update-metadata");
    }
    finally {
      plugin.hooks.onLintInBatch = originalBatch;
    }

    const entry = (Zotero.PreferencePanes as any).pluginPanes.find((p: any) => p.pluginID === config.addonID);
    const prefsWin = Zotero.Utilities.Internal.openPreferences(entry.id)! as Window & typeof globalThis;
    try {
      for (let attempt = 0; attempt < 100 && !prefsWin.document.getElementById("metaref-core-workflows"); attempt++)
        await Zotero.Promise.delay(50);
      await (prefsWin as any).Zotero_Preferences.waitForFirstPaneLoad();
      const pane = prefsWin.document.getElementById("metaref") as HTMLElement;
      const toggle = pane.querySelector<HTMLInputElement>(`#metaref-core-workflows [preference='${pref("workflow.showActionsPane")}']`)!;
      const posSelect = pane.querySelector<HTMLSelectElement>("#metaref-actions-pane-position")!;
      assert.isNotNull(toggle, "settings toggle exists under core workflows");
      assert.isNotNull(posSelect, "position selector exists under core workflows");
      assert.isTrue(toggle.checked);
      assert.isFalse(posSelect.disabled);

      posSelect.value = "top";
      posSelect.dispatchEvent(new prefsWin.Event("change", { bubbles: true }));
      for (let attempt = 0; attempt < 40 && !String(Zotero.Prefs.get("sidenav.order") ?? "").startsWith("metaflow\\@groele-metaref-actions"); attempt++)
        await Zotero.Promise.delay(50);
      assert.isTrue(String(Zotero.Prefs.get("sidenav.order")).startsWith("metaflow\\@groele-metaref-actions"), "top position moves actions pane first in sidenav.order");

      toggle.click();
      for (let attempt = 0; attempt < 60 && (!section.hidden || !sidenavBtn.parentElement!.hidden); attempt++)
        await Zotero.Promise.delay(50);
      assert.isFalse(Zotero.Prefs.get(pref("workflow.showActionsPane"), true) as boolean);
      assert.isTrue(posSelect.disabled, "disabling actions pane disables the position selector");
      assert.isTrue(section.hidden, "disabling the setting hides the sidebar immediately");
      assert.isTrue(sidenavBtn.parentElement!.hidden, "disabling the setting hides the sidenav icon immediately");

      toggle.click();
      for (let attempt = 0; attempt < 60 && (section.hidden || sidenavBtn.parentElement!.hidden); attempt++)
        await Zotero.Promise.delay(50);
      assert.isTrue(Zotero.Prefs.get(pref("workflow.showActionsPane"), true) as boolean);
      assert.isFalse(posSelect.disabled, "re-enabling actions pane re-enables the position selector");
      assert.isFalse(section.hidden, "re-enabling the setting restores the sidebar immediately");
      assert.isFalse(sidenavBtn.parentElement!.hidden, "re-enabling the setting restores the sidenav icon immediately");
    }
    finally {
      prefsWin?.close();
    }
  });
});
