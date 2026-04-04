export { DIDCredential } from './credential.js';
export { IdentityManager } from './identity-manager.js';
export { DIDIdentityProvider } from './provider.js';
export { publicKeyToDID, didToPublicKey, resolveDIDKey, base58btcEncode, base58btcDecode, type DIDDocument } from './did-key.js';
export { signData, verifySignedContent, computeSigningPayload, type SignedContent, type ContentProof } from './signing.js';
export {
  storeCredential, loadCredential, loadAllCredentials, deleteCredential,
  unlockPrivateKey, exportEncrypted, importEncrypted,
} from './keystore.js';
export { install } from './polyfill.js';
