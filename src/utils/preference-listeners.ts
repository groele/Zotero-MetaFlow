const controllers = new Map<Element, AbortController>();

export function preferenceLifetime(pane: Element): AbortSignal {
  let controller = controllers.get(pane);
  if (!controller) {
    const win = pane.ownerDocument!.defaultView as Window & typeof globalThis;
    controller = new win.AbortController();
    controllers.set(pane, controller);
  }
  return controller.signal;
}

export function preferenceListeners(pane: Element) {
  const signal = preferenceLifetime(pane);
  return <E extends Event>(target: Element, type: string, listener: (event: E) => unknown, options: boolean | AddEventListenerOptions = {}) => {
    target.addEventListener(type, listener as EventListener, {
      ...typeof options === "boolean" ? { capture: options } : options,
      signal,
    });
  };
}

export function releasePreferenceListeners(doc?: Document) {
  for (const [pane, controller] of controllers) {
    if (!doc || pane.ownerDocument === doc) {
      controller.abort();
      controllers.delete(pane);
    }
  }
}
