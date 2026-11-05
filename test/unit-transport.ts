import { vi } from "vitest";

// Service fixtures replace the transport. Credential transport has its own real tests.
vi.mock("../src/utils/http-transport", async (original) => {
  const actual = await original<typeof import("../src/utils/http-transport")>();
  return {
    ...actual,
    requestTransport: (...args: Parameters<typeof actual.requestTransport>) => Zotero.HTTP.request(...args),
  };
});
