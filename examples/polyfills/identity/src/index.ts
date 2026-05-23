export { DIDCredential, registerGraphDIDWriter } from './credential.js';
export type { DIDCredentialKind, DelegateAddOptions, GraphDIDWriter } from './credential.js';
export { IdentityManager } from './identity-manager.js';
export type { CredentialFilter } from './identity-manager.js';
export { DIDIdentityProvider } from './provider.js';
export {
  publicKeyToDID,
  didToPublicKey,
  resolveDIDKey,
  encodeEd25519Multibase,
  decodeEd25519Multibase,
  base58btcEncode,
  base58btcDecode,
} from './did-key.js';
export type { DIDDocument, DIDDocumentMethod, DIDDocumentTrustLevel } from './did-key.js';
export {
  publicKeyToGraphDID,
  graphDIDToPublicKey,
  isGraphDID,
  isKeyDID,
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
export {
  resolve,
  registerGraphSource,
  registerResolver,
  supportedMethods,
} from './resolver.js';
export type { AsyncResolver } from './resolver.js';
export {
  signData,
  verifySignedContent,
  computeSigningPayload,
  ed25519,
} from './signing.js';
export type { SignedContent, ContentProof, SignatureSection } from './signing.js';
export {
  storeCredential,
  loadCredential,
  loadAllCredentials,
  deleteCredential,
  unlockPrivateKey,
  exportEncrypted,
  importEncrypted,
} from './keystore.js';
export type { StoredCredential } from './keystore.js';
export { install } from './polyfill.js';
