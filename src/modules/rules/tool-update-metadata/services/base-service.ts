import type { ApplyContext, Rule } from "../../rule-base";
import type { Identifiers } from "../identifiers";
import { abortableDelay } from "../../../../utils/rule-execution";

type MetadataResponse = Record<string, any>;

export type TransformedData = {
  itemType?: _ZoteroTypes.Item.ItemType;
  creators?: (_ZoteroTypes.Item.Creator | _ZoteroTypes.Item.CreatorJSON)[];
} & {
  [field in _ZoteroTypes.Item.ItemField]?: string
};

export interface MetadataContext {
  item: Zotero.Item;
  identifiers: Identifiers;
  isPreprint: boolean;
  // options: UpdateMetadataOptions;
  debug: ApplyContext["debug"];
  signal?: AbortSignal;
}

export interface MetadataService<T extends MetadataResponse> {
  id: string;
  name: string;
  /** How this adapter binds a response to the requested work. Contradictory DOIs are still rejected. */
  lookup?: "identifier" | "url";
  supportedItemTypes?: string[];
  /** @see {@link Rule.cooldown}   */
  cooldown: number;
  /**
   * Determines whether this service should be applied to the current item.
   * Returns `true` if this service is relevant for the item.
   */
  shouldApply: (ctx: MetadataContext) => boolean;
  /**
   * Optionally update or enrich the item's identifiers before fetching metadata.
   * For example, using an arXiv ID to retrieve and store the corresponding DOI.
   *
   * Return true if the identifier is successfully modified, otherwise return false.
   */
  updateIdentifiers?: (ctx: MetadataContext) => Promise<boolean>;
  /**
   * Fetch metadata from an external API.
   * Returns a format-specific raw response, or `null`/`undefined` if no data is available.
   */
  fetch?: (ctx: MetadataContext) => Promise<T | null | undefined>;
  /**
   * Transforms the fetched metadata into a Zotero-compatible data structure.
   * Returned data should contain only fields acceptable by Zotero's item API.
   */
  transform?: (response: T) => TransformedData;
}

export function defineService<T extends MetadataResponse>(service: MetadataService<T>) {
  let slots: Promise<void> = Promise.resolve();
  let lastStart = Number.NEGATIVE_INFINITY;
  const run = <Result>(fn: (ctx: MetadataContext) => Promise<Result>, ctx: MetadataContext) => {
    const slot = slots.then(async () => {
      ctx.signal?.throwIfAborted();
      const wait = Math.max(0, lastStart + service.cooldown - Date.now());
      if (wait)
        await abortableDelay(wait, ctx.signal);
      lastStart = Date.now();
    });
    slots = slot.catch(() => {});
    return slot.then(() => {
      ctx.signal?.throwIfAborted();
      return fn(ctx);
    });
  };
  const guard = <Result>(fn?: (ctx: MetadataContext) => Promise<Result>) => fn && ((ctx: MetadataContext) => run(fn, ctx));
  service.fetch = guard(service.fetch);
  service.updateIdentifiers = guard(service.updateIdentifiers);
  return service;
}
