import { assert } from "chai";
import { config } from "../../package.json";

describe("credential request privacy in Zotero", function () {
  this.timeout(15_000);
  const secret = "metaflow-fixture-credential";
  const plugin = () => (Zotero as any)[config.addonInstance];
  let restore: () => void;
  const url = (path: string) => `${Zotero.Prefs.get("metaref.test.transportBaseURL", true)}${path}?secretKey=${secret}`;

  beforeEach(function () {
    assert.isString(Zotero.Prefs.get("metaref.test.transportBaseURL", true), "use the isolated loopback transport fixture");
    restore = plugin().api.testing.useHTTPTransport();
  });

  afterEach(function () {
    restore?.();
  });

  it("uses privileged requests without exposing query credentials to host debug logging", async function () {
    const base = Zotero.Prefs.get("metaref.test.transportBaseURL", true) as string;
    const control = await Zotero.HTTP.request("GET", `${base}/control`);
    assert.equal(control.status, 200, "the loopback fixture is reachable via the host transport");
    const original = Zotero.debug;
    let exposed = false;
    Zotero.debug = ((message: unknown, ...args: unknown[]) => {
      exposed ||= String(message).includes(secret);
      return (original as any).call(Zotero, message, ...args);
    }) as any;
    try {
      const response = await plugin().api.testing.requestHTTP("GET", url("/echo"));
      assert.equal(response.status, 200);
      assert.isTrue(response.mozSystem, "credential transport uses system-principal XHR");
      assert.equal(JSON.parse(response.responseText).title, "Loopback fixture");
      assert.isFalse(exposed, "the credential must not enter Zotero.debug");
    }
    finally {
      Zotero.debug = original;
    }
  });

  it("times out a credential request without including its query in the error", async function () {
    let error: any;
    try {
      await plugin().api.testing.requestHTTP("GET", url("/slow"), { timeout: 30 });
    }
    catch (caught) {
      error = caught;
    }
    assert.equal(error?.name, "TimeoutError");
    assert.notInclude(error.message, secret);
  });

  it("cancels an active credential request before a late response", async function () {
    const controller = new (Zotero.getMainWindow() as Window & typeof globalThis).AbortController();
    const pending = plugin().api.testing.requestHTTP("GET", url("/slow"), {}, controller.signal);
    await Zotero.Promise.delay(20);
    controller.abort(new Error("Fixture cancellation"));
    let error: any;
    try {
      await pending;
    }
    catch (caught) {
      error = caught;
    }
    assert.equal(error?.message, "Fixture cancellation");
  });

  it("keeps rate-limit retry policy on the private credential transport", async function () {
    const response = await plugin().api.testing.requestHTTP("GET", url("/retry"));
    assert.equal(JSON.parse(response.responseText).attempt, 2);
  });
});
