export { GraphGovernanceEngine } from './engine.js';
export { GOV, CONTEXT, DID_DOC } from './predicates.js';
export { resolveAncestry, collectConstraints, applyPrecedence } from './scope.js';
export { verifyCapability } from './capability.js';
export { verifyCredential } from './credential.js';
export { verifyTemporal } from './temporal.js';
export { verifyContent } from './content.js';
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
export type { GovernanceOptions } from './integration.js';
export type {
  GraphConstraint,
  ValidationResult,
  CapabilityInfo,
  ZCAPDocument,
  CapabilityProof,
  Caveat,
  CaveatType,
  EnforcementMode,
  VerifiableCredential,
  TripleInput,
  ValidationContext,
  TripleRecord,
  ConstraintHandler,
  ConstraintKind,
  ValidationHistoryEntry,
} from './types.js';
