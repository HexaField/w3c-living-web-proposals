/**
 * did:graph method — graph identity with DID-document delegates.
 *
 * The DID identifier is single-key (the same multibase Ed25519 encoding as did:key).
 * Shared signing authority lives in the DID document's capability sections, NOT
 * in the identifier. No multisig, no threshold cryptography.
 *
 * The DID document for a did:graph DID is composed from triples stored INSIDE the
 * graph it identifies. This module exposes a resolver interface that takes a
 * triple source as input; @living-web/personal-graph registers itself as that
 * source.
 */

import {
  decodeEd25519Multibase,
  encodeEd25519Multibase,
  type DIDDocument,
  type DIDDocumentMethod,
  type DIDDocumentTrustLevel,
} from './did-key.js';

export function publicKeyToGraphDID(publicKey: Uint8Array): string {
  return `did:graph:${encodeEd25519Multibase(publicKey)}`;
}

export function graphDIDToPublicKey(did: string): Uint8Array {
  if (!did.startsWith('did:graph:')) throw new Error('Invalid did:graph URI');
  return decodeEd25519Multibase(did.slice('did:graph:'.length));
}

export function isGraphDID(did: string): boolean {
  return typeof did === 'string' && did.startsWith('did:graph:');
}

export function isKeyDID(did: string): boolean {
  return typeof did === 'string' && did.startsWith('did:key:');
}

/** Predicates the resolver reads from a graph's context. */
export const DID_DOC_PREDICATES = {
  type: 'did://verificationMethod/type',
  controller: 'did://verificationMethod/controller',
  publicKeyMultibase: 'did://verificationMethod/publicKeyMultibase',
  hasMethod: 'did://hasMethod',
  capabilityInvocation: 'did://capabilityInvocation',
  capabilityDelegation: 'did://capabilityDelegation',
  assertionMethod: 'did://assertionMethod',
  authentication: 'did://authentication',
  deactivated: 'did://deactivated',
} as const;

export interface GraphTriple {
  source: string;
  predicate: string;
  target: string;
}

/** Source of triples for resolving a did:graph DID. Provided by personal-graph. */
export interface GraphTripleSource {
  /** Return all triples in the graph identified by `graphDid`. */
  readGraph(graphDid: string): Iterable<GraphTriple>;
}

/**
 * Resolve a did:graph by reading the graph's locally-mounted triples.
 *
 * If the graph is not locally available, callers should first mount a snapshot
 * into the local store (handled by personal-graph's mountSnapshot()).
 */
export function resolveDIDGraph(
  did: string,
  source: GraphTripleSource,
  trustLevel: DIDDocumentTrustLevel = 'local',
): DIDDocument {
  if (!isGraphDID(did)) throw new Error('Invalid did:graph URI');
  // Verify the embedded key decodes (throws on invalid)
  graphDIDToPublicKey(did);

  const methodProps = new Map<string, Partial<DIDDocumentMethod>>();
  const capabilityInvocation = new Set<string>();
  const capabilityDelegation = new Set<string>();
  const assertionMethod = new Set<string>();
  const authentication = new Set<string>();
  let deactivated = false;

  for (const { source: s, predicate: p, target: t } of source.readGraph(did)) {
    if (s === did) {
      switch (p) {
        case DID_DOC_PREDICATES.hasMethod:
          methodProps.set(t, methodProps.get(t) ?? { id: t, controller: did });
          break;
        case DID_DOC_PREDICATES.capabilityInvocation:
          capabilityInvocation.add(t);
          break;
        case DID_DOC_PREDICATES.capabilityDelegation:
          capabilityDelegation.add(t);
          break;
        case DID_DOC_PREDICATES.assertionMethod:
          assertionMethod.add(t);
          break;
        case DID_DOC_PREDICATES.authentication:
          authentication.add(t);
          break;
        case DID_DOC_PREDICATES.deactivated:
          deactivated = stripLiteral(t) === 'true';
          break;
      }
    } else if (p === DID_DOC_PREDICATES.type) {
      const m = methodProps.get(s) ?? { id: s, controller: did };
      m.type = stripLiteral(t);
      methodProps.set(s, m);
    } else if (p === DID_DOC_PREDICATES.controller) {
      const m = methodProps.get(s) ?? { id: s, controller: did };
      m.controller = t;
      methodProps.set(s, m);
    } else if (p === DID_DOC_PREDICATES.publicKeyMultibase) {
      const m = methodProps.get(s) ?? { id: s, controller: did };
      m.publicKeyMultibase = stripLiteral(t);
      methodProps.set(s, m);
    }
  }

  const verificationMethod: DIDDocumentMethod[] = [];
  for (const m of methodProps.values()) {
    if (m.id && m.type && m.publicKeyMultibase) {
      verificationMethod.push({
        id: m.id,
        type: m.type,
        controller: m.controller ?? did,
        publicKeyMultibase: m.publicKeyMultibase,
      });
    }
  }

  // If the graph has no DID-document triples yet (freshly minted), seed with the
  // identifier-derived "creator" method — the key that minted the DID.
  if (verificationMethod.length === 0) {
    const identifier = did.slice('did:graph:'.length);
    const seedId = `${did}#${identifier}`;
    verificationMethod.push({
      id: seedId,
      type: 'Ed25519VerificationKey2020',
      controller: did,
      publicKeyMultibase: identifier,
    });
    capabilityInvocation.add(seedId);
    capabilityDelegation.add(seedId);
    assertionMethod.add(seedId);
    authentication.add(seedId);
  }

  const doc: DIDDocument = {
    '@context': [
      'https://www.w3.org/ns/did/v1',
      'https://w3id.org/security/suites/ed25519-2020/v1',
    ],
    id: did,
    verificationMethod,
    authentication: [...authentication],
    assertionMethod: [...assertionMethod],
    capabilityInvocation: [...capabilityInvocation],
    capabilityDelegation: [...capabilityDelegation],
    trustLevel,
  };

  if (deactivated) {
    (doc as DIDDocument & { deactivated: boolean }).deactivated = true;
  }

  return doc;
}

