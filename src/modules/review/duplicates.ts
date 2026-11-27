import type { TransformedData } from "../rules/tool-update-metadata/services/base-service";
import type { DuplicatePair, DuplicateRecord } from "./duplicate-matching";
import type { MasterStrategy } from "./duplicate-policy";
import { getString } from "../../utils/locale";
import { getPref } from "../../utils/prefs";
import { isFieldValidForItemType } from "../../utils/zotero";
import { extractIdentifiers, isPreprint } from "../rules/tool-update-metadata/identifiers";
import { assertReviewFresh } from "./apply";
import { cell, displayValue, fieldLabel } from "./dialog";
import { duplicateMatchEvents, duplicatePairs } from "./duplicate-matching";
import { canMergePair, chooseMaster } from "./duplicate-policy";
import { isNonDuplicate, markNonDuplicate, transferNonDuplicates } from "./non-duplicates";
import { useReviewPanel } from "./panel";
import { REVIEW_FIELDS } from "./policy";

export interface DuplicateDecision {
  pair: DuplicatePair;
  action: "skip" | "merge" | "relate" | "notDuplicate";
  masterID: number;
  donors: Map<string, number>;
}

export function duplicateRecord(item: Zotero.Item): DuplicateRecord {
  return { id: item.id, libraryID: item.libraryID, data: item.toJSON() as TransformedData, preprint: isPreprint(item, extractIdentifiers(item)) };
}

export async function findDuplicates(items: Zotero.Item[], signal?: AbortSignal, compact = false): Promise<DuplicatePair[]> {
  const records: DuplicateRecord[] = [];
  for (const libraryID of new Set(items.map(item => item.libraryID))) {
    signal?.throwIfAborted();
    const library = await Zotero.Items.getAll(libraryID, true, false);
    for (let index = 0; index < library.length; index++) {
      const item = library[index];
      if (item.isRegularItem() && !item.deleted) {
        const creator = item.getCreators()[0];
        let isPrep: boolean | undefined;
        records.push({
          id: item.id,
          libraryID: item.libraryID,
          get preprint() {
            if (isPrep === undefined)
              isPrep = isPreprint(item, extractIdentifiers(item));
            return isPrep;
          },
          data: { itemType: item.itemType, DOI: String(item.getField("DOI") || ""), title: String(item.getField("title") || ""), date: String(item.getField("date") || ""), url: String(item.getField("url") || ""), creators: creator ? [{ creatorType: "author", ...creator.fieldMode === 1 ? { name: creator.lastName } : { lastName: creator.lastName, firstName: creator.firstName } }] : [] },
        });
      }
      if (index % 250 === 0) {
        await Zotero.Promise.delay(0);
        signal?.throwIfAborted();
      }
    }
  }
  const snapshots = new Map<number, DuplicateRecord>();
  const snapshot = (id: number) => {
    const item = Zotero.Items.get(id);
    if (!item || item.deleted || !item.isRegularItem())
      return;
    if (!snapshots.has(id))
      snapshots.set(id, duplicateRecord(item));
    return snapshots.get(id);
  };
  signal?.throwIfAborted();
  const pairs: DuplicatePair[] = [];
  const accept = (pair: DuplicatePair) => {
    const left = Zotero.Items.get(pair.left.id);
    const right = Zotero.Items.get(pair.right.id);
    return !!left && !!right && !left.deleted && !right.deleted && !isNonDuplicate(left, right);
  };
  const differentTypes = getPref("duplicates.mergeDifferentTypes" as any, false) === true;
  for (const event of duplicateMatchEvents(new Set(items.map(item => item.id)), records, { compact, accept, merge: pair => canMergePair(pair, differentTypes) })) {
    if (event.kind === "checkpoint") {
      await Zotero.Promise.delay(0);
      signal?.throwIfAborted();
      continue;
    }
    const pair = event.pair;
    if (!accept(pair))
      continue;
    const left = snapshot(pair.left.id);
    const right = snapshot(pair.right.id);
    if (left && right) {
      const current = duplicatePairs(new Set([left.id]), [left, right])[0];
      if (current)
        pairs.push(current);
    }
  }
  signal?.throwIfAborted();
  return pairs;
}

