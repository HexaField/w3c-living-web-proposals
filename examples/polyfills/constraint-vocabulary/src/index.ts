import type { ConstraintHandler } from '@living-web/capability-framework';
import { temporalConstraintHandler } from './temporal.js';
import { contentConstraintHandler } from './content.js';
import { credentialConstraintHandler } from './credential.js';

export { temporalConstraintHandler } from './temporal.js';
export { contentConstraintHandler } from './content.js';
export { credentialConstraintHandler } from './credential.js';
export {
  predicateCaveatHandler,
  propertyCaveatHandler,
  subjectCaveatHandler,
  objectCaveatHandler,
  rateLimitCaveatHandler,
  cardinalityCaveatHandler,
  authorOnlyCaveatHandler,
  shapeCaveatHandler,
  contentCaveatHandler,
  credentialCaveatHandler,
  standardCaveatTypes,
  resetStandardCaveatCounters,
} from './caveats.js';
export { VOCAB } from './predicates.js';
export type { VerifiableCredential } from './types.js';

/**
 * The standard set of constraint-kind handlers defined by this vocabulary.
 * Pass to `createGovernanceLayer({ constraintKinds: standardConstraintKinds })`
 * to install all of them, or register them individually.
 */
export const standardConstraintKinds: ConstraintHandler[] = [
  temporalConstraintHandler,
  contentConstraintHandler,
  credentialConstraintHandler,
];
