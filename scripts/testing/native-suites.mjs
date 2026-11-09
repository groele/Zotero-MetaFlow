import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Every domain runs once; shared diagnostics contain hooks rather than tests. */
export function nativeSuites(root, qa, selected, monolithic = false) {
  const source = path.join(root, "test/tests");
  if (selected || monolithic)
    return [{ name: selected ? "selected" : "monolithic", directory: path.resolve(root, selected || source) }];
  const hooks = "00-diagnostics.spec.ts";
  const collect = (directory, prefix = "") => readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? collect(path.join(directory, entry.name), path.join(prefix, entry.name))
    : /\.(?:spec|test)\.[jt]s$/.test(entry.name) ? [path.join(prefix, entry.name)] : []);
  const files = collect(source).filter(file => file !== hooks).sort();
  const journals = new Set(["journal-columns.spec.ts", "journal-database.spec.ts", "journal-layout.spec.ts", "journal-pane.spec.ts"]);
  const menus = new Set(["menu-native.spec.ts"]);
  const groups = [
    { name: "journals", files: files.filter(file => journals.has(file)) },
    { name: "menus", files: files.filter(file => menus.has(file)) },
    { name: "workflows", files: files.filter(file => !journals.has(file) && !menus.has(file)) },
  ];
  assert.deepEqual(groups.flatMap(group => group.files).sort(), files, "Native suite partition must cover every file exactly once");
  return groups.map((group) => {
    assert.ok(group.files.length, `Empty native suite: ${group.name}`);
    const directory = path.join(qa, "native-suites", group.name);
    mkdirSync(directory, { recursive: true });
    const aggregate = path.join(directory, "suite.spec.ts");
    if (existsSync(aggregate))
      unlinkSync(aggregate); // Retire only our earlier generated aggregate entry.
    for (const file of [hooks, ...group.files]) {
      const entry = path.join(directory, file);
      mkdirSync(path.dirname(entry), { recursive: true });
      const target = path.relative(path.dirname(entry), path.join(source, file)).replaceAll("\\", "/").replace(/\.ts$/, "");
      // Preserve the original per-file bundle boundaries and module instances.
      writeFileSync(entry, `import ${JSON.stringify(target)};\n`, "utf8");
    }
    return { name: group.name, directory };
  });
}
