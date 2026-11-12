import { afterEach, expect, it, vi } from "vitest";

const stored = vi.hoisted(() => ({ value: undefined as any, writes: 0 }));
vi.mock("./logger", () => ({ createLogger: () => ({ warn: vi.fn(), error: vi.fn() }) }));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
  stored.value = undefined;
  stored.writes = 0;
});

async function setup() {
  vi.stubGlobal("Zotero", { Profile: { dir: "profile" } });
  vi.stubGlobal("PathUtils", { join: (...parts: string[]) => parts.join("/") });
  vi.stubGlobal("IOUtils", {
    exists: async () => stored.value !== undefined,
    readJSON: async () => stored.value,
    writeJSON: async (_path: string, value: unknown) => {
      stored.value = value;
      stored.writes++;
    },
  });
  return import("./journal-ranking-index");
}

function item(title = "Journal QA", issn = "1234-5678") {
  return { itemType: "journalArticle", getField: (key: string) => key === "publicationTitle" ? title : key === "ISSN" ? issn : "" } as unknown as Zotero.Item;
}

it("persists selected values by ISSN and title and reloads them for another item", async () => {
  const index = await setup();
  await index.loadJournalRankingIndex();
  await index.saveJournalRankingIndex(item(), { jcr: "Q1", impactFactor: "34.9" }, new Set(["jcr", "impactFactor"]));
  await index.flushJournalRankingIndex();
  expect(stored.writes).toBe(1);
  vi.resetModules();
  const reloaded = await import("./journal-ranking-index");
  await reloaded.loadJournalRankingIndex();
  expect(reloaded.readJournalRankingIndex(item())).toEqual(new Map([["jcr", "Q1"], ["impactFactor", "34.9"]]));
  expect(reloaded.readJournalRankingIndex(item("Journal QA", "")).get("impactFactor")).toBe("34.9");
  expect(reloaded.readJournalRankingIndex(item("Journal QA", "8765-4321"))).toEqual(new Map());
});

it("preserves existing index values in blank mode and removes negative membership markers", async () => {
  const index = await setup();
  await index.saveJournalRankingIndex(item(), { jcr: "Q1", sci: "是" }, new Set(["jcr", "sci"]));
  await index.saveJournalRankingIndex(item(), { jcr: "Q2", sci: "否" }, new Set(["jcr", "sci"]), "blank");
  expect(index.readJournalRankingIndex(item())).toMatchObject(new Map([["jcr", "Q1"], ["sci", "是"]]));
  await index.saveJournalRankingIndex(item(), { sci: "否" }, new Set(["sci"]));
  expect(index.readJournalRankingIndex(item()).has("sci")).toBe(false);
  await index.flushJournalRankingIndex();
});

it("does not rewrite unchanged journal data across repeated flushes", async () => {
  const index = await setup();
  await index.saveJournalRankingIndex(item(), { jcr: "Q1" }, new Set(["jcr"]));
  await index.flushJournalRankingIndex();
  await index.flushJournalRankingIndex();
  await index.saveJournalRankingIndex(item(), { jcr: "Q1" }, new Set(["jcr"]));
  await index.flushJournalRankingIndex();
  expect(stored.writes).toBe(1);
});

it("preserves a newer journal index on downgrade while permitting session-only lookups", async () => {
  const future = { version: 2, entries: { future: { payload: "preserve" } } };
  stored.value = future;
  const index = await setup();
  await index.loadJournalRankingIndex();
  await index.saveJournalRankingIndex(item(), { jcr: "Q1" }, new Set(["jcr"]));
  expect(index.readJournalRankingIndex(item()).get("jcr")).toBe("Q1");
  await index.flushJournalRankingIndex();
  expect(stored.writes).toBe(0);
  expect(stored.value).toBe(future);
});

it("uses the latest complete snapshot instead of reviving a removed field from an older ISSN alias", async () => {
  vi.useFakeTimers();
  const index = await setup();
  const both = item("Journal QA", "1234-5678; 8765-4321");
  await index.saveJournalRankingIndex(both, { sci: "是", jcr: "Q1", impactFactor: "34.9" }, new Set(["sci", "jcr", "impactFactor"]));
  await index.saveJournalRankingIndex(item(), { sci: "否", jcr: "Q2" }, new Set(["sci", "jcr"]));
  expect(index.readJournalRankingIndex(both)).toEqual(new Map([["jcr", "Q2"], ["impactFactor", "34.9"]]));
  await index.flushJournalRankingIndex();
});

it("keeps an empty newer snapshot after restart so an obsolete membership does not return", async () => {
  vi.useFakeTimers();
  const index = await setup();
  const both = item("Journal QA", "1234-5678; 8765-4321");
  await index.saveJournalRankingIndex(both, { sci: "是" }, new Set(["sci"]));
  await index.saveJournalRankingIndex(item(), { sci: "否" }, new Set(["sci"]));
  await index.flushJournalRankingIndex();
  vi.resetModules();
  const reloaded = await import("./journal-ranking-index");
  await reloaded.loadJournalRankingIndex();
  expect(reloaded.readJournalRankingIndex(both).has("sci")).toBe(false);
});

