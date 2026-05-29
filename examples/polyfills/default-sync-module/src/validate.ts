/**
 * In-module validation (Spec 06 §5.5).
 *
 * Validation runs *inside* the module by design. The polyfill's
 * `defaultValidateDiff` and `defaultValidateReadAccess` are the same
 * functions a production WASM module would call from inside the sandbox.
 * They:
 *
 *   1. Verify the bundle signature (Spec 05 §5.2.2 / §9.2.1 step 0).
 *   2. Delegate to the [[CAPABILITY-FRAMEWORK]] governance engine for
 *      capability + caveat checks.
 *
 * The engine is built per-call from the supplied `Graph`'s local view,
 * matching the "validation reads only from the writing graph" invariant
 * (Spec 04 §6, Spec 05 §9.2.1).
 */

import type { Graph } from '@living-web/personal-graph';
import {
  verifyBundleSignature,
  type GraphDiff,
  type SyncValidationResult,
  type CapabilityProof,
} from '@living-web/context-sync';
import { createGovernanceLayer } from '@living-web/capability-framework';
import { didToPublicKey, ed25519 } from '@living-web/identity';

/** Resolve a did:key author + verify the bundle signature. */
async function verifyDidKeySignature(
  commitId: string,
  signatureHex: string,
  author: string,
): Promise<boolean> {
  if (!author.startsWith('did:key:')) {
    // Graph-DID authors require DID-document resolution to find the current
    // capabilityDelegation verification method. Production modules MUST
    // perform that resolution; the polyfill treats them as unverifiable.
    return false;
  }
  try {
    const publicKey = didToPublicKey(author);
    return await ed25519.verifyAsync(hexBytes(signatureHex), hexBytes(commitId), publicKey);
  } catch {
    return false;
  }
}

function hexBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.slice(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Spec 06 §5.1 `validateDiff` — the in-module entry point invoked by the
 * runtime for every incoming diff. Returns the module's authoritative
 * accept/reject; the runtime treats this as the final outcome.
 *
 * The polyfill takes a `Graph` directly; a WASM module would build the
 * equivalent context from its `ModuleConfig.graphReader` handle.
 */
export async function defaultValidateDiff(
  graph: Graph,
  diff: GraphDiff,
): Promise<SyncValidationResult> {
  // Step 0 — bundle signature verification (Spec 05 §9.2.1 step 0).
  const sig = await verifyBundleSignature(diff, verifyDidKeySignature);
  if (!sig.ok) {
    return {
      accepted: false,
      constraintKind: 'capability',
      reason: sig.reason ?? 'signature_invalid',
    };
  }

  // Steps 1–4 — capability + caveat checks via the governance engine.
  // The polyfill operates on graphs without a DID by short-circuiting:
  // such graphs cannot bind capabilities (Spec 04 §1.4) and therefore
  // have no governance to enforce.
  if (!graph.did) return { accepted: true };

  const layer = createGovernanceLayer(graph);
  // Validate every triple in additions through the engine. The reifier
  // signatures on the triples themselves are verified by `personal-graph`
  // before reaching here (the broadcast module re-applies via the same
  // signed-triple path).
  for (const triple of diff.additions) {
    const result = await layer.canAddTripleAs(
      triple.data.subject,
      triple.data.predicate,
      triple.data.object,
      diff.author,
    );
    if (!result.allowed) {
      return {
        accepted: false,
        constraintKind: result.constraintKind ?? 'capability',
        constraintId: result.rejectedBy,
        reason: result.reason ?? 'capability_check_failed',
      };
    }
  }

  return { accepted: true };
}

/**
 * Spec 06 §5.1 `validateReadAccess` — invoked by the responder before
 * serving a snapshot or accepting a read-mode mount (Spec 05 §9.2.2).
 * Delegates to the governance engine's `validateAction("mountContext", …)`.
 */
export async function defaultValidateReadAccess(
  graph: Graph,
  authorDid: string,
  proof?: CapabilityProof,
): Promise<SyncValidationResult> {
  if (!graph.did) {
    // Graphs without a DID have no capability binding — unrestricted read.
    return { accepted: true };
  }

  const layer = createGovernanceLayer(graph);
  const result = await layer.engine.validateAction('mountContext', authorDid, {
    capabilityProof: proof ? { chain: proof.chain, presentations: proof.presentations } : undefined,
  });

  if (result.allowed) return { accepted: true };
  return {
    accepted: false,
    constraintKind: result.constraintKind ?? 'capability',
    constraintId: result.rejectedBy,
    reason: result.reason ?? 'mount_context_denied',
  };
}
