type RequestOptions = NonNullable<Parameters<typeof Zotero.HTTP.request>[2]>;

/** Privileged XHR avoids the host HTTP logger, which does not redact secretKey. */
export function requestCredentials(method: "GET" | "POST", url: string, options: RequestOptions): Promise<XMLHttpRequest> {
  // Use the same privileged global constructor as Zotero's own network module.
  if (typeof XMLHttpRequest === "undefined" && typeof Cu !== "undefined")
    Cu.importGlobalProperties(["XMLHttpRequest"]);
  const win = Zotero.getMainWindow?.() as unknown as (Window & typeof globalThis) | undefined;
  let XHR = typeof XMLHttpRequest !== "undefined" ? XMLHttpRequest : win && !win.closed ? win.XMLHttpRequest : undefined;
  if (!XHR && typeof Services !== "undefined") {
    const windows = Services.wm.getEnumerator("");
    while (windows.hasMoreElements()) {
      const candidate = windows.getNext() as unknown as Window & typeof globalThis;
      if (!candidate.closed && candidate.XMLHttpRequest) {
        XHR = candidate.XMLHttpRequest;
        break;
      }
    }
  }
  if (!XHR)
    return Promise.reject(new Error("No privileged request context available"));
  const display = new URL(url);
  const endpoint = `${display.origin}${display.pathname}`;
  return new Promise((resolve, reject) => {
    const SystemXHR = XHR as unknown as { new (options: { mozSystem: boolean; mozAnon: boolean }): XMLHttpRequest };
    const xhr = new SystemXHR({ mozSystem: true, mozAnon: true });
    let settled = false;
    const finish = (error?: Error) => {
      if (settled)
        return;
      settled = true;
      xhr.onload = xhr.onerror = xhr.ontimeout = xhr.onabort = null;
      if (error)
        reject(Object.assign(error, { status: xhr.status, xmlhttp: xhr }));
      else
        resolve(xhr);
    };
    try {
      (xhr as any).mozBackgroundRequest = !options.foreground;
      xhr.open(method, url, true);
      xhr.timeout = options.timeout ?? 15_000;
      if (options.responseType)
        xhr.responseType = options.responseType as XMLHttpRequestResponseType;
      for (const [name, value] of Object.entries(options.headers || {}))
        xhr.setRequestHeader(name, String(value));
      xhr.onload = () => {
        const valid = options.successCodes === false
          || (Array.isArray(options.successCodes) ? options.successCodes.includes(xhr.status) : xhr.status >= 200 && xhr.status < 300);
        finish(valid ? undefined : new Error(`HTTP ${xhr.status} from ${endpoint}`));
      };
      xhr.onerror = () => finish(new Error(`Network request failed: ${endpoint}`));
      xhr.ontimeout = () => finish(Object.assign(new Error(`Request timed out: ${endpoint}`), { name: "TimeoutError" }));
      xhr.onabort = () => finish(Object.assign(new Error("Request cancelled"), { name: "AbortError" }));
      options.cancellerReceiver?.(() => {
        if (settled)
          return;
        finish(Object.assign(new Error("Request cancelled"), { name: "AbortError" }));
        xhr.abort();
      });
      if (!settled)
        xhr.send(options.body ?? null);
    }
    catch {
      finish(new Error(`Cannot start request: ${endpoint}`));
      xhr.abort();
    }
  });
}
