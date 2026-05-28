/**
 * Capability framework types.
 *
 * - ZCAPs target `did:graph:...` as their canonical resource.
 * - Enforcement modes (Open / Announced / Enforced) are first-class.
 * - Only `expiry` is built into the framework as a caveat type — it applies
 *   to the capability lifecycle itself and is meaningful regardless of which
 *   plug-ins are installed. All other caveat types (predicate, property,
 *   subject, object, rateLimit, cardinality, authorOnly, shape, content,
 *   credential) are supplied by `CaveatHandler` plug-ins registered on the
 *   engine — see `@living-web/constraint-vocabulary` for the standard set.
 * - A graph's authority is rooted in its root capability — a single ZCAP
 *   minted at creation time and delegatable like any other.
 */

/** Built-in `"capability"` plus any plug-in-registered kind string. */
export type ConstraintKind = string;
export type EnforcementMode = 'open' | 'announced' | 'enforced';

/** `'expiry'` is built in; any other string identifies a plug-in caveat type. */
export type CaveatType = string;

export interface Caveat {
  type: CaveatType;
  value: Record<string, unknown>;
}

/**
 * Caveat plug-in interface. Register via `engine.registerCaveatType(handler)`.
 *
 * `appliesToNonTripleOps` controls whether the engine evaluates this caveat
 * when authorising operations that have no triple (e.g. `mountContext`).
 * Caveats that depend on triple fields (predicate, subject, object, content)
 * MUST set this to `false`; context-only caveats (expiry, rateLimit,
 * cardinality, credential) MUST set it to `true`.
 */
export interface CaveatHandler {
  type: string;
  appliesToNonTripleOps: boolean;
  evaluate(
    caveat: Caveat,
    triple: TripleInput | null,
    action: string,
    ctx: ValidationContext,
  ): Promise<GovernanceValidationResult> | GovernanceValidationResult;
}

export interface GraphConstraint {
  readonly id: string;
  readonly kind: ConstraintKind;
  /** The graph (did:graph) this constraint is attached to — always the target graph. */
  readonly scope: string;
  readonly properties: Record<string, string>;
}

export interface GovernanceValidationResult {
  readonly allowed: boolean;
  /** Spec 03 §11 — the constraint kind that decided this result. */
  readonly constraintKind?: string;
  readonly reason?: string;
  readonly rejectedBy?: string;
  /** When the constraint was advisory (Announced mode), the recorded reason. */
  readonly announcedRejection?: string;
}

export interface CapabilityInfo {
  readonly id: string;
  readonly actions: string[];
  readonly resource: string;          // did:graph:...
  readonly caveats: Caveat[];
  readonly expires: string | null;
}

export interface ZCAPDocument {
  id: string;
  /** Either a did:key (individual delegatee) or a did:graph (delegate to a graph). */
  invoker: string;
  /** Identifier of the parent capability, or null for a root capability. */
  parentCapability: string | null;
  /** Actions this capability authorises (e.g., "createLink"). */
  actions: string[];
  /** The resource — typically a did:graph:... */
  resource: string;
  /** Caveats narrowing the capability. */
  caveats?: Caveat[];
  proof: {
    type: string;
    created: string;
    verificationMethod: string;
    proofPurpose: string;
    proofValue: string;
  };
  /** Legacy fields kept for back-compat parsing. */
  capability?: {
    predicates?: string[];
    scope?: { within: string | null; graph: string };
  };
  expires?: string | null;
}

export interface TripleInput {
  subject: string;
  predicate: string;
  object: string;
  author: string;
  timestamp: string;
}

export interface TripleRecord {
  data: { subject: string; predicate: string; object: string };
  author: string;
  timestamp: string;
}

export interface ValidationContext {
  /** did:graph of the graph being written to. */
  graphDid: string;
  /** The root capability id of this graph. */
  rootCapabilityId: string | null;
  /** Current enforcement mode (defaults to "open" if not set). */
  enforcementMode: EnforcementMode;
  queryTriples: (q: { subject?: string | null; predicate?: string | null; object?: string | null }) => Promise<TripleRecord[]>;
  resolveExpression?: (address: string) => Promise<unknown>;
  now?: () => number;
}

export interface ConstraintHandler {
  kind: string;
  validate(triple: TripleInput, constraint: GraphConstraint, graph: ValidationContext): GovernanceValidationResult | Promise<GovernanceValidationResult>;
}

export interface CapabilityProof {
  chain: ZCAPDocument[];
  caveatsSatisfied?: string[];
  hasContentCaveats?: boolean;
}

export interface ValidationHistoryEntry {
  triple: TripleInput;
  result: GovernanceValidationResult;
  timestamp: number;
}
