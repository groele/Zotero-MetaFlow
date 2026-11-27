import type { BatchResult } from "./services/lint/runner";
import type { AutomaticWorkflow } from "./utils/automatic-workflow";
import type { CoreCommand, CoreStage } from "./utils/core-workflow";
import { config } from "../package.json";
import api from "./api";
import { AutomaticIngestBridge } from "./bridges/automatic-ingest-bridge";
import { ItemSyncBridge } from "./bridges/item-sync-bridge";
import { JournalInsightsDomainModule } from "./domains/journal-insights/module";
import { LintEngineDomainModule } from "./domains/lint-engine/module";
import { ReviewDuplicatesDomainModule } from "./domains/review-duplicates/module";
import { WorkspaceUiDomainModule } from "./domains/workspace-ui/module";
import hooks from "./hooks";
import { PluginKernel } from "./kernel/plugin-kernel";
import { LintRunner } from "./services/lint/runner";
import { ServiceContainer } from "./services/service-container";
import { DEFAULT_PREFS } from "./utils/prefs";
import { createZToolkit } from "./utils/ztoolkit";

export interface AddonRuntimeModules {
  workspaceUi: WorkspaceUiDomainModule;
  journalInsights: JournalInsightsDomainModule;
  reviewDuplicates: ReviewDuplicatesDomainModule;
  lintEngine: LintEngineDomainModule;
  itemSyncBridge: ItemSyncBridge;
  automaticIngestBridge: AutomaticIngestBridge;
}

class Addon {
  public data: {
    alive: boolean;
    config: typeof config;
    // Env type, see build.js
    env: "development" | "production";
    ztoolkit: ZToolkit;
    locale?: {
      current: any;
    };
    prefs?: {
      window: Window;
    };
    dialogs: Map<string, Window>;
    lastAutomaticWorkflow?: AutomaticWorkflow;
    lastCoreWorkflow?: { lastResult: BatchResult; stages: { stage: CoreStage; result: BatchResult }[] };
    activeCoreWorkflow?: { command: CoreCommand; stage?: CoreStage; index: number; total: number; cancelled: boolean; cancel: () => void };
  };

  public readonly kernel: PluginKernel;
  public readonly services: ServiceContainer;
  public readonly runtimeModules: AddonRuntimeModules;
  public runner: LintRunner;

  // Lifecycle hooks
  public hooks: typeof hooks;
  // APIs
  public api: typeof api;

  constructor() {
    this.data = {
      alive: true,
      config,
      env: __env__,
      ztoolkit: createZToolkit(),
      dialogs: new Map(),
    };
    this.kernel = new PluginKernel({
      prefPrefix: config.prefsPrefix,
      prefDefaults: DEFAULT_PREFS as Record<string, unknown>,
      onHostNotify: payload => this.hooks.onNotify(
        payload.event,
        payload.type,
        [...payload.ids],
        (payload.extraData ?? {}) as { [key: string]: unknown },
      ),
      onError: (scope, error) => Zotero.debug(`[MetaFlow kernel:${scope}] ${String(error)}`),
    });
    this.services = new ServiceContainer(this.kernel);

    const workspaceUi = new WorkspaceUiDomainModule(this.kernel);
    const journalInsights = new JournalInsightsDomainModule(this.kernel);
    const reviewDuplicates = new ReviewDuplicatesDomainModule(this.kernel);
    const lintEngine = new LintEngineDomainModule(this.kernel, this.services);
    const itemSyncBridge = new ItemSyncBridge(this.kernel);
    const automaticIngestBridge = new AutomaticIngestBridge(this.kernel);

    this.kernel.registerDomain(workspaceUi);
    this.kernel.registerDomain(journalInsights);
    this.kernel.registerDomain(reviewDuplicates);
    this.kernel.registerDomain(lintEngine);
    this.kernel.registerBridge(itemSyncBridge);
    this.kernel.registerBridge(automaticIngestBridge);

    workspaceUi.ensurePortRegistered();
    journalInsights.ensurePortRegistered();
    reviewDuplicates.ensurePortRegistered();
    lintEngine.ensurePortRegistered();

    this.runtimeModules = {
      workspaceUi,
      journalInsights,
      reviewDuplicates,
      lintEngine,
      itemSyncBridge,
      automaticIngestBridge,
    };
    this.hooks = hooks;
    this.api = api;
    this.runner = new LintRunner();
  }
}

export default Addon;
