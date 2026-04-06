import type { SharedGraph } from '@living-web/graph-sync';

/** Member dictionary per §5.2 */
export interface Member {
  /** The member's DID */
  did: string;
  /** true if the member is itself a group */
  isGroup: boolean;
  /** Display name if available */
  name?: string;
  /** Timestamp at which the member joined */
  joinedAt?: number;
}

/** Options for createGroup() per §5.4 */
export interface GroupOptions {
  name?: string;
  description?: string;
  syncModule?: string;
  relays?: string[];
}

/** Predicates used by the group identity spec */
export const GROUP = {
  TYPE: 'group://Group',
  CREATED: 'group://created',
  CREATOR: 'group://creator',
  HAS_MEMBER: 'group://has_member',
  MEMBERSHIP_REQUEST: 'group://membership_request',
  JOINED_AT: 'group://joined_at',
  INVITED_BY: 'group://invited_by',
  ROLE: 'group://role',
  CAPABILITY_TRANSITIVE: 'group://capability_transitive',
  MEMBERSHIP_OPEN: 'group://membership_open',
  MEMBERSHIP_MAX_COUNT: 'group://membership_max_count',
} as const;

/** RDF predicates reused from other specs */
export const RDF = {
  TYPE: 'rdf://type',
  NAME: 'rdf://name',
  DESCRIPTION: 'rdf://description',
} as const;

/** Group registry — tracks known groups for resolution */
export interface GroupRegistry {
  register(group: Group): void;
  resolve(did: string): Group | undefined;
  list(): Group[];
  isGroupDid(did: string): Promise<boolean>;
}

// Forward reference — avoid circular import
import type { Group } from './group.js';
