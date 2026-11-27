import type { TagElementProps } from "zotero-plugin-toolkit";
import { getString } from "../../../utils/locale";

export function fieldLabel(field: string): string {
  if (field === "itemType" || field === "creators")
    return getString(`review-field-${field}`);
  if (!Zotero.ItemFields.getID(field))
    return field;
  return Zotero.ItemFields.getLocalizedString(field) || field;
}

export function displayValue(value: unknown): string {
  if (Array.isArray(value))
    return value.map(creator => creator.name || [creator.firstName, creator.lastName].filter(Boolean).join(" ")).join("; ");
  return String(value ?? "");
}

export function cell(text: string, header = false): TagElementProps {
  return { tag: header ? "th" : "td", properties: { textContent: text }, styles: { padding: "8px", textAlign: "start", verticalAlign: "top", borderBottom: "1px solid var(--fill-quinary)", whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxWidth: "360px" } };
}
