import { readdirSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("keeps each journal pane domain module within 360 lines", () => {
  for (const name of readdirSync("src/modules/journal-pane").filter(name => name.endsWith(".ts"))) {
    const content = readFileSync(`src/modules/journal-pane/${name}`, "utf8");
    expect(content.trimEnd().split(/\r?\n/).length, name).toBeLessThanOrEqual(360);
  }
});
