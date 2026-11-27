import type { MetadataService } from "./base-service";
import { getPref } from "../../../../utils/prefs";
import { ArxivService } from "./arxiv-service";
import { CrossrefService } from "./crossref-service";
import { OpenAlexService } from "./openalex-service";
import { SemanticScholarService } from "./semantic-scholar-service";
import { IdentifiersTranslateService, ItemTranslateService, URLTranslateService } from "./translate-service";

export { CrossrefService } from "./crossref-service";
export { OpenAlexService, transformOpenAlexWork } from "./openalex-service";

export const services: MetadataService<any>[] = [
  // Keep preprint service first
  ArxivService,

  // Zotero native search translator & authoritative DOI services
  IdentifiersTranslateService,
  CrossrefService,
  ItemTranslateService,
  OpenAlexService,

  // Semantic Scholar (promoted dynamically when API key is configured)
  SemanticScholarService,

  // Finally, URL translate service
  URLTranslateService,
];

const BUILTIN_SERVICE_IDS = new Set([
  ArxivService.id,
  IdentifiersTranslateService.id,
  CrossrefService.id,
  ItemTranslateService.id,
  OpenAlexService.id,
  SemanticScholarService.id,
  URLTranslateService.id,
]);

export function hasConfiguredSemanticScholarAPI(): boolean {
  try {
    return Boolean(String(getPref("semanticScholarToken") || "").trim());
  }
  catch {
    return false;
  }
}

export function getOrderedMetadataServices(allServices: MetadataService<any>[] = services): MetadataService<any>[] {
  if (!allServices.length || !allServices.some(service => BUILTIN_SERVICE_IDS.has(service.id)))
    return [...allServices];

  const byId = new Map(allServices.map(service => [service.id, service]));
  const orderedIds = hasConfiguredSemanticScholarAPI()
    ? [
        ArxivService.id,
        SemanticScholarService.id,
        CrossrefService.id,
        IdentifiersTranslateService.id,
        ItemTranslateService.id,
        OpenAlexService.id,
        URLTranslateService.id,
      ]
    : [
        ArxivService.id,
        IdentifiersTranslateService.id,
        CrossrefService.id,
        ItemTranslateService.id,
        OpenAlexService.id,
        URLTranslateService.id,
        SemanticScholarService.id,
      ];

  const ordered: MetadataService<any>[] = [];
  const seen = new Set<string>();
  for (const id of orderedIds) {
    const found = byId.get(id);
    if (found) {
      ordered.push(found);
      seen.add(id);
    }
  }
  for (const service of allServices) {
    if (!seen.has(service.id))
      ordered.push(service);
  }
  return ordered;
}
