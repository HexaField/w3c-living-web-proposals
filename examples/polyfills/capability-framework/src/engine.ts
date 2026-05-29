/**
 * GraphGovernanceEngine — orchestrator for a single graph (Spec 04 §11).
 *
 * Architecture:
 *   - Per-graph validation (Spec 04 §6): each graph carries its own
 *     constraints and validates writes against its own local state.
 *     Cross-graph composition is application-layer (Spec 04 Appendix A).
 *   - Same-kind constraints accumulate within the graph; deny-wins per
 *     kind (Spec 04 §4.2, §6.3).
 *   - Audit attribution: the rejecting constraint with lex-greater id is
 *     recorded in `rejectedBy` (audit only — the decision is deny-wins).
 *   - Capability is built in (`verifyCapability`); other kinds (temporal,
 *     content, credential, …) are supplied as handler plug-ins (Spec 04 §9.3).
 *   - Open mode skips capability enforcement only; other constraint kinds
 *     still apply (Spec 04 §5.1, §5.3).
 */

import { GOV, IMMUTABLE_SEED_PREDICATES } from './predicates.js';
import { resolveScopeSet, collectConstraints, pickAuditAttribution, type ScopeSet } from './scope.js';
import { verifyCapability, inferAction } from './capability.js';
import { expiryCaveatHandler } from './caveats.js';
import type {
  GraphConstraint,
  GovernanceValidationResult,
  TripleInput,
  ValidationContext,
  CapabilityInfo,
  ConstraintHandler,
  CaveatHandler,
  ValidationHistoryEntry,
  ZCAPDocument,
  EnforcementMode,
} from './types.js';

export class GraphGovernanceEngine {
  private _ctx: ValidationContext;
  private _handlers = new Map<string, ConstraintHandler>();
  private _caveatHandlers = new Map<string, CaveatHandler>();
  private _history: ValidationHistoryEntry[] = [];
  private _historyMaxSize: number;
  private _actionPrefixes: Array<[string, string]> = [];

  constructor(ctx: ValidationContext, opts?: { historyMaxSize?: number }) {
    this._ctx = ctx;
    this._historyMaxSize = opts?.historyMaxSize ?? 1000;
    // Framework-core `expiry` handler is always registered.
    this._caveatHandlers.set(expiryCaveatHandler.type, expiryCaveatHandler);
  }

  /** Expose the caveat handler map to the chain walk (Spec 04 §7.6.4). */
  get caveatHandlers(): ReadonlyMap<string, CaveatHandler> {
    return this._caveatHandlers;
  }

  /** Register a caveat type plug-in (Spec 04 §9.3). */
  registerCaveatType(handler: CaveatHandler): void {
    this._caveatHandlers.set(handler.type, handler);
  }

  get graph(): ValidationContext { return this._ctx; }

  async getEnforcementMode(): Promise<EnforcementMode> {
    const triples = await this._ctx.queryTriples({
      subject: this._ctx.graphDid,
      predicate: GOV.ENFORCEMENT_MODE,
    });
    if (triples.length === 0) return 'open';
    const raw = triples[0].data.object.replace(/^"|"$/g, '');
    if (raw === 'enforced' || raw === 'announced' || raw === 'open') return raw;
    return 'open';
  }

  async setEnforcementMode(mode: EnforcementMode): Promise<void> {
    this._ctx.enforcementMode = mode;
  }

