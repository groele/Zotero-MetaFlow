import { assert } from "chai";
import { config } from "../../package.json";
import { Rules } from "../../src/modules/rules";
import { SemanticScholarService } from "../../src/modules/rules/tool-update-metadata/services/semantic-scholar-service";
import { fetchEasyScholarRank } from "../../src/utils/easyscholar";
import { useHTTPTransport } from "../../src/utils/http-transport";

describe("settings panel layout and validation in Zotero", function () {
  this.timeout(30_000);
  let restoreTransport: (() => void) | undefined;
  let win: Window & typeof globalThis;
  let pane: HTMLElement;
  let previousConcurrency: number;
  const pref = (key: string) => `${config.prefsPrefix}.${key}`;
  const find = (key: string) => pane.querySelector<HTMLElement>(`[preference='${pref(key)}']`)!;

  before(async function () {
    restoreTransport = useHTTPTransport((method, url, options) => Zotero.HTTP.request(method, url, options));
    previousConcurrency = Zotero.Prefs.get(pref("lint.numConcurrent"), true) as number;
    const entry = (Zotero.PreferencePanes as any).pluginPanes.find((entry: any) => entry.pluginID === config.addonID);
    win = Zotero.Utilities.Internal.openPreferences(entry.id)! as Window & typeof globalThis;
    for (let attempt = 0; attempt < 100 && !win.document.getElementById("metaref-concurrency-status"); attempt++)
      await Zotero.Promise.delay(50);
    await (win as any).Zotero_Preferences.waitForFirstPaneLoad();
    pane = win.document.getElementById("metaref") as HTMLElement;
    await win.document.l10n!.translateFragment(pane);
    await Zotero.Promise.delay(50);
  });

  after(function () {
    restoreTransport?.();
    Zotero.Prefs.set(pref("lint.numConcurrent"), previousConcurrency, true);
    win?.close();
  });

  it("initializes once and omits the removed search, section jump and global disclosure controls", function () {
    const actions = pane.querySelectorAll(".metaref-shortcut-action").length;
    pane.dispatchEvent(new win.Event("load"));
    pane.dispatchEvent(new win.Event("load"));
    assert.equal(pane.querySelectorAll(".metaref-shortcut-action").length, actions);
    assert.isAbove(actions, 0);
    assert.isNull(pane.querySelector(`[preference='${pref("rule.tool-update-metadata.option.allow-type-changed")}']`));
    assert.isNull(pane.querySelector(".metaref-settings-search, .metaref-settings-jump, .metaref-settings-disclosure, .metaref-settings-rule-actions"));
  });

  it("persists the single local/cloud priority control through real radio clicks", function () {
    const key = pref("rule.tool-update-metadata.option.mode");
    const before = Zotero.Prefs.get(key, true);
    const group = pane.querySelector("#metaref-metadata-source-priority")!;
    assert.exists(group);
    assert.lengthOf(pane.querySelectorAll(`[preference='${key}']`), 1);
    try {
      for (const value of ["all", "blank"]) {
        const radio = group.querySelector<HTMLElement>(`radio[value='${value}']`)!;
        assert.isNotEmpty(radio.getAttribute("label") || radio.textContent || "");
        radio.click();
        assert.equal(Zotero.Prefs.get(key, true), value);

        const htmlRadio = pane.querySelector<HTMLInputElement>(`#metaref-source-priority-${value}`);
        if (htmlRadio)
          assert.isTrue(htmlRadio.checked);
      }

      for (const value of ["all", "blank"]) {
        const htmlRadio = pane.querySelector<HTMLInputElement>(`#metaref-source-priority-${value}`);
        if (htmlRadio) {
          htmlRadio.click();
          assert.equal(Zotero.Prefs.get(key, true), value);
          assert.isTrue(htmlRadio.checked);
        }
      }
    }
    finally {
      if (before === undefined)
        Zotero.Prefs.clear(key, true);
      else
        Zotero.Prefs.set(key, before as string, true);
    }
  });

  it("keeps import dependencies and section ownership clear without duplicating controls", function () {
    const auto = find("lint.onAdded") as HTMLInputElement;
    const before = auto.checked;
    const steps = ["lint.onGroup", "metadata.autoUpdateOnAdded", "easyscholar.autoUpdateOnAdded"].map(key => find(key) as HTMLInputElement);
    const values = steps.map(step => step.checked);
    const general = auto.closest(".metaref-section-card")!;
    const data = pane.querySelector("#metaref-data-settings")!;
    assert.isTrue(data.contains(find("lint.notify")));
    assert.isTrue(data.contains(find("lint.numConcurrent")));
    assert.isTrue(steps.every(step => general.contains(step)));
    assert.isNotNull(pane.querySelector(":scope > .metaref-section-card > #metaref-easyscholar-settings"));
    const headings = [...pane.querySelectorAll(":scope > .metaref-section-card > summary [data-l10n-id]")].map(heading => heading.getAttribute("data-l10n-id"));
    assert.isBelow(headings.indexOf("metaref-core-workflows-heading"), headings.indexOf("metaref-section-rules"));
    try {
      if (auto.checked)
        auto.click();
      assert.isTrue(steps.every(step => step.disabled));
      assert.deepEqual(steps.map(step => step.checked), values, "disabling import preserves configured steps");
      auto.click();
      assert.isTrue(steps.every(step => !step.disabled));
      assert.deepEqual(steps.map(step => step.checked), values);
    }
    finally {
      if (auto.checked !== before)
        auto.click();
    }
  });

  it("persists every available checkbox binding and connects standard rule switches to the runner", function () {
    const controls = [...pane.querySelectorAll<HTMLInputElement>("input[type='checkbox'][preference]")];
    const saved = new Map(controls.map(control => [control.getAttribute("preference")!, { value: Zotero.Prefs.get(control.getAttribute("preference")!, true), checked: control.checked }]));
    let checked = 0;
    try {
      for (const control of controls.filter(control => !control.getAttribute("preference")!.includes(".easyscholar."))) {
        const key = control.getAttribute("preference")!;
        const importStep = ["lint.onGroup", "metadata.autoUpdateOnAdded", "easyscholar.autoUpdateOnAdded"].some(step => key === pref(step));
        const parents = controls.filter(parent => key.startsWith(`${parent.getAttribute("preference")}.`)
          || (importStep && parent.getAttribute("preference") === pref("lint.onAdded"))).sort((a, b) => a.getAttribute("preference")!.length - b.getAttribute("preference")!.length);
        for (const parent of parents) {
          if (!parent.checked)
            parent.click();
        }
        assert.isFalse(control.disabled, `${key} is usable after its parent is enabled`);
        const previous = control.checked;
        control.click();
        assert.equal(Zotero.Prefs.get(key, true), !previous, `${key} persists an actual click`);
        const ruleID = key.replace(`${config.prefsPrefix}.rule.`, "");
        const rule = Rules.getByID(ruleID as ID);
        if (rule?.category !== "tool" && rule)
          assert.equal(Rules.getEnabledStandard().some(entry => entry.id === ruleID), !previous, `${key} controls standard execution`);
        control.click();
        assert.equal(Zotero.Prefs.get(key, true), previous, `${key} can be restored`);
        checked++;
      }
      assert.isAbove(checked, 70, "the audit covers ordinary, rule, workflow and menu switches");
    }
    finally {
      for (const control of controls) {
        const key = control.getAttribute("preference")!;
        const original = saved.get(key)!;
        if (original.value === undefined)
          Zotero.Prefs.clear(key, true);
        else
          Zotero.Prefs.set(key, original.value as boolean, true);
        control.checked = original.checked;
      }
      pane.dispatchEvent(new win.Event("change", { bubbles: true }));
    }
  });

  it("persists service credentials from their actual inputs and uses them in provider requests", async function () {
    const keys = ["easyscholar.secretKey", "semanticScholarToken"];
    const previous = new Map(keys.map(key => [key, Zotero.Prefs.get(pref(key), true)]));
    const inputs = keys.map(key => find(key) as HTMLInputElement);
    const request = Zotero.HTTP.request;
    let easyScholarCalls = 0;
    let semanticCalls = 0;
    Zotero.HTTP.request = (async (method: string, url: string, options: any) => {
      const parsed = new URL(url);
      if (parsed.hostname === "www.easyscholar.cc") {
        easyScholarCalls++;
        assert.equal(parsed.searchParams.get("secretKey"), "settings-audit-es-key");
        return { status: 200, responseText: JSON.stringify({ code: 200, data: { officialRank: { all: { sci: "Q1" } } } }) };
      }
      if (parsed.hostname === "api.semanticscholar.org") {
        semanticCalls++;
        assert.equal(options.headers["x-api-key"], "settings-audit-semantic-key");
        const response = JSON.stringify({ paperId: "settings-audit-paper", title: "Settings audit" });
        return { status: 200, response, responseText: response };
      }
      return request.call(Zotero.HTTP, method, url, options);
    }) as any;
    try {
      for (const [index, value] of ["  settings-audit-es-key  ", "  settings-audit-semantic-key  "].entries()) {
        inputs[index].value = value;
        inputs[index].dispatchEvent(new win.Event("change", { bubbles: true }));
        assert.equal(Zotero.Prefs.get(pref(keys[index]), true), value);
      }
      assert.equal((await fetchEasyScholarRank("Settings audit journal")).status, "success");
      await fetchEasyScholarRank("Settings audit journal");
      assert.equal(easyScholarCalls, 1, "an ordinary cached query uses the saved key once");
      await SemanticScholarService.fetch!({ identifiers: { DOI: "10.1234/settings-audit" }, debug() {} } as any);
      assert.equal(semanticCalls, 1);
      const button = pane.querySelector("#metaref-easyscholar-test")!;
      button.dispatchEvent(new win.Event("command", { bubbles: true }));
      for (let attempt = 0; attempt < 100; attempt++) {
        if (easyScholarCalls >= 2 && button.parentElement!.getAttribute("data-busy") !== "true")
          break;
        await Zotero.Promise.delay(50);
      }
      assert.equal(easyScholarCalls, 2, "the connection test deliberately makes a fresh request");
      assert.isNotEmpty(pane.querySelector("#metaref-easyscholar-test-status")!.textContent!);
    }
    finally {
      Zotero.HTTP.request = request;
      for (const [index, key] of keys.entries()) {
        const value = previous.get(key);
        if (value === undefined)
          Zotero.Prefs.clear(pref(key), true);
        else
          Zotero.Prefs.set(pref(key), value as string, true);
        inputs[index].value = String(value || "");
      }
    }
  });

  it("uses one card style for every section and links workflow modules to existing rule switches", async function () {
    assert.isAtLeast(pane.querySelectorAll(":scope > .metaref-section-card").length, 10);
    assert.isNotNull(pane.querySelector(":scope > .metaref-section-card > #metaref-core-workflows"));
    assert.isNotNull(pane.querySelector(":scope > .metaref-section-card > #metaref-tool-center"));
    const sections = [...pane.querySelectorAll(":scope > .metaref-section-card")];
    assert.lengthOf(pane.querySelectorAll("details details"), 0, "settings expose a single disclosure level");
    assert.isNotNull(sections[0].querySelector(":scope > summary [data-l10n-id$='section-general']"));
    assert.isNotNull(sections[1].querySelector(":scope > summary [data-l10n-id$='core-workflows-heading']"));
    assert.lengthOf(pane.querySelectorAll("checkbox[preference]"), 0, "all preference checkboxes use the same visible native control");
    for (const card of pane.querySelectorAll(":scope > .metaref-section-card"))
      assert.isNotNull(card.querySelector(":scope > summary"));
    for (const label of pane.querySelectorAll(".metaref-check-option"))
      assert.isNotEmpty(label.textContent!.trim(), "every native checkbox has a readable label");
    const titleRules = Rules.getStandard().filter(rule => /title/i.test(rule.id) && !/publication/i.test(rule.id));
    const before = new Map(titleRules.map(rule => [rule.id, Zotero.Prefs.get(pref(`rule.${rule.id}`), true)]));
    const module = pane.querySelector<HTMLInputElement>("#metaref-workflow-title")!;
    try {
      module.checked = false;
      module.click();
      for (const rule of titleRules)
        assert.isTrue(Zotero.Prefs.get(pref(`rule.${rule.id}`), true));
      module.click();
      for (const rule of titleRules)
        assert.isFalse(Zotero.Prefs.get(pref(`rule.${rule.id}`), true));
    }
    finally {
      for (const [id, value] of before) {
        Zotero.Prefs.set(pref(`rule.${id}`), value as boolean, true);
        (find(`rule.${id}`) as HTMLInputElement).checked = value as boolean;
      }
      pane.dispatchEvent(new win.Event("command", { bubbles: true }));
    }
    const cards = [...pane.querySelectorAll<HTMLDetailsElement>(":scope > .metaref-section-card")];
    const initial = cards.map(card => card.open);
    try {
      cards.forEach(card => card.open = false);
      win.resizeTo(920, 800);
      pane.scrollIntoView({ block: "start" });
      await Zotero.Promise.delay(100);
      const canvas = win.document.createElementNS("http://www.w3.org/1999/xhtml", "canvas") as HTMLCanvasElement;
      canvas.width = win.innerWidth;
      canvas.height = win.innerHeight;
      (canvas.getContext("2d") as any).drawWindow(win, 0, 0, canvas.width, canvas.height, "rgb(245,245,245)");
      await IOUtils.write(PathUtils.join(PathUtils.tempDir, "metaref-unified-settings-overview.png"), Uint8Array.from(win.atob(canvas.toDataURL("image/png").split(",")[1]), char => char.charCodeAt(0)));
    }
    finally {
      cards.forEach((card, index) => card.open = initial[index]);
    }
  });

  it("groups cache and runtime controls together without expanding advanced rules by default", async function () {
    const data = pane.querySelector("#metaref-data-settings")!;
    assert.isNotNull(data.querySelector("#metaref-runtime-data-open"));
    assert.isNotNull(data.querySelector("#metaref-last-batch-report"));
    assert.isNotNull(data.querySelector("#metaref-clear-api-cache"));
    assert.include(data.querySelector("#metaref-runtime-data-policy")!.textContent!, "200");
    assert.include(data.querySelector("#metaref-runtime-data-policy")!.textContent!, "30");
    assert.lengthOf(pane.querySelectorAll("#metaref-clear-api-cache"), 1);
    const cards = [...pane.querySelectorAll<HTMLDetailsElement>(":scope > .metaref-section-card")];
    assert.isTrue(cards[0].open, "the first group opens initially");
    assert.isTrue(cards.slice(1).every(card => !card.open), "other groups wait for the user's choice");
    const rules = cards.find(card => card.querySelector(":scope > summary [data-l10n-id$='section-rules']"))!;
    assert.isFalse(rules.open, "advanced rules remain available without filling the initial screen");
    const card = data.closest("details") as HTMLDetailsElement;
    card.open = true;
    data.scrollIntoView({ block: "start" });
    await Zotero.Promise.delay(100);
    const rect = card.getBoundingClientRect();
    const canvas = win.document.createElementNS("http://www.w3.org/1999/xhtml", "canvas") as HTMLCanvasElement;
    canvas.width = Math.ceil(rect.width);
    canvas.height = Math.min(Math.ceil(rect.height), win.innerHeight - Math.ceil(rect.top));
    (canvas.getContext("2d") as any).drawWindow(win, rect.left, rect.top, canvas.width, canvas.height, "rgb(245,245,245)");
    await IOUtils.write(PathUtils.join(PathUtils.tempDir, "metaref-global-data-settings.png"), Uint8Array.from(win.atob(canvas.toDataURL("image/png").split(",")[1]), char => char.charCodeAt(0)));
    card.open = false;
  });

  it("unifies command visibility and execution settings without duplicate bindings", async function () {
    const core = pane.querySelector<HTMLElement>("#metaref-core-workflows")!;
    const compact = find("menu.compact") as HTMLInputElement;
    const additional = core.querySelector<HTMLElement>("#metaref-additional-menu-options")!;
    const saved = new Map(["menu.compact", "menu.standard", "menu.tool-update-metadata"].map(key => [key, Zotero.Prefs.get(pref(key), true) as boolean]));
    const stages = ["workflow.updateBibliographic", "workflow.formatAfterUpdate"];
    const beforeStages = stages.map(key => Zotero.Prefs.get(pref(key), true));
    const cards = [...pane.querySelectorAll<HTMLDetailsElement>("details")];
    const opened = cards.map(card => card.open);
    try {
      assert.isTrue(core.contains(compact));
      assert.include(compact.closest(".metaref-check-option")!.textContent!, config.addonName);
      assert.isNull(pane.querySelector(":scope > .metaref-section-card > summary [data-l10n-id$='section-menu']"));
      for (const [key, id] of [["menu.standard", "metaref-workflow-settings"], ["menu.tool-update-metadata", "metaref-update-workflow-settings"]]) {
        const visible = find(key) as HTMLInputElement;
        assert.lengthOf(pane.querySelectorAll(`[preference='${pref(key)}']`), 1);
        assert.equal(visible.closest(".metaref-static-card")!.id, id);
        visible.click();
        assert.equal(Zotero.Prefs.get(pref(key), true), visible.checked);
        assert.deepEqual(stages.map(key => Zotero.Prefs.get(pref(key), true)), beforeStages);
      }
      for (const enabled of [false, true]) {
        if (compact.checked !== enabled)
          compact.click();
        assert.equal(Zotero.Prefs.get(pref("menu.compact"), true), enabled);
        assert.equal(additional.hidden, enabled);
        for (const placement of core.querySelectorAll<HTMLSelectElement>("[data-core-menu-command] select"))
          assert.equal(placement.hidden, enabled);
      }
      for (const [key, value] of saved) {
        if (key === "menu.compact")
          continue;
        const input = find(key) as HTMLInputElement;
        if (input.checked !== value)
          input.click();
      }
      cards.forEach(card => card.open = false);
      (core.closest("details") as HTMLDetailsElement).open = true;
      win.resizeTo(920, 900);
      core.scrollIntoView({ block: "start" });
      await Zotero.Promise.delay(100);
      const rect = core.closest("details")!.getBoundingClientRect();
      const canvas = win.document.createElementNS("http://www.w3.org/1999/xhtml", "canvas") as HTMLCanvasElement;
      canvas.width = Math.ceil(rect.width);
      canvas.height = Math.ceil(rect.height);
      (canvas.getContext("2d") as any).drawWindow(win, rect.left, rect.top, canvas.width, canvas.height, "rgb(245,245,245)");
      await IOUtils.write(PathUtils.join(PathUtils.tempDir, "metaref-menu-workflow-unified.png"), Uint8Array.from(win.atob(canvas.toDataURL("image/png").split(",")[1]), char => char.charCodeAt(0)));
    }
    finally {
      for (const [key, value] of saved) {
        const input = find(key) as HTMLInputElement;
        if (input.checked !== value)
          input.click();
      }
      cards.forEach((card, index) => card.open = opened[index]);
    }
  });

  it("saves metadata update policy in preferences and never reopens the mode dialog", async function () {
    const modeKey = "rule.tool-update-metadata.option.mode";
    const typeKey = "rule.tool-update-metadata.option.allow-type-changed";
    const legacyKey = "rule.tool-update-metadata.option.slient";
    const previous = new Map([modeKey, typeKey, legacyKey].map(key => [key, Zotero.Prefs.get(pref(key), true)]));
    const mode = find(modeKey) as any;
    assert.isNull(find(typeKey), "retired type conversion is not a core command setting");
    const plugin = (Zotero as any)[config.addonInstance];
    const dialogs = plugin.data.dialogs.size;
    const rule = Rules.getByID("tool-update-metadata")!;
    assert.isNull(pane.querySelector(`[preference='${pref(legacyKey)}']`));
    try {
      Zotero.Prefs.set(pref(legacyKey), false, true);
      for (const value of ["blank", "all"]) {
        mode.value = value;
        mode.dispatchEvent(new win.Event("command", { bubbles: true }));
        await Zotero.Promise.delay(50);
        assert.equal(Zotero.Prefs.get(pref(modeKey), true), value);
        for (const enabled of [false, true]) {
          Zotero.Prefs.set(pref(typeKey), enabled, true);
          const options = await rule.prepare!({ items: [], debug() {} } as any);
          assert.include(options, { mode: value, allowTypeChanged: enabled, repairCreators: Zotero.Prefs.get(pref("metadata.repairCreators"), true) === true });
          assert.equal(plugin.data.dialogs.size, dialogs, "legacy prompt preference cannot reopen the mode dialog");
        }
      }
    }
    finally {
      for (const [key, value] of previous)
        Zotero.Prefs.set(pref(key), value as string | boolean, true);
      mode.value = previous.get(modeKey);
    }
  });

  it("preserves workflow and field dependencies after unrelated settings change", function () {
    const keys = ["workflow.updateBibliographic", "easyscholar.fields.jcr"];
    const before = new Map(keys.map(key => [key, Zotero.Prefs.get(pref(key), true)]));
    const set = (key: string, checked: boolean) => {
      const input = find(key) as HTMLInputElement;
      input.checked = checked;
      input.dispatchEvent(new win.Event("change", { bubbles: true }));
    };
    try {
      for (const key of keys)
        set(key, false);
      const versions = pane.querySelector<HTMLInputElement>("#metaref-workflow-update-versions")!;
      const pdf = pane.querySelector<HTMLInputElement>("#metaref-workflow-scan-pdf")!;
      const title = pane.querySelector<HTMLInputElement>("#metaref-workflow-search-title")!;
      const column = find("easyscholar.columns.jcr") as HTMLInputElement;
      pane.dispatchEvent(new win.Event("command", { bubbles: true }));
      for (const input of [versions, pdf, title, column])
        assert.isTrue(input.disabled, input.id);
      set("workflow.updateBibliographic", true);
      set("easyscholar.fields.jcr", true);
      assert.isFalse(versions.disabled);
      assert.isFalse(pdf.disabled);
      assert.isFalse(title.disabled);
      assert.isFalse(column.disabled);
    }
    finally {
      for (const [key, value] of before)
        set(key, value as boolean);
    }
  });

  it("resynchronizes dependent controls after external preference changes", async function () {
    for (const [parentKey, childKey] of [["lint.onAdded", "metadata.autoUpdateOnAdded"], ["workflow.updateBibliographic", "workflow.updateVersions"]]) {
      const key = pref(parentKey);
      const original = Zotero.Prefs.get(key, true) as boolean;
      const auto = find(parentKey) as HTMLInputElement;
      const child = find(childKey) as HTMLInputElement;
      try {
        for (const enabled of [false, true, false]) {
          Zotero.Prefs.set(key, enabled, true);
          for (let i = 0; i < 100 && (auto.checked !== enabled || child.disabled !== !enabled); i++)
            await Zotero.Promise.delay(20);
          assert.equal(auto.checked, enabled, parentKey);
          assert.equal(child.disabled, !enabled, childKey);
          assert.equal(child.closest(".metaref-check-option")?.classList.contains("is-disabled"), !enabled, childKey);
        }
      }
      finally {
        Zotero.Prefs.set(key, original, true);
      }
    }
  });

  it("persists every bound boolean control and exports a live control inventory", async function () {
    const controls = [...pane.querySelectorAll<HTMLInputElement>("input[type='checkbox'][preference]")];
    assert.isAtLeast(controls.length, 150);
    const inventory = [];
    for (const input of controls) {
      const key = input.getAttribute("preference")!;
      const before = Zotero.Prefs.get(key, true) as boolean;
      assert.isBoolean(before, key);
      inventory.push({ id: input.id, preference: key, disabled: input.disabled, value: before });
      try {
        for (const value of [!before, before]) {
          input.checked = value;
          input.dispatchEvent(new win.Event("change", { bubbles: true }));
          assert.equal(Zotero.Prefs.get(key, true), value, key);
        }
      }
      finally {
        input.checked = before;
        input.dispatchEvent(new win.Event("change", { bubbles: true }));
      }
    }
    const allControls = [...pane.querySelectorAll<HTMLInputElement>("[preference]")].map(input => ({ id: input.id, preference: input.getAttribute("preference"), element: input.localName, type: input.type, disabled: input.disabled }));
    for (const select of pane.querySelectorAll<HTMLSelectElement>("select[data-abbr-option], select[data-index-policy]")) {
      const key = select.dataset.abbrOption ? `rule.require-journal-abbr.${select.dataset.abbrOption}` : `insights.${select.dataset.indexPolicy}SourcePriority`;
      allControls.push({ id: select.id, preference: pref(key), element: "select", type: select.type, disabled: select.disabled });
    }
    await IOUtils.writeUTF8(PathUtils.join(PathUtils.tempDir, "metaflow-live-setting-controls.json"), JSON.stringify({ booleanControlsChecked: inventory, controls: allControls }, null, 2));
  });

  it("persists all abbreviation and journal-index source choices", function () {
    const controls = [...pane.querySelectorAll<HTMLSelectElement>("select[data-abbr-option], select[data-index-policy]")];
    assert.lengthOf(controls, 7);
    for (const input of controls) {
      const key = pref(input.dataset.abbrOption ? `rule.require-journal-abbr.${input.dataset.abbrOption}` : `insights.${input.dataset.indexPolicy}SourcePriority`);
      const before = Zotero.Prefs.get(key, true);
      try {
        const values = [...input.querySelectorAll("option[value], menuitem[value]")].map(option => option.getAttribute("value")!);
        assert.isNotEmpty(values, key);
        for (const value of values) {
          input.value = value;
          input.dispatchEvent(new win.Event("change", { bubbles: true }));
          input.dispatchEvent(new win.Event("command", { bubbles: true }));
          assert.equal(String(Zotero.Prefs.get(key, true)), value, key);
        }
      }
      finally {
        input.value = String(before);
        input.dispatchEvent(new win.Event("change", { bubbles: true }));
        input.dispatchEvent(new win.Event("command", { bubbles: true }));
      }
    }
  });

  it("redraws the duplicate collection when its statistics display switch changes", async function () {
    const input = find("duplicates.showStats") as HTMLInputElement;
    const before = input.checked;
    let redraws = 0;
    let requested = 0;
    let changed = 0;
    const onChange = () => changed++;
    input.addEventListener("change", onChange);
    const trigger = Zotero.Notifier.trigger;
    Zotero.Notifier.trigger = function (...args: Parameters<typeof trigger>) {
      if (args[0] === "redraw" && args[1] === "collection")
        requested++;
      return trigger.apply(this, args);
    };
    const observer = Zotero.Notifier.registerObserver({ notify(event: string) {
      if (event === "redraw")
        redraws++;
    } }, ["collection"], "metaflow-show-stats-setting-test", 1);
    try {
      input.click();
      for (let attempt = 0; attempt < 50; attempt++) {
        if (redraws)
          break;
        await Zotero.Promise.delay(10);
      }
      assert.equal(input.checked, !before);
      assert.isAtLeast(requested, 1, JSON.stringify({ connected: input.isConnected, disabled: input.disabled, changed, requested }));
      assert.isAtLeast(redraws, 1, JSON.stringify({ connected: input.isConnected, disabled: input.disabled, checked: input.checked, changed, requested, preference: Zotero.Prefs.get(pref("duplicates.showStats"), true) }));
    }
    finally {
      Zotero.Notifier.unregisterObserver(observer);
      Zotero.Notifier.trigger = trigger;
      input.removeEventListener("change", onChange);
      input.checked = before;
      input.dispatchEvent(new win.Event("change", { bubbles: true }));
    }
  });

  it("tests EasyScholar connections inline, prevents duplicate requests and redacts keys", async function () {
    const input = pane.querySelector<HTMLInputElement>("#metaref-easyscholar-key")!;
    const button = pane.querySelector<HTMLButtonElement>("#metaref-easyscholar-test")!;
    const status = pane.querySelector<HTMLElement>("#metaref-easyscholar-test-status")!;
    const previousValue = input.value;
    const request = Zotero.HTTP.request;
    let requests = 0;
    let accepted = true;
    try {
      input.value = "connection-fixture-key";
      Zotero.HTTP.request = (async (method: string, url: string, options: any) => {
        if (new URL(url).hostname !== "www.easyscholar.cc")
          return request.call(Zotero.HTTP, method, url, options);
        requests++;
        assert.equal(new URL(url).searchParams.get("publicationName"), "Nature");
        await Zotero.Promise.delay(50);
        return { responseText: JSON.stringify(accepted ? { code: 200 } : { code: 403, msg: "Rejected connection-fixture-key" }) };
      }) as any;
      const run = async () => {
        button.dispatchEvent(new win.Event("command", { bubbles: true }));
        assert.isTrue(button.disabled);
        button.dispatchEvent(new win.Event("command", { bubbles: true }));
        for (let attempt = 0; attempt < 200 && button.disabled; attempt++)
          await Zotero.Promise.delay(25);
        assert.isFalse(button.disabled);
        assert.isNotEmpty(status.textContent!.trim());
      };
      await run();
      const success = status.textContent;
      assert.equal(requests, 1);
      accepted = false;
      await run();
      assert.equal(requests, 2);
      assert.notEqual(status.textContent, success);
      assert.notInclude(status.textContent!, "connection-fixture-key");
      assert.include(status.textContent!, "[redacted]");
      input.value = "";
      await run();
      assert.equal(requests, 2, "an empty key makes no request");
    }
    finally {
      Zotero.HTTP.request = request;
      input.value = previousValue;
    }
  });

  it("links the hidden menu location to visibility and preserves the last visible location", function () {
    const key = "tool-update-easyscholar";
    const visible = Zotero.Prefs.get(pref(`menu.${key}`), true);
    const primary = Zotero.Prefs.get(pref(`menu.primary.${key}`), true);
    const checkbox = find(`menu.${key}`) as HTMLInputElement;
    const select = checkbox.closest(".metaref-menu-placement-row")!.querySelector("select")!;
    const initial = select.value;
    try {
      assert.isNotNull(select.querySelector("option[value='none']"));
      select.value = "primary";
      select.dispatchEvent(new win.Event("change", { bubbles: true }));
      assert.isTrue(checkbox.checked);
      select.value = "none";
      select.dispatchEvent(new win.Event("change", { bubbles: true }));
      assert.isFalse(Zotero.Prefs.get(pref(`menu.${key}`), true));
      assert.isFalse(checkbox.checked);
      checkbox.click();
      assert.equal(select.value, "primary");
      checkbox.click();
      assert.equal(select.value, "none");
      select.value = "nested";
      select.dispatchEvent(new win.Event("change", { bubbles: true }));
      assert.isTrue(Zotero.Prefs.get(pref(`menu.${key}`), true));
      assert.isFalse(Zotero.Prefs.get(pref(`menu.primary.${key}`), true));
      assert.isTrue(checkbox.checked);
    }
    finally {
      for (const [name, value] of [[`menu.${key}`, visible], [`menu.primary.${key}`, primary]] as const) {
        if (value === undefined)
          Zotero.Prefs.clear(pref(name), true);
        else
          Zotero.Prefs.set(pref(name), value as boolean, true);
      }
      checkbox.checked = visible as boolean;
      select.value = initial;
    }
  });

  it("keeps identifier controls inset from card edges at both window widths", async function () {
    const input = find("rule.no-doi-prefix");
    const card = input.closest(".metaref-static-card")!;
    const states = new Map<HTMLDetailsElement, boolean>();
    for (let ancestor: Element | null = card; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor.localName === "details") {
        states.set(ancestor as HTMLDetailsElement, (ancestor as HTMLDetailsElement).open);
        (ancestor as HTMLDetailsElement).open = true;
      }
    }
    try {
      assert.isNotNull(input.closest(".metaref-card-body"));
      for (const width of [920, 780]) {
        win.resizeTo(width, 800);
        for (const overview of pane.querySelectorAll(".metaref-collapsible-card > p"))
          assert.equal(win.getComputedStyle(overview).marginInlineStart, "0px", "level-one overview starts at the card content edge");
        card.scrollIntoView({ block: "center" });
        await Zotero.Promise.delay(100);
        const rect = card.getBoundingClientRect();
        const control = input.getBoundingClientRect();
        assert.isAtLeast(control.left - rect.left, 13, "checkbox clears the border");
        const heading = card.querySelector(":scope > .metaref-card-heading")!.firstElementChild!.getBoundingClientRect();
        assert.closeTo(control.left, heading.left, 1, "checkbox aligns with its heading");
        assert.isAtLeast(rect.right - control.right, 13);
        assert.isAtMost(pane.scrollWidth, pane.clientWidth + 1);
      }
      const rect = card.getBoundingClientRect();
      const canvas = win.document.createElementNS("http://www.w3.org/1999/xhtml", "canvas") as HTMLCanvasElement;
      canvas.width = Math.ceil(rect.width);
      canvas.height = Math.ceil(rect.height);
      (canvas.getContext("2d") as any).drawWindow(win, rect.left, rect.top, rect.width, rect.height, "rgb(245,245,245)");
      await IOUtils.write(PathUtils.join(PathUtils.tempDir, "metaref-card-inset.png"), Uint8Array.from(win.atob(canvas.toDataURL("image/png").split(",")[1]), char => char.charCodeAt(0)));
    }
    finally {
      for (const [detail, open] of states)
        detail.open = open;
    }
  });

  it("retains warnings without an automatic report and opens details only on request", async function () {
    const plugin = (Zotero as any)[config.addonInstance];
    const keys = ["lint.notify", "lint.onAdded"];
    const previous = new Map(keys.map(key => [key, Zotero.Prefs.get(pref(key), true)]));
    const item = new Zotero.Item("journalArticle");
    const dialogs = new Set(plugin.data.dialogs.keys());
    try {
      keys.forEach(key => Zotero.Prefs.set(pref(key), false, true));
      item.setField("title", "Quiet feedback fixture");
      await item.saveTx();
      await plugin.runner.add({ items: [item], rules: [{ id: "tool-update-metadata", scope: "item", apply({ report }: any) {
        report({ level: "warning", message: "Retained warning fixture" });
      } }] });
      assert.equal(plugin.data.dialogs.size, dialogs.size, "warnings do not automatically open detailed reports");
      assert.equal(plugin.runner.lastResult.warnings, 1);
      assert.isNotEmpty(pane.querySelector("#metaref-last-batch-status")!.textContent!);
      const button = pane.querySelector<HTMLButtonElement>("#metaref-last-batch-report")!;
      assert.isFalse(button.disabled);
      button.dispatchEvent(new win.Event("command", { bubbles: true }));
      for (let attempt = 0; attempt < 100 && plugin.data.dialogs.size === dialogs.size; attempt++)
        await Zotero.Promise.delay(25);
      const report = [...plugin.data.dialogs.entries()].find(([key]: any) => !dialogs.has(key))?.[1] as Window;
      assert.isDefined(report, "an explicit request opens the retained details");
      assert.include(report.document.body!.textContent!, "Retained warning fixture");
      report.close();
    }
    finally {
      for (const [key, value] of previous)
        Zotero.Prefs.set(pref(key), value as boolean, true);
      if (item.id)
        await item.eraseTx();
      for (const [key, dialog] of plugin.data.dialogs) {
        if (!dialogs.has(key))
          (dialog as Window).close();
      }
    }
  });

  it("persists independent ESI and Nature Index source priorities", async function () {
    for (const kind of ["esi", "nature"]) {
      const key = pref(`insights.${kind}SourcePriority`);
      const previous = Zotero.Prefs.get(key, true);
      const select = pane.querySelector<HTMLSelectElement>(`select[data-index-policy='${kind}']`)!;
      const initial = select.value;
      try {
        assert.lengthOf(select.options, 4);
        assert.isNotEmpty(win.document.getElementById(select.getAttribute("aria-labelledby")!)!.textContent!.trim());
        for (const value of ["api-first", "local-first", "api-only", "local-only"]) {
          select.value = value;
          select.dispatchEvent(new win.Event("change", { bubbles: true }));
          assert.equal(Zotero.Prefs.get(key, true), value);
        }
      }
      finally {
        Zotero.Prefs.set(key, previous as string, true);
        select.value = initial;
      }
    }
    const card = pane.querySelector("select[data-index-policy]")!.closest("details") as HTMLDetailsElement;
    const states = new Map<HTMLDetailsElement, boolean>();
    for (let ancestor: Element | null = card; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor.localName === "details") {
        states.set(ancestor as HTMLDetailsElement, (ancestor as HTMLDetailsElement).open);
        (ancestor as HTMLDetailsElement).open = true;
      }
    }
    try {
      win.resizeTo(920, 800);
      card.scrollIntoView({ block: "center" });
      await Zotero.Promise.delay(100);
      assert.isAtMost(pane.scrollWidth, pane.clientWidth + 1);
      const rect = card.getBoundingClientRect();
      const canvas = win.document.createElementNS("http://www.w3.org/1999/xhtml", "canvas") as HTMLCanvasElement;
      canvas.width = Math.ceil(rect.width);
      canvas.height = Math.ceil(rect.height);
      (canvas.getContext("2d") as any).drawWindow(win, rect.left, rect.top, rect.width, rect.height, "rgb(245,245,245)");
      await IOUtils.write(PathUtils.join(PathUtils.tempDir, "metaref-index-source-priority.png"), Uint8Array.from(win.atob(canvas.toDataURL("image/png").split(",")[1]), char => char.charCodeAt(0)));
    }
    finally {
      for (const [detail, open] of states)
        detail.open = open;
    }
  });

  it("validates custom files before activation, rejects edits at the same path, and keeps paths on cancellation", async function () {
    const plugin = (Zotero as any)[config.addonInstance];
    const picker = plugin.data.ztoolkit.FilePicker.prototype;
    const originalOpen = picker.open;
    const paths: string[] = [];
    const previous = new Map<string, unknown>();
    const choices: (string | undefined)[] = [];
    picker.open = async () => choices.shift();
    try {
      for (const [kind, rule, key, content, broken] of [
        ["abbr", "rule.require-journal-abbr", "rule.require-journal-abbr.customDataPath", "{\"QA Journal\":\"QA J.\"}", "broken JSON"],
        ["title", "rule.correct-title-sentence-case", "rule.correct-title-sentence-case.custom-term-path", "mos2,MoS2\n", "/[/g,invalid\n"],
      ]) {
        for (const name of [rule, key])
          previous.set(pref(name), Zotero.Prefs.get(pref(name), true));
        const control = find(rule) as HTMLInputElement;
        control.checked = true;
        control.dispatchEvent(new win.Event("command", { bubbles: true }));
        const path = PathUtils.join(PathUtils.tempDir, `metaref-settings-${Date.now()}-${kind}.${kind === "abbr" ? "json" : "csv"}`);
        paths.push(path);
        await Zotero.File.putContentsAsync(path, content);
        const input = find(key) as HTMLInputElement;
        const row = input.parentElement!;
        const button = row.querySelector(`#metaref-${kind}-choose-custom-data-button`)!;
        const status = row.querySelector(".metaref-custom-data-status")!;
        const choose = async (value: string | undefined) => {
          choices.push(value);
          button.dispatchEvent(new win.Event("command", { bubbles: true }));
          assert.equal(row.getAttribute("aria-busy"), "true");
          button.dispatchEvent(new win.Event("command", { bubbles: true }));
          for (let attempt = 0; attempt < 200 && row.hasAttribute("data-busy"); attempt++)
            await Zotero.Promise.delay(25);
          assert.isFalse(row.hasAttribute("data-busy"));
          assert.isFalse((button as HTMLButtonElement).disabled);
          assert.isEmpty(choices, "a repeated command must not open another picker");
        };
        await choose(path);
        assert.equal(Zotero.Prefs.get(pref(key), true), path);
        assert.equal(input.value, path);
        Zotero.Prefs.set(pref(key), `${path}.external`, true);
        await Zotero.Promise.delay(25);
        assert.equal(input.value, `${path}.external`, "the path display follows authoritative preference changes");
        Zotero.Prefs.set(pref(key), path, true);
        assert.include(status.textContent!, "1");
        const acceptedStatus = status.textContent;
        await Zotero.File.putContentsAsync(path, broken);
        await choose(path);
        assert.equal(Zotero.Prefs.get(pref(key), true), path, "failed validation preserves the previous choice");
        assert.notEqual(status.textContent, acceptedStatus, "edited contents must be revalidated rather than read from the old cache");
        assert.isNotEmpty(status.textContent!.trim());
        await choose(undefined);
        assert.equal(input.value, path);
        assert.equal(status.textContent, "");
        row.querySelector("[data-reset-path='true']")!.dispatchEvent(new win.Event("command", { bubbles: true }));
        assert.equal(input.value, "");
        assert.equal(Zotero.Prefs.get(pref(key), true), "");
      }
    }
    finally {
      picker.open = originalOpen;
      for (const [key, value] of previous) {
        if (value === undefined)
          Zotero.Prefs.clear(key, true);
        else
          Zotero.Prefs.set(key, value as string | boolean, true);
      }
      for (const path of paths)
        await IOUtils.remove(path, { ignoreAbsent: true });
    }
  });

  it("persists every abbreviation source option in its independent collapsible card", async function () {
    const group = pane.querySelector("#metaref-journal-abbreviation-settings")!;
    const card = group.closest("details.metaref-section-card") as HTMLDetailsElement;
    assert.equal(card.parentElement, pane);
    card.open = true;
    const selects = [...group.querySelectorAll<HTMLSelectElement>("select[data-abbr-option]")];
    assert.lengthOf(selects, 5);
    assert.lengthOf(group.querySelectorAll("select[data-abbr-option='profile'] option"), 19);
    for (const select of selects) {
      const key = pref(`rule.require-journal-abbr.${select.dataset.abbrOption}`);
      const previous = Zotero.Prefs.get(key, true);
      try {
        for (const option of select.options) {
          select.value = option.value;
          select.dispatchEvent(new win.Event("change", { bubbles: true }));
          assert.equal(Zotero.Prefs.get(key, true), option.value);
          assert.isNotEmpty(option.textContent!.trim());
        }
      }
      finally {
        Zotero.Prefs.set(key, previous as string, true);
        select.value = previous as string;
      }
    }
    group.scrollIntoView({ block: "start" });
    await Zotero.Promise.delay(100);
    assert.isAtMost(group.scrollWidth, group.clientWidth + 1);
    const canvas = win.document.createElementNS("http://www.w3.org/1999/xhtml", "canvas") as HTMLCanvasElement;
    canvas.width = win.innerWidth;
    canvas.height = win.innerHeight;
    (canvas.getContext("2d") as any).drawWindow(win, 0, 0, canvas.width, canvas.height, "rgb(245,245,245)");
    await IOUtils.write(PathUtils.join(PathUtils.tempDir, "metaref-abbreviation-settings.png"), Uint8Array.from(win.atob(canvas.toDataURL("image/png").split(",")[1]), char => char.charCodeAt(0)));
    card.open = false;
  });

  it("keeps invalid numeric values out of preferences and labels all input controls", async function () {
    const input = find("lint.numConcurrent") as HTMLInputElement;
    for (const value of ["4", "16", "1"]) {
      input.value = value;
      input.dispatchEvent(new win.Event("input", { bubbles: true }));
      assert.equal(Zotero.Prefs.get(pref("lint.numConcurrent"), true), Number(value));
    }
    for (const value of ["", "0", "17", "1.5"]) {
      input.value = value;
      input.dispatchEvent(new win.Event("input", { bubbles: true }));
      input.dispatchEvent(new win.Event("change", { bubbles: true }));
      assert.equal(input.getAttribute("aria-invalid"), "true");
      assert.equal(Zotero.Prefs.get(pref("lint.numConcurrent"), true), 1);
      input.dispatchEvent(new win.Event("blur"));
      assert.equal(input.value, "1");
      assert.isFalse(input.hasAttribute("aria-invalid"));
    }
    for (const control of pane.querySelectorAll<HTMLElement>("input[preference], radiogroup[preference]")) {
      const labelID = control.getAttribute("aria-labelledby");
      assert.isNotNull(labelID, `${control.getAttribute("preference")} has an accessible label`);
      assert.isNotNull(win.document.getElementById(labelID!));
    }
    win.resizeTo(780, 720);
    await Zotero.Promise.delay(100);
    const rect = pane.getBoundingClientRect();
    assert.isAtMost(pane.scrollWidth, pane.clientWidth + 1, "the settings panel fits its available width");
    const canvas = win.document.createElementNS("http://www.w3.org/1999/xhtml", "canvas") as HTMLCanvasElement;
    canvas.width = Math.ceil(rect.width);
    canvas.height = Math.min(600, Math.ceil(rect.height));
    const context = canvas.getContext("2d")!;
    (context as any).drawWindow(win, rect.left, rect.top, canvas.width, canvas.height, "rgb(245,245,245)");
    const bytes = Uint8Array.from(win.atob(canvas.toDataURL("image/png").split(",")[1]), char => char.charCodeAt(0));
    await IOUtils.write(PathUtils.join(PathUtils.tempDir, `metaref-settings-${Zotero.locale}.png`), bytes);
  });
});
