/**
 * @living-web/graph-sync — peer-to-peer Context sync.
 *
 * Importing this package augments `Context.prototype` (via {@link installSyncExtension})
 * with publish/peers/diff/signal APIs as defined in the P2P Graph Sync spec.
 */

export {
  ContextDiff,
  DiffEvent,
  SignalEvent,
  PeerEvent,
  SyncStateChangeEvent,
} from './types.js';

export type {
  ContextSyncState,
  Peer,
  CapabilityProof,
  SpaceTopology,
  PublishOptions,
  PublishedContext,
  SyncSpaceInfo,
  SyncModuleInfo,
  SyncValidationResult,
} from './types.js';

export { deriveSpaceUri } from './space.js';
export { createContextDiff, computeRevision } from './diff.js';
export { installSyncExtension } from './sync-extension.js';
