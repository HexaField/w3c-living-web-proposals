/**
 * Living Web Extension — Content Script
 * Injected into every page's MAIN world via Manifest V3.
 * Feature-detects native support and only installs polyfills if needed.
 */

import { PersonalGraphManager, PersonalGraph, EphemeralIdentity } from '@living-web/personal-graph';
import { install as installIdentity } from '@living-web/identity';
import { SharedGraphManager } from '@living-web/graph-sync';
import { install as installGraphSync } from '@living-web/graph-sync/polyfill';
import { installShapeExtension } from '@living-web/shape-validation';

// Feature detect: if navigator.graph already exists (native browser), skip everything
if (typeof navigator !== 'undefined' && 'graph' in navigator && (navigator as any).graph?.__native) {
  console.info('[Living Web Extension] Native support detected — skipped');
} else {
  // 1. Personal Graph — navigator.graph
  const identity = new EphemeralIdentity();
  const graphManager = new PersonalGraphManager(identity);
  (navigator as any).graph = graphManager;

  // 2. Identity — extends navigator.credentials with DID support
  installIdentity();

  // 3. Shape Validation — extends PersonalGraph with addShape/construct
  installShapeExtension(PersonalGraph);

  // 4. Graph Sync — extends navigator.graph with join/share/listShared
  const syncManager = new SharedGraphManager(identity);
  installGraphSync(syncManager);

  // 5. Governance is available via import — no global install needed
  // Apps import createGovernanceLayer from @living-web/governance directly

  console.info('[Living Web Extension] Polyfill installed');
}
