import { preferenceListeners } from "../../utils/preference-listeners";
import { getPref, setPref } from "../../utils/prefs";
import { validConcurrency } from "../../utils/settings";

export function setupSettingsPanel(pane: Element) {
  setupInputLabels(pane);
  setupConcurrency(pane);
}

function setupInputLabels(pane: Element) {
  for (const [index, input] of [...pane.querySelectorAll<HTMLElement>("input[preference], radiogroup[preference]")].entries()) {
    if (input.closest(".metaref-check-option"))
      continue;
    input.id ||= `metaref-setting-input-${index}`;
    const label = input.parentElement?.querySelector(":scope > label") || input.parentElement?.previousElementSibling;
    if (label?.localName === "label") {
      label.id ||= `${input.id}-label`;
      label.setAttribute("control", input.id);
      input.setAttribute("aria-labelledby", label.id);
    }
    const description = input.closest("hbox, vbox")?.querySelector("description") || input.closest("hbox, vbox")?.nextElementSibling;
    if (description?.localName === "description") {
      description.id ||= `${input.id}-description`;
      input.setAttribute("aria-describedby", [input.getAttribute("aria-describedby"), description.id].filter(Boolean).join(" "));
    }
  }
}

function setupConcurrency(pane: Element) {
  const listen = preferenceListeners(pane);
  const input = pane.querySelector<HTMLInputElement>(`input[preference='${addon.data.config.prefsPrefix}.lint.numConcurrent']`)!;
  const doc = pane.ownerDocument!;
  const status = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  status.id = "metaref-concurrency-status";
  status.className = "metaref-input-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  input.parentElement!.appendChild(status);
  input.setAttribute("aria-describedby", `${input.getAttribute("aria-describedby") || ""} ${status.id}`.trim());
  const validate = (event: Event) => {
    event.stopImmediatePropagation();
    const value = validConcurrency(input.value);
    if (value === null) {
      input.setAttribute("aria-invalid", "true");
      doc.l10n!.setAttributes(status, "metaref-settings-concurrency-invalid");
    }
    else {
      input.removeAttribute("aria-invalid");
      status.removeAttribute("data-l10n-id");
      status.textContent = "";
      setPref("lint.numConcurrent", value);
    }
  };
  listen(input, "input", validate, true);
  listen(input, "change", validate, true);
  listen(input, "blur", () => {
    if (input.hasAttribute("aria-invalid")) {
      input.value = String(getPref("lint.numConcurrent"));
      input.removeAttribute("aria-invalid");
      doc.l10n!.setAttributes(status, "metaref-settings-concurrency-restored");
    }
  });
}
