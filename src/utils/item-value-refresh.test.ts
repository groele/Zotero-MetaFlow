import { afterEach, describe, expect, it, vi } from "vitest";
import { redrawItemValues } from "./item-value-refresh";

afterEach(() => vi.unstubAllGlobals());

describe("item value refresh", () => {
  it("redraws normalized IDs without resetting columns or selecting an item", async () => {
    const trigger = vi.fn();
    const refreshColumns = vi.fn();
    vi.stubGlobal("addon", { data: { alive: true } });
    vi.stubGlobal("Zotero", { Notifier: { trigger }, ItemTreeManager: { refreshColumns } });
    await redrawItemValues([11, 11, 0, -1, NaN, 12]);
    expect(trigger).toHaveBeenCalledExactlyOnceWith("redraw", "item", [11, 12], {});
    expect(refreshColumns).not.toHaveBeenCalled();
  });

  it("waits for host notification completion and propagates failures", async () => {
    const error = new Error("host redraw failed");
    vi.stubGlobal("Zotero", { Notifier: { trigger: async () => {
      throw error;
    } } });
    await expect(redrawItemValues([11])).rejects.toBe(error);
  });

  it("invalidates cached column values in every open main window before redrawing", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const closed = vi.fn();
    const trigger = vi.fn(() => {
      expect(first).toHaveBeenCalledWith([11]);
      expect(second).toHaveBeenCalledWith([11]);
    });
    vi.stubGlobal("Zotero", {
      Notifier: { trigger },
      getMainWindows: () => [
        { ZoteroPane: { itemsView: { invalidateRowCache: first } } },
        { ZoteroPane: { itemsView: { invalidateRowCache: second } } },
        { closed: true, ZoteroPane: { itemsView: { invalidateRowCache: closed } } },
      ],
    });
    await redrawItemValues([11]);
    expect(closed).not.toHaveBeenCalled();
  });

  it("redraws all windows for cache updates but ignores invalid-only targets and shutdown", async () => {
    const trigger = vi.fn();
    vi.stubGlobal("Zotero", { Notifier: { trigger } });
    await redrawItemValues();
    expect(trigger).toHaveBeenCalledExactlyOnceWith("redraw", "item", [], {});
    await redrawItemValues([0, NaN]);
    vi.stubGlobal("addon", { data: { alive: false } });
    await redrawItemValues([11]);
    expect(trigger).toHaveBeenCalledTimes(1);
  });
});
