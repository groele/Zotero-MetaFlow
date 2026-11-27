import type { Rule } from "../../../services/lint/rule-base";
import { registerRuleCatalog, Rules } from "../../../services/lint/rule-registry";
import { ToolUpdateEasyScholar } from "../../../services/metadata/easyscholar-rule";
import { CorrectConferenceAbbr, RequireJournalAbbr } from "../../../services/metadata/journal-abbr-rule";
import { ToolReviewDuplicates, ToolReviewMetadata, ToolReviewPreprint } from "../../../services/metadata/review-rules";
import { ToolUpdateMetadata } from "../../../services/metadata/tool-update-metadata";
import { CorrectAbstractFormat } from "./correct-abstract-format";
import { CorrectAttachmentRoles } from "./correct-attachment-roles";
import { CorrectCreatorsCase } from "./correct-creators-case";
import { CorrectCreatorsPinyin } from "./correct-creators-pinyin";
import { CorrectDateFormat, CorrectFilingDateFormat, CorrectIssueDateFormat, CorrectPriorityDateFormat } from "./correct-date-format";
import { CorrectDOILong } from "./correct-doi-long";
import { CorrectEditionNumeral, CorrectVolumeNumeral } from "./correct-edition-numeral";
import { CorrectExtraOrder } from "./correct-extra-order";
import { CorrectPagesConnector } from "./correct-pages-connector";
import { CorrectPagesRange } from "./correct-pages-range";
import { CorrectPublicationTitleAlias } from "./correct-publication-title-alias";
import { CorrectPublicationTitleCase } from "./correct-publication-title-case";
import { CorrectCreatorsPunctuation, CorrectTitlePunctuation } from "./correct-punctuation";
import { CorrectThesisType } from "./correct-thesis-type";
import { CorrectTitleChemicalFormula } from "./correct-title-chemical-formula";
import { CorrectBookTitleSentenceCase, CorrectProceedingsTitleSentenceCase, CorrectShortTitleSentenceCase, CorrectTitleSentenceCase } from "./correct-title-sentence-case";
import { CorrectUniversityPunctuation } from "./correct-university-punctuation";
import { NoArticleWebPage } from "./no-article-webpage";
import { NoDOIPrefix } from "./no-doi-prefix";
import { NoIssueExtraZeros, NoPagesExtraZeros, NoVolumeExtraZeros } from "./no-extra-zeros";
import { NoFieldMisuse } from "./no-field-misuse";
import { NoItemDuplication } from "./no-item-duplication";
import { NoJournalPreprint } from "./no-journal-preprint";
import { NoTitleTrailingDot } from "./no-title-trailing-dot";
import { NoValueNullish } from "./no-value-nullish";
import { RequireCreators } from "./require-creators";
import { RequireDOI } from "./require-doi";
import { RequireLanguage } from "./require-language";
import { RequireShortTitle } from "./require-short-title";
import { RequireUniversityPlace } from "./require-university-place";
import { ToolCleanExtra } from "./tool-clean-extra";
import { ToolCreatorsExt } from "./tool-creators-ext";
import { ToolCSLHelper } from "./tool-csl-extra-helper";
import { ToolGetShortDOI } from "./tool-get-short-doi";
import { ToolClearAllExtra, ToolCreatorsStyle, ToolCreatorsSwap, ToolPublicationReplace, ToolTitleReplace } from "./tool-library-maintenance";
import { ToolQueryESI } from "./tool-query-esi";
import { ToolQueryNatureIndex } from "./tool-query-nature-index";
import { ToolSetLanguage } from "./tool-set-language";
import { ToolTitleGuillemet } from "./tool-title-guillemet";

const register: Rule<any>[] = [
  // Item rules first
  NoItemDuplication,
  NoArticleWebPage,
  NoJournalPreprint,
  NoValueNullish,
  NoFieldMisuse,
  CorrectAttachmentRoles,

  // Language
  RequireLanguage,

  // Title
  NoTitleTrailingDot,
  CorrectTitlePunctuation,
  CorrectTitleSentenceCase,
  CorrectTitleChemicalFormula,
  RequireShortTitle,
  CorrectShortTitleSentenceCase,

  // Creators
  RequireCreators,
  CorrectCreatorsPunctuation,
  CorrectCreatorsCase,
  CorrectCreatorsPinyin,

  // Other general fields
  CorrectAbstractFormat,
  CorrectDateFormat,
  CorrectExtraOrder,

  // Identifiers
  RequireDOI,
  NoDOIPrefix,
  CorrectDOILong,

  // Article specific fields
  CorrectPublicationTitleAlias,
  CorrectPublicationTitleCase,
  RequireJournalAbbr,
  CorrectPagesConnector,
  CorrectPagesRange,
  NoIssueExtraZeros,
  NoPagesExtraZeros,
  NoVolumeExtraZeros,

  // Conference specific fields
  CorrectConferenceAbbr,
  CorrectProceedingsTitleSentenceCase,

  // Thesis specific fields
  CorrectThesisType,
  CorrectUniversityPunctuation,
  RequireUniversityPlace,

  // Book
  CorrectEditionNumeral,
  CorrectVolumeNumeral,
  CorrectBookTitleSentenceCase,

  // Patent
  CorrectFilingDateFormat,
  CorrectIssueDateFormat,
  CorrectPriorityDateFormat,

  // Tools
  ToolQueryESI,
  ToolTitleGuillemet,
  ToolCreatorsExt,
  ToolSetLanguage,
  ToolUpdateMetadata,
  ToolReviewMetadata,
  ToolReviewPreprint,
  ToolReviewDuplicates,
  ToolGetShortDOI,
  ToolQueryNatureIndex,
  ToolUpdateEasyScholar,
  ToolCSLHelper,
  ToolCleanExtra,
  ToolCreatorsStyle,
  ToolCreatorsSwap,
  ToolTitleReplace,
  ToolPublicationReplace,
  ToolClearAllExtra,
];

registerRuleCatalog(register);

export { Rules };
