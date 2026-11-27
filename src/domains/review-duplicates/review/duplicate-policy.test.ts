import type { DuplicateRecord } from "./duplicate-matching";
import { expect, it } from "vitest";
import { canMergePair, chooseMaster, duplicateConcurrency, duplicateGroups } from "./duplicate-policy";

const record = (id: number, added: string, modified = added, more = false): DuplicateRecord => ({ id, libraryID: 1, preprint: false, data: { itemType: "journalArticle", title: "Shared reference", DOI: "10.1234/a", ...{ dateAdded: added, dateModified: modified }, ...more ? { volume: "10", pages: "1-5" } : {} } });

it("implements each retained-item strategy with stable ties", () => {
  const a = record(1, "2020", "2025");
  const b = record(2, "2021", "2022", true);
  expect(chooseMaster([a, b], "oldest").id).toBe(1);
  expect(chooseMaster([a, b], "newest").id).toBe(2);
  expect(chooseMaster([a, b], "modified").id).toBe(1);
  expect(chooseMaster([a, b], "detailed").id).toBe(2);
  expect(chooseMaster([record(2, "2020"), a], "oldest").id).toBe(1);
});

it("keeps concurrent duplicate groups disjoint", () => {
  const [a, b, c, d, e] = [1, 2, 3, 4, 5].map(id => record(id, "2020"));
  const pair = (left: DuplicateRecord, right: DuplicateRecord) => ({ left, right, reason: "doi" as const, mergeable: true });
  expect(duplicateGroups([pair(a, b), pair(b, c), pair(a, c), pair(d, e)]).map(group => group.map(item => item.id))).toEqual([[1, 2, 3], [4, 5]]);
  expect([0, 1, 3, 8, 9, 1.5, "3"].map(duplicateConcurrency)).toEqual([3, 1, 3, 8, 3, 3, 3]);
});

it("permits cross-type merging only with explicit configuration and the same DOI/version", () => {
  const left = record(1, "2020");
  const right = record(2, "2021");
  right.data.itemType = "conferencePaper";
  const pair = { left, right, reason: "doi" as const, mergeable: false };
  expect(canMergePair(pair)).toBe(false);
  expect(canMergePair(pair, true)).toBe(true);
  right.data.DOI = "10.1234/b";
  expect(canMergePair(pair, true)).toBe(false);
  right.data.DOI = left.data.DOI;
  right.preprint = true;
  expect(canMergePair(pair, true)).toBe(false);
});

it("traverses a high-fanout duplicate group without spreading its neighbors into function arguments", () => {
  const master = record(1, "2020");
  const pairs = Array.from({ length: 130_000 }, (_, index) => ({ left: master, right: record(index + 2, "2020"), reason: "doi" as const, mergeable: true }));
  const groups = duplicateGroups(pairs);
  expect(groups).toHaveLength(1);
  expect(groups[0]).toHaveLength(130_001);
  expect(new Set(groups[0].map(item => item.id)).size).toBe(130_001);
});
