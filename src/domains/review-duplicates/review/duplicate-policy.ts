import type { DuplicatePair, DuplicateRecord } from "./duplicate-matching";
import { normalizeArxiv } from "../../../services/metadata/review-policy";
import { normalizeDOI } from "../../../services/metadata/tool-update-metadata/policy";

export type MasterStrategy = "oldest" | "newest" | "modified" | "detailed";
export type DefaultDuplicateAction = "keep" | "discard" | "cancel" | "ask";

export function duplicateConcurrency(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 8 ? value : 3;
}

export function chooseMaster(records: DuplicateRecord[], strategy: MasterStrategy): DuplicateRecord {
  const date = (record: DuplicateRecord, field: string) => String((record.data as Record<string, unknown>)[field] || "");
  const score = (record: DuplicateRecord) => Object.entries(record.data).reduce((total, [field, value]) => total + (!["key", "version", "dateAdded", "dateModified", "itemType"].includes(field) && value ? Array.isArray(value) ? value.length : 1 : 0), 0);
  let master = records[0];
  let bestScore = strategy === "detailed" && master ? score(master) : 0;
  const field = strategy === "modified" ? "dateModified" : "dateAdded";
  for (let index = 1; index < records.length; index++) {
    const candidate = records[index];
    const candidateScore = strategy === "detailed" ? score(candidate) : 0;
    const order = strategy === "detailed"
      ? bestScore - candidateScore || candidate.id - master.id
      : (date(candidate, field).localeCompare(date(master, field)) || candidate.id - master.id) * (strategy === "oldest" ? 1 : -1);
    if (order < 0) {
      master = candidate;
      bestScore = candidateScore;
    }
  }
  return master;
}

export function canMergePair(pair: DuplicatePair, differentTypes = false): boolean {
  if (pair.mergeable)
    return true;
  if (!differentTypes)
    return false;
  const left = normalizeDOI(pair.left.data.DOI);
  const right = normalizeDOI(pair.right.data.DOI);
  const a = normalizeArxiv(pair.left.data.url || "") || normalizeArxiv(pair.left.data.DOI || "");
  const b = normalizeArxiv(pair.right.data.url || "") || normalizeArxiv(pair.right.data.DOI || "");
  return differentTypes && !!left && left === right && pair.left.preprint === pair.right.preprint && !(a && b && a !== b);
}

export function duplicateGroups(pairs: DuplicatePair[]): DuplicateRecord[][] {
  const records = new Map<number, DuplicateRecord>();
  const parents = new Map<number, number>();
  const sizes = new Map<number, number>();
  const root = (id: number): number => {
    let current = id;
    while (parents.get(current) !== current) {
      const parent = parents.get(current)!;
      parents.set(current, parents.get(parent)!);
      current = parents.get(current)!;
    }
    return current;
  };
  for (const pair of pairs) {
    for (const record of [pair.left, pair.right]) {
      records.set(record.id, record);
      if (!parents.has(record.id)) {
        parents.set(record.id, record.id);
        sizes.set(record.id, 1);
      }
    }
    let a = root(pair.left.id);
    let b = root(pair.right.id);
    if (a !== b) {
      if (sizes.get(a)! < sizes.get(b)!)
        [a, b] = [b, a];
      parents.set(b, a);
      sizes.set(a, sizes.get(a)! + sizes.get(b)!);
      sizes.delete(b);
    }
  }
  const groups = new Map<number, DuplicateRecord[]>();
  for (const record of records.values()) {
    const id = root(record.id);
    if (!groups.has(id))
      groups.set(id, []);
    groups.get(id)!.push(record);
  }
  return [...groups.values()];
}
