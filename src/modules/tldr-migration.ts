import { isWritableItem } from "../utils/item-write-policy";
import { cleanseTLDRFromExtra, extractTLDRFromNote, findExistingTLDRNote, saveTLDRToNote } from "./rules/tool-update-metadata/tldr";

/** Remove legacy Extra text only after its note is durable and the source is unchanged. */
export async function migrateLegacyTLDR(item: Zotero.Item, text: string, originalExtra: string, isAlive = () => addon.data.alive): Promise<boolean> {
  if (!isAlive() || !isWritableItem(item))
    return false;
  const saved = await saveTLDRToNote(item, text);
  if (!isAlive() || !isWritableItem(item) || String(item.getField("extra") || "") !== originalExtra)
    return false;
  const existing = findExistingTLDRNote(item);
  if (!saved && (!existing || extractTLDRFromNote(existing.getNote()) !== text))
    return false;
  if (!cleanseTLDRFromExtra(item))
    return false;
  await item.saveTx({ skipSelect: true });
  return true;
}
