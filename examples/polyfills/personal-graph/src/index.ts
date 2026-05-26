export { Triple, isValidURI } from './types.js';
export type {
  Reifier,
  SignedTriple,
  TripleQuery,
  SparqlResult,
  SparqlQueryOptions,
  LiteralValue,
  MountMode,
  MountOptions,
  MountedContextInfo,
  ContextSubscriptionState,
  ContextCreationOptions,
} from './types.js';

export { Context, TripleEvent } from './context.js';
export type { TriplePattern } from './context.js';
export {
  GraphStore,
  ContextQueryBuilder,
  ContextLifecycleEvent,
  credentialAsProvider,
  newUuid,
} from './graph-store.js';
export { GraphStoreManager } from './manager.js';
export { GraphStorage } from './storage.js';
export type { ContextRecord, GraphStoreRecord } from './storage.js';

export {
  signTripleWithReifier,
  verifyReifier,
  reifierToSigned,
  canonicalNQuad,
  computeSignaturePayload,
  EphemeralIdentity,
} from './signing.js';
export type { IdentityProvider } from './signing.js';

export {
  getAsSnapshot,
  parseSnapshot,
  computeContentHash,
  tripleFrom,
} from './snapshot.js';
export type {
  GraphSnapshot,
  SnapshotProof,
  SnapshotFormat,
  GetAsSnapshotOptions,
  GraphSignBy,
  ParsedSnapshot,
} from './snapshot.js';

export { runSparql } from './sparql.js';
export {
  registerContextMethodBinding,
  getContextMethodBinding,
  requireContextMethodBinding,
  type ContextMethodBinding,
  type GraphSeedTriple,
  type DIDCapabilitySection,
} from './method-binding.js';
export { install, getManager } from './polyfill.js';
