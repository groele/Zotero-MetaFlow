import { describe, expect, it, vi } from "vitest";
import { builtinJournalDatabasePath, writeBuiltinJournalDatabaseFile } from "./journal-database-file";

describe("journal-database-file built-in path resolution", () => {
  it("resolves ESI and Nature Index built-in paths inside Zotero profile metaflow folder", async () => {
    const writes: Array<{ path: string; data: unknown }> = [];
    vi.stubGlobal("PathUtils", {
      join: (...parts: string[]) => parts.join("/"),
    });
    vi.stubGlobal("IOUtils", {
      makeDirectory: vi.fn().mockResolvedValue(undefined),
      writeJSON: vi.fn(async (path: string, data: unknown) => {
        writes.push({ path, data });
      }),
    });
    vi.stubGlobal("Zotero", {
      Profile: { dir: "C:/Users/demo/Zotero/Profiles/default" },
      debug: () => {},
      File: {
        getResourceAsync: vi.fn(async (uri: string) => (uri.includes("esi")
          ? JSON.stringify([{ title: "Nature", issn: "0028-0836", category: "MULTIDISCIPLINARY" }])
          : JSON.stringify({ venues: [{ title: "Nature", type: "journal", issn: ["0028-0836"] }] }))),
      },
    });
    vi.stubGlobal("rootURI", "jar:file:///mock.xpi!/");

    expect(builtinJournalDatabasePath("esi")).toBe("C:/Users/demo/Zotero/Profiles/default/metaflow/esi-journals.json");
    expect(builtinJournalDatabasePath("nature")).toBe("C:/Users/demo/Zotero/Profiles/default/metaflow/nature-index-journals.json");

    const esiWritten = await writeBuiltinJournalDatabaseFile("esi");
    const natureWritten = await writeBuiltinJournalDatabaseFile("nature");
    expect(esiWritten.endsWith("metaflow/esi-journals.json")).toBe(true);
    expect(natureWritten.endsWith("metaflow/nature-index-journals.json")).toBe(true);
    expect(writes).toHaveLength(2);
    vi.unstubAllGlobals();
  });
});
