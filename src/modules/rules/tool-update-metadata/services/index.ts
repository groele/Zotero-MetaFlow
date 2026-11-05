import type { MetadataService } from "./base-service";
import { ArxivService } from "./arxiv-service";
import { CrossrefService } from "./crossref-service";
import { SemanticScholarService } from "./semantic-scholar-service";
import { IdentifiersTranslateService, ItemTranslateService, URLTranslateService } from "./translate-service";

export { CrossrefService } from "./crossref-service";

export const services: MetadataService<any>[] = [
  // Keep preprint service first
  ArxivService,

  // Primary authoritative DOI service
  CrossrefService,

  // Fallback to Zotero's translate service
  IdentifiersTranslateService,
  ItemTranslateService,

  // Then, Semantic Scholar
  SemanticScholarService,

  // Finally, URL translate service
  URLTranslateService,
];
