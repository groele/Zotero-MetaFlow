import { exportNonDuplicates, importNonDuplicates } from "../../services/duplicates/non-duplicates";
import { useDialog } from "../../utils/dialog";
import { getString } from "../../utils/locale";
import { preferenceListeners } from "../../utils/preference-listeners";
import { getPref, setPref } from "../../utils/prefs";
import { selectedLibraryIDs } from "../../utils/selection";
import { refreshDuplicateStats } from "./duplicate-stats";
import { bulkMergeDuplicates, cancelDuplicateBatch, getDuplicateBatch, pauseDuplicateBatch } from "./review/duplicate-batch";
import { duplicateConcurrency, duplicateGroups } from "./review/duplicate-policy";
import { findDuplicates } from "./review/duplicates";

function selectedLibraryID() {
  const libraries = selectedLibraryIDs(Zotero.getActiveZoteroPane());
  if (libraries.length > 1)
    throw new Error(getString("duplicates-select-one-library"));
  return libraries[0] || Zotero.Libraries.userLibraryID;
}

export function setupDuplicateSettings(pane: Element) {
  const doc = pane.ownerDocument!;
  const listen = preferenceListeners(pane);
  const host = pane.querySelector<HTMLElement>("#metaref-duplicate-settings");
  if (!host)
    return;
  for (const [id, preference, values] of [
    ["default-action", "duplicates.defaultAction", ["keep", "discard", "cancel", "ask"]],
    ["master", "duplicates.masterStrategy", ["oldest", "newest", "modified", "detailed"]],
  ] as const) {
    const group = host.querySelector(`#metaref-duplicates-${id}`)!;
    for (const value of values) {
      const label = doc.createElementNS("http://www.w3.org/1999/xhtml", "label");
      label.className = "metaref-check-option";
      const input = doc.createElementNS("http://www.w3.org/1999/xhtml", "input") as HTMLInputElement;
      input.type = "radio";
      input.name = `metaref-duplicates-${id}`;
      input.value = value;
      input.checked = getPref(preference as any) === value;
      const caption = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
      caption.textContent = getString(`duplicates-${id}-${value}` as any);
      label.append(input, caption);
      group.append(label);
      listen(input, "change", () => {
        if (input.checked)
          setPref(preference as any, value);
      });
    }
  }
  const syncDuplicatesUI = () => {
    for (const [id, preference] of [
      ["default-action", "duplicates.defaultAction"],
      ["master", "duplicates.masterStrategy"],
    ] as const) {
      const current = String(getPref(preference as any) || "");
      for (const radio of host.querySelectorAll<HTMLInputElement>(`#metaref-duplicates-${id} input[type='radio']`))
        radio.checked = radio.value === current;
    }
  };
  const concurrency = host.querySelector<HTMLInputElement>("#metaref-duplicates-concurrency")!;
  concurrency.value = String(duplicateConcurrency(getPref("duplicates.concurrency" as any, 3)));
  const status = host.querySelector<HTMLElement>("#metaref-duplicates-status")!;
  const validateConcurrency = () => {
    const value = Number(concurrency.value);
    if (Number.isInteger(value) && value >= 1 && value <= 8) {
      setPref("duplicates.concurrency" as any, value);
      concurrency.removeAttribute("aria-invalid");
      if (status.textContent === getString("duplicates-concurrency-invalid"))
        status.textContent = "";
    }
    else {
      concurrency.setAttribute("aria-invalid", "true");
      status.textContent = getString("duplicates-concurrency-invalid");
    }
  };
  listen(concurrency, "input", validateConcurrency);
  listen(concurrency, "change", validateConcurrency);
  listen(concurrency, "blur", () => {
    if (concurrency.hasAttribute("aria-invalid")) {
      concurrency.value = String(duplicateConcurrency(getPref("duplicates.concurrency" as any, 3)));
      concurrency.removeAttribute("aria-invalid");
      status.textContent = "";
    }
  });
  listen(pane, "metaref-preferences-synced", () => {
    syncDuplicatesUI();
    if (!concurrency.hasAttribute("aria-invalid"))
      concurrency.value = String(duplicateConcurrency(getPref("duplicates.concurrency" as any, 3)));
  });
  const action = (id: string, task: () => Promise<unknown>) => {
    const button = host.querySelector<HTMLButtonElement>(`#metaref-duplicates-${id}`)!;
    listen(button, "command", async () => {
      if (button.disabled)
        return;
      button.disabled = true;
      try {
        await task();
      }
      catch (error) {
        status.textContent = String(error);
      }
      finally {
        button.disabled = ["pause", "cancel"].includes(id) && !getDuplicateBatch()?.running;
      }
    });
  };
  action("review", async () => {
    const items = Zotero.getActiveZoteroPane()?.getSelectedItems() || [];
    if (!items.length) {
      status.textContent = getString("workflow-tool-no-selection");
      return;
    }
    await addon.hooks.onLintInBatch("tool-review-duplicates", items);
  });
  action("bulk", async () => {
    const libraryID = selectedLibraryID();
    const library = Zotero.Libraries.get(libraryID);
    if (!library || !library.editable)
      return;
    const items = (await Zotero.Items.getAll(libraryID, true, false)).filter(item => item.isRegularItem() && item.isEditable());
    const pairs = await findDuplicates(items, undefined, true);
    const { dialog, openAndWaitClose } = useDialog(new ztoolkit.Dialog(1, 1));
    let accepted = false;
    dialog.addCell(0, 0, { tag: "p", properties: { textContent: getString("duplicates-bulk-confirm", { args: { groups: duplicateGroups(pairs).length } }) } });
    dialog.addButton(getString("review-apply"), "metaref-duplicate-bulk-apply", { callback: () => accepted = true });
    dialog.addButton(getString("review-cancel"));
    await openAndWaitClose(getString("duplicates-bulk"));
    if (!accepted)
      return;
    await addon.runner.exclusive(signal => bulkMergeDuplicates(pairs, signal, undefined, (state) => {
      for (const id of ["pause", "cancel"])
        host.querySelector<HTMLButtonElement>(`#metaref-duplicates-${id}`)!.disabled = !state.running;
      status.textContent = getString("duplicates-bulk-status", { args: { completed: state.completed, total: state.total, merged: state.merged, failed: state.errors.length } });
    }));
    await refreshDuplicateStats(libraryID);
  });
  action("pause", async () => {
    pauseDuplicateBatch();
    status.textContent = getString(getDuplicateBatch()?.paused ? "duplicates-paused" : "duplicates-resumed");
  });
  action("cancel", async () => {
    cancelDuplicateBatch();
    status.textContent = getString("duplicates-cancelled");
  });
  action("refresh", async () => {
    await refreshDuplicateStats(selectedLibraryID());
    status.textContent = getString("duplicates-stats-refreshed");
  });
  action("export", async () => {
    const path = await new ztoolkit.FilePicker(getString("duplicates-export"), "save", [["JSON", "*.json"]], "metaflow-nonduplicates.json").open();
    if (path)
      await Zotero.File.putContentsAsync(path, JSON.stringify(exportNonDuplicates(), null, 2));
  });
  action("import", async () => {
    const libraryID = selectedLibraryID();
    const path = await new ztoolkit.FilePicker(getString("duplicates-import"), "open", [["JSON", "*.json"]]).open();
    if (!path)
      return;
    if (((await IOUtils.stat(path)).size || 0) > 2_000_000)
      throw new Error(getString("duplicates-invalid-data"));
    const result = await importNonDuplicates(JSON.parse(await IOUtils.readUTF8(path)));
    status.textContent = getString("duplicates-import-result", { args: result });
    await refreshDuplicateStats(libraryID);
  });
  host.querySelector<HTMLButtonElement>("#metaref-duplicates-pause")!.disabled = true;
  host.querySelector<HTMLButtonElement>("#metaref-duplicates-cancel")!.disabled = true;
}
