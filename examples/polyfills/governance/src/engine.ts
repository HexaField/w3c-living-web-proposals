/**
 * GraphGovernanceEngine — main orchestrator (Spec 05 §13).
 *
 * Operates on a single context (did:graph). Scope inheritance walks
 * `context://participates_in` links upward through the agent's GraphStore.
 */

import { GOV } from './predicates.js';
import { resolveAncestry, collectConstraints, applyPrecedence } from './scope.js';
import { verifyCapability } from './capability.js';
import { verifyCredential } from './credential.js';
import { verifyTemporal } from './temporal.js';
import { verifyContent } from './content.js';
import type {
  GraphConstraint,
  GovernanceValidationResult,
  TripleInput,
  ValidationContext,
  CapabilityInfo,
  ConstraintHandler,
  ValidationHistoryEntry,
  ZCAPDocument,
  EnforcementMode,
} from './types.js';

export class GraphGovernanceEngine {
  private _ctx: ValidationContext;
  private _customHandlers = new Map<string, ConstraintHandler>();
  private _history: ValidationHistoryEntry[] = [];
  private _historyMaxSize: number;

  constructor(ctx: ValidationContext, opts?: { historyMaxSize?: number }) {
    this._ctx = ctx;
    this._historyMaxSize = opts?.historyMaxSize ?? 1000;
  }

  get context(): ValidationContext { return this._ctx; }

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

  /** Update the context's enforcement mode (requires updateGovernance capability — not checked here). */
  async setEnforcementMode(mode: EnforcementMode): Promise<void> {
    this._ctx.enforcementMode = mode;
  }

  /**
   * Validate a triple against all governance constraints.
   * Order: scope → capability → credential → temporal → content → custom.
   * Capability checks honour the enforcement mode (open/announced/enforced).
   */
  async validate(triple: TripleInput): Promise<GovernanceValidationResult> {
    // Refresh enforcement mode from graph (cheap query)
    this._ctx.enforcementMode = await this.getEnforcementMode();

    // Step 1: scope resolution (holonic, via participates_in)
    const ancestry = await resolveAncestry(this._ctx.graphDid, this._ctx);
    const allConstraints = await collectConstraints(ancestry, this._ctx);
    const constraints = applyPrecedence(allConstraints);

    // Step 2: capability — honours enforcement mode
    const capResult = await verifyCapability(triple, constraints, ancestry, this._ctx);
    if (!capResult.allowed) {
      if (this._ctx.enforcementMode === 'open') {
        // Open mode: skip the rejection
      } else if (this._ctx.enforcementMode === 'announced') {
        // Announced mode: record but accept
        this._recordHistory(triple, { ...capResult, allowed: true, announcedRejection: capResult.reason });
      } else {
        this._recordHistory(triple, capResult);
        return capResult;
      }
    }

    // Step 3: credential (always enforced regardless of mode)
    const credResult = await verifyCredential(triple, constraints, this._ctx);
    if (!credResult.allowed) {
      this._recordHistory(triple, credResult);
      return credResult;
    }

    // Step 4: temporal (always enforced)
    const tempResult = await verifyTemporal(triple, constraints, ancestry, this._ctx);
    if (!tempResult.allowed) {
      this._recordHistory(triple, tempResult);
      return tempResult;
    }

    // Step 5: content (always enforced)
    const contentResult = await verifyContent(triple, constraints, this._ctx);
    if (!contentResult.allowed) {
      this._recordHistory(triple, contentResult);
      return contentResult;
    }

    // Step 6: custom constraints
    const customConstraints = constraints.filter(
      c => !['capability', 'temporal', 'content', 'credential'].includes(c.kind),
    );
    for (const cc of customConstraints) {
      const handler = this._customHandlers.get(cc.kind);
      if (handler) {
        const r = await handler.validate(triple, cc, this._ctx);
        if (!r.allowed) {
          this._recordHistory(triple, r);
          return r;
        }
      }
    }

    const result: GovernanceValidationResult = { allowed: true };
    this._recordHistory(triple, result);
    return result;
  }

  async constraintsFor(contextDid: string = this._ctx.graphDid): Promise<GraphConstraint[]> {
    const ancestry = await resolveAncestry(contextDid, this._ctx);
    const allConstraints = await collectConstraints(ancestry, this._ctx);
    return applyPrecedence(allConstraints);
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
      const expiresAt = (expiryCaveat?.value as any)?.expiresAt ?? zcap.expires ?? null;
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

  registerConstraintKind(handler: ConstraintHandler): void {
    this._customHandlers.set(handler.kind, handler);
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
        if (doc && typeof doc === 'object' && 'id' in (doc as any)) return doc as ZCAPDocument;
      } catch { /* fallthrough */ }
    }
    return null;
  }
}