export async function reviewDuplicate(pair: DuplicatePair, signal?: AbortSignal): Promise<DuplicateDecision | false> {
  const mergeable = canMergePair(pair, getPref("duplicates.mergeDifferentTypes" as any, false) === true);
  const master = chooseMaster([pair.left, pair.right], getPref("duplicates.masterStrategy" as any, "oldest") as MasterStrategy);
  const decision: DuplicateDecision = { pair, action: "skip", masterID: master.id, donors: new Map() };
  let accepted = false;
  const { dialog, openAndWaitClose } = useReviewPanel(signal);
  const details = (record: DuplicateRecord) => {
    const item = Zotero.Items.get(record.id);
    if (!item)
      throw new Error(getString("review-stale"));
    return `${record.id} · ${record.data.title || ""}\n${getString("review-item-summary", { args: { attachments: item.getAttachments().length, notes: item.getNotes().length, tags: item.getTags().length, collections: item.getCollections().length } })}`;
  };
  dialog.addCell(0, 0, {
    tag: "div",
    properties: { id: "metaref-duplicate-review" },
    styles: { width: "100%", fontSize: "14px" },
    children: [
      { tag: "p", properties: { textContent: getString(`review-duplicate-${pair.reason}`) } },
      { tag: "p", properties: { textContent: getString(mergeable ? "review-merge-note" : "review-relate-note") } },
      { tag: "label", children: [
        { tag: "span", properties: { textContent: getString("review-action") } },
        { tag: "select", properties: { id: "metaref-duplicate-action", onchange: (event: Event) => { decision.action = (event.target as HTMLSelectElement).value as DuplicateDecision["action"]; } }, children: [
          { tag: "option", properties: { value: "skip", textContent: getString("review-skip") } },
          { tag: "option", properties: { value: "relate", textContent: getString("review-relate") } },
          { tag: "option", properties: { value: "notDuplicate", textContent: getString("duplicates-mark-not") } },
          ...mergeable ? [{ tag: "option", properties: { value: "merge", textContent: getString("review-merge") } }] : [],
        ] },
      ] },
      { tag: "label", children: [
        { tag: "span", properties: { textContent: getString("review-master") } },
        { tag: "select", properties: { id: "metaref-duplicate-master", onchange: (event: Event) => { decision.masterID = Number((event.target as HTMLSelectElement).value); } }, children: [pair.left, pair.right].map(record => ({ tag: "option", properties: { value: String(record.id), selected: record.id === master.id, textContent: `${record.id} · ${record.data.title || ""}` } })) },
      ] },
      { tag: "table", styles: { width: "100%", tableLayout: "fixed", borderCollapse: "collapse" }, children: [
        { tag: "thead", children: [{ tag: "tr", children: [cell(getString("review-field"), true), cell(details(pair.left), true), cell(details(pair.right), true), cell(getString("review-adopt"), true)] }] },
        { tag: "tbody", children: ["itemType", ...REVIEW_FIELDS, "extra"].filter(field => pair.left.data[field as keyof typeof pair.left.data] || pair.right.data[field as keyof typeof pair.right.data]).map((field) => {
          const left = pair.left.data[field as keyof typeof pair.left.data];
          const right = pair.right.data[field as keyof typeof pair.right.data];
          const different = JSON.stringify(left ?? "") !== JSON.stringify(right ?? "");
          return { tag: "tr", children: [cell(fieldLabel(field)), cell(displayValue(left)), cell(displayValue(right)), {
            tag: "td",
            children: mergeable && field !== "itemType" && different
              ? [{ tag: "select", attributes: { "aria-label": fieldLabel(field) }, properties: { className: "metaref-duplicate-field", value: "0", onchange: (event: Event) => {
                  const donor = Number((event.target as HTMLSelectElement).value);
                  if (donor)
                    decision.donors.set(field, donor);
                  else
                    decision.donors.delete(field);
                } }, children: [
                  { tag: "option", properties: { value: "0", textContent: getString("review-keep-master") } },
                  ...[pair.left, pair.right].map(record => ({ tag: "option", properties: { value: String(record.id), textContent: String(record.id) } })),
                ] }]
              : [],
          }] };
        }) },
      ] },
    ],
  });
  dialog.addButton(getString("review-apply"), "metaref-duplicate-apply", { callback: () => {
    accepted = true;
  } });
  dialog.addButton(getString("review-cancel"), "metaref-review-cancel");
  await openAndWaitClose(getString("rule-tool-review-duplicates"));
  signal?.throwIfAborted();
  return accepted ? decision : false;
}

