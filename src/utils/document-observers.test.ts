import { expect, it, vi } from "vitest";
import { DocumentObservers } from "./document-observers";

function document() {
  const callbacks: (() => void)[] = [];
  const disconnects: ReturnType<typeof vi.fn>[] = [];
  const listeners = new Set<() => void>();
  const win = { closed: false, MutationObserver: class {
    disconnect = vi.fn();
    observe = vi.fn();
    constructor(callback: () => void) {
      callbacks.push(callback);
      disconnects.push(this.disconnect);
    }
  }, addEventListener: (_: string, callback: () => void) => listeners.add(callback), removeEventListener: (_: string, callback: () => void) => listeners.delete(callback) };
  return { doc: { defaultView: win } as unknown as Document, callbacks, disconnects, listeners, win };
}

it("does not attach duplicate observers to the same host table", () => {
  const owner = document();
  const target = {} as Node;
  const observers = new DocumentObservers();
  observers.observe(owner.doc, target, vi.fn());
  observers.observe(owner.doc, target, vi.fn());
  expect(owner.callbacks).toHaveLength(1);
  observers.clear();
  expect(owner.disconnects[0]).toHaveBeenCalledOnce();
  expect(owner.listeners.size).toBe(0);
});

it("disconnects a closed reader without disconnecting another live document", () => {
  const left = document();
  const right = document();
  const observers = new DocumentObservers();
  const refresh = vi.fn();
  observers.observe(left.doc, {} as Node, refresh);
  observers.observe(right.doc, {} as Node, refresh);
  for (const close of left.listeners)
    close();
  expect(left.disconnects[0]).toHaveBeenCalledOnce();
  expect(right.disconnects[0]).not.toHaveBeenCalled();
  left.callbacks[0]();
  expect(refresh).not.toHaveBeenCalled();
  right.callbacks[0]();
  expect(refresh).toHaveBeenCalledOnce();
  observers.clear();
});

it("can reattach after cleanup and ignores a callback queued by an old observer", () => {
  const owner = document();
  const observers = new DocumentObservers();
  const target = {} as Node;
  const refresh = vi.fn();
  observers.observe(owner.doc, target, refresh);
  observers.clear();
  observers.observe(owner.doc, target, refresh);
  owner.callbacks[0]();
  expect(refresh).not.toHaveBeenCalled();
  owner.callbacks[1]();
  expect(refresh).toHaveBeenCalledOnce();
  observers.clear();
});
