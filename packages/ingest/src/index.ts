export {
  makeIdentifier,
  dedupeIdentifiers,
  isValidContainerNumber,
  normaliseBl,
  normaliseAwb,
  normaliseInvoice,
  normaliseContainer,
  normalisePo,
} from './normalise.js';
export type { Identifier, IdentifierKind } from './normalise.js';
export { scoreMatches, IDENTIFIER_WEIGHTS, MATCH_THRESHOLD } from './match.js';
export { normaliseHsCode, hsPrefixes, hsLookupKeys, hsMatchesPrefix } from './hs.js';
export {
  analyseScrutiny,
  ScrutinySchema,
  nameRequirement,
  RequirementNameSchema,
  suggestRequestMatches,
  RequestMatchSchema,
  draftFinalNotice,
  FinalNoticeSchema,
} from './scrutiny.js';
export type {
  ScrutinyAnalysis,
  ScrutinyInput,
  ScrutinyDocument,
  ScrutinyRequirement,
  RequirementName,
  RequestMatches,
  FinalNotice,
} from './scrutiny.js';
export type { MatchOutcome, CandidateIdentifier } from './match.js';
export { triageDocument, TRIAGE_DOC_TYPES, TRADE_DOCUMENT_TYPES, TriageSchema } from './triage.js';
export type { Triage, TriageResult, DocumentType } from './triage.js';
export { processMessage } from './process.js';
export type {
  IncomingMessage,
  IncomingAttachment,
  ProcessResult,
  ProcessOutcome,
} from './process.js';
