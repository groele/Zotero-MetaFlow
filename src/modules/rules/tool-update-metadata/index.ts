import type { MetadataContext, TransformedData } from "./services/base-service";
import { getString } from "../../../utils/locale";
import { getPref } from "../../../utils/prefs";
import { isFieldValidForItemType } from "../../../utils/zotero";
import { isPlaceholderCreator } from "../../review/policy";
import { discoverSnapshotIdentifiers, isSnapshotItem, revivalExtra } from "../../review/snapshot-reviver";
import { defineRule } from "../rule-base";
import { extractIdentifiers, isPreprint } from "./identifiers";
import { resolveMissingISSN } from "./issn-resolver";
import { mergeMetadata, metadataIdentity, metadataMissing, metadataValuesEqual, normalizeDOI, sanitizeWebTitle, titlesAgree } from "./policy";
import { services } from "./services";
import { backfillItemTLDR } from "./tldr";

interface UpdateMetadataOption {
  mode: "blank" | "all";
  allowTypeChanged: boolean;
  repairCreators?: boolean;
  creatorsOnly?: boolean;
  tldrEnabled?: boolean;
  tldrTarget?: "note" | "extra" | "both" | "abstract";
  tldrExtraFormat?: "remark" | "tldr";
  reviveSnapshots?: boolean;
  // lint: boolean;
}

