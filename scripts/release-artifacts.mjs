import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.resolve("zotero-plugin-scaffold"));
const AdmZip = require("adm-zip");

const json = file => JSON.parse(readFileSync(file, "utf8"));
const write = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");

export function packDeterministic(directory) {
  const root = path.join(directory, "addon");
  const zip = new AdmZip();
  const add = (folder) => {
    for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        add(file);
      }
      else if (entry.isFile()) {
        const name = path.relative(root, file).replaceAll("\\", "/");
        zip.addFile(name, readFileSync(file), "", 0o100644 << 16);
        zip.getEntry(name).header.time = new Date(1980, 0, 1, 0, 0, 0);
      }
      else {
        throw new Error(`Unsupported package entry: ${file}`);
      }
    }
  };
  add(root);
  zip.writeZip(path.join(directory, "zotero-metaflow.xpi"));
}

export function writeReleaseMetadata(directory, promote = false) {
  const pkg = json("package.json");
  const manifest = json(path.join(directory, "addon/manifest.json"));
  if (manifest.version !== pkg.version || manifest.applications.zotero.id !== "metaflow@groele")
    throw new Error("Built package identity/version mismatch");
  const bytes = readFileSync(path.join(directory, "zotero-metaflow.xpi"));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const sha512 = createHash("sha512").update(bytes).digest("hex");
  const feed = { addons: { "metaflow@groele": { updates: [{ version: pkg.version, update_link: `https://github.com/groele/Zotero-MetaFlow/releases/download/v${pkg.version}/zotero-metaflow.xpi`, update_hash: `sha512:${sha512}`, applications: { zotero: { strict_min_version: "10.0", strict_max_version: "12.*" } } }] } } };
  const verification = { version: pkg.version, addon_id: "metaflow@groele", name: "Zotero MetaFlow", bytes: bytes.length, sha256, sha512, archive: "zotero-metaflow.xpi", strict_min_version: "10.0", strict_max_version: "12.*" };
  write(path.join(directory, "update.json"), feed);
  write(path.join(directory, "verification.json"), verification);
  if (promote) {
    mkdirSync("dist", { recursive: true });
    for (const name of ["zotero-metaflow.xpi", "update.json", "verification.json"])
      copyFileSync(path.join(directory, name), path.join("dist", name));
    write("update.json", feed);
    const checksums = ["update.json", "verification.json", "zotero-metaflow.xpi"].map(name => `${createHash("sha256").update(readFileSync(path.join("dist", name))).digest("hex")}  ${name}`).join("\n");
    writeFileSync("dist/SHA256SUMS.txt", `${checksums}\n`);
  }
  return verification;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(JSON.stringify(writeReleaseMetadata(".scaffold/build", process.argv.includes("--promote"))));
