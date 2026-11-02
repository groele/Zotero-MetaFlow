import { preferenceListeners } from "../utils/preference-listeners";
import { getPref, setPref } from "../utils/prefs";
import { MENU_GROUPS, MENU_SECTIONS } from "./menu";
import { Rules } from "./rules";

export function setupMenuSettings(pane: Element) {
  const listen = preferenceListeners(pane);
  const container = pane.querySelector("#metaref-menu-settings");
  if (!container)
    return;
  const doc = pane.ownerDocument!;
  for (const [key, keys] of [["primary", MENU_SECTIONS.primary], ...MENU_GROUPS]) {
    const group = doc.createXULElement("groupbox");
    if (key === "primary")
      group.id = "metaref-primary-menu-controls";
    const label = doc.createXULElement("label");
    doc.l10n!.setAttributes(label, `metaref-menu-group-${key}`);
    group.appendChild(label);
    for (const id of keys) {
      const control = doc.createXULElement("checkbox") as XULElement & { checked: boolean };
      const rule = id === "standard" ? undefined : Rules.getByID(id as ID);
      const l10nID = id.startsWith("show-") ? `menu-${id}` : id === "standard" ? "menuitem-stdFormatFlow" : rule?.getItemMenu?.()?.l10nID || `rule-${id}-menu-item`;
      doc.l10n!.setAttributes(control, `metaref-${l10nID}`);
      control.setAttribute("native", "true");
      control.setAttribute("preference", `${addon.data.config.prefsPrefix}.menu.${id}`);
      control.checked = getPref(`menu.${id}` as any, true) as boolean;
      listen(control, "command", () => setPref(`menu.${id}` as any, control.checked));
      const row = doc.createXULElement("hbox");
      row.className = "metaref-menu-placement-row";
      const placement = doc.createElementNS("http://www.w3.org/1999/xhtml", "select") as HTMLSelectElement;
      doc.l10n!.setAttributes(placement, "metaref-menu-placement");
      for (const value of ["none", "primary", "nested"]) {
        const option = doc.createElementNS("http://www.w3.org/1999/xhtml", "option") as HTMLOptionElement;
        option.value = value;
        doc.l10n!.setAttributes(option, `metaref-menu-placement-${value}`);
        placement.append(option);
      }
      const preferredPrimary = () => getPref(`menu.primary.${id}` as any, MENU_SECTIONS.primary.includes(id)) === true;
      placement.value = control.checked ? preferredPrimary() ? "primary" : "nested" : "none";
      listen(placement, "change", () => {
        const visible = placement.value !== "none";
        setPref(`menu.${id}` as any, visible);
        if (visible)
          setPref(`menu.primary.${id}` as any, placement.value === "primary");
        (row.querySelector("input[preference]") as HTMLInputElement || control).checked = visible;
      });
      const syncVisibility = (event: Event) => {
        if (!(event.target as Element)?.matches("input[preference]"))
          return;
        placement.value = (event.target as HTMLInputElement).checked ? preferredPrimary() ? "primary" : "nested" : "none";
      };
      listen(row, "change", syncVisibility);
      listen(row, "command", syncVisibility);
      row.append(control, placement);
      if (key === "primary") {
        row.setAttribute("data-core-menu-command", id);
        doc.l10n!.setAttributes(control, "metaref-menu-core-visible");
      }
      group.appendChild(row);
    }
    container.appendChild(group);
  }
  const updateCompact = () => {
    const compact = getPref("menu.compact" as any, true) === true;
    pane.querySelector<HTMLElement>("#metaref-additional-menu-options")!.hidden = compact;
    for (const placement of pane.querySelectorAll<HTMLSelectElement>("[data-core-menu-command] select"))
      placement.hidden = compact;
  };
  listen(pane, "change", updateCompact);
  listen(pane, "command", updateCompact);
  updateCompact();
}
