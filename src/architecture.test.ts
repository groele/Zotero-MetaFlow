import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : path.endsWith(".ts") ? [path] : [];
  });
}

it("keeps every TypeScript source and test within the 360-line ceiling", () => {
  const oversized = sourceFiles("src").filter(file => readFileSync(file, "utf8").trimEnd().split(/\r?\n/).length > 360);
  expect(oversized).toEqual([]);
});

it("defines each Fluent message once per locale across resources", () => {
  for (const locale of ["en-US", "zh-CN"]) {
    const seen = new Map<string, string>();
    for (const name of readdirSync(`addon/locale/${locale}`).filter(name => name.endsWith(".ftl"))) {
      const text = readFileSync(`addon/locale/${locale}/${name}`, "utf8");
      for (const match of text.matchAll(/^([\w-]+)\s*=/gm)) {
        expect(seen.has(match[1]), `${locale}: ${match[1]} in ${seen.get(match[1])} and ${name}`).toBe(false);
        seen.set(match[1], name);
      }
    }
  }
});
