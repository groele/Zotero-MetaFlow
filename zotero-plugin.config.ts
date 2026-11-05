import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { env } from "node:process";
import { defineConfig } from "zotero-plugin-scaffold";
import { fse } from "zotero-plugin-scaffold/vendor";
import pkg from "./package.json";

export default defineConfig({
  source: ["src", "addon"],
  dist: ".scaffold/build",
  name: pkg.config.addonName,
  xpiName: "zotero-metaflow",
  id: pkg.config.addonID,
  namespace: pkg.config.addonRef,
  updateURL: "https://raw.githubusercontent.com/groele/Zotero-MetaFlow/main/dist/update.json",
  xpiDownloadLink: `https://github.com/groele/Zotero-MetaFlow/releases/download/v${pkg.version}/zotero-metaflow.xpi`,
  server: {
    startArgs: ["-no-remote"],
  },

  build: {
    assets: [
      "addon/**/*.*",
      "data/journal-abbr/journal-abbr.json",
      "data/journal-abbr/journal-abbr-profiles.json",
      "data/journal-abbr/journal-abbr-provenance.json",
      "data/journal-abbr/ltwa.tsv",
      "data/journal-abbr/shortwords.txt",
      "data/conference-abbr.json",
      "data/university-list/university-place.json",
      "data/esi/esi-journals.json",
      "data/nature-index/nature-index-journals.json",
    ],
    define: {
      ...pkg.config,
      author: pkg.author,
      description: pkg.description,
      homepage: pkg.homepage,
      buildVersion: pkg.version,
      buildTime: "{{buildTime}}",
    },
    prefs: {
      prefix: pkg.config.prefsPrefix,
    },
    esbuildOptions: [
      {
        entryPoints: [
          { in: "src/index.ts", out: pkg.config.addonRef },
        ],
        define: {
          __env__: `"${env.NODE_ENV}"`,
        },
        bundle: true,
        format: "esm",
        target: "firefox140",
        outdir: `.scaffold/build/addon/content/scripts/`,
        external: ["Zotero"],
      },
    ],
    makeUpdateJson: {
      hash: true,
      updates: [],
    },
    hooks: {
      "build:bundle": async () => {
        fse.ensureDirSync(".scaffold/build/addon/licenses");
        copyFileSync("LICENSE", ".scaffold/build/addon/licenses/MetaFlow-AGPL-3.0.txt");
        // @ts-expect-error resolve esbuild "ReferenceError: Zotero is not defined" error
        globalThis.Zotero = {
          Prefs: {
            get: () => 1,
          },
        };
        // Generate declaration file for rule ids
        const { Rules } = await import("./src/modules/rules/index.ts");

        const dts = `// Auto generated file. Do not modify.
        /* eslint-disable */
        type ID =
          | ${Rules.getAll().map(r => `"${r.id}"`).join("\n  | ")}
        `.replaceAll(" ".repeat(8), "");

        const declarationPath = "typings/rules.d.ts";
        if (!existsSync(declarationPath) || readFileSync(declarationPath, "utf8") !== dts)
          fse.outputFileSync(declarationPath, dts);
      },
    },
  },

  release: {
    bumpp: {
      execute: "pnpm build",
      all: true,
    },
    github: {
      enable: "ci",
      updater: "releaser",
      releaseNote(ctx: any) {
        let notes = `${ctx.release.changelog}  \n\n`;
        notes += `![GitHub release (by tag)](https://img.shields.io/github/downloads/${ctx.release.github.repository}/${ctx.release.bumpp.tag}/total)  \n\n`;
        return notes;
      },
    },
  },
  test: {
    entries: [env.METAREF_TEST_ENTRIES || "test/tests"],
    prefs: {
      // Host background retraction checks are independent of MetaFlow's offline pipeline.
      "extensions.zotero.retractions.enabled": false,
      "metaref.test.fixturePath": resolve("test/data"),
      ...env.METAREF_TEST_TRANSPORT_BASE_URL && { "metaref.test.transportBaseURL": env.METAREF_TEST_TRANSPORT_BASE_URL },
      [`${pkg.config.prefsPrefix}.metadata.repairCreators`]: false,
      [`${pkg.config.prefsPrefix}.metadata.updateJournalInfo`]: false,
      ...env.METAREF_TEST_PLATFORM && { "metaref.test.expectedPlatform": Number(env.METAREF_TEST_PLATFORM) },
      ...env.METAREF_TEST_PACKAGE_PATH && { "metaref.test.packagePath": env.METAREF_TEST_PACKAGE_PATH },
      ...env.METAREF_TEST_LOCALE && { "intl.locale.requested": env.METAREF_TEST_LOCALE },
    },
    watch: false,
    waitForPlugin: "() => Boolean(Zotero.MetaRef?.data.alive)",
  },

  // If you need to see a more detailed build log, uncomment the following line:
  // logLevel: "TRACE",
});
