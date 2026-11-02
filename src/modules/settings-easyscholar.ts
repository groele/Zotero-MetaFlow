import {
  EASYSCHOLAR_DEFAULT_FIELDS,
  EASYSCHOLAR_FIELD_DEFINITIONS,
  getEasyScholarFieldMessageID,
  isEasyScholarFieldEnabled,
  testEasyScholarConnection,
} from "../utils/easyscholar";
import { getString } from "../utils/locale";
import { createLogger } from "../utils/logger";
import { preferenceListeners } from "../utils/preference-listeners";
import { getPref, setPref } from "../utils/prefs";
import { registerExtraColumns } from "./item-tree";

const logger = createLogger("settings-easyscholar");

export function setupEasyScholarSettings(pane: Element) {
  const listen = preferenceListeners(pane);
  const doc = pane.ownerDocument!;
  const fieldHost = pane.querySelector<HTMLElement>("#metaref-easyscholar-university-fields");
  const customHost = pane.querySelector<HTMLElement>("#metaref-easyscholar-custom-fields");
  const supplementalHost = pane.querySelector<HTMLElement>("#metaref-easyscholar-supplemental-fields");
  const columnsHost = pane.querySelector<HTMLElement>("#metaref-easyscholar-columns");
  if (!fieldHost || !customHost || !columnsHost)
    return;

  const makeControl = (field: (typeof EASYSCHOLAR_FIELD_DEFINITIONS)[number], kind: "fields" | "columns") => {
    const pref = `easyscholar.${kind}.${field.key}`;
    const defaultEnabled = kind === "fields" && EASYSCHOLAR_DEFAULT_FIELDS.has(field.key);
    return makeCheckbox(pref, `metaref-${getEasyScholarFieldMessageID(field.key)}`, defaultEnabled);
  };

  function makeCheckbox(pref: string, l10nID: string, fallback: boolean) {
    const label = doc.createElementNS("http://www.w3.org/1999/xhtml", "label");
    label.className = "metaref-check-option";
    const control = doc.createElementNS("http://www.w3.org/1999/xhtml", "input") as HTMLInputElement;
    control.type = "checkbox";
    control.id = `metaref-check-${pref.replaceAll(".", "-")}`;
    control.setAttribute("preference", `${addon.data.config.prefsPrefix}.${pref}`);
    control.checked = getPref(pref as any, fallback) === true;
    const caption = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
    caption.id = `${control.id}-label`;
    caption.textContent = getString(l10nID.replace(/^metaref-/, "") as any);
    control.setAttribute("aria-labelledby", caption.id);
    label.append(control, caption);
    const update = () => {
      setPref(pref as any, control.checked as any);
      if (pref === "duplicates.showStats")
        void Zotero.Notifier.trigger("redraw", "collection", [], {}, true).catch(error => logger.error(error));
      if (pref.startsWith("easyscholar.columns.") || pref.startsWith("easyscholar.fields.") || pref === "insights.natureEnabled") {
        registerExtraColumns();
        for (const field of EASYSCHOLAR_FIELD_DEFINITIONS) {
          const column = columnsHost!.querySelector<HTMLInputElement>(`input[preference$='.easyscholar.columns.${field.key}']`);
          if (column)
            column.disabled = !isEasyScholarFieldEnabled(field.key);
        }
      }
    };
    listen(control, "change", update);
    listen(control, "command", update);
    return label;
  }

  for (const original of pane.querySelectorAll("checkbox[preference]")) {
    const pref = original.getAttribute("preference")!.replace(`${addon.data.config.prefsPrefix}.`, "");
    const replacement = makeCheckbox(pref, original.getAttribute("data-l10n-id")!, getPref(pref as any) === true);
    if (original.id)
      replacement.querySelector("input")!.id = original.id;
    original.replaceWith(replacement);
  }
  for (const group of pane.querySelectorAll(".metaref-field-groups > groupbox")) {
    const choices = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    choices.className = "metaref-choice-grid";
    choices.append(...group.querySelectorAll(":scope > .metaref-check-option"));
    if (choices.childElementCount)
      group.append(choices);
  }
  for (const host of [fieldHost, customHost, supplementalHost, columnsHost])
    host?.classList.add("metaref-choice-grid");

  for (const field of EASYSCHOLAR_FIELD_DEFINITIONS) {
    if ("group" in field && field.group === "university")
      fieldHost.appendChild(makeControl(field, "fields"));
    else if (field.source === "custom")
      customHost.appendChild(makeControl(field, "fields"));
    else if (field.source === "supplemental")
      supplementalHost?.appendChild(makeControl(field, "fields"));
    const columnControl = makeControl(field, "columns");
    columnControl.querySelector("input")!.disabled = !isEasyScholarFieldEnabled(field.key);
    columnsHost.appendChild(columnControl);
  }
  const cardGroups = pane.querySelectorAll<Element>(".metaref-field-groups > groupbox, #metaref-easyscholar-settings > groupbox");
  for (const group of cardGroups) {
    const heading = group.querySelector(":scope > label");
    if (!heading)
      continue;
    const card = doc.createElementNS("http://www.w3.org/1999/xhtml", "section");
    card.className = "metaref-setting-card metaref-static-card";
    const summary = doc.createElementNS("http://www.w3.org/1999/xhtml", "header");
    summary.className = "metaref-card-heading";
    const count = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
    count.className = "metaref-card-hint";
    const updateCount = () => {
      const choices = [...group.querySelectorAll("input[type='checkbox']")] as HTMLInputElement[];
      doc.l10n!.setAttributes(count, "metaref-settings-group-count", { selected: choices.filter(choice => choice.checked).length, total: choices.length });
    };
    group.before(card);
    summary.append(heading);
    if (group.querySelector("input[type=checkbox]"))
      summary.append(count);
    card.append(summary, group);
    listen(card, "change", updateCount);
    listen(card, "command", updateCount);
    updateCount();
  }
}

export function setupEasyScholarConnectionTest(pane: Element) {
  const listen = preferenceListeners(pane);
  const input = pane.querySelector<HTMLInputElement>("#metaref-easyscholar-key");
  const button = pane.querySelector<HTMLButtonElement>("#metaref-easyscholar-test");
  const status = pane.querySelector<HTMLElement>("#metaref-easyscholar-test-status");
  const container = button?.parentElement;
  if (!input || !button || !status || !container)
    return;

  listen(button, "command", async () => {
    if (container.getAttribute("data-busy") === "true")
      return;
    container.setAttribute("data-busy", "true");
    button.disabled = true;
    status.textContent = "";
    try {
      const result = await testEasyScholarConnection(input.value);
      status.textContent = result.status === "success"
        ? getString("easyscholar-test-success")
        : result.status === "unconfigured"
          ? getString("easyscholar-test-empty")
          : getString("easyscholar-test-failed", { args: { error: result.message } });
    }
    finally {
      container.removeAttribute("data-busy");
      button.disabled = input.disabled;
    }
  });
}
