import { showZoteroDirectory } from "../../utils/directories";
import { getString } from "../../utils/locale";
import { preferenceListeners } from "../../utils/preference-listeners";
import { MENU_GROUPS } from "./menu";

export function setupToolCenter(pane: Element) {
  const select = pane.querySelector<HTMLSelectElement>("#metaref-tool-choice");
  const button = pane.querySelector<HTMLButtonElement>("#metaref-run-tool");
  const status = pane.querySelector<HTMLElement>("#metaref-tool-status");
  if (!select || !button || !status)
    return;
  const doc = pane.ownerDocument!;
  for (const [group, keys] of MENU_GROUPS) {
    const options = doc.createElementNS("http://www.w3.org/1999/xhtml", "optgroup");
    options.setAttribute("label", getString(`menu-group-${group}` as any));
    for (const key of keys) {
      const option = doc.createElementNS("http://www.w3.org/1999/xhtml", "option") as HTMLOptionElement;
      option.value = key;
      option.textContent = getString((key.startsWith("show-") ? `menu-${key}` : `rule-${key}-menu-item`) as any);
      options.append(option);
    }
    select.append(options);
  }
  preferenceListeners(pane)(button, "command", async () => {
    const key = select.value;
    const items = Zotero.getActiveZoteroPane()?.getSelectedItems() || [];
    if (!key.startsWith("show-") && !items.some(item => item.isRegularItem() && !item.deleted && item.isEditable())) {
      status.textContent = getString("workflow-tool-no-selection");
      return;
    }
    button.disabled = true;
    status.textContent = getString("workflow-tool-running");
    try {
      if (key.startsWith("show-"))
        await showZoteroDirectory(key === "show-data-directory" ? "data" : "profile");
      else if (key === "correct-date-format")
        await addon.hooks.onLintInBatch(["correct-date-format", "correct-filing-date-format", "correct-issue-date-format", "correct-priority-date-format"], items);
      else if (key === "tool-update-metadata")
        await addon.hooks.onLintInBatch(key, items, { review: true });
      else
        await addon.hooks.onLintInBatch(key as ID, items);
      status.textContent = getString("workflow-tool-finished");
    }
    catch (error) {
      status.textContent = String(error);
    }
    finally {
      button.disabled = false;
    }
  });
}