  /**
   * Validate a triple. Capability + every registered constraint-kind handler
   * is evaluated; results combine deny-wins. Capability enforcement honours
   * Open/Announced/Enforced; other constraint kinds always apply.
   *
   * `options.action` overrides the predicate-derived action (Spec 04 §7
   * step 2). Used for non-triple operations such as `mountContext`.
   */
  async validate(
    triple: TripleInput,
    options?: { action?: string },
  ): Promise<GovernanceValidationResult> {
    this._ctx.enforcementMode = await this.getEnforcementMode();

    // Spec 03 §4.5 / Spec 04 §10 — immutable seed predicates.
    // No action authorises writes to these predicates on the graph DID;
    // they are set once during the bootstrap atomic (groupification or
    // fork) and never modified thereafter. The bootstrap path bypasses
    // validate() entirely, so any call that reaches here mutating them
    // is forbidden.
    if (
      triple.subject === this._ctx.graphDid
      && IMMUTABLE_SEED_PREDICATES.has(triple.predicate)
    ) {
      const result: GovernanceValidationResult = {
        allowed: false,
        constraintKind: 'immutable-seed',
        reason: `Immutable seed predicate '${triple.predicate}' on ${this._ctx.graphDid} cannot be modified outside bootstrap`,
      };
      this._recordHistory(triple, result);
      return result;
    }

    const scope = await resolveScopeSet(this._ctx.graphDid, this._ctx);
    if (scope.overflow) {
      const result: GovernanceValidationResult = {
        allowed: false,
        constraintKind: 'scope-overflow',
        reason: `Scope set exceeded 100 graphs`,
      };
      this._recordHistory(triple, result);
      return result;
    }

    const constraints = await collectConstraints(scope, this._ctx);

    const rejectingConstraints: GraphConstraint[] = [];
    let firstRejection: GovernanceValidationResult | null = null;

    // ── Capability (built-in) ────────────────────────────────────────────────
    // Capability checking always runs (to record history under Announced),
    // but the outcome is gated by enforcement mode.
    const capResult = await verifyCapability(
      triple,
      constraints,
      scope,
      this._ctx,
      this._caveatHandlers,
      options?.action,
    );
    if (!capResult.allowed) {
      if (this._ctx.enforcementMode === 'open') {
        // Skip — capability denials don't reject in Open.
      } else if (this._ctx.enforcementMode === 'announced') {
        // Record but don't reject.
        this._recordHistory(triple, { ...capResult, allowed: true, announcedRejection: capResult.reason });
      } else {
        // Enforced — accumulate into deny-wins set.
        firstRejection = firstRejection ?? capResult;
        if (capResult.rejectedBy) {
          const c = constraints.find(x => x.id === capResult.rejectedBy);
          if (c) rejectingConstraints.push(c);
        }
      }
    }

    // ── Plug-in constraint kinds (always enforced) ───────────────────────────
    // For each constraint with a registered handler, evaluate. Same-kind
    // constraints accumulate; deny-wins per kind.
    const nonCapConstraints = constraints.filter(c => c.kind !== 'capability');
    for (const cc of nonCapConstraints) {
      const handler = this._handlers.get(cc.kind);
      if (!handler) {
        // Unknown kind — fail-closed (Spec 03 §4.1, §13.8).
        const result: GovernanceValidationResult = {
          allowed: false,
          constraintKind: cc.kind,
          reason: `Unknown constraint kind '${cc.kind}' has no registered handler`,
          rejectedBy: cc.id,
        };
        rejectingConstraints.push(cc);
        firstRejection = firstRejection ?? result;
        continue;
      }
      const r = await handler.validate(triple, cc, this._ctx);
      if (!r.allowed) {
        rejectingConstraints.push(cc);
        firstRejection = firstRejection ?? {
          ...r,
          constraintKind: r.constraintKind ?? cc.kind,
          rejectedBy: r.rejectedBy ?? cc.id,
        };
      }
    }

    if (rejectingConstraints.length > 0) {
      const audit = pickAuditAttribution(rejectingConstraints);
      const result: GovernanceValidationResult = {
        allowed: false,
        constraintKind: audit?.kind ?? firstRejection?.constraintKind,
        reason: firstRejection?.reason ?? 'rejected',
        rejectedBy: audit?.id ?? firstRejection?.rejectedBy,
      };
      this._recordHistory(triple, result);
      return result;
    }

    const ok: GovernanceValidationResult = { allowed: true };
    this._recordHistory(triple, ok);
    return ok;
  }

  /**
   * Authorise a non-triple operation (Spec 04 §7.1, Spec 05 §9.2.2).
   *
   * Used by sync modules to gate read-mount requests against `mountContext`
   * capability constraints. The polyfill constructs a synthetic TripleInput
   * (no subject/predicate/object content) and runs `validate()` with the
   * explicit action override; caveats that depend on triple content are
   * naturally skipped because there is no content.
   *
   * Returns `{ allowed: true }` either when the action passes the chain
   * walk OR when the graph carries no constraint covering the requested
   * action (unrestricted-access case).
   */
  async validateAction(
    action: string,
    authorDid: string,
    options?: { timestamp?: string; capabilityProof?: { chain: string[]; presentations?: object[] } },
  ): Promise<GovernanceValidationResult> {
    const synthetic: TripleInput = {
      subject: this._ctx.graphDid,
      predicate: `__action__://${action}`,   // never matches a real capability_predicates filter
      object: '',
      author: authorDid,
      timestamp: options?.timestamp ?? new Date().toISOString(),
    };
    // The capabilityProof is consumed by the engine indirectly: in the
    // polyfill, capability resolution walks `has_zcap` triples already
    // present in the graph store. A wire-level proof from a remote peer
    // would be re-inserted into the local store (or a transient scope) by
    // the sync module before this call; the responsibility for that
    // staging is the sync module's, not the engine's.
    void options;
    return this.validate(synthetic, { action });
  }

  /**
   * Register a predicate prefix → action mapping (Spec 03 §4.5.4.1).
   * Throws if the prefix overlaps an existing registration.
   */
  registerActionPrefix(prefix: string, action: string): void {
    for (const [existing] of this._actionPrefixes) {
      if (existing.startsWith(prefix) || prefix.startsWith(existing)) {
        throw new Error(`Action prefix '${prefix}' overlaps existing '${existing}'`);
      }
    }
    this._actionPrefixes.push([prefix, action]);
  }

  /** Surface the action derivation helper for callers that need to inspect it. */
  inferAction(triple: TripleInput): string {
    return inferAction(triple, this._actionPrefixes);
  }

