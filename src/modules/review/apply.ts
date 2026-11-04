import type { ApplyContext } from "../rules/rule-base";
import type { TransformedData } from "../rules/tool-update-metadata/services/base-service";
import type { MetadataDecision } from "./policy";
import { getString } from "../../utils/locale";
import { isFieldValidForItemType } from "../../utils/zotero";
import { normalizeDOI } from "../rules/tool-update-metadata/policy";
import { REVIEW_FIELDS } from "./policy";
import { revivalExtra } from "./snapshot-reviver";

export function selectionIssue(selection: MetadataDecision): string | undefined {
  const { proposal, action, fields, acknowledged } = selection;
  if (action === "skip")
    return getString("review-skipped");
  if (proposal.blocked)
    return getString("review-blocked");
  if (proposal.conflicts.length && !acknowledged)
    return getString("review-needs-acknowledgement");
  if (proposal.preprintURL && proposal.changes.some(change => ["DOI", "itemType"].includes(change.field) && !fields.has(change.field)))
    return getString("review-version-required");
  return undefined;
}

export function assertReviewFresh(item: Zotero.Item, original: TransformedData): void {
  const current = item.toJSON() as Record<string, unknown>;
  const expected = original as Record<string, unknown>;
  const fields = new Set([...Object.keys(expected), ...Object.keys(current)]);
  if (item.deleted || !item.isEditable() || [...fields].some(field => JSON.stringify(current[field] ?? "") !== JSON.stringify(expected[field] ?? "")))
    throw new Error(getString("review-stale"));
}

function preprintExtra(item: Zotero.Item, selection: MetadataDecision, type: _ZoteroTypes.Item.ItemType): string {
  const { proposal } = selection;
  let extra = String(item.getField("extra") || "");
  const add = (line: string) => {
    if (!extra.split(/\r?\n/).includes(line))
      extra += `${extra ? "\n" : ""}${line}`;
  };
  add(`MetaFlow preprint URL: ${proposal.preprintURL}`);
  add(`MetaFlow preprint identifier: ${proposal.identifier.value}`);
  if (proposal.original.DOI && normalizeDOI(proposal.original.DOI) !== normalizeDOI(proposal.candidate.DOI))
    add(`MetaFlow ${/^10\.48550\/arxiv\./i.test(normalizeDOI(proposal.original.DOI)) ? "preprint" : "previous"} DOI: ${proposal.original.DOI}`);
  for (const [field, value] of Object.entries(item.toJSON())) {
    if (typeof value === "string" && value && Zotero.ItemFields.getID(field) && !isFieldValidForItemType(field as _ZoteroTypes.Item.ItemField, type))
      add(`MetaFlow preprint ${field}: ${JSON.stringify(value)}`);
  }
  return extra;
}

export function applyReviewedMetadata(item: Zotero.Item, selection: MetadataDecision, report: ApplyContext["report"]): void {
  const issue = selectionIssue(selection);
  if (issue) {
    report({ level: "warning", message: issue });
    return;
  }
  if (selection.action === "related")
    return;
  assertReviewFresh(item, selection.proposal.original);
  const { proposal, fields } = selection;
  const targetType = fields.has("itemType") ? proposal.candidate.itemType! : item.itemType;
  const targetID = Zotero.ItemTypes.getID(targetType);
  if (!targetID)
    throw new Error(getString("review-invalid-type"));
  const candidateCreators = fields.has("creators") ? proposal.candidate.creators : undefined;
  const validCreators = (candidateCreators || item.getCreators()).every((creator) => {
    const type = "creatorType" in creator ? Zotero.CreatorTypes.getID(creator.creatorType) : creator.creatorTypeID;
    return !!type && Zotero.CreatorTypes.isValidForItemType(type, targetID);
  });
  if (!validCreators)
    throw new Error(getString("rule-tool-update-metadata-invalid-creators"));
  if (targetType !== item.itemType && !proposal.preprintURL && !proposal.revival)
    throw new Error(getString("review-invalid-type"));
  const extra = proposal.preprintURL
    ? preprintExtra(item, selection, targetType)
    : proposal.revival
      ? revivalExtra(item, proposal, targetType)
      : undefined;
  if (targetType !== item.itemType)
    item.setType(targetID);
  if (extra !== undefined)
    item.setField("extra", extra);
  for (const change of proposal.changes) {
    if (!fields.has(change.field) || change.field === "itemType")
      continue;
    if (change.field === "creators") {
      const existingNonAuthors = (item.getCreators() || []).filter((creator: any) => {
        const cType = "creatorType" in creator ? creator.creatorType : (typeof Zotero !== "undefined" && Zotero.CreatorTypes?.getName ? Zotero.CreatorTypes.getName(creator.creatorTypeID) : "author");
        return cType && cType !== "author";
      });
      const candidateHasNonAuthors = (proposal.candidate.creators || []).some((creator: any) => ("creatorType" in creator ? creator.creatorType : "author") !== "author");
      const mergedCreators = (!candidateHasNonAuthors && existingNonAuthors.length > 0)
        ? [...proposal.candidate.creators!, ...existingNonAuthors]
        : proposal.candidate.creators!;
      item.setCreators(mergedCreators);
    }
    else if (isFieldValidForItemType(change.field, item.itemType)) {
      item.setField(change.field, change.after as string);
    }
    else {
      continue;
    }
    report({ level: "info", code: "metadata-field-filled", field: change.field, source: proposal.source, message: getString("review-field-applied", { args: { field: change.field } }) });
  }
  if (proposal.revival) {
    report({
      level: "info",
      code: "metadata-snapshot-revived",
      source: proposal.source,
      message: getString("review-snapshot-revived", { args: { from: proposal.revival.from, to: targetType } }),
    });
  }
}

