import type { DuplicateRecord } from "./duplicate-matching";
import { expect, it, vi } from "vitest";
import * as policy from "../../../services/metadata/review-policy";
import { duplicateMatchEvents, duplicatePairs } from "./duplicate-matching";
import { canMergePair, duplicateGroups } from "./duplicate-policy";

const record = (id: number, doi: string): DuplicateRecord => ({ id, libraryID: 1, preprint: false, data: { itemType: "journalArticle", DOI: doi } });

it("provides scheduling checkpoints during indexing and matching even when no duplicate exists", () => {
  const records = Array.from({ length: 1_000 }, (_, i) => record(i + 1, `10.1234/unique-${i}`));
  const events = [...duplicateMatchEvents(new Set(records.map(item => item.id)), records)];
  expect(events.filter(event => event.kind === "pair")).toHaveLength(0);
  expect(events.flatMap(event => event.kind === "checkpoint" && event.stage === "index" ? [event.processed] : [])).toEqual([250, 500, 750, 1_000]);
  expect(events.filter(event => event.kind === "checkpoint" && event.stage === "match")).toHaveLength(4);
});

it("streams each dense-bucket pair once with deterministic DOI precedence", () => {
  const records = Array.from({ length: 30 }, (_, i) => record(i + 1, "10.1234/dense"));
  const events = [...duplicateMatchEvents(new Set(records.map(item => item.id)), records)];
  const pairs = duplicatePairs(new Set(records.map(item => item.id)), records);
  expect(pairs).toHaveLength(30 * 29 / 2);
  expect(new Set(pairs.map(pair => [pair.left.id, pair.right.id].sort((a, b) => a - b).join(":"))).size).toBe(pairs.length);
  expect(pairs.every(pair => pair.reason === "doi" && pair.mergeable)).toBe(true);
  expect(events.some(event => event.kind === "checkpoint" && event.stage === "match")).toBe(true);
  expect(pairs[0]).toMatchObject({ left: { id: 1 }, right: { id: 2 } });
});

it("bounds dense internal candidates while retaining all members", () => {
  const records = Array.from({ length: 5_000 }, (_, i) => record(i + 1, "10.1234/dense"));
  const pairs = [...duplicateMatchEvents(new Set(records.map(item => item.id)), records, { compact: true })].flatMap(event => event.kind === "pair" ? [event.pair] : []);
  expect(pairs).toHaveLength(4_999);
  expect(duplicateGroups(pairs)[0]).toHaveLength(5_000);
});

it("preserves candidate and merge components across exclusions, versions and selection subsets", () => {
  let seed = 173;
  const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const groups = (pairs: ReturnType<typeof duplicatePairs>) => duplicateGroups(pairs).map(group => group.map(item => item.id).sort((a, b) => a - b).join(":")).sort();
  for (let trial = 0; trial < 150; trial++) {
    const records = Array.from({ length: 25 }, (_, i) => ({ ...record(i + 1, random() < 0.2 ? "" : `10.1234/group-${Math.floor(random() * 3)}`), preprint: random() < 0.3, data: { itemType: random() < 0.2 ? "conferencePaper" : "journalArticle", DOI: random() < 0.2 ? "" : `10.1234/group-${Math.floor(random() * 3)}`, title: "Shared sufficiently long title", date: "2025", creators: [{ creatorType: "author", lastName: "Fixture" }], url: random() < 0.3 ? `https://arxiv.org/abs/2501.12345v${Math.floor(random() * 3) + 1}` : "" } } as DuplicateRecord));
    const selected = new Set(records.filter(() => random() < 0.5).map(item => item.id));
    const excluded = new Set<string>();
    const key = (a: number, b: number) => [a, b].sort((a, b) => a - b).join(":");
    for (const a of records) {
      for (const b of records) {
        if (random() < 0.04)
          excluded.add(key(a.id, b.id));
      }
    }
    const accept = (pair: ReturnType<typeof duplicatePairs>[number]) => !excluded.has(key(pair.left.id, pair.right.id));
    const differentTypes = trial % 2 === 0;
    const merge = (pair: ReturnType<typeof duplicatePairs>[number]) => canMergePair(pair, differentTypes);
    const full = duplicatePairs(selected, records).filter(accept);
    const compact = [...duplicateMatchEvents(selected, records, { compact: true, accept, merge })].flatMap(event => event.kind === "pair" ? [event.pair] : []);
    expect(groups(compact)).toEqual(groups(full));
    expect(groups(compact.filter(merge))).toEqual(groups(full.filter(merge)));
    expect(compact.every(pair => accept(pair) && (selected.has(pair.left.id) || selected.has(pair.right.id)))).toBe(true);
  }
});

it("pre-filters non-selected title candidates by normalized title and year before invoking firstCreator in large libraries", () => {
  const spy = vi.spyOn(policy, "firstCreator");
  const records: DuplicateRecord[] = [
    {
      id: 1,
      libraryID: 1,
      preprint: false,
      data: { itemType: "journalArticle", title: "Target Paper With Sufficiently Long Title", date: "2026", creators: [{ creatorType: "author", lastName: "Zhang" }] },
    },
    {
      id: 2,
      libraryID: 1,
      preprint: false,
      data: { itemType: "journalArticle", title: "Target Paper With Sufficiently Long Title", date: "2026", creators: [{ creatorType: "author", lastName: "Zhang" }] },
    },
    ...Array.from({ length: 100 }, (_, i) => ({
      id: i + 3,
      libraryID: 1,
      preprint: false,
      data: { itemType: "journalArticle" as const, title: `Unrelated Paper Title Number ${i + 3} In Library`, date: "2026", creators: [{ creatorType: "author" as const, lastName: "Author" }] },
    })),
  ];
  const pairs = duplicatePairs(new Set([1]), records);
  expect(pairs).toHaveLength(1);
  expect(pairs[0]).toMatchObject({ left: { id: 1 }, right: { id: 2 }, reason: "title" });
  expect(spy).toHaveBeenCalledTimes(2);
  spy.mockRestore();
});
