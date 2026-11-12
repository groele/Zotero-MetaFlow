import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeCoreFeedback, updateBatchFeedback } from "./batch-feedback";
import { ProgressUI } from "./progress-ui";

const createdLines: Array<Record<string, unknown>> = [];
const changedLines: Array<Record<string, unknown>> = [];

vi.mock("../utils/locale", () => ({
  getString: (id: string) => id,
}));

vi.mock("../utils/prefs", () => ({
  getPref: (key: string) => key === "lint.notify",
}));

vi.mock("../utils/wait", () => ({
  waitUtilAsync: () => {},
}));

vi.mock("./completion-notice", () => ({
  configureCompletionNotice: vi.fn(async () => {}),
}));

vi.mock("./reporter", async () => {
  const actual = await vi.importActual<typeof import("./progress-ui")>("./progress-ui");
  return {
    createReporter: vi.fn(async () => {}),
    ProgressUI: actual.ProgressUI,
  };
});

class MockProgressWindow {
  private readonly doc = { documentElement: { setAttribute: vi.fn(), removeAttribute: vi.fn() } };
  public lines = [
    { _hbox: { ownerDocument: this.doc } },
    {},
    { _hbox: { addEventListener: vi.fn(), removeEventListener: vi.fn(), setAttribute: vi.fn(), ownerDocument: this.doc } },
  ];

  public createLine(line: Record<string, unknown>) {
    createdLines.push(line);
    return this;
  }

  public changeLine(line: Record<string, unknown>) {
    changedLines.push(line);
    return this;
  }

  public show() {
    return this;
  }

  public close() {}
}

describe("progressUI staged-commit notice", () => {
  beforeEach(() => {
    createdLines.length = 0;
    changedLines.length = 0;
    vi.stubGlobal("ztoolkit", { ProgressWindow: MockProgressWindow });
    vi.stubGlobal("Zotero", { debug: vi.fn(), getMainWindows: () => [] });
    vi.stubGlobal("addon", { data: { config: { addonName: "Zotero MetaFlow" } } });
  });

  afterEach(() => {
    closeCoreFeedback();
    vi.unstubAllGlobals();
  });

  it("displays coreSubtext on idx 1 during staged workflow and clears it on finish", async () => {
    const ui = new ProgressUI();
    await ui.init(false, "Running stage 1", "core-task-staged-commit");

    expect(createdLines).toEqual([
      expect.objectContaining({ idx: 0, text: "Running stage 1" }),
      expect.objectContaining({ idx: 1, text: "core-task-staged-commit" }),
      expect.objectContaining({ idx: 2, text: "info-batch-break" }),
    ]);

    const shown = ui.showCoreFinished("Done", false, async () => {});
    expect(shown).toBe(true);
    expect(changedLines).toEqual([
      expect.objectContaining({ idx: 0, text: "Done", type: "default" }),
      expect.objectContaining({ idx: 1, text: "" }),
    ]);
  });

  it("shows staged-commit notice only when activeCoreWorkflow has multiple stages", async () => {
    (addon.data as any).activeCoreWorkflow = {
      command: "full-workflow",
      stage: "update",
      index: 1,
      total: 2,
      cancelled: false,
      cancel: vi.fn(),
    };
    updateBatchFeedback();
    await Promise.resolve();

    expect(createdLines.find(line => line.idx === 1)?.text).toBe("core-task-staged-commit");
    closeCoreFeedback();

    createdLines.length = 0;
    (addon.data as any).activeCoreWorkflow = {
      command: "format",
      stage: "format",
      index: 1,
      total: 1,
      cancelled: false,
      cancel: vi.fn(),
    };
    updateBatchFeedback();
    await Promise.resolve();

    expect(createdLines.find(line => line.idx === 1)?.text).toBe("");
  });
});
