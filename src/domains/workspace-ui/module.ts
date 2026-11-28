import type { PluginKernel } from "../../kernel/plugin-kernel";
import type { Disposable, DomainModule } from "../../kernel/types";
import { closeCoreFeedback } from "../../services/lint/batch-feedback";
import { closeCompletionNotices } from "../../services/lint/completion-notice";
import { cleanupResources } from "../../utils/cleanup";
import { closeAllDialogs } from "../../utils/dialog";
import { closeJournalShareDialogs } from "../../utils/journal-card-share";
import { initLocale, registerMainWindowLocale, unloadLocale, unregisterMainWindowLocale } from "../../utils/locale";
import { logger } from "../../utils/logger";
import { registerActionsPane, unregisterActionsPane } from "./actions-pane";
import { placeTLDRBeforeExtra, refreshTLDRInfoRow, registerInfoRows, unregisterInfoRows } from "./item-info-row";
import { registerMenu, unregisterMenu } from "./menu";
import { registerPrefs, unregisterPrefsWindows } from "./preference";
import { RichTextToolBar } from "./rich-text";
import { onShortcuts } from "./shortcut-actions";
import { registerShortcuts } from "./shortcuts";

interface WindowBinding {
  closed: boolean;
  readyPromise: Promise<void>;
}

function isAddonAlive(): boolean {
  return typeof addon === "undefined" || !addon?.data || addon.data.alive;
}

export class WorkspaceUiDomainModule implements DomainModule {
  public readonly id = "workspace-ui" as const;

  private readonly windowBindings = new Map<Window, WindowBinding>();
  private readonly shortcutCleanups = new Map<Window, () => void>();
  private readonly toolbars = new Map<Window, RichTextToolBar>();
  private readonly preLocalizedWindows = new WeakSet<Window>();
  private active = false;
  private earlyStarted = false;
  private infoRowsStarted = false;
  private portDisposer?: Disposable;

  constructor(private readonly kernel: PluginKernel) {}

  public isActive(): boolean {
    return this.active;
  }

  public ensurePortRegistered(): void {
    if (this.portDisposer && this.kernel.ports.has("workspace-ui"))
      return;
    this.portDisposer?.();
    this.portDisposer = this.kernel.ports.register("workspace-ui", {
      refreshTldrRow: rowID => refreshTLDRInfoRow(rowID),
      placeTldrRow: doc => placeTLDRBeforeExtra(doc),
      executeShortcut: (hookName, win) => onShortcuts(hookName, win),
    });
  }

  public async startEarly(): Promise<void> {
    if (this.earlyStarted)
      return;
    this.earlyStarted = true;
    initLocale();
    const prefsReady = registerPrefs();
    registerMenu();
    this.active = true;
    this.ensurePortRegistered();
    await prefsReady;
  }

  public startInfoRows(): void {
    if (this.infoRowsStarted || !this.active)
      return;
    this.infoRowsStarted = true;
    registerActionsPane();
    registerInfoRows();
  }

  public async start(): Promise<void> {
    if (!this.earlyStarted)
      await this.startEarly();
    if (!this.active)
      return;
    this.startInfoRows();
  }

  public onMainWindowLoad(win: Window, localeRegistered = false): Promise<void> {
    const existing = this.windowBindings.get(win);
    if (existing)
      return existing.readyPromise;
    const binding: WindowBinding = { closed: false, readyPromise: Promise.resolve() };
    this.windowBindings.set(win, binding);
    binding.readyPromise = Promise.resolve().then(async () => {
      if (binding.closed || win.closed || !this.active || !isAddonAlive())
        return;
      try {
        this.initializeMainWindow(win, localeRegistered);
        if (binding.closed || win.closed || !this.active || !isAddonAlive())
          await this.onMainWindowUnload(win);
      }
      catch (error) {
        await this.onMainWindowUnload(win);
        throw error;
      }
    });
    return binding.readyPromise;
  }

  public async onMainWindowUnload(win: Window): Promise<void> {
    const binding = this.windowBindings.get(win);
    if (binding)
      binding.closed = true;
    this.windowBindings.delete(win);
    const shortcuts = this.shortcutCleanups.get(win);
    const toolbar = this.toolbars.get(win);
    this.shortcutCleanups.delete(win);
    this.toolbars.delete(win);
    await cleanupResources([
      () => shortcuts?.(),
      () => toolbar?.clean(),
      () => unregisterMainWindowLocale(win),
    ], error => logger.error("Window cleanup failed:", error));
  }

  public async stop(): Promise<void> {
    this.active = false;
    this.earlyStarted = false;
    this.infoRowsStarted = false;
    const mainWindows = typeof Zotero !== "undefined" ? (Zotero.getMainWindows?.() ?? []) : [];
    const windows = [
      ...new Set([
        ...this.windowBindings.keys(),
        ...this.shortcutCleanups.keys(),
        ...this.toolbars.keys(),
        ...mainWindows,
      ]),
    ];
    await cleanupResources([
      closeJournalShareDialogs,
      unregisterPrefsWindows,
      closeCoreFeedback,
      closeCompletionNotices,
      closeAllDialogs,
      unregisterMenu,
      unregisterActionsPane,
      unregisterInfoRows,
      () => {
        if (typeof ztoolkit !== "undefined")
          ztoolkit?.unregisterAll?.();
      },
      () => Promise.all(windows.map(win => this.onMainWindowUnload(win))),
      unloadLocale,
      () => {
        this.portDisposer?.();
        this.portDisposer = undefined;
      },
    ], error => logger.error("Workspace UI cleanup failed:", error));
  }

  public prepareWindowLocale(win: Window): void {
    registerMainWindowLocale(win);
    this.preLocalizedWindows.add(win);
  }

  public markWindowLocaleRegistered(win: Window): void {
    this.preLocalizedWindows.add(win);
  }

  private initializeMainWindow(win: Window, localeRegistered: boolean): void {
    if (!this.active || !isAddonAlive())
      return;
    const alreadyLocalized = localeRegistered || this.preLocalizedWindows.delete(win);
    if (!alreadyLocalized)
      registerMainWindowLocale(win);
    this.shortcutCleanups.get(win)?.();
    this.shortcutCleanups.set(win, registerShortcuts(win));
    this.toolbars.get(win)?.clean();
    const toolbar = new RichTextToolBar(win);
    toolbar.init();
    this.toolbars.set(win, toolbar);
    placeTLDRBeforeExtra(win.document);
  }
}
