import { TypedEventBus } from "../kernel/event-bus";
import { UnifiedNotifierHub } from "../kernel/notifier-hub";
import { logger } from "../utils/logger";

let fallbackHub: UnifiedNotifierHub | undefined;
let fallbackDispose: (() => void) | undefined;

export function registerNotifier() {
  unregisterNotifier();
  const kernelNotifier = (globalThis as any).addon?.kernel?.notifier;
  if (kernelNotifier) {
    kernelNotifier.start();
    return;
  }
  fallbackHub ??= new UnifiedNotifierHub(new TypedEventBus(), {
    observerID: "metaref",
    priority: 666,
    isAlive: () => Boolean(addon?.data?.alive),
    onError: error => logger.error("Automatic metadata processing failed:", error),
  });
  fallbackDispose = fallbackHub.subscribe(["item"], ev =>
    addon.hooks.onNotify(ev.event, ev.type, [...ev.ids], ev.extraData ?? {}));
  fallbackHub.start();
}

export function unregisterNotifier() {
  const kernelNotifier = (globalThis as any).addon?.kernel?.notifier;
  if (kernelNotifier) {
    kernelNotifier.stop();
    return;
  }
  fallbackDispose?.();
  fallbackDispose = undefined;
  fallbackHub?.stop();
}
