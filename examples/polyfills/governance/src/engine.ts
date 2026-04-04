/**
 * GraphGovernanceEngine — main orchestrator (§9)
 */

import { GOV } from './predicates.js';
import { resolveAncestry, collectConstraints, applyPrecedence } from './scope.js';
import { verifyCapability } from './capability.js';
import { verifyCredential } from './credential.js';
import { verifyTemporal } from './temporal.js';
import { verifyContent } from './content.js';
import type {
  GraphConstraint,
  ValidationResult,
  TripleInput,
  ValidationContext,
  CapabilityInfo,
  ConstraintHandler,
  ValidationHistoryEntry,
  ZCAPDocument,
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

  get context(): ValidationContext {
    return this._ctx;
  }

  /**
   * Validate a triple against all governance constraints (§9.1).
   * Order: scope resolution → capability → credential → temporal → content → custom
   */
  async validate(triple: TripleInput): Promise<ValidationResult> {
    // Step 1: Scope resolution
    const ancestry = await resolveAncestry(triple.source, this._ctx);
    const allConstraints = await collectConstraints(ancestry, this._ctx);
    const constraints = applyPrecedence(allConstraints);

    // Step 2: Capability verification
    const capResult = await verifyCapability(triple, constraints, ancestry, this._ctx);
    if (!capResult.allowed) {
      this._recordHistory(triple, capResult);
      return capResult;
    }

    // Step 3: Credential verification
    const credResult = await verifyCredential(triple, constraints, this._ctx);
    if (!credResult.allowed) {
      this._recordHistory(triple, credResult);
      return credResult;
    }

    // Step 4: Temporal verification
    const tempResult = await verifyTemporal(triple, constraints, ancestry, this._ctx);
    if (!tempResult.allowed) {
      this._recordHistory(triple, tempResult);
      return tempResult;
    }

    // Step 5: Content verification
    const contentResult = await verifyContent(triple, constraints, this._ctx);
    if (!contentResult.allowed) {
      this._recordHistory(triple, contentResult);
      return contentResult;
    }

    // Step 6: Custom constraint kinds
    const customConstraints = constraints.filter(
      c => !['capability', 'temporal', 'content', 'credential'].includes(c.kind)
    );
    for (const cc of customConstraints) {
      const handler = this._customHandlers.get(cc.kind);
      if (handler) {
        const result = handler.validate(triple, cc, this._ctx);
        if (!result.allowed) {
          this._recordHistory(triple, result);
          return result;
        }
      }
    }

    const result: ValidationResult = { allowed: true };
    this._recordHistory(triple, result);
    return result;
  }

  /**
   * Get all constraints applicable to an entity (§9.2)
   */
  async constraintsFor(entityAddress: string): Promise<GraphConstraint[]> {
    const ancestry = await resolveAncestry(entityAddress, this._ctx);
    const allConstraints = await collectConstraints(ancestry, this._ctx);
    return applyPrecedence(allConstraints);
  }

  /**
   * Get current identity's valid capabilities (§9.3)
   */
  async myCapabilities(myDid: string): Promise<CapabilityInfo[]> {
    const zcapLinks = await this._ctx.queryTriples({
      source: myDid,
      predicate: GOV.HAS_ZCAP,
    });

    const caps: CapabilityInfo[] = [];
    const now = this._ctx.now ? this._ctx.now() : Date.now();

    for (const link of zcapLinks) {
      const zcap = await this._resolveZCAP(link.data.target);
      if (!zcap) continue;

      // Check expiry
      if (zcap.expires) {
        const expiryTime = new Date(zcap.expires).getTime();
        if (now > expiryTime) continue;
      }

      // Check revocation
      const revocations = await this._ctx.queryTriples({
        predicate: GOV.REVOKES_CAPABILITY,
        target: zcap.id,
      });
      if (revocations.length > 0) continue;

      caps.push({
        id: zcap.id,
        predicates: zcap.capability.predicates,
        scope: zcap.capability.scope.within,
        expires: zcap.expires ?? null,
      });
    }

    return caps;
  }

  /**
   * Register a custom constraint kind
   */
  registerConstraintKind(handler: ConstraintHandler): void {
    this._customHandlers.set(handler.kind, handler);
  }

  /**
   * Get validation history
   */
  getValidationHistory(opts?: { limit?: number }): ValidationHistoryEntry[] {
    const limit = opts?.limit ?? this._history.length;
    return this._history.slice(-limit);
  }

  /**
   * Reload (clear caches — in this polyfill, no-op since we query live)
   */
  reload(): void {
    this._history = [];
  }

  private _recordHistory(triple: TripleInput, result: ValidationResult): void {
    this._history.push({
      triple,
      result,
      timestamp: this._ctx.now ? this._ctx.now() : Date.now(),
    });
    if (this._history.length > this._historyMaxSize) {
      this._history.shift();
    }
  }

  private async _resolveZCAP(address: string): Promise<ZCAPDocument | null> {
    if (this._ctx.resolveExpression) {
      try {
        const doc = await this._ctx.resolveExpression(address);
        if (doc && typeof doc === 'object' && 'id' in (doc as any)) {
          return doc as ZCAPDocument;
        }
      } catch { /* fall through */ }
    }
    return null;
  }
}
