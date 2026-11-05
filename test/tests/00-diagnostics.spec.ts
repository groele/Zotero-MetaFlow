/* eslint-disable mocha/no-top-level-hooks -- Shared fixture lifetime spans every native suite. */
import type { Runner } from "mocha";
import { config } from "../../package.json";

const testWindow = globalThis as unknown as {
  mocha: { reporter: (reporter: new (runner: Runner) => object) => void };
  Reporter: new (runner: Runner) => object;
  debug: (message: string) => void;
};

testWindow.mocha.reporter(class extends testWindow.Reporter {
  constructor(runner: Runner) {
    super(runner);
    runner.on("fail", (test, error) => {
      testWindow.debug(`E2E failure: ${test.fullTitle()}\n${error.stack || String(error)}`);
    });
  }
});

let restoreTransport: (() => void) | undefined;

before(function () {
  const plugin = (Zotero as any)[config.addonInstance];
  restoreTransport = plugin.api.testing.useHTTPTransport((method: "GET" | "POST", url: string, options: any) => Zotero.HTTP.request(method, url, options));
});

after(function () {
  restoreTransport?.();
});
