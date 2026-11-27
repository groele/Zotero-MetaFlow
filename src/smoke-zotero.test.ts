import { describe, expect, it, vi } from "vitest";
// @ts-expect-error -- ESM Node script helper under scripts/
import { parseCliArgs, removeDirWithRetry, resolveExtensionStage, terminateProcessTree } from "../scripts/smoke-zotero.mjs";

describe("smoke-zotero and smoke-launch harness", () => {
  it("parses --launch, --timeout, and forces launch=false when --check-only is set", () => {
    expect(parseCliArgs(["--launch", "--timeout=8500", "--json"])).toEqual({
      checkOnly: false,
      launch: true,
      timeoutMs: 8500,
      json: true,
      requireHost: false,
      zoteroBin: null,
    });
    expect(parseCliArgs(["--launch", "--check-only"])).toMatchObject({
      checkOnly: true,
      launch: false,
    });
  });

  it("retries transient EBUSY/EPERM errors and succeeds on subsequent removal", async () => {
    let calls = 0;
    const rmSyncFn = vi.fn(() => {
      calls++;
      if (calls < 3) {
        const err = new Error("busy") as Error & { code: string };
        err.code = "EBUSY";
        throw err;
      }
    });
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const res = await removeDirWithRetry("/tmp/fake-smoke-profile", { rmSyncFn, sleepFn, maxAttempts: 5 });
    expect(res).toEqual({ removed: true, attempts: 3, warning: null });
    expect(sleepFn).toHaveBeenCalledTimes(2);
  });

  it("terminates spawned process tree strictly by child PID on win32 and POSIX", () => {
    const spawnSyncFn = vi.fn(() => ({ status: 0 }));
    const child = { pid: 42424, kill: vi.fn() };
    expect(terminateProcessTree(child, { platform: "win32", spawnSyncFn })).toBe(true);
    expect(spawnSyncFn).toHaveBeenCalledWith(
      "taskkill",
      ["/PID", "42424", "/T", "/F"],
      expect.objectContaining({ windowsHide: true }),
    );

    const killFn = vi.fn();
    expect(terminateProcessTree(child, { platform: "linux", killFn })).toBe(true);
    expect(killFn).toHaveBeenCalledWith(-42424, "SIGKILL");
  });

  it("prefers unpacked .scaffold/build/addon proxy and falls back to dist/zotero-metaflow.xpi", () => {
    const proxyStage = resolveExtensionStage("/repo", {
      existsFn: (p: string) => p.replaceAll("\\", "/").endsWith(".scaffold/build/addon/manifest.json"),
    });
    expect(proxyStage.mode).toBe("proxy");
    expect(proxyStage.addonId).toBe("metaflow@groele");

    const xpiStage = resolveExtensionStage("/repo", {
      existsFn: (p: string) => p.replaceAll("\\", "/").endsWith("dist/zotero-metaflow.xpi"),
    });
    expect(xpiStage.mode).toBe("xpi");

    expect(() => resolveExtensionStage("/repo", { existsFn: () => false })).toThrow(/pnpm run build/);
  });
});
