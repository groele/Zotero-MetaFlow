import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { requestCredentials } from "./credential-request";

class Request {
  static instances: Request[] = [];
  status = 200;
  responseText = "{}";
  timeout = 0;
  responseType = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  open = vi.fn();
  send = vi.fn();
  abort = vi.fn(() => this.onabort?.());
  setRequestHeader = vi.fn();
  constructor() {
    Request.instances.push(this);
  }
}
const secret = "fixture-credential";
const url = `https://example.org/rank?secretKey=${secret}`;

beforeEach(() => {
  Request.instances = [];
  vi.stubGlobal("XMLHttpRequest", undefined);
  vi.stubGlobal("Zotero", { getMainWindow: () => ({ XMLHttpRequest: Request }), HTTP: { request: vi.fn() }, debug: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

it("sends credentials without using the host logger and releases handlers on success", async () => {
  const pending = requestCredentials("GET", url, {});
  const xhr = Request.instances[0];
  expect(xhr.open).toHaveBeenCalledWith("GET", url, true);
  expect(xhr.timeout).toBe(15_000);
  xhr.onload!();
  expect(await pending).toBe(xhr);
  expect(Zotero.HTTP.request).not.toHaveBeenCalled();
  expect(Zotero.debug).not.toHaveBeenCalled();
  expect(xhr.onload).toBeNull();
});

it.each(["onerror", "ontimeout"] as const)("redacts credentials on %s and ignores a late load", async (event) => {
  const pending = requestCredentials("GET", url, {});
  const xhr = Request.instances[0];
  const late = xhr.onload!;
  xhr[event]!();
  await expect(pending).rejects.not.toThrow(secret);
  late();
  expect(xhr.onload).toBeNull();
});

it("cancels before sending and detaches all callbacks", async () => {
  const pending = requestCredentials("GET", url, { cancellerReceiver: (cancel: () => void) => cancel() });
  const xhr = Request.instances[0];
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(xhr.send).not.toHaveBeenCalled();
  expect(xhr.abort).toHaveBeenCalledOnce();
  expect(xhr.onabort).toBeNull();
});

it("retains status and headers for the shared HTTP retry policy without exposing query secrets", async () => {
  const pending = requestCredentials("GET", url, {});
  const xhr = Request.instances[0];
  xhr.status = 429;
  xhr.onload!();
  await expect(pending).rejects.toMatchObject({ status: 429, xmlhttp: xhr, message: "HTTP 429 from https://example.org/rank" });
});

it("routes query credentials and API-key headers through the private transport", async () => {
  const { requestTransport } = await vi.importActual<typeof import("./http-transport")>("./http-transport");
  const first = requestTransport("GET", url, {});
  Request.instances[0].onload!();
  await first;
  const second = requestTransport("GET", "https://example.org/paper", { headers: { "x-api-key": secret } });
  Request.instances[1].onload!();
  await second;
  expect(Request.instances[1].setRequestHeader).toHaveBeenCalledWith("x-api-key", secret);
  expect(Zotero.HTTP.request).not.toHaveBeenCalled();
  await requestTransport("GET", "https://example.org/public", {});
  expect(Zotero.HTTP.request).toHaveBeenCalledOnce();
});

it("uses a live detached-window request context when no main window remains", async () => {
  (Zotero as any).getMainWindow = () => undefined;
  let available = true;
  vi.stubGlobal("Services", { wm: { getEnumerator: () => ({ hasMoreElements: () => available, getNext: () => {
    available = false;
    return { closed: false, XMLHttpRequest: Request };
  } }) } });
  const pending = requestCredentials("GET", url, {});
  Request.instances[0].onload!();
  await expect(pending).resolves.toBe(Request.instances[0]);
});

it("does not abort or change a completed response when a stale canceller runs", async () => {
  let cancel!: () => void;
  const pending = requestCredentials("GET", url, { cancellerReceiver: (callback: () => void) => {
    cancel = callback;
  } });
  const xhr = Request.instances[0];
  xhr.onload!();
  await pending;
  cancel();
  expect(xhr.abort).not.toHaveBeenCalled();
});
