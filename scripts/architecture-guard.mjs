import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";

const read = file => readFileSync(file, "utf8");
const json = file => JSON.parse(read(file));
const pkg = json("package.json");
const files = folder => readdirSync(folder, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(folder, entry.name)) : [path.join(folder, entry.name)]);
const sources = files("src");
const prefs = read("addon/content/preferences.xhtml");
const feed = file => json(file).addons[pkg.config.addonID].updates[0];

export function checkVersionAlignment() {
  for (const file of ["update.json", "dist/update.json"])
    assert.equal(feed(file).version, pkg.version, file);
  for (const file of ["docs/brand/product.json", "dist/verification.json"])
    assert.equal(json(file).version, pkg.version, file);
  assert.equal(json("scripts/architecture-baseline.json").lastReleasedVersion, pkg.version);
  assert.equal(json("addon/manifest.json").version, "__buildVersion__");
  assert.match(prefs, /"version":"__buildVersion__"/);
  for (const file of ["README.md", "README.zh-CN.md", "README.en.md"])
    assert.ok(read(file).includes(`badge/version-${pkg.version}-`), file);
  // pnpm's lockfile schema has no root package version field.
  assert.ok(read("pnpm-lock.yaml").includes("lockfileVersion:"));
}

test("release identity", () => {
  assert.equal(pkg.name, "zotero-metaflow");
  assert.equal(pkg.config.addonID, "metaflow@groele");
  assert.equal(pkg.repository.url, "git+https://github.com/groele/Zotero-MetaFlow.git");
});
test("checkVersionAlignment", checkVersionAlignment);
test("source line limits and cleared baseline", () => {
  assert.equal(json("scripts/architecture-baseline.json").debtCleared, true);
  for (const file of sources.filter(file => file.endsWith(".ts")))
    assert.ok(read(file).trimEnd().split(/\r?\n/).length <= 360, file);
});
test("TypeScript source ownership and pinned third-party assets", () => {
  const assets = json("scripts/architecture-baseline.json").vendorAssets;
  for (const file of sources.filter(file => /\.[cm]?jsx?$/.test(file))) {
    const name = file.replaceAll("\\", "/");
    assert.ok(assets[name], `Authored JavaScript source is forbidden: ${name}`);
    assert.equal(createHash("sha256").update(readFileSync(file)).digest("hex"), assets[name], name);
  }
});
test("strict TypeScript configuration", () => {
  const config = json("tsconfig.json").compilerOptions;
  for (const key of ["strict", "isolatedModules", "verbatimModuleSyntax", "noEmit"])
    assert.equal(config[key], true);
  assert.equal(config.target, "ES2023");
});
test("readable modern production bundle", () => {
  const config = read("zotero-plugin.config.ts");
  for (const text of ["target: \"firefox140\"", "format: \"esm\"", "minify: false", "charset: \"utf8\""])
    assert.ok(config.includes(text), text);
});
test("retired Gecko APIs", () => {
  for (const file of sources.filter(file => file.endsWith(".ts") && !file.endsWith(".test.ts")))
    assert.doesNotMatch(read(file), /Components\.(classes|interfaces|utils)|\.ownerGlobal\b|ChromeUtils\.import\(/, file);
});
test("Fluent language parity", () => {
  const ids = locale => files(`addon/locale/${locale}`).filter(file => file.endsWith(".ftl")).flatMap(file => [...read(file).matchAll(/^([\w-]+)\s*=/gm)].map(match => match[1])).sort();
  assert.deepEqual(ids("en-US"), ids("zh-CN"));
});
test("localized preferences template", () => {
  const markup = prefs.replace(/<!--[\s\S]*?-->/g, "");
  for (const match of markup.matchAll(/>([^<>]+)</g))
    assert.equal(match[1].trim(), "");
});
test("preference grid", () => {
  const css = read("addon/content/preferences.css");
  assert.match(css, /padding-inline:\s*16px/);
  assert.match(css, /margin-inline-start:\s*24px/);
});
test("manifest compatibility", () => {
  const config = json("addon/manifest.json").applications.zotero;
  assert.equal(config.strict_min_version, "10.0");
  assert.equal(config.strict_max_version, "12.*");
});
test("update compatibility and asset URL", () => {
  for (const file of ["update.json", "dist/update.json"]) {
    assert.deepEqual(feed(file).applications.zotero, { strict_min_version: "10.0", strict_max_version: "12.*" });
    assert.equal(feed(file).update_link, `https://github.com/groele/Zotero-MetaFlow/releases/download/v${pkg.version}/zotero-metaflow.xpi`);
  }
});
test("deterministic XPI paths, timestamps and checksums", () => {
  const AdmZip = createRequire(import.meta.resolve("zotero-plugin-scaffold"))("adm-zip");
  const bytes = readFileSync("dist/zotero-metaflow.xpi");
  for (const entry of new AdmZip(bytes).getEntries()) {
    assert.ok(!entry.entryName.includes("\\"));
    assert.equal(entry.header.time.getFullYear(), 1980);
    assert.equal(entry.header.time.getMonth(), 0);
    assert.equal(entry.header.time.getDate(), 1);
  }
  assert.equal(feed("update.json").update_hash, `sha512:${createHash("sha512").update(bytes).digest("hex")}`);
  assert.equal(json("dist/verification.json").sha256, createHash("sha256").update(bytes).digest("hex"));
});
