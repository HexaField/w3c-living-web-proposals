/**
 * Capability framework types.
 *
 * - ZCAPs target `did:graph:...` as their canonical resource.
 * - Enforcement modes (Open / Announced / Enforced) are first-class.
 * - The core caveat types (Expiry, Predicate, Property, RateLimit, Cardinality,
 *   Subject, Object, AuthorOnly) are evaluated here. Additional caveat types
 *   (Shape, Content) and additional constraint kinds (temporal, content,
 *   credential) are supplied by plug-in handlers registered on the engine.
 * - A context's authority is rooted in its root capability — a single ZCAP
 *   minted at creation time and delegatable like any other.
 */

/** Built-in `"capability"` plus any plug-in-registered kind string. */
export type ConstraintKind = string;
export type EnforcementMode = 'open' | 'announced' | 'enforced';

export type CaveatType =
  | 'expiry'
  | 'predicate'
  | 'shape'
  | 'property'
  | 'content'
  | 'rateLimit'
  | 'cardinality'
  | 'subject'
  | 'object'
  | 'authorOnly'
  | 'custom';

export interface Caveat {
  type: CaveatType;
  value: Record<string, unknown>;
}

export interface GraphConstraint {
  readonly id: string;
  readonly kind: ConstraintKind;
  /** The context (did:graph) this constraint is attached to. */
  readonly scope: string;
  /** Depth in the holonic scope chain (0 = directly on the writing context). */
  readonly depth: number;
  readonly properties: Record<string, string>;
}

export interface GovernanceValidationResult {
  readonly allowed: boolean;
  readonly module?: string;
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
  /** did:graph of the context being written to. */
  graphDid: string;
  /** The root capability id of this context. */
  rootCapabilityId: string | null;
  /** Current enforcement mode (defaults to "open" if not set). */
  enforcementMode: EnforcementMode;
  queryTriples: (q: { subject?: string | null; predicate?: string | null; object?: string | null }) => Promise<TripleRecord[]>;
  resolveExpression?: (address: string) => Promise<unknown>;
  now?: () => number;
}

export interface ConstraintHandler {
  kind: string;
  validate(triple: TripleInput, constraint: GraphConstraint, context: ValidationContext): GovernanceValidationResult | Promise<GovernanceValidationResult>;
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
