/** Own observers by document so closing one reader releases only its resources. */
export class DocumentObservers {
  private targets = new Map<Node, { doc: Document; observer: MutationObserver }>();
  private windows = new Map<Document, () => void>();

  observe(doc: Document, target: Node, callback: () => void) {
    if (this.targets.has(target))
      return;
    const win = doc.defaultView as (Window & typeof globalThis) | null;
    const Observer = win?.MutationObserver ?? (typeof MutationObserver !== "undefined" ? MutationObserver : undefined);
    if (!Observer || win?.closed)
      return;
    const observer = new Observer(() => {
      if (this.targets.get(target)?.observer !== observer)
        return;
      if (win?.closed) {
        this.clear(doc);
        return;
      }
      callback();
    });
    observer.observe(target, { childList: true, subtree: true });
    this.targets.set(target, { doc, observer });
    if (win && !this.windows.has(doc)) {
      const close = () => this.clear(doc);
      win.addEventListener("unload", close, { once: true });
      this.windows.set(doc, close);
    }
  }

  clear(doc?: Document) {
    for (const [target, binding] of this.targets) {
      if (doc && binding.doc !== doc)
        continue;
      binding.observer.disconnect();
      this.targets.delete(target);
    }
    for (const [owner, close] of this.windows) {
      if (doc && owner !== doc)
        continue;
      owner.defaultView?.removeEventListener("unload", close);
      this.windows.delete(owner);
    }
  }
}
