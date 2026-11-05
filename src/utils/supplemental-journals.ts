import type { EasyScholarField, EasyScholarRank } from "./easyscholar";
import njauCoreData from "../../data/njau-core-2010.json";
import { requestHTTP } from "./http";
import { runJournalSource } from "./journal-source";

export function getNjauCore(title: string): string | undefined {
  if (njauCoreData.classOne.includes(title.trim()))
    return "一类核心";
  if (njauCoreData.classTwo.includes(title.trim()))
    return "二类核心";
}

interface SupplementalResult { data: Partial<EasyScholarRank>; errors: string[] }
const cache = new Map<string, { expires: number; result: SupplementalResult }>();
let generation = 0;

export function clearSupplementalJournalCache() {
  generation++;
  cache.clear();
}

export async function fetchSupplementalJournalRank(title: string, fields: ReadonlySet<EasyScholarField>, signal?: AbortSignal): Promise<SupplementalResult> {
  const njauQuality = fields.has("njauQuality");
  const key = JSON.stringify([title, njauQuality, fields.has("njauCore")]);
  signal?.throwIfAborted();
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now())
    return cached.result;
  const token = generation;
  const result: SupplementalResult = { data: fields.has("njauCore") ? { njauCore: getNjauCore(title) } : {}, errors: [] };
  const tasks: { source: string; run: (sourceSignal: AbortSignal) => Promise<Partial<EasyScholarRank>> }[] = [];
  if (njauQuality) {
    tasks.push({ source: "NJAU 2024", async run(sourceSignal) {
      const response = await requestHTTP("POST", "http://phq.njau.edu.cn/admin_getJournal2024.action", { timeout: 7000, body: new URLSearchParams({ keyword: title }).toString(), headers: { "Content-Type": "application/x-www-form-urlencoded" } }, sourceSignal);
      const data = JSON.parse(response.responseText || "{}") as { classname?: unknown };
      return { njauQuality: typeof data.classname === "string" && data.classname.trim() ? data.classname.trim() : undefined };
    } });
  }
  const settled = await Promise.allSettled(tasks.map(task => runJournalSource(task.run, signal, 9000)));
  signal?.throwIfAborted();
  settled.forEach((response, index) => {
    if (response.status === "fulfilled")
      Object.assign(result.data, response.value);
    else
      result.errors.push(`${tasks[index].source}: ${String(response.reason)}`);
  });
  if (!result.errors.length && token === generation) {
    if (cache.size >= 128)
      cache.delete(cache.keys().next().value!);
    cache.set(key, { expires: Date.now() + 600_000, result });
  }
  return result;
}
