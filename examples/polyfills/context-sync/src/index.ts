export {
  GraphDiff,
  DiffEvent,
  SignalEvent,
  PeerEvent,
  SyncStateChangeEvent,
  SubscriptionEvent,
} from './types.js';

export type {
  ContextSyncState,
  Peer,
  CapabilityProof,
  SpaceTopology,
  PublishOptions,
  PublishedGraph,
  SyncSpaceInfo,
  SyncModuleInfo,
  SyncValidationResult,
} from './types.js';

export { deriveSpaceUri } from './space.js';
export {
  createContextDiff,
  computeRevision,
  computeCommitId,
  verifyBundleSignature,
  type SignCommitFn,
} from './diff.js';

export { installContextSyncExtension } from './extension.js';
export {
  installSyncRuntime,
  requireSyncRuntime,
  getSyncRuntime,
  type ContextSyncRuntime,
} from './runtime.js';
