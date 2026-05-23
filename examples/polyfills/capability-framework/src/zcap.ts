/**
 * ZCAP management helpers — create, delegate, revoke (actions+resource model).
 */

import { v4 as uuidv4 } from 'uuid';
import { GOV } from './predicates.js';
import type { Caveat, ZCAPDocument, ValidationContext } from './types.js';

export interface CreateCapabilityOptions {
  parentCapability?: string | null;
  caveats?: Caveat[];
  expires?: string | null;
}

export function createCapability(
  invokerDid: string,
  actions: string[],
  resource: string,                 // did:graph:...
  signerDid: string,
  opts: CreateCapabilityOptions = {},
): ZCAPDocument {
  return {
    id: `urn:uuid:${uuidv4()}`,
    invoker: invokerDid,
    parentCapability: opts.parentCapability ?? null,
    actions: [...actions],
    resource,
    caveats: opts.caveats ?? [],
    expires: opts.expires ?? null,
    proof: {
      type: 'Ed25519Signature2020',
      created: new Date().toISOString(),
      verificationMethod: `${signerDid}#${signerDid.split(':').pop()}`,
      proofPurpose: 'capabilityDelegation',
      proofValue: `mock-proof-${uuidv4().slice(0, 8)}`,
    },
  };
}

export function delegateCapability(
  parentZcap: ZCAPDocument,
  newInvokerDid: string,
  delegatorDid: string,
  opts: {
    subsetActions?: string[];
    additionalCaveats?: Caveat[];
    expires?: string;
  } = {},
): ZCAPDocument {
  const parentActions = parentZcap.actions ?? parentZcap.capability?.predicates ?? [];
  const actions = opts.subsetActions ?? parentActions;
  // Verify subset
  for (const a of actions) {
    if (!parentActions.includes(a)) {
      throw new Error(`Action ${a} not in parent capability`);
    }
  }
  const resource = parentZcap.resource ?? parentZcap.capability?.scope?.graph ?? '';
  const caveats: Caveat[] = [...(parentZcap.caveats ?? []), ...(opts.additionalCaveats ?? [])];

  return {
    id: `urn:uuid:${uuidv4()}`,
    invoker: newInvokerDid,
    parentCapability: parentZcap.id,
    actions,
    resource,
    caveats,
    expires: opts.expires ?? parentZcap.expires ?? null,
    proof: {
      type: 'Ed25519Signature2020',
      created: new Date().toISOString(),
      verificationMethod: `${delegatorDid}#${delegatorDid.split(':').pop()}`,
      proofPurpose: 'capabilityDelegation',
      proofValue: `mock-proof-${uuidv4().slice(0, 8)}`,
    },
  };
}

export interface RevocationTriple {
  subject: string;
  predicate: string;
  object: string;
}

export function revokeCapability(revokerDid: string, zcapId: string): RevocationTriple {
  return {
    subject: revokerDid,
    predicate: GOV.REVOKES_CAPABILITY,
    object: zcapId,
  };
}

/**
 * Issue ZCAPs for a joining peer based on the context's default-capability templates.
 */
export async function issueDefaultCapabilities(
  peerDid: string,
  signerDid: string,
  graphDid: string,
  ctx: ValidationContext,
): Promise<ZCAPDocument[]> {
  const entryTypes = await ctx.queryTriples({
    predicate: GOV.ENTRY_TYPE,
    object: GOV.DEFAULT_CAPABILITY,
  });
  const zcaps: ZCAPDocument[] = [];
  for (const entry of entryTypes) {
    const defId = entry.data.subject;
    const defTriples = await ctx.queryTriples({ subject: defId });
    const props: Record<string, string> = {};
    for (const t of defTriples) props[t.data.predicate] = t.data.object;

    const actions = props[GOV.DEFAULT_CAPABILITY_ACTIONS];
    if (!actions) continue;
    const actionList = actions.split(',').map(s => s.trim()).filter(Boolean);
    let caveats: Caveat[] = [];
    if (props[GOV.DEFAULT_CAPABILITY_CAVEATS]) {
      try { caveats = JSON.parse(props[GOV.DEFAULT_CAPABILITY_CAVEATS]); } catch {}
    }
    zcaps.push(createCapability(peerDid, actionList, graphDid, signerDid, { caveats }));
  }
  return zcaps;
}
