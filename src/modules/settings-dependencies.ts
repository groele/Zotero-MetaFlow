import { preferenceLifetime, preferenceListeners } from "../utils/preference-listeners";
import { getPref, setPref } from "../utils/prefs";

export function setupCustomDataReset(pane: Element) {
  const listen = preferenceListeners(pane);
  for (const input of pane.querySelectorAll<HTMLInputElement>("input[readonly][preference]")) {
    const button = input.ownerDocument.createXULElement("button");
    input.ownerDocument.l10n!.setAttributes(button, "metaref-settings-custom-data-reset");
    button.setAttribute("native", "true");
    button.dataset.resetPath = "true";
    if (!input.closest("[data-journal-database]")) {
      listen(button, "command", () => {
        if (input.parentElement!.hasAttribute("data-busy"))
          return;
        const status = input.parentElement!.querySelector(".metaref-custom-data-status");
        if (status)
          status.textContent = "";
        const key = input.getAttribute("preference")!.replace(`${addon.data.config.prefsPrefix}.`, "");
        setPref(key as any, "");
        input.value = "";
      });
    }
    input.parentElement!.appendChild(button);
  }
}

export function setupDependencies(pane: Element) {
  const listen = preferenceListeners(pane);
  const signal = preferenceLifetime(pane);
  const prefix = `${addon.data.config.prefsPrefix}.`;
  const controls = [...pane.querySelectorAll<HTMLInputElement>("[preference]")];
  const key = (control: Element) => control.getAttribute("preference")!.replace(prefix, "");
  const parents = controls.filter(control => control.localName === "checkbox" || control.type === "checkbox")
    .map(control => ({ control, prefix: `${key(control)}.` }));
  const dependencies = controls.map(control => ({
    control,
    parents: parents.filter(parent => parent.control !== control && key(control).startsWith(parent.prefix)),
  }));
  const auto = controls.find(control => key(control) === "lint.onAdded");
  const importSteps = controls.filter(control => ["lint.onGroup", "metadata.autoUpdateOnAdded", "easyscholar.autoUpdateOnAdded"].includes(key(control)));
  const tldrParent = controls.find(control => key(control) === "workflow.tldrEnabled");
  const tldrChild = controls.find(control => key(control) === "workflow.tldrShowInInfoPane");
  const update = () => {
    if (signal.aborted || !pane.isConnected || !addon.data.alive)
      return;
    for (const { control, parents } of dependencies) {
      if (parents.length)
        control.disabled = parents.some(parent => !parent.control.checked);
    }
    if (auto) {
      for (const step of importSteps)
        step.disabled = !auto.checked;
    }
    if (tldrParent && tldrChild)
      tldrChild.disabled = !tldrParent.checked;
    for (const button of pane.querySelectorAll<HTMLButtonElement>("hbox button")) {
      if (button.closest("[data-busy='true']")) {
        button.disabled = true;
        continue;
      }
      const input = button.parentElement?.querySelector("input[preference]") as HTMLInputElement | null;
      if (input)
        button.disabled = input.disabled || (button.dataset.resetPath === "true" && !input.value);
    }
    for (const control of controls)
      control.closest(".metaref-check-option, .subordinate-row")?.classList.toggle("is-disabled", control.disabled);
  };
  const schedule = () => {
    void Promise.resolve().then(update);
  };
  let syncQueued = false;
  const syncPreferences = () => {
    if (syncQueued)
      return;
    syncQueued = true;
    void Promise.resolve().then(() => {
      syncQueued = false;
      if (signal.aborted || !pane.isConnected || !addon.data.alive)
        return;
      // Host bindings may update checked after the preference observer callback.
      for (const parent of parents)
        parent.control.checked = getPref(key(parent.control) as any, false) === true;
      const Event = (pane.ownerDocument!.defaultView as Window & typeof globalThis).Event;
      pane.dispatchEvent(new Event("metaref-preferences-synced"));
      update();
    });
  };
  listen(pane, "command", update);
  listen(pane, "change", update);
  listen(pane, "syncfrompreference", schedule, true);
  const keys = new Set(controls.map(key));
  for (const name of keys) {
    const observer = Zotero.Prefs.registerObserver(`${prefix}${name}`, syncPreferences, true);
    signal.addEventListener("abort", () => Zotero.Prefs.unregisterObserver(observer), { once: true });
  }
  update();
}
