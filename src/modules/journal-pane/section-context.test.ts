import { describe, expect, it } from "vitest";
import { isJournalPaneItemCurrent, journalPaneItem } from "./section-context";

describe("journal section context", () => {
  it("uses the section's public item and never a stale private property", () => {
    const section = { item: { id: 11 }, _item: { id: 10 } };
    const body = { isConnected: true, closest: () => section } as unknown as HTMLElement;
    expect(journalPaneItem(body)).toBe(section.item);
    expect(isJournalPaneItemCurrent(body, { id: 10 } as Zotero.Item)).toBe(false);
    section.item = { id: 12 };
    expect(isJournalPaneItemCurrent(body, { id: 11 } as Zotero.Item)).toBe(false);
  });

  it("keeps separate window and reader bodies independent", () => {
    const left = { isConnected: true, closest: () => ({ item: { id: 11 } }) } as unknown as HTMLElement;
    const reader = { isConnected: true, closest: () => ({ item: { id: 12 } }) } as unknown as HTMLElement;
    expect(journalPaneItem(left)?.id).toBe(11);
    expect(journalPaneItem(reader)?.id).toBe(12);
    expect(isJournalPaneItemCurrent(reader, { id: 11 } as Zotero.Item)).toBe(false);
  });

  it("rejects disconnected bodies and cleared sections instead of reviving cached items", () => {
    const body = { isConnected: false, closest: () => ({ item: { id: 11 } }) } as unknown as HTMLElement;
    expect(isJournalPaneItemCurrent(body, { id: 11 } as Zotero.Item)).toBe(false);
    const empty = { isConnected: true, closest: () => ({ _item: { id: 10 } }) } as unknown as HTMLElement;
    expect(journalPaneItem(empty)).toBeUndefined();
  });
});
