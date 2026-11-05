import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LintRunner } from "../runner";
import { RuleExecution } from "./execution";
import { BatchPersistence } from "./persistence";
import { RunnerState } from "./state";

describe("runner module boundaries", () => {
  it("keeps the coordinator and each domain module within 360 lines", () => {
    const files = ["src/modules/runner.ts", ...readdirSync("src/modules/runner").filter(name => name.endsWith(".ts")).map(name => `src/modules/runner/${name}`)];
    for (const file of files)
      expect(readFileSync(file, "utf8").trimEnd().split(/\r?\n/).length, file).toBeLessThanOrEqual(360);
  });

  it("does not shadow methods across the runner layers", () => {
    const methods = new Set<string>();
    for (const layer of [RunnerState, RuleExecution, BatchPersistence, LintRunner]) {
      for (const name of Object.getOwnPropertyNames(layer.prototype).filter(name => name !== "constructor")) {
        expect(methods.has(name), `${layer.name}.${name}`).toBe(false);
        methods.add(name);
      }
    }
  });

  it("declares only the first template card open before scripts initialize", () => {
    const template = readFileSync("addon/content/preferences.xhtml", "utf8");
    const cards = [...template.matchAll(/<html:details\b[^>]*>/g)].map(match => match[0]);
    expect(cards).toHaveLength(11);
    expect(cards[0]).toContain("open=\"open\"");
    expect(cards.slice(1).every(card => !/\bopen\s*=/.test(card))).toBe(true);
  });
});
