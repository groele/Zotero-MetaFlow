import { requestCredentials } from "./credential-request";

type RequestOptions = NonNullable<Parameters<typeof Zotero.HTTP.request>[2]>;
export type HTTPTransport = (method: "GET" | "POST", url: string, options: RequestOptions) => ReturnType<typeof Zotero.HTTP.request>;
let override: HTTPTransport | undefined;

export function useHTTPTransport(transport?: HTTPTransport): () => void {
  const previous = override;
  override = transport;
  return () => {
    override = previous;
  };
}

export function requestTransport(method: "GET" | "POST", url: string, options: RequestOptions) {
  if (override)
    return override(method, url, options);
  const sensitive = [...new URL(url).searchParams.keys()].some(name => /^(?:secretkey|api[_-]?key|access[_-]?token|token|key)$/i.test(name))
    || Object.keys(options.headers || {}).some(name => /^(?:authorization|x-api-key|zotero-api-key)$/i.test(name));
  return sensitive ? requestCredentials(method, url, options) : Zotero.HTTP.request(method, url, options);
}