it("recognizes a newer title snapshot when its ISSN alias still contains older values", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(2000);
  const index = await setup();
  await index.saveJournalRankingIndex(item(), { jcr: "Q1" }, new Set(["jcr"]));
  vi.setSystemTime(1000);
  await index.saveJournalRankingIndex(item("Journal QA", ""), { jcr: "Q2" }, new Set(["jcr"]));
  expect(index.readJournalRankingIndex(item()).get("jcr")).toBe("Q2");
  await index.flushJournalRankingIndex();
});

it("records a newly learned alias even when the selected values are unchanged", async () => {
  const index = await setup();
  await index.saveJournalRankingIndex(item(), { jcr: "Q1" }, new Set(["jcr"]));
  await index.flushJournalRankingIndex();
  await index.saveJournalRankingIndex(item("Corrected Journal QA"), { jcr: "Q1" }, new Set(["jcr"]));
  await index.flushJournalRankingIndex();
  expect(index.readJournalRankingIndex(item("Corrected Journal QA", "")).get("jcr")).toBe("Q1");
  expect(stored.writes).toBe(2);
});

it("does not share rankings through a malformed partial ISSN", async () => {
  const index = await setup();
  await index.saveJournalRankingIndex(item("First Journal", "1234"), { jcr: "Q1" }, new Set(["jcr"]));
  expect(index.readJournalRankingIndex(item("Other Journal", "1234")).size).toBe(0);
  await index.flushJournalRankingIndex();
});

it("keeps a known ISSN distinct when a different journal has the same normalized title", async () => {
  vi.useFakeTimers();
  const index = await setup();
  const first = item("Shared Journal", "1234-5678");
  const other = item("Shared Journal", "8765-4321");
  await index.saveJournalRankingIndex(first, { jcr: "Q1" }, new Set(["jcr"]));
  await index.saveJournalRankingIndex(other, { jcr: "Q2" }, new Set(["jcr"]));
  expect(index.readJournalRankingIndex(first).get("jcr")).toBe("Q1");
  expect(index.readJournalRankingIndex(other).get("jcr")).toBe("Q2");
  await index.flushJournalRankingIndex();
  vi.resetModules();
  const reloaded = await import("./journal-ranking-index");
  await reloaded.loadJournalRankingIndex();
  expect(reloaded.readJournalRankingIndex(first).get("jcr")).toBe("Q1");
  expect(reloaded.readJournalRankingIndex(other).get("jcr")).toBe("Q2");
});

it("does not carry unselected fields from a conflicting known ISSN into a new snapshot", async () => {
  const index = await setup();
  await index.saveJournalRankingIndex(item("Shared Journal", "1234-5678"), { jcr: "Q1", impactFactor: "34.9" }, new Set(["jcr", "impactFactor"]));
  const other = item("Shared Journal", "8765-4321");
  await index.saveJournalRankingIndex(other, { jcr: "Q2" }, new Set(["jcr"]));
  expect(index.readJournalRankingIndex(other).has("impactFactor")).toBe(false);
  await index.flushJournalRankingIndex();
});

it("loads legacy v1 rows without identity metadata and keeps their known ISSN precedence", async () => {
  stored.value = { version: 1, entries: {
    "journal:issn:12345678": { updatedAt: 1000, values: { jcr: "Q1" } },
    "journal:title:journalqa": { updatedAt: 2000, values: { jcr: "Q2" } },
  } };
  const index = await setup();
  await index.loadJournalRankingIndex();
  expect(index.readJournalRankingIndex(item()).get("jcr")).toBe("Q1");
  await index.saveJournalRankingIndex(item(), { jcr: "Q3" }, new Set(["jcr"]));
  await index.flushJournalRankingIndex();
  expect(stored.value.version).toBe(1);
  expect(stored.value.entries["journal:issn:12345678"].issns).toEqual(["12345678"]);
});

it("updates print and electronic ISSN readers when only one ISSN and a corrected title are present", async () => {
  const index = await setup();
  await index.saveJournalRankingIndex(item("Original Journal", "1234-5678; 8765-4321"), { jcr: "Q1", sci: "是" }, new Set(["jcr", "sci"]));
  await index.saveJournalRankingIndex(item("Corrected Journal", "1234-5678"), { jcr: "Q2", sci: "否" }, new Set(["jcr", "sci"]));
  expect(index.readJournalRankingIndex(item("Original Journal", "8765-4321"))).toEqual(new Map([["jcr", "Q2"]]));
  expect(index.readJournalRankingIndex(item("Original Journal", ""))).toEqual(new Map([["jcr", "Q2"]]));
  await index.flushJournalRankingIndex();
});

