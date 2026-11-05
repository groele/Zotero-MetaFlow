import { afterEach, expect, it, vi } from "vitest";
import { releasePreferenceListeners } from "../utils/preference-listeners";
import { setupDependencies } from "./settings-dependencies";

afterEach(() => {
  releasePreferenceListeners();
  vi.unstubAllGlobals();
});

it("reads changed preferences before the native checkbox binding has caught up and unregisters on release", async () => {
  vi.stubGlobal("queueMicrotask", undefined);
  const callbacks = new Map<symbol, () => void>();
  let enabled = true;
  const unregisterObserver = vi.fn((id: symbol) => callbacks.delete(id));
  vi.stubGlobal("addon", { data: { alive: true, config: { prefsPrefix: "test" } } });
  vi.stubGlobal("Zotero", { Prefs: {
    get: (name: string) => name.endsWith(".lint.onAdded") ? enabled : true,
    registerObserver: (_name: string, callback: () => void) => {
      const id = Symbol("preference");
      callbacks.set(id, callback);
      return id;
    },
    unregisterObserver,
  } });
  const control = (name: string) => Object.assign(new EventTarget(), {
    localName: "input",
    type: "checkbox",
    checked: true,
    disabled: false,
    getAttribute: () => `test.${name}`,
    closest: () => ({ classList: { toggle: vi.fn() } }),
  });
  const auto = control("lint.onAdded");
  const child = control("metadata.autoUpdateOnAdded");
  const pane = Object.assign(new EventTarget(), {
    isConnected: true,
    ownerDocument: { defaultView: { AbortController, Event } },
    querySelectorAll: (selector: string) => selector === "[preference]" ? [auto, child] : [],
  }) as unknown as Element;
  setupDependencies(pane);
  expect(child.disabled).toBe(false);
  enabled = false;
  for (const callback of callbacks.values())
    callback();
  expect(auto.checked).toBe(true);
  await Promise.resolve();
  expect(auto.checked).toBe(false);
  expect(child.disabled).toBe(true);
  const count = callbacks.size;
  releasePreferenceListeners();
  expect(unregisterObserver).toHaveBeenCalledTimes(count);
  expect(callbacks.size).toBe(0);
});
