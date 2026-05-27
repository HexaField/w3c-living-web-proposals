/**
 * The `did:graph` DID method ([[GROUP-IDENTITY]] §4).
 *
 * The DID identifier is single-key (the same multibase Ed25519 encoding as
 * did:key). Shared signing authority lives in the DID document's capability
 * sections, NOT in the identifier. No multisig, no threshold cryptography.
 *
 * The DID document for a did:graph DID is composed from triples stored
 * INSIDE the graph it identifies. This module exposes a resolver interface
 * that takes a triple subject as input; the group-identity polyfill at
 * install time provides the implementation (drawing triples from locally
 * mounted graphs in personal-graph's GraphStores).
 */

import {
  decodeEd25519Multibase,
  encodeEd25519Multibase,
  type DIDDocument,
  type DIDDocumentMethod,
  type DIDDocumentTrustLevel,
} from '@living-web/identity';

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

/** Predicates the resolver reads from a graph's graph. */
export const DID_DOC_PREDICATES = {
  type: 'did://verificationMethod/type',
  controller: 'did://verificationMethod/controller',
  publicKeyMultibase: 'did://verificationMethod/publicKeyMultibase',
  verificationMethod: 'did://verificationMethod',
  capabilityInvocation: 'did://capabilityInvocation',
  capabilityDelegation: 'did://capabilityDelegation',
  assertionMethod: 'did://assertionMethod',
  authentication: 'did://authentication',
  deactivated: 'did://deactivated',
} as const;

export interface GraphTriple {
  subject: string;
  predicate: string;
  object: string;
}

/** Source of triples for resolving a did:graph DID. */
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
  provider: GraphTripleSource,
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

  for (const { subject: s, predicate: p, object: t } of provider.readGraph(did)) {
    if (s === did) {
      switch (p) {
        case DID_DOC_PREDICATES.verificationMethod:
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
 * Produce the seed triples that should be written into a freshly created graph.
 * The caller (personal-graph's createContext) writes these as the first triples
 * in the new graph.
 */
export function seedDIDDocumentTriples(graphDid: string): GraphTriple[] {
  const identifier = graphDid.slice('did:graph:'.length);
  const methodId = `${graphDid}#${identifier}`;
  return [
    { subject: graphDid, predicate: DID_DOC_PREDICATES.verificationMethod, object: methodId },
    { subject: methodId, predicate: DID_DOC_PREDICATES.type, object: '"Ed25519VerificationKey2020"' },
    { subject: methodId, predicate: DID_DOC_PREDICATES.controller, object: graphDid },
    { subject: methodId, predicate: DID_DOC_PREDICATES.publicKeyMultibase, object: `"${identifier}"` },
    { subject: graphDid, predicate: DID_DOC_PREDICATES.capabilityInvocation, object: methodId },
    { subject: graphDid, predicate: DID_DOC_PREDICATES.capabilityDelegation, object: methodId },
    { subject: graphDid, predicate: DID_DOC_PREDICATES.assertionMethod, object: methodId },
    { subject: graphDid, predicate: DID_DOC_PREDICATES.authentication, object: methodId },
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
    { subject: graphDid, predicate: DID_DOC_PREDICATES.verificationMethod, object: methodId },
    { subject: methodId, predicate: DID_DOC_PREDICATES.type, object: '"Ed25519VerificationKey2020"' },
    { subject: methodId, predicate: DID_DOC_PREDICATES.controller, object: graphDid },
    { subject: methodId, predicate: DID_DOC_PREDICATES.publicKeyMultibase, object: `"${multibase}"` },
  ];
  for (const section of sections) {
    triples.push({
      subject: graphDid,
      predicate: DID_DOC_PREDICATES[section],
      object: methodId,
    });
  }
  return triples;
}

/**
 * Produce the triples to remove to retract a method from all capability sections.
 */
export function removeMethodTriples(graphDid: string, methodId: string): GraphTriple[] {
  return [
    { subject: graphDid, predicate: DID_DOC_PREDICATES.verificationMethod, object: methodId },
    { subject: graphDid, predicate: DID_DOC_PREDICATES.capabilityInvocation, object: methodId },
    { subject: graphDid, predicate: DID_DOC_PREDICATES.capabilityDelegation, object: methodId },
    { subject: graphDid, predicate: DID_DOC_PREDICATES.assertionMethod, object: methodId },
    { subject: graphDid, predicate: DID_DOC_PREDICATES.authentication, object: methodId },
  ];
}