function stripLiteral(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Produce the seed triples that should be written into a freshly created context.
 * The caller (the personal-graph polyfill's createContext) writes these as the
 * first triples in the new context.
 */
export function seedDIDDocumentTriples(graphDid: string): GraphTriple[] {
  const identifier = graphDid.slice('did:graph:'.length);
  const methodId = `${graphDid}#${identifier}`;
  return [
    { source: graphDid, predicate: DID_DOC_PREDICATES.hasMethod, target: methodId },
    { source: methodId, predicate: DID_DOC_PREDICATES.type, target: '"Ed25519VerificationKey2020"' },
    { source: methodId, predicate: DID_DOC_PREDICATES.controller, target: graphDid },
    { source: methodId, predicate: DID_DOC_PREDICATES.publicKeyMultibase, target: `"${identifier}"` },
    { source: graphDid, predicate: DID_DOC_PREDICATES.capabilityInvocation, target: methodId },
    { source: graphDid, predicate: DID_DOC_PREDICATES.capabilityDelegation, target: methodId },
    { source: graphDid, predicate: DID_DOC_PREDICATES.assertionMethod, target: methodId },
    { source: graphDid, predicate: DID_DOC_PREDICATES.authentication, target: methodId },
  ];
}

export type DIDCapabilitySection =
  | 'capabilityInvocation'
  | 'capabilityDelegation'
  | 'assertionMethod'
  | 'authentication';

/** Produce triples that add a new verification method to the DID document. */
export function addMethodTriples(
  graphDid: string,
  methodId: string,
  publicKey: Uint8Array,
  sections: DIDCapabilitySection[],
): GraphTriple[] {
  const multibase = encodeEd25519Multibase(publicKey);
  const triples: GraphTriple[] = [
    { source: graphDid, predicate: DID_DOC_PREDICATES.hasMethod, target: methodId },
    { source: methodId, predicate: DID_DOC_PREDICATES.type, target: '"Ed25519VerificationKey2020"' },
    { source: methodId, predicate: DID_DOC_PREDICATES.controller, target: graphDid },
    { source: methodId, predicate: DID_DOC_PREDICATES.publicKeyMultibase, target: `"${multibase}"` },
  ];
  for (const section of sections) {
    triples.push({
      source: graphDid,
      predicate: DID_DOC_PREDICATES[section],
      target: methodId,
    });
  }
  return triples;
}

/**
 * Produce the triples to remove for `removeMethodFromGraph`.
 * Returns the (source, predicate, target) tuples whose matching triples should
 * be deleted to retract the method from all capability sections.
 */
export function removeMethodTriples(graphDid: string, methodId: string): GraphTriple[] {
  return [
    { source: graphDid, predicate: DID_DOC_PREDICATES.hasMethod, target: methodId },
    { source: graphDid, predicate: DID_DOC_PREDICATES.capabilityInvocation, target: methodId },
    { source: graphDid, predicate: DID_DOC_PREDICATES.capabilityDelegation, target: methodId },
    { source: graphDid, predicate: DID_DOC_PREDICATES.assertionMethod, target: methodId },
    { source: graphDid, predicate: DID_DOC_PREDICATES.authentication, target: methodId },
  ];
}
