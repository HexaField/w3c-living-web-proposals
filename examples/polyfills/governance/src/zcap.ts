/**
 * ZCAP management helpers — create, delegate, revoke
 */

import { v4 as uuidv4 } from 'uuid';
import { GOV } from './predicates.js';
import type { ZCAPDocument, ValidationContext } from './types.js';

export function createCapability(
  invokerDid: string,
  predicates: string[],
  scope: { within: string | null; graph: string },
  signerDid: string,
  opts?: { expires?: string; parentCapability?: string | null },
): ZCAPDocument {
  return {
    id: `urn:uuid:${uuidv4()}`,
    invoker: invokerDid,
    parentCapability: opts?.parentCapability ?? null,
    capability: {
      predicates: [...predicates],
      scope: { within: scope.within, graph: scope.graph },
    },
    expires: opts?.expires ?? null,
    proof: {
      type: 'Ed25519Signature2020',
      created: new Date().toISOString(),
      verificationMethod: `${signerDid}#key-1`,
      proofPurpose: 'capabilityDelegation',
      proofValue: `mock-proof-${uuidv4().slice(0, 8)}`,
    },
  };
}

export function delegateCapability(
  parentZcap: ZCAPDocument,
  newInvokerDid: string,
  delegatorDid: string,
  opts?: { subsetPredicates?: string[]; subsetScope?: string | null; expires?: string },
): ZCAPDocument {
  const predicates = opts?.subsetPredicates ?? parentZcap.capability.predicates;
  const scopeWithin = opts?.subsetScope !== undefined ? opts.subsetScope : parentZcap.capability.scope.within;

  return {
    id: `urn:uuid:${uuidv4()}`,
    invoker: newInvokerDid,
    parentCapability: parentZcap.id,
    capability: {
      predicates: [...predicates],
      scope: { within: scopeWithin, graph: parentZcap.capability.scope.graph },
    },
    expires: opts?.expires ?? null,
    proof: {
      type: 'Ed25519Signature2020',
      created: new Date().toISOString(),
      verificationMethod: `${delegatorDid}#key-1`,
      proofPurpose: 'capabilityDelegation',
      proofValue: `mock-proof-${uuidv4().slice(0, 8)}`,
    },
  };
}

export interface RevocationTriple {
  source: string;
  predicate: string;
  target: string;
}

export function revokeCapability(revokerDid: string, zcapId: string): RevocationTriple {
  return {
    source: revokerDid,
    predicate: GOV.REVOKES_CAPABILITY,
    target: zcapId,
  };
}

/**
 * Read default capability templates from the graph and issue ZCAPs for a joining peer.
 */
export async function issueDefaultCapabilities(
  peerDid: string,
  rootAuthorityDid: string,
  graphUri: string,
  ctx: ValidationContext,
): Promise<ZCAPDocument[]> {
  // Find all default_capability entries
  const entryTypes = await ctx.queryTriples({
    predicate: GOV.ENTRY_TYPE,
    target: GOV.DEFAULT_CAPABILITY,
  });

  const zcaps: ZCAPDocument[] = [];
  for (const entry of entryTypes) {
    const defId = entry.data.source;
    const defTriples = await ctx.queryTriples({ source: defId });
    const props: Record<string, string> = {};
    for (const t of defTriples) {
      if (t.data.predicate) props[t.data.predicate] = t.data.target;
    }

    const predicates = props[GOV.DEFAULT_CAPABILITY_PREDICATES];
    const scope = props[GOV.DEFAULT_CAPABILITY_SCOPE];
    if (!predicates) continue;

    const predList = predicates.split(',').map(s => s.trim()).filter(Boolean);
    const zcap = createCapability(peerDid, predList, {
      within: scope || null,
      graph: graphUri,
    }, rootAuthorityDid);

    zcaps.push(zcap);
  }

  return zcaps;
}
