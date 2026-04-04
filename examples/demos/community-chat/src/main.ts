/**
 * Main entry point — routing between setup and app
 */

import { createIdentity, createCommunity, joinCommunity, type AppState } from './setup.js';
import { renderApp } from './ui/app.js';

const app = document.getElementById('app')!;

// Check if there's a graph URI in the URL hash
const hashUri = window.location.hash.slice(1);

function showSetup(): void {
  app.innerHTML = '';

  const screen = document.createElement('div');
  screen.className = 'setup-screen';

  const card = document.createElement('div');
  card.className = 'setup-card';

  card.innerHTML = `
    <h1>🌐 Community Chat</h1>
    <p>A Discord-like chat built on the Living Web — decentralized identity, shared graphs, and governance. No server required.</p>
    <div class="field">
      <label>Display Name</label>
      <input id="display-name" type="text" placeholder="Enter your name..." />
    </div>
  `;

  if (hashUri) {
    // Join flow
    card.innerHTML += `
      <div class="field">
        <label>Graph URI</label>
        <input id="graph-uri" type="text" value="${hashUri}" readonly />
      </div>
      <div class="actions">
        <button id="btn-join">Join Community</button>
      </div>
      <div class="divider">or</div>
      <div class="actions">
        <button id="btn-create" class="btn-secondary">Create New Community</button>
      </div>
    `;
  } else {
    // Create flow
    card.innerHTML += `
      <div class="field">
        <label>Community Name</label>
        <input id="community-name" type="text" placeholder="My Awesome Community" />
      </div>
      <div class="actions">
        <button id="btn-create">Create Community</button>
      </div>
      <div class="divider">or</div>
      <div class="field">
        <label>Invite Link (Graph URI)</label>
        <input id="graph-uri" type="text" placeholder="shared-graph://..." />
      </div>
      <div class="actions">
        <button id="btn-join" class="btn-secondary">Join Community</button>
      </div>
    `;
  }

  screen.appendChild(card);
  app.appendChild(screen);

  // Wire up buttons
  document.getElementById('btn-create')?.addEventListener('click', async () => {
    const displayName = (document.getElementById('display-name') as HTMLInputElement).value.trim();
    const communityName = (document.getElementById('community-name') as HTMLInputElement)?.value.trim() || 'My Community';
    if (!displayName) { alert('Please enter a display name'); return; }

    try {
      const { did, identity } = await createIdentity(displayName);
      const state = await createCommunity(displayName, communityName, identity, did);
      // Update URL hash so others can join
      window.location.hash = state.graph.uri;
      launchApp(state);
    } catch (e) {
      console.error('Failed to create community:', e);
      alert('Failed to create community: ' + (e as Error).message);
    }
  });

  document.getElementById('btn-join')?.addEventListener('click', async () => {
    const displayName = (document.getElementById('display-name') as HTMLInputElement).value.trim();
    const graphUri = (document.getElementById('graph-uri') as HTMLInputElement).value.trim();
    if (!displayName) { alert('Please enter a display name'); return; }
    if (!graphUri) { alert('Please enter a graph URI'); return; }

    try {
      const { did, identity } = await createIdentity(displayName);
      const state = await joinCommunity(displayName, graphUri, identity, did);
      window.location.hash = graphUri;
      launchApp(state);
    } catch (e) {
      console.error('Failed to join community:', e);
      alert('Failed to join community: ' + (e as Error).message);
    }
  });
}

function launchApp(state: AppState): void {
  app.innerHTML = '';
  renderApp(app, state);
}

// Start
showSetup();
