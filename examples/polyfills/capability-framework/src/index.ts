export { GraphGovernanceEngine } from './engine.js';
export { GOV, CONTEXT, DID_DOC } from './predicates.js';
export { resolveAncestry, collectConstraints, applyPrecedence } from './scope.js';
export { verifyCapability } from './capability.js';
export { evaluateCaveats, resetCaveatCounters } from './caveats.js';
export {
  createCapability,
  delegateCapability,
  revokeCapability,
  issueDefaultCapabilities,
} from './zcap.js';
export type { CreateCapabilityOptions, RevocationTriple } from './zcap.js';
export { ConstraintKindRegistry } from './registry.js';
export { createGovernanceLayer } from './integration.js';
export type { GovernanceOptions, GovernanceLayer } from './integration.js';
export type {
  GraphConstraint,
  GovernanceValidationResult,
  CapabilityInfo,
  ZCAPDocument,
  CapabilityProof,
  Caveat,
  CaveatType,
  EnforcementMode,
  TripleInput,
  ValidationContext,
  TripleRecord,
  ConstraintHandler,
  ConstraintKind,
  ValidationHistoryEntry,
} from './types.js';
