export type ConstraintKind = 'capability' | 'temporal' | 'content' | 'credential';

export interface GraphConstraint {
  readonly id: string;
  readonly kind: ConstraintKind;
  readonly scope: string;
  readonly depth: number;
  readonly properties: Record<string, string>;
}

export interface ValidationResult {
  readonly allowed: boolean;
  readonly module?: string;
  readonly reason?: string;
  readonly rejectedBy?: string;
}

export interface CapabilityInfo {
  readonly id: string;
  readonly predicates: string[];
  readonly scope: string | null;
  readonly expires: string | null;
}

export interface ZCAPDocument {
  id: string;
  invoker: string;
  parentCapability: string | null;
  capability: {
    predicates: string[];
    scope: {
      within: string | null;
      graph: string;
    };
  };
  expires?: string | null;
  proof: {
    type: string;
    created: string;
    verificationMethod: string;
    proofPurpose: string;
    proofValue: string;
  };
}

export interface VerifiableCredential {
  type: string[];
  issuer: string;
  issuanceDate: string;
  expirationDate?: string;
  credentialSubject: {
    id: string;
    [key: string]: unknown;
  };
  proof: {
    type: string;
    created: string;
    verificationMethod: string;
    proofPurpose: string;
    proofValue: string;
  };
}

export interface ConstraintHandler {
  kind: string;
  validate(triple: TripleInput, constraint: GraphConstraint, context: ValidationContext): ValidationResult;
}

export interface TripleInput {
  source: string;
  predicate: string | null;
  target: string;
  author: string;
  timestamp: string;
}

export interface ValidationContext {
  graphUri: string;
  rootAuthority: string;
  queryTriples: (q: { source?: string | null; predicate?: string | null; target?: string | null }) => Promise<TripleRecord[]>;
  resolveExpression?: (address: string) => Promise<unknown>;
  now?: () => number;
}

export interface TripleRecord {
  data: { source: string; predicate: string | null; target: string };
  author: string;
  timestamp: string;
}

export interface ValidationHistoryEntry {
  triple: TripleInput;
  result: ValidationResult;
  timestamp: number;
}
