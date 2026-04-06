// Test harness setup — loads all polyfills and exposes them on window/navigator

// 01 — Personal Graph polyfill (auto-installs navigator.graph)
import '@living-web/personal-graph/polyfill';

// 02 — Identity polyfill (patches navigator.credentials for DID)
import { install as installIdentity } from '@living-web/identity';
installIdentity();

// 04 — Shape validation extension (adds shape methods to PersonalGraph.prototype)
import { installShapeExtension } from '@living-web/shape-validation';
import { PersonalGraph } from '@living-web/personal-graph';
installShapeExtension(PersonalGraph);

// 03 — Graph sync (used directly in tests, not auto-installed)
import { SharedGraphManager, SharedGraph } from '@living-web/graph-sync';
(window as any).__SharedGraphManager = SharedGraphManager;
(window as any).__SharedGraph = SharedGraph;

// 05 — Governance
import { createGovernanceLayer, GOV, createCapability, issueDefaultCapabilities } from '@living-web/governance';
(window as any).__createGovernanceLayer = createGovernanceLayer;
(window as any).__GOV = GOV;
(window as any).__createCapability = createCapability;
(window as any).__issueDefaultCapabilities = issueDefaultCapabilities;

// Expose SemanticTriple for convenience
import { SemanticTriple, type IdentityProvider } from '@living-web/personal-graph';
(window as any).__SemanticTriple = SemanticTriple;

// DIDIdentityProvider adapter (wraps DIDCredential for SharedGraph)
import { DIDIdentityProvider } from '@living-web/identity';
(window as any).__DIDIdentityProvider = DIDIdentityProvider;

// Helper to create identity + provider in one step
(window as any).__createIdentityProvider = async (displayName: string) => {
  const cred = await (navigator.credentials as any).create({ did: { displayName } });
  if (cred.isLocked) await cred.unlock('__living-web-polyfill__');
  const provider = new DIDIdentityProvider(cred);
  return { cred, provider, did: cred.did };
};

// 06 — Group Identity
import { GroupManager, DefaultGroupRegistry, Group, GROUP, RDF } from '@living-web/group-identity';
(window as any).__GroupIdentity = { GroupManager, DefaultGroupRegistry, Group, GROUP, RDF };

document.getElementById('status')!.textContent = 'ready';
console.log('[test-harness] All polyfills loaded');
