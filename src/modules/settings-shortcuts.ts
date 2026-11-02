import { preferenceListeners } from "../utils/preference-listeners";
import { getPref, setPref } from "../utils/prefs";
import { normalizeShortcut, recordShortcut, SHORTCUT_DEFAULTS, shortcutPreview } from "../utils/shortcuts";

export function setupShortcutInputs(pane: Element) {
  const listen = preferenceListeners(pane);
  const win = addon.data.prefs?.window;
  if (!win)
    return;
  const doc = win.document;
  const status = doc.querySelector<HTMLElement>(".metaref-shortcut-status");
  if (status) {
    status.id = "metaref-shortcut-status";
    status.setAttribute("role", "status");
  }
  const inputs = [...doc.querySelectorAll<HTMLInputElement>(".metaref-shortcut-input")];
  const prefKey = (input: HTMLInputElement) => input.getAttribute("preference")!
    .replace(`${addon.data.config.prefsPrefix}.`, "");

  const updatePreview = (input: HTMLInputElement) => {
    const preview = input.parentElement?.querySelector<HTMLElement>(".metaref-shortcut-preview");
    if (preview) {
      preview.textContent = shortcutPreview(input.value, Zotero.isMac);
      preview.title = preview.textContent;
    }
  };
  const showStatus = (id: string, args?: Record<string, unknown>) => {
    if (status)
      doc.l10n!.setAttributes(status, `metaref-${id}`, args);
  };
  const save = (input: HTMLInputElement, raw: string): boolean => {
    const normalized = normalizeShortcut(raw, Zotero.isMac);
    const conflict = normalized && inputs.find(other => other !== input
      && normalizeShortcut(other.value, Zotero.isMac) === normalized);
    if (normalized === null || conflict) {
      input.setAttribute("aria-invalid", "true");
      if (conflict) {
        const label = conflict.parentElement?.querySelector("label")?.textContent ?? "";
        showStatus("shortcut-conflict", { action: label });
      }
      else {
        showStatus("shortcut-invalid");
      }
      return false;
    }
    input.removeAttribute("aria-invalid");
    input.value = raw.trim();
    setPref(prefKey(input) as any, input.value);
    updatePreview(input);
    showStatus(input.value ? "shortcut-saved" : "shortcut-disabled");
    return true;
  };

  for (const input of inputs) {
    const row = input.parentElement!;
    const pref = prefKey(input);
    const action = pref.slice("shortcut.".length) as keyof typeof SHORTCUT_DEFAULTS;
    input.id = `metaref-shortcut-${action}`;
    const label = row.querySelector("label")!;
    label.id = `${input.id}-label`;
    label.setAttribute("control", input.id);
    input.setAttribute("aria-labelledby", label.id);
    input.setAttribute("aria-describedby", "metaref-shortcut-status");
    doc.l10n!.setAttributes(input, "metaref-shortcut-input-hint");
    const actions = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    actions.className = "metaref-shortcut-actions";
    actions.setAttribute("role", "group");
    actions.setAttribute("aria-labelledby", label.id);
    row.appendChild(actions);
    const makeButton = (l10nID: string, onCommand: () => void) => {
      const button = doc.createXULElement("button");
      doc.l10n!.setAttributes(button, `metaref-${l10nID}`);
      button.setAttribute("native", "true");
      button.classList.add("metaref-shortcut-action");
      listen(button, "command", onCommand);
      actions.appendChild(button);
    };
    makeButton("shortcut-clear", () => save(input, ""));
    makeButton("shortcut-reset", () => save(input, SHORTCUT_DEFAULTS[action]));
    input.value = getPref(pref as any, SHORTCUT_DEFAULTS[action]) as string;
    updatePreview(input);
    listen(input, "syncfrompreference", () => setTimeout(updatePreview, 0, input));

    listen(input, "input", (event: Event) => {
      // Reject invalid pasted bindings before Zotero's preference binding saves them.
      event.stopImmediatePropagation();
      const raw = input.value;
      if (!save(input, raw)) {
        input.value = getPref(pref as any, SHORTCUT_DEFAULTS[action]) as string;
        updatePreview(input);
      }
    }, true);
    listen(input, "blur", () => input.removeAttribute("aria-invalid"));
    listen(input, "keydown", (event: KeyboardEvent) => {
      if (event.key === "Tab")
        return;
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        input.blur();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "v")
        return;
      event.preventDefault();
      if ((event.key === "Backspace" || event.key === "Delete") && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
        save(input, "");
        return;
      }
      const raw = recordShortcut(event, Zotero.isMac);
      if (raw && save(input, raw))
        input.blur();
    });
  }
}