export async function applyDuplicateDecision(decision: DuplicateDecision, signal?: AbortSignal): Promise<"merged" | "related" | "skipped" | "excluded"> {
  if (decision.action === "skip")
    return "skipped";
  signal?.throwIfAborted();
  const { pair } = decision;
  const left = Zotero.Items.get(pair.left.id);
  const right = Zotero.Items.get(pair.right.id);
  if (!left || !right || left.libraryID !== right.libraryID || left.hasChanged() || right.hasChanged())
    throw new Error(getString("review-stale"));
  assertReviewFresh(left, pair.left.data);
  assertReviewFresh(right, pair.right.data);
  if (decision.action === "notDuplicate") {
    markNonDuplicate(left, right);
    return "excluded";
  }
  if (decision.action === "merge") {
    const current = duplicatePairs(new Set([left.id]), [duplicateRecord(left), duplicateRecord(right)])[0];
    if (!current || !canMergePair(current, getPref("duplicates.mergeDifferentTypes" as any, false) === true) || isNonDuplicate(left, right) || ![left.id, right.id].includes(decision.masterID))
      throw new Error(getString("review-relate-note"));
  }
  const master = decision.masterID === right.id ? right : left;
  const other = master === left ? right : left;
  // Include children in failure recovery; the host merge owns their movement and key remapping.
  const children = decision.action === "merge" ? await Zotero.Items.getAsync([...left.getAttachments(true), ...right.getAttachments(true), ...left.getNotes(true), ...right.getNotes(true)]) : [];
  if (children.some(item => item.hasChanged()))
    throw new Error(getString("review-stale"));
  signal?.throwIfAborted();
  assertReviewFresh(left, pair.left.data);
  assertReviewFresh(right, pair.right.data);
  const relatedMutations = new Set<Zotero.Item>();
  try {
    if (decision.action === "relate") {
      await Zotero.DB.executeTransaction(async () => {
        signal?.throwIfAborted();
        assertReviewFresh(left, pair.left.data);
        assertReviewFresh(right, pair.right.data);
        relatedMutations.add(left);
        left.addRelatedItem(right);
        await left.save();
        signal?.throwIfAborted();
        assertReviewFresh(right, pair.right.data);
        relatedMutations.add(right);
        right.addRelatedItem(left);
        await right.save();
      });
    }
    else {
      if (left.itemType !== right.itemType) {
        const types = [left.itemType, right.itemType].filter(type => [left, right].every(item => item.getCreators().every(creator => Zotero.CreatorTypes.isValidForItemType(creator.creatorTypeID, Number(Zotero.ItemTypes.getID(type))))));
        const loss = (type: typeof left.itemType) => [left, right].reduce((total, item) => total + Object.entries(item.toJSON()).filter(([field, value]) => typeof value === "string" && value && Zotero.ItemFields.getID(field) && !isFieldValidForItemType(field as any, type)).length, 0);
        const target = types.sort((a, b) => loss(a) - loss(b))[0];
        if (!target)
          throw new Error(getString("rule-tool-update-metadata-invalid-creators"));
        let preserved = String(master.getField("extra") || "");
        for (const item of [left, right]) {
          for (const [field, value] of Object.entries(item.toJSON())) {
            if (typeof value === "string" && value && Zotero.ItemFields.getID(field) && !isFieldValidForItemType(field as any, target))
              preserved += `\nMetaFlow preserved ${item.key} ${field}: ${JSON.stringify(value)}`;
          }
          item.setType(Number(Zotero.ItemTypes.getID(target)));
        }
        master.setField("extra", preserved.trim());
      }
      for (const [field, value] of Object.entries(other.toJSON())) {
        if (field !== "extra" && typeof value === "string" && value && Zotero.ItemFields.getID(field) && isFieldValidForItemType(field as any, master.itemType) && !master.getField(field))
          master.setField(field, value);
      }
      if (!master.getCreators().length && other.getCreators().length)
        master.setCreators(other.getCreators());
      if (!decision.donors.has("extra")) {
        const lines = [master.getField("extra"), other.getField("extra")].flatMap(value => String(value || "").split(/\r?\n/)).filter(Boolean);
        master.setField("extra", [...new Set(lines)].join("\n"));
      }
      for (const [field, donorID] of decision.donors) {
        if (![...REVIEW_FIELDS, "extra"].includes(field as any) || ![left.id, right.id].includes(donorID))
          throw new Error(getString("review-blocked"));
        const donor = donorID === left.id ? pair.left.data : pair.right.data;
        if (field === "creators")
          master.setCreators(donor.creators || []);
        else if (isFieldValidForItemType(field as any, master.itemType))
          master.setField(field, donor[field as keyof typeof donor] as string || "");
      }
      // The native merge opens its own transaction; wrapping it queues a transaction against itself.
      await Zotero.Items.merge(master, [other]);
      transferNonDuplicates(master, other);
    }
  }
  catch (error) {
    if (decision.action === "relate") {
      for (const item of relatedMutations)
        await item.reload(["primaryData", "relations"], true);
    }
    else {
      for (const item of [left, right, ...children])
        await item.reload(["primaryData", "itemData", "creators", "relations", "tags", "collections", "childItems"], true);
    }
    throw error;
  }
  return decision.action === "merge" ? "merged" : "related";
}
