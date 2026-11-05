import type { TransformedData } from "./services/base-service";
import { getString } from "../../../utils/locale";
import { isFieldValidForItemType } from "../../../utils/zotero";
import { isSnapshotItem, revivalExtra } from "../../review/snapshot-reviver";
import { isPlaceholderCreator, metadataValuesEqual, normalizeDOI, sanitizeWebTitle, titlesAgree } from "./policy";

export interface UpdateMetadataApplyOptions {
  mode: "blank" | "all";
  allowTypeChanged: boolean;
  repairCreators?: boolean;
  creatorsOnly?: boolean;
  reviveSnapshots?: boolean;
}

export function isAuthor(creator: NonNullable<TransformedData["creators"]>[number]): boolean {
  return !isPlaceholderCreator(creator) && ("creatorType" in creator
    ? creator.creatorType === "author"
    : creator.creatorTypeID === Zotero.CreatorTypes.getID("author"));
}

export function hasAuthors(creators?: TransformedData["creators"]): boolean {
  return Boolean(creators?.some(isAuthor));
}

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
    else if (typeof value === "number" && Number.isFinite(value)) {
      data[field] = String(value);
    }
    else if (typeof value === "string" && value.trim()) {
      if (field === "DOI") {
        const doi = normalizeDOI(value);
        if (doi)
          data.DOI = doi;
      }
      else {
        data[field] = value.trim();
      }
    }
  }
  if (!["title", "DOI", "publicationTitle", "proceedingsTitle", "date"].some(field => data[field]) && !data.creators?.length)
    return null;
  return data as TransformedData;
}

export function applyItemType(
  item: Zotero.Item,
  data: TransformedData,
  options: UpdateMetadataApplyOptions,
  original: TransformedData,
  unchanged: (field: string, value: unknown) => boolean,
  report: (info: any) => void,
  debug: (msg: string) => void,
) {
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

export function applyItemCreators(
  item: Zotero.Item,
  data: TransformedData,
  options: UpdateMetadataApplyOptions,
  original: TransformedData,
  sources: Map<string, string>,
  unchanged: (field: string, value: unknown) => boolean,
  report: (info: any) => void,
  debug: (msg: string) => void,
) {
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

export function applyItemFields(
  item: Zotero.Item,
  data: Omit<TransformedData, "itemType" | "creators">,
  options: UpdateMetadataApplyOptions,
  sources: Map<string, string>,
  unchanged: (field: string, value: unknown) => boolean,
  report: (info: any) => void,
  debug: (msg: string) => void,
) {
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
        if (!Number.isFinite(new Date(value).getTime())) {
          report({ level: "warning", message: getString("rule-tool-update-metadata-invalid-date") });
          continue;
        }
        newFieldValue = Zotero.Date.dateToSQL(new Date(value), true);
        break;

      case "abstractNote":
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