export const ToolUpdateMetadata = defineRule<UpdateMetadataOption>({
  id: "tool-update-metadata",
  scope: "item",
  targetItemTypes: ["journalArticle", "preprint", "conferencePaper", "webpage", "blogPost"],
  category: "tool",
  cooldown: 0,
  async apply({ item, options, report, debug, signal }) {
    const original = item.toJSON() as TransformedData;
    // 1. extract identifiers
    const identifiers = extractIdentifiers(item);
    if (options.reviveSnapshots && isSnapshotItem(item) && !identifiers.DOI && !identifiers.arXiv && !identifiers.PMID && !identifiers.PMCID) {
      const snapshotCandidates = await discoverSnapshotIdentifiers(item, signal);
      for (const candidate of snapshotCandidates) {
        if (candidate.kind === "DOI" && !identifiers.DOI)
          identifiers.DOI = candidate.value;
        else if (candidate.kind === "arXiv" && !identifiers.arXiv)
          identifiers.arXiv = candidate.value;
        else if (candidate.kind === "PMID" && !identifiers.PMID)
          identifiers.PMID = candidate.value;
        else if (candidate.kind === "PMCID" && !identifiers.PMCID)
          identifiers.PMCID = candidate.value;
      }
    }
    const initialIdentifiers = { ...identifiers };
    const originalDOI = normalizeDOI(identifiers.DOI);
    const allowRelatedDOI = isPreprint(item, identifiers);
    debug("Identifiers: ", identifiers);
    if (Object.entries(identifiers).length === 0 && !String(item.getField("title") || "").trim() && !String(item.getField("publicationTitle") || "").trim()) {
      report({
        level: "error",
        message: getString("rule-tool-update-metadata-no-identifiers"),
      });
      return;
    }

    function createServiceContext(service: typeof services[number]): MetadataContext {
      return {
        item,
        identifiers,
        isPreprint: isPreprint(item, identifiers),
        debug: (msg: string) => debug(`[${service.id}] ${msg}`),
        signal,
      };
    }

    let errorMessage: string = "";

    // 2. get available metadata services
    const isAvailable = (service: typeof services[number]): boolean => {
      try {
        return (!service.supportedItemTypes || service.supportedItemTypes.includes(item.itemType)) && service.shouldApply(createServiceContext(service));
      }
      catch (error) {
        signal?.throwIfAborted();
        const message = error instanceof Error ? error.message : String(error);
        debug(`Failed to check ${service.name}: ${message}`);
        errorMessage += `${service.name}: ${message}\n`;
        return false;
      }
    };
    const availableServices = services.filter(isAvailable);
    debug(`Available services: ${availableServices.map(s => s.id).join(", ")}`);

    // 3. update identidiers
    for (const service of availableServices) {
      signal?.throwIfAborted();
      if (!service.updateIdentifiers)
        continue;

      const status = await service.updateIdentifiers?.(createServiceContext(service))
        .catch((error) => {
          signal?.throwIfAborted();
          const message = error instanceof Error ? error.message : String(error);
          debug(`Failed to update identifiers via ${service.name}: ${message}`);
          errorMessage += `${service.name}: ${message}\n`;
        });

      // To save resources, we expect that once a service has obtained a general identifier,
      // it will not attempt further operations.
      // This can prevent some items that could have been updated via DOI service from being
      // forced to use a rate-limited semantic scholar service.
      // When the number of services increases further, we may be able to change this logic.
      if (status) {
        if (originalDOI && !allowRelatedDOI && normalizeDOI(identifiers.DOI) !== originalDOI) {
          identifiers.DOI = originalDOI;
          delete identifiers.SemanticScholarID;
          report({ level: "warning", message: getString("rule-tool-update-metadata-identity-conflict", { args: { service: service.name } }) });
        }
        debug(`Identifiers updated via service ${service.name}: ${JSON.stringify(identifiers, null, 2)}`);
        break;
      }
    }

    // 3. request metadata and clean data
    let data: TransformedData | null = null;
    const isAuthor = (creator: NonNullable<TransformedData["creators"]>[number]) => !isPlaceholderCreator(creator) && ("creatorType" in creator
      ? creator.creatorType === "author"
      : creator.creatorTypeID === Zotero.CreatorTypes.getID("author"));
    const hasAuthors = (creators?: TransformedData["creators"]) => Boolean(creators?.some(isAuthor));
    const sources = new Map<string, string>();
    const successfulServices = new Set<string>();
    const expectedType = (result: TransformedData) => options.mode === "all" && options.allowTypeChanged && result.itemType
      && Zotero.ItemTypes.getID(result.itemType)
      ? result.itemType
      : item.itemType;
    for (const service of services.filter(isAvailable)) {
      signal?.throwIfAborted();
      if (!service.fetch)
        continue;

      debug(`Service ${service.name} processing...`);

      try {
        const res = await service.fetch(createServiceContext(service));
        signal?.throwIfAborted();
        if (!res) {
          debug(`Service ${service.name} failed: no response`);
          continue;
        }
        const transformedData = normalizeMetadata(service.transform?.(res));
        if (transformedData) {
          const identity = metadataIdentity(original, identifiers, transformedData, service.lookup);
          if (!identity) {
            report({ level: "warning", message: getString("rule-tool-update-metadata-identity-conflict", { args: { service: service.name } }) });
            continue;
          }
          // An echoed identifier alone is not a metadata update.
          if (!Object.entries(transformedData).some(([field, value]) => !["DOI", "itemType", "libraryCatalog"].includes(field) && (Array.isArray(value) ? value.length > 0 : Boolean(value))))
            continue;
          const merged = mergeMetadata(data ?? {}, transformedData);
          if (options.repairCreators && !hasAuthors(data?.creators) && hasAuthors(transformedData.creators)) {
            merged.creators = transformedData.creators;
            sources.set("creators", service.name);
          }
          for (const field of Object.keys(merged)) {
            if (!sources.has(field) && (field === "creators" ? merged.creators?.length : merged[field as keyof TransformedData]))
              sources.set(field, service.name);
          }
          data = merged;
          successfulServices.add(service.name);
          const missing = options.creatorsOnly ? !hasAuthors(data.creators) : metadataMissing(data, original, options.mode, expectedType(data)).length || (options.repairCreators && !hasAuthors(data.creators));
          if (!missing)
            break;
        }
      }
      catch (error) {
        signal?.throwIfAborted();
        const message = error instanceof Error ? error.message : String(error);
        debug(`Service ${service.name} failed: ${message}`);
        errorMessage += `${service.name}: ${message}\n`;
      }
    }

    // Resolve independently of article metadata; merge before the shared edit guards.
    if (!options.creatorsOnly && isFieldValidForItemType("ISSN", item.itemType)
      && !String(original.ISSN || "").trim() && !String(data?.ISSN || "").trim()) {
      const resolved = await resolveMissingISSN({
        doi: originalDOI,
        publicationTitle: String(original.publicationTitle || data?.publicationTitle || ""),
        signal,
        debug,
      });
      signal?.throwIfAborted();
      if (resolved) {
        data = { ...data, ISSN: resolved.issn };
        sources.set("ISSN", resolved.source);
        successfulServices.add(resolved.source);
      }
    }

    if (!data) {
      if (options.tldrEnabled && !options.creatorsOnly) {
        const tldrSuccess = await backfillItemTLDR(item, identifiers, {
          target: options.tldrTarget,
          extraFormat: options.tldrExtraFormat,
          report,
          debug,
          signal,
        });
        if (tldrSuccess)
          return;
      }
      report({
        level: "error",
        message: getString("rule-tool-update-metadata-no-data", { args: { errors: errorMessage } }),
      });
      return;
    }
    else if (errorMessage) {
      report({
        level: "warning",
        message: getString("rule-tool-update-metadata-service-warning", { args: { service: [...successfulServices].join(", "), errors: errorMessage } }),
      });
    }

    debug("Clean data: ", data);
    const missing = options.creatorsOnly ? data.creators?.length ? [] : ["creators"] : metadataMissing(data, original, options.mode, expectedType(data));
    if (options.repairCreators && !hasAuthors(data.creators) && !missing.includes("creators"))
      missing.push("creators");
    if (missing.length)
      report({ level: "warning", message: getString("rule-tool-update-metadata-incomplete", { args: { fields: missing.join(", ") } }) });

    const unchanged = (field: string, value: unknown) => {
      if (metadataValuesEqual(field, (original as Record<string, unknown>)[field], value))
        return true;
      report({ level: "warning", message: getString("rule-tool-update-metadata-edited", { args: { field } }) });
      return false;
    };

    const currentIdentifiers = extractIdentifiers(item);
    const changedIdentifiers = [...new Set([...Object.keys(initialIdentifiers), ...Object.keys(currentIdentifiers)])]
      .filter(key => initialIdentifiers[key as keyof typeof initialIdentifiers] !== currentIdentifiers[key as keyof typeof currentIdentifiers]);
    if (changedIdentifiers.length) {
      report({ level: "warning", message: getString("rule-tool-update-metadata-edited", { args: { field: changedIdentifiers.join(", ") } }) });
      return;
    }

    // 4. apply field changes
    function applyItemType(data: TransformedData) {
      if (!data.itemType) {
        debug("Service did not provide itemType");
        return;
      }

      const newItemTypeID = Zotero.ItemTypes.getID(data.itemType);
      if (!newItemTypeID || data.itemType === item.itemType) {
        debug("Item type is not changed.");
        return;
      }

      if (data.DOI?.match(/arxiv/gi)) {
        debug("DOI has 'arxiv', skip to change itemType.");
        return;
      }

      const isRevivingSnapshot = Boolean(options.reviveSnapshots && isSnapshotItem(item));
      if (!options.allowTypeChanged && !isRevivingSnapshot) {
        debug("User disable to change itemType");
        return;
      }
      if (!unchanged("itemType", item.itemType))
        return;

      // Blank mode must not perform a destructive type migration, except for
      // verified snapshot revival upgrading webpage to a scholarly publication.
      if (options.mode === "blank" && !isRevivingSnapshot) {
        report({ level: "warning", message: getString("rule-tool-update-metadata-type-change-loss") });
        return;
      }

      const incompatible = Object.entries(item.toJSON()).filter(([field, value]) => typeof value === "string" && value
        && Zotero.ItemFields.getID(field) && !isFieldValidForItemType(field as _ZoteroTypes.Item.ItemField, newItemTypeID));
      if (incompatible.length) {
        report({ level: "warning", message: getString("rule-tool-update-metadata-type-fields-preserved", { args: { fields: incompatible.map(([field]) => field).join(", ") } }) });
        return;
      }
      if (item.getCreators().some(creator => !Zotero.CreatorTypes.isValidForItemType(creator.creatorTypeID, newItemTypeID))) {
        report({ level: "warning", message: getString("rule-tool-update-metadata-type-roles-preserved") });
        return;
      }

      const prevType = item.itemType;
      debug(`Update ItemType from ${prevType} to ${data.itemType}`);
      item.setType(newItemTypeID);
      if (isRevivingSnapshot) {
        const extra = revivalExtra(item, { original, candidate: data, identifier: { kind: "DOI", value: data.DOI || "", source: "" }, source: "", conflicts: [], blocked: false, changes: [], itemID: item.id }, data.itemType as _ZoteroTypes.Item.ItemType);
        item.setField("extra", extra);
        report({
          level: "info",
          code: "metadata-snapshot-revived",
          message: getString("review-snapshot-revived", { args: { from: prevType, to: data.itemType } }),
        });
      }
    }

    function applyItemCreators(data: TransformedData) {
      if (options.repairCreators === false)
        return;
      if (!data.creators?.length) {
        debug("Service doesn't return creators");
        return;
      }
      if (!unchanged("creators", (item.toJSON() as TransformedData).creators))
        return;

      const hasRealCreators = item.getCreators().some(c => !isPlaceholderCreator(c));
      if (hasRealCreators && options.mode !== "all" && !options.repairCreators) {
        debug("Original item has creators, blank mode, skip to update creators.");
        return;
      }

      let creators = data.creators.filter((creator) => {
        const type = "creatorType" in creator ? Zotero.CreatorTypes.getID(creator.creatorType) : creator.creatorTypeID;
        return type && Zotero.CreatorTypes.isValidForItemType(type, item.itemTypeID);
      });
      if (creators.length !== data.creators.length) {
        report({ level: "warning", message: getString("rule-tool-update-metadata-invalid-creators") });
        return;
      }
      if (options.repairCreators && options.mode !== "all") {
        const authors = creators.filter(isAuthor);
        if (!authors.length)
          return;
        creators = [...authors, ...(original.creators || []).filter(creator => !isAuthor(creator) && !isPlaceholderCreator(creator))];
      }
      if (creators.length) {
        if (metadataValuesEqual("creators", (item.toJSON() as TransformedData).creators, creators))
          return;
        item.setCreators(creators);
        report({ level: "info", field: "creators", source: sources.get("creators"), message: getString("rule-tool-update-metadata-field-source", { args: { field: "creators", source: sources.get("creators") || "" } }) });
      }
    }

    function applyItemFields(data: Omit<TransformedData, "itemType" | "creators">) {
      for (const [field, value] of Object.entries(data)) {
        if (!isFieldValidForItemType(field as _ZoteroTypes.Item.ItemField, item.itemType))
          continue;

        let newFieldValue = "";
        const oldFieldValue = item.getField(field);

        if (options.mode !== "all" && !!String(oldFieldValue || "").trim()
          && !(field === "title" && sanitizeWebTitle(oldFieldValue) !== oldFieldValue && titlesAgree(oldFieldValue, String(value || "")))) {
          continue;
        }

        if (!unchanged(field, oldFieldValue))
          continue;

        switch (field) {
          case "accessDate":
            // https://github.com/northword/zotero-format-metadata/issues/239
            // https://forums.zotero.org/discussion/117940/zoteroobjectuploaderror#latest
            if (!Number.isFinite(new Date(value).getTime())) {
              report({ level: "warning", message: getString("rule-tool-update-metadata-invalid-date") });
              continue;
            }
            newFieldValue = Zotero.Date.dateToSQL(new Date(value), true);
            break;

          case "abstractNote":
            // https://github.com/northword/zotero-format-metadata/issues/404
            newFieldValue = Zotero.Utilities.trimInternal(data[field] || "");
            break;

          default:
            newFieldValue = value;
            break;
        }

        if (!newFieldValue || newFieldValue === oldFieldValue)
          continue;

        debug(`Update "${field}" from "${oldFieldValue}" to "${newFieldValue}"`);
        item.setField(field, newFieldValue);
        report({ level: "info", field, source: sources.get(field), message: getString("rule-tool-update-metadata-field-source", { args: { field, source: sources.get(field) || "" } }) });
      }
    }

    if (!options.creatorsOnly)
      applyItemType(data);
    applyItemCreators(data);
    const { itemType, creators, ...fields } = data;
    if (!options.creatorsOnly)
      applyItemFields(fields);

    if (options.tldrEnabled && !options.creatorsOnly) {
      await backfillItemTLDR(item, identifiers, {
        target: options.tldrTarget,
        extraFormat: options.tldrExtraFormat,
        report,
        debug,
        signal,
      });
    }

    // if (options.lint)
    //   addon.runner.add({ rules: "standard", items: item });
  },

  prepare() {
    return {
      mode: getPref("rule.tool-update-metadata.option.mode") === "all" ? "all" : "blank",
      allowTypeChanged: getPref("rule.tool-update-metadata.option.allow-type-changed"),
      repairCreators: getPref("metadata.repairCreators" as any, true) === true,
      tldrEnabled: getPref("workflow.tldrEnabled" as any, true) === true,
      tldrTarget: getPref("workflow.tldrTarget" as any, "note") as "note" | "extra" | "both" | "abstract",
      tldrExtraFormat: getPref("workflow.tldrExtraFormat" as any, "remark") as "remark" | "tldr",
      reviveSnapshots: getPref("workflow.reviveSnapshots" as any, true) === true,
    };
  },
});

export function normalizeMetadata(response: unknown): TransformedData | null {
  if (!response || typeof response !== "object" || Array.isArray(response))
    return null;
  const data: Record<string, any> = {};
  for (const [field, value] of Object.entries(response)) {
    if (field === "creators" && Array.isArray(value)) {
      const creators = value.filter(creator => creator && typeof creator === "object"
        && (typeof creator.lastName === "string" || typeof creator.name === "string")
        && ((typeof creator.lastName === "string" && creator.lastName.trim()) || (typeof creator.name === "string" && creator.name.trim()))
        && (creator.firstName === undefined || typeof creator.firstName === "string"));
      data.creators = creators;
    }
    else if (typeof value === "string" && value.trim()) {
      if (field === "DOI") {
        const doi = normalizeDOI(value);
        if (doi)
          data.DOI = doi;
      }
      else {
        data[field] = value;
      }
    }
  }
  if (!["title", "DOI", "publicationTitle", "proceedingsTitle", "date"].some(field => data[field]) && !data.creators?.length)
    return null;
  return data as TransformedData;
}