  async constraintsFor(contextDid: string = this._ctx.graphDid): Promise<GraphConstraint[]> {
    const scope = await resolveScopeSet(contextDid, this._ctx);
    return collectConstraints(scope, this._ctx);
  }

  async myCapabilities(myDid: string): Promise<CapabilityInfo[]> {
    const zcapLinks = await this._ctx.queryTriples({
      subject: myDid,
      predicate: GOV.HAS_ZCAP,
    });
    const caps: CapabilityInfo[] = [];
    const now = this._ctx.now ? this._ctx.now() : Date.now();
    for (const link of zcapLinks) {
      const zcap = await this._resolveZCAP(link.data.object);
      if (!zcap) continue;
      const expiryCaveat = (zcap.caveats ?? []).find(c => c.type === 'expiry');
      const expiresAt = (expiryCaveat?.value as { expiresAt?: string } | undefined)?.expiresAt ?? zcap.expires ?? null;
      if (expiresAt && new Date(expiresAt).getTime() < now) continue;
      const revocations = await this._ctx.queryTriples({
        predicate: GOV.REVOKES_CAPABILITY,
        object: zcap.id,
      });
      if (revocations.length > 0) continue;
      caps.push({
        id: zcap.id,
        actions: zcap.actions ?? zcap.capability?.predicates ?? [],
        resource: zcap.resource ?? zcap.capability?.scope?.graph ?? this._ctx.graphDid,
        caveats: zcap.caveats ?? [],
        expires: expiresAt,
      });
    }
    return caps;
  }

  /** Returns the trivial single-graph "scope" — kept for API stability. */
  async resolveScope(): Promise<ScopeSet> {
    return resolveScopeSet(this._ctx.graphDid, this._ctx);
  }

  /**
   * Brick-state guard (Spec 04 §13.10). Returns ACCEPT iff the proposed
   * operation — a revocation of `zcapId` (and/or removal of the named
   * `revokedCapIds` if the caller is removing has_zcap links directly) —
   * would leave the graph with *at least one* valid capability bearing
   * `updateGovernance` for some currently-listed delegate.
   *
   * Callers (governance APIs that mutate the cap store) MUST consult this
   * before persisting the operation and reject when `allowed: false`.
   *
   * The check is deliberately conservative: any has_zcap link whose ZCAP
   * resolves, lists `updateGovernance` in its actions, is unexpired, is
   * not in `revokedCapIds`, and is not itself revoked counts as a
   * surviving governance capability.
   */
  async wouldBrickGovernance(revokedCapIds: string[]): Promise<GovernanceValidationResult> {
    const revokedSet = new Set(revokedCapIds);
    const links = await this._ctx.queryTriples({ predicate: GOV.HAS_ZCAP });
    const now = this._ctx.now ? this._ctx.now() : Date.now();
    for (const link of links) {
      const capId = link.data.object;
      if (revokedSet.has(capId)) continue;
      const zcap = await this._resolveZCAP(capId);
      if (!zcap) continue;
      const actions = zcap.actions ?? zcap.capability?.predicates ?? [];
      if (!actions.includes('updateGovernance')) continue;
      // Expiry
      const expiry = (zcap.caveats ?? []).find(c => c.type === 'expiry');
      const expiresAt = (expiry?.value as { expiresAt?: string } | undefined)?.expiresAt
        ?? zcap.expires ?? null;
      if (expiresAt && new Date(expiresAt).getTime() < now) continue;
      // Already revoked in current state
      const existingRevocations = await this._ctx.queryTriples({
        predicate: GOV.REVOKES_CAPABILITY,
        object: capId,
      });
      if (existingRevocations.length > 0) continue;
      // Survives the proposed operation.
      return { allowed: true };
    }
    return {
      allowed: false,
      constraintKind: 'brick-state',
      reason: 'would_brick_governance',
    };
  }

  registerConstraintKind(handler: ConstraintHandler): void {
    this._handlers.set(handler.kind, handler);
  }

  getValidationHistory(opts?: { limit?: number }): ValidationHistoryEntry[] {
    const limit = opts?.limit ?? this._history.length;
    return this._history.slice(-limit);
  }

  reload(): void { this._history = []; }

  private _recordHistory(triple: TripleInput, result: GovernanceValidationResult): void {
    this._history.push({
      triple,
      result,
      timestamp: this._ctx.now ? this._ctx.now() : Date.now(),
    });
    if (this._history.length > this._historyMaxSize) this._history.shift();
  }

  private async _resolveZCAP(address: string): Promise<ZCAPDocument | null> {
    if (this._ctx.resolveExpression) {
      try {
        const doc = await this._ctx.resolveExpression(address);
        if (doc && typeof doc === 'object' && 'id' in (doc as Record<string, unknown>)) {
          return doc as ZCAPDocument;
        }
      } catch { /* fallthrough */ }
    }
    return null;
  }
}