/** Reuse an existing published record when possible, without overwriting its metadata. */
export async function createRelatedVersion(item: Zotero.Item, selection: MetadataDecision, signal?: AbortSignal): Promise<Zotero.Item> {
  const issue = selectionIssue(selection);
  if (issue || selection.action !== "related")
    throw new Error(issue || getString("review-skipped"));
  assertReviewFresh(item, selection.proposal.original);
  if (item.hasChanged())
    throw new Error(getString("review-stale"));
  const doi = normalizeDOI(selection.proposal.candidate.DOI);
  if (!doi)
    throw new Error(getString("review-blocked"));
  const search = new Zotero.Search({ libraryID: item.libraryID });
  search.addCondition("DOI", "is", doi);
  const matches = (await Zotero.Items.getAsync(await search.search())).filter(candidate => candidate.id !== item.id && !candidate.deleted && candidate.isRegularItem() && ["journalArticle", "conferencePaper"].includes(candidate.itemType));
  if (matches.length > 1)
    throw new Error(getString("review-published-duplicates"));
  signal?.throwIfAborted();
  assertReviewFresh(item, selection.proposal.original);
  let published = matches[0];
  if (published && (!published.isEditable() || published.hasChanged()))
    throw new Error(getString("review-stale"));
  const existing = Boolean(published);
  const publishedOriginal = published ? JSON.parse(JSON.stringify(published.toJSON())) : undefined;
  if (!published) {
    published = new Zotero.Item(selection.proposal.candidate.itemType as "journalArticle" | "conferencePaper");
    published.libraryID = item.libraryID;
    for (const field of REVIEW_FIELDS) {
      const changed = selection.proposal.changes.some(change => change.field === field);
      const value = selection.proposal.excludedFields?.includes(field) || (changed && !selection.fields.has(field)) ? selection.proposal.original[field] : selection.proposal.candidate[field];
      if (field === "creators") {
        if (Array.isArray(value) && value.length)
          published.setCreators(value);
      }
      else if (typeof value === "string" && value && isFieldValidForItemType(field, published.itemType)) {
        published.setField(field, value);
      }
    }
    published.setField("DOI", doi);
    published.setCollections(item.getCollections());
  }
  let sourceMutated = false;
  let publishedMutated = false;
  try {
    await Zotero.DB.executeTransaction(async () => {
      signal?.throwIfAborted();
      assertReviewFresh(item, selection.proposal.original);
      if (existing)
        assertReviewFresh(published, publishedOriginal!);
      if (!existing)
        await published.save();
      signal?.throwIfAborted();
      assertReviewFresh(item, selection.proposal.original);
      sourceMutated = publishedMutated = true;
      item.addRelatedItem(published);
      published.addRelatedItem(item);
      await item.save();
      await published.save();
    });
  }
  catch (error) {
    if (sourceMutated)
      await item.reload(["primaryData", "relations"], true);
    if (existing && publishedMutated)
      await published.reload(["primaryData", "relations"], true);
    throw error;
  }
  return published;
}
