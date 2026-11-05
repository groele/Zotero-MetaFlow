import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { startTransportFixture } from "./testing/transport-fixture.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultManager = process.env.npm_execpath && existsSync(process.env.npm_execpath) ? process.env.npm_execpath : "pnpm";
async function run(args, env = process.env, requireTests = false) {
  // Reuse the manager selected by the parent instead of re-entering a global
  // version-manager wrapper, which can require another registry verification.
  const manager = env.npm_execpath && existsSync(env.npm_execpath) ? env.npm_execpath : defaultManager;
  const script = /\.[cm]?js$/i.test(manager);
  const actualArgs = args[0] === "build" && !/pnpm/i.test(manager) ? ["run", "build"] : args;
  await new Promise((resolve, reject) => {
    const child = spawn(script ? process.execPath : manager, script ? [manager, ...actualArgs] : actualArgs, { cwd: projectRoot, stdio: requireTests ? ["inherit", "pipe", "pipe"] : "inherit", shell: process.platform === "win32" && !script && !/\.exe$/i.test(manager), env });
    let output = "";
    for (const [stream, target] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
      stream?.setEncoding("utf8");
      stream?.on("data", (chunk) => {
        target.write(chunk);
        output = (output + chunk).slice(-1024 * 1024);
      });
    }
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) {
        reject(new Error(`E2E command failed with exit code ${code}`));
        return;
      }
      const count = stripVTControlCharacters(output).match(/Test run completed\s*-\s*(\d+) passed/);
      if (requireTests && (!count || Number(count[1]) === 0)) {
        reject(new Error("The E2E runner did not report any passing tests; refusing an empty or incomplete run."));
        return;
      }
      resolve();
    });
  });
}

const testDirectory = path.resolve(projectRoot, process.env.METAREF_TEST_ENTRIES || "test/tests");
if (!statSync(testDirectory).isDirectory())
  throw new Error("METAREF_TEST_ENTRIES must be a test directory, not a single file.");
function containsTests(directory) {
  return readdirSync(directory, { withFileTypes: true }).some(entry => entry.isDirectory()
    ? containsTests(path.join(directory, entry.name))
    : /\.(?:spec|test)\.[jt]s$/.test(entry.name));
}
if (!containsTests(testDirectory))
  throw new Error("The selected E2E directory contains no test files.");

await run(["build"]);
const qa = path.join(projectRoot, ".scaffold", "qa");
mkdirSync(qa, { recursive: true });
const packagePath = path.join(qa, "zotero-metaflow-production.xpi");
copyFileSync(path.join(projectRoot, ".scaffold", "build", "zotero-metaflow.xpi"), packagePath);
const version = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8")).version;
const updateFile = version.includes("-") ? "update-beta.json" : "update.json";
copyFileSync(path.join(projectRoot, ".scaffold", "build", updateFile), path.join(qa, "zotero-metaflow-production-update.json"));
const fixture = await startTransportFixture();
try {
  await run(["exec", "zotero-plugin", "test", "--no-watch"], {
    ...process.env,
    METAREF_TEST_PACKAGE_PATH: packagePath,
    METAREF_TEST_TRANSPORT_BASE_URL: fixture.url,
    ZOTERO_PLUGIN_KILL_COMMAND: process.env.ZOTERO_PLUGIN_KILL_COMMAND || (process.platform === "win32" ? "pwsh -NoProfile -Command \"exit 0\"" : "true"),
  }, true);
}
finally {
  fixture.close();
}
