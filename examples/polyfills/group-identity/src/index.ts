export { Group } from './group.js';
export { DefaultGroupRegistry, installGroupExtension } from './extension.js';
export { GROUP, CONTEXT, RDF, VOTE, POLYFILL_DEFAULT_SYNC_MODULE } from './types.js';
export type { Participant, GroupOptions, GroupRegistry } from './types.js';

// did:graph method primitives ([[GROUP-IDENTITY]] §4 + §5)
export {
  publicKeyToGraphDID,
  graphDIDToPublicKey,
  isGraphDID,
  resolveDIDGraph,
  seedDIDDocumentTriples,
  addMethodTriples,
  removeMethodTriples,
  DID_DOC_PREDICATES,
} from './did-graph.js';
export type {
  GraphTriple,
  GraphTripleSource,
  DIDCapabilitySection,
} from './did-graph.js';

// DIDCredential augmentation + credential factory
export {
  createGraphCredential,
  installCredentialAugmentation,
  publicKeyFromDid,
  registerGraphDIDWriter,
  type DelegateAddOptions,
  type GraphDIDWriter,
} from './credential.js';

// Binding installer + groupify operation + fork operation
export {
  installDIDGraphBinding,
  groupifyContext,
  forkContext,
  type GroupifyOptions,
  type GroupifyResult,
  type ForkOptions,
  type ForkResult,
} from './binding.js';