it("repairs linked stale 12.5.7 snapshots on reads and preserves the latest unselected fields on writes", async () => {
  const old = { updatedAt: 1000, values: { jcr: "Q1", impactFactor: "8.4" }, issns: ["12345678", "87654321"] };
  stored.value = { version: 1, entries: {
    "journal:issn:12345678": { ...old, updatedAt: 2000, values: { jcr: "Q2", impactFactor: "9.1" } },
    "journal:issn:87654321": old,
    "journal:title:originaljournal": old,
  } };
  const index = await setup();
  await index.loadJournalRankingIndex();
  expect(index.readJournalRankingIndex(item("Original Journal", "8765-4321")).get("impactFactor")).toBe("9.1");
  expect(index.readJournalRankingIndex(item("Original Journal", "")).get("jcr")).toBe("Q2");
  await index.saveJournalRankingIndex(item("Original Journal", "8765-4321"), { jcr: "Q3" }, new Set(["jcr"]));
  expect(index.readJournalRankingIndex(item("", "1234-5678"))).toEqual(new Map([["jcr", "Q3"], ["impactFactor", "9.1"]]));
  await index.flushJournalRankingIndex();
});

it("preserves an existing journal file when its initial read fails instead of replacing it with one session entry", async () => {
  const original = { version: 1, entries: { "journal:issn:87654321": { updatedAt: 1000, values: { jcr: "Q1" } } } };
  stored.value = original;
  const index = await setup();
  vi.spyOn(IOUtils, "readJSON").mockRejectedValueOnce(new Error("File is temporarily unreadable"));
  await index.saveJournalRankingIndex(item(), { jcr: "Q2" }, new Set(["jcr"]));
  await index.flushJournalRankingIndex();
  expect(stored.writes).toBe(0);
  expect(stored.value).toBe(original);
  expect(index.readJournalRankingIndex(item()).get("jcr")).toBe("Q2");
});

it("persists a first negative membership without hiding unrelated Extra and allows a later positive correction", async () => {
  const index = await setup();
  await index.saveJournalRankingIndex(item(), { sci: "否" }, new Set(["sci"]));
  await index.flushJournalRankingIndex();
  await index.saveJournalRankingIndex(item(), { sci: "否" }, new Set(["sci"]));
  await index.flushJournalRankingIndex();
  expect(stored.writes).toBe(1);
  vi.resetModules();
  const reloaded = await import("./journal-ranking-index");
  await reloaded.loadJournalRankingIndex();
  const extra = new Map([["sci", "是"], ["ccf", "B"]] as const);
  expect(reloaded.readJournalRankingIndex(item(), extra)).toEqual(new Map([["ccf", "B"]]));
  await reloaded.saveJournalRankingIndex(item(), { sci: "是" }, new Set(["sci"]));
  expect(reloaded.readJournalRankingIndex(item(), extra)).toEqual(extra);
  await reloaded.flushJournalRankingIndex();
});

it("does not link two distinct ISSN groups through their shared title", async () => {
  const index = await setup();
  const first = item("Shared Title", "1234-5678; 8765-4321");
  const other = item("Shared Title", "1111-2222; 3333-4444");
  await index.saveJournalRankingIndex(first, { jcr: "Q1" }, new Set(["jcr"]));
  await index.saveJournalRankingIndex(other, { jcr: "Q4" }, new Set(["jcr"]));
  expect(index.readJournalRankingIndex(item("Shared Title", "")).get("jcr")).toBe("Q1");
  expect(index.readJournalRankingIndex(item("Shared Title", "9999-0000")).size).toBe(0);
  await index.saveJournalRankingIndex(item("Corrected Title", "1234-5678"), { jcr: "Q2" }, new Set(["jcr"]));
  expect(index.readJournalRankingIndex(item("Shared Title", "8765-4321")).get("jcr")).toBe("Q2");
  expect(index.readJournalRankingIndex(item("Shared Title", "3333-4444")).get("jcr")).toBe("Q4");
  await index.flushJournalRankingIndex();
});

it("preserves an unrecognized journal index structure while keeping new lookups available in memory", async () => {
  const original = { version: 1, entries: ["unrecognized payload"] };
  stored.value = original;
  const index = await setup();
  await index.saveJournalRankingIndex(item(), { jcr: "Q2" }, new Set(["jcr"]));
  await index.flushJournalRankingIndex();
  expect(stored.value).toBe(original);
  expect(stored.writes).toBe(0);
  expect(index.readJournalRankingIndex(item()).get("jcr")).toBe("Q2");
});

it("ignores a stale disk read completed after an index reset", async () => {
  const index = await setup();
  let resolve!: (value: unknown) => void;
  vi.stubGlobal("IOUtils", {
    exists: async () => true,
    readJSON: () => new Promise((done) => { resolve = done; }),
  });
  const pending = index.loadJournalRankingIndex();
  await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
  index.resetJournalRankingIndex();
  resolve({ version: 1, entries: { "journal:title:journalqa": { updatedAt: 1, values: { jcr: "Q4" } } } });
  await pending;
  expect(index.readJournalRankingIndex(item()).size).toBe(0);
});
