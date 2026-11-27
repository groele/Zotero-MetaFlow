import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";

const read = file => readFileSync(file, "utf8");
const json = file => JSON.parse(read(file));
const pkg = json("package.json");
const files = folder => readdirSync(folder, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(folder, entry.name)) : [path.join(folder, entry.name)]);
const sources = files("src");
const prodTsFiles = sources.filter(file => file.endsWith(".ts") && !file.endsWith(".test.ts"));
const relSrc = file => path.relative("src", file).replaceAll("\\", "/");
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
  for (const file of prodTsFiles)
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
function collectRelativeImports(file, text) {
  const specs = [];
  for (const match of text.matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
    const spec = match[1];
    if (spec.startsWith("."))
      specs.push(path.relative("src", path.resolve(path.dirname(file), spec)).replaceAll("\\", "/"));
  }
  return specs;
}

test("five-layer unidirectional dependency boundaries", () => {
  const violations = [];
  for (const file of prodTsFiles) {
    const rel = relSrc(file);
    if (rel.startsWith("modules/"))
      continue;
    const d1 = rel.match(/^domains\/([^/]+)\//);
    for (const resolved of collectRelativeImports(file, read(file))) {
      if (resolved.startsWith("modules/"))
        violations.push(`${rel} -> ${resolved} (production source cannot import legacy src/modules shims)`);
      if (rel.startsWith("kernel/") && /^(?:services|domains|modules|bridges|utils)\//.test(resolved))
        violations.push(`${rel} -> ${resolved} (kernel cannot import upper layers)`);
      if ((rel.startsWith("services/") || rel.startsWith("utils/")) && /^(?:domains|modules|bridges)\//.test(resolved))
        violations.push(`${rel} -> ${resolved} (services/utils cannot import domains/modules/bridges)`);
      const d2 = resolved.match(/^domains\/([^/]+)\//);
      if (d1 && d2 && d1[1] !== d2[1])
        violations.push(`${rel} -> ${resolved} (cross-domain import forbidden)`);
      if (d1 && resolved.startsWith("bridges/"))
        violations.push(`${rel} -> ${resolved} (domains cannot import bridges)`);
    }
  }
  assert.deepEqual(violations, []);
});
test("compatibility shim purity in src/modules", () => {
  const moduleFiles = sources.filter(f => relSrc(f).startsWith("modules/"));
  assert.ok(moduleFiles.length <= 7, `Unexpected file count in src/modules: ${moduleFiles.length}`);
  const violations = [];
  for (const file of moduleFiles) {
    const text = read(file);
    if (!/^(?:export\s+\*\s+from\s+"[^"]+";\r?\n)+$/.test(text))
      violations.push(`${relSrc(file)} must be a pure 1-line re-export shim`);
  }
  assert.deepEqual(violations, []);
});
test("bridge isolation (Port and EventBus only)", () => {
  const violations = [];
  for (const file of prodTsFiles.filter(f => relSrc(f).startsWith("bridges/"))) {
    const rel = relSrc(file);
    for (const resolved of collectRelativeImports(file, read(file))) {
      if (/^(?:domains|modules)\//.test(resolved))
        violations.push(`${rel} -> ${resolved}`);
    }
  }
  assert.deepEqual(violations, []);
});
test("host anti-corruption fence", () => {
  const violations = [];
  for (const file of prodTsFiles) {
    const rel = relSrc(file);
    if (rel === "kernel/native-runtime.ts" || rel.startsWith("services/host/"))
      continue;
    const text = read(file);
    if (/\.prototype\.|\bruntime\.patch\s*\(|\bpluginPanes\b|\bProgressWindowSet\b/.test(text))
      violations.push(rel);
  }
  assert.deepEqual(violations, []);
});
test("centralized Prefs and Notifier observers", () => {
  const violations = [];
  for (const file of prodTsFiles) {
    const rel = relSrc(file);
    if (rel.startsWith("kernel/"))
      continue;
    if (/\b(?:Prefs|Notifier)\.registerObserver\s*\(/.test(read(file)))
      violations.push(rel);
  }
  assert.deepEqual(violations, []);
});
test("sandbox safety and Zotero 11+ compatibility guard", () => {
  const violations = [];
  for (const file of prodTsFiles) {
    const rel = relSrc(file);
    const base = path.basename(file);
    if (/^(?:v\d+|temp[-_])/i.test(base))
      violations.push(`${rel} (forbidden version/temp filename)`);
    if (/@ts-ignore|@ts-nocheck|\bqueueMicrotask\s*\(|\bgetSelectedLibraryID\s*\(|\bgetSelectedCollection\s*\(/.test(read(file)))
      violations.push(`${rel} (forbidden suppression, queueMicrotask, or singular ZoteroPane API)`);
  }
  assert.deepEqual(violations, []);
});
test("EventBus closure (zero dead or half-open events)", () => {
  const typesText = read("src/kernel/types.ts");
  const mapMatch = typesText.match(/export interface MetaFlowEventMap \{([\s\S]*?)\n\}/);
  assert.ok(mapMatch, "MetaFlowEventMap not found in src/kernel/types.ts");
  const eventNames = [...mapMatch[1].matchAll(/["']([a-z0-9:-]+)["']\s*:/g)].map(m => m[1]);
  assert.ok(eventNames.length > 0, "No events declared in MetaFlowEventMap");
  const corpus = prodTsFiles.filter(f => relSrc(f) !== "kernel/types.ts").map(f => read(f)).join("\n");
  const broken = eventNames.filter((ev) => {
    const esc = ev.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const hasEmit = new RegExp(`emit\\(\\s*["']${esc}["']`).test(corpus);
    const hasOn = new RegExp(`\\.on\\(\\s*["']${esc}["']`).test(corpus);
    return !hasEmit || !hasOn;
  });
  assert.deepEqual(broken, []);
});
test("Gecko loadSubScript sandbox global safety", () => {
  const violations = [];
  for (const file of prodTsFiles) {
    const rel = relSrc(file);
    if (rel === "kernel/host-globals.ts")
      continue;
    if (/\bglobalThis\b[^\n;]*\.\s*(?:addon|Zotero)\b/.test(read(file)))
      violations.push(`${rel} (must use resolveAddonHost/resolveZoteroHost instead of globalThis.addon/Zotero)`);
  }
  assert.deepEqual(violations, []);
});
test("host contract and headless launch smoke script integrity", () => {
  assert.ok(existsSync("scripts/smoke-zotero.mjs"), "Missing scripts/smoke-zotero.mjs");
  assert.ok(existsSync("scripts/smoke-launch.mjs"), "Missing scripts/smoke-launch.mjs");
  assert.equal(pkg.scripts?.["smoke:host"], "node scripts/smoke-zotero.mjs --check-only");
  assert.equal(pkg.scripts?.["smoke:launch"], "node scripts/smoke-zotero.mjs --launch");
});
