/**
 * P2P VCS — Main entry point
 */
import { createIdentity, createRepo, forkRepo, type AppState } from './setup.js';
import { renderApp } from './app.js';

const app = document.getElementById('app')!;
const hashUri = window.location.hash.slice(1);

function showSetup(): void {
  app.innerHTML = '';
  const screen = document.createElement('div');
  screen.className = 'setup-screen';
  const card = document.createElement('div');
  card.className = 'setup-card';

  card.innerHTML = `
    <h1>🔀 P2P Version Control</h1>
    <p>Git-lite built on the Living Web — decentralised identity, shared graphs, and governance. No server required.</p>
    <div class="field">
      <label>Display Name</label>
      <input id="display-name" type="text" placeholder="Enter your name..." />
    </div>
  `;

  if (hashUri) {
    card.innerHTML += `
      <div class="field">
        <label>Repository URI</label>
        <input id="graph-uri" type="text" value="${hashUri}" readonly />
      </div>
      <div class="actions">
        <button id="btn-fork">Fork / Join Repository</button>
      </div>
      <div class="divider">or</div>
      <div class="actions">
        <button id="btn-create" class="btn-secondary">Create New Repository</button>
      </div>
    `;
  } else {
    card.innerHTML += `
      <div class="field">
        <label>Repository Name</label>
        <input id="repo-name" type="text" placeholder="my-project" />
      </div>
      <div class="actions">
        <button id="btn-create">Create Repository</button>
      </div>
      <div class="divider">or</div>
      <div class="field">
        <label>Fork Link (Graph URI)</label>
        <input id="graph-uri" type="text" placeholder="shared-graph://..." />
      </div>
      <div class="actions">
        <button id="btn-fork" class="btn-secondary">Fork Repository</button>
      </div>
    `;
  }

  screen.appendChild(card);
  app.appendChild(screen);

  document.getElementById('btn-create')?.addEventListener('click', async () => {
    const displayName = (document.getElementById('display-name') as HTMLInputElement).value.trim();
    const repoName = (document.getElementById('repo-name') as HTMLInputElement)?.value.trim() || 'my-project';
    if (!displayName) { alert('Please enter a display name'); return; }
    try {
      const { did, identity } = await createIdentity(displayName);
      const state = await createRepo(displayName, repoName, identity, did);
      window.location.hash = state.graph.uri;
      launchApp(state);
    } catch (e) {
      console.error('Failed to create repo:', e);
      alert('Failed: ' + (e as Error).message);
    }
  });

  document.getElementById('btn-fork')?.addEventListener('click', async () => {
    const displayName = (document.getElementById('display-name') as HTMLInputElement).value.trim();
    const graphUri = (document.getElementById('graph-uri') as HTMLInputElement).value.trim();
    if (!displayName) { alert('Please enter a display name'); return; }
    if (!graphUri) { alert('Please enter a graph URI'); return; }
    try {
      const { did, identity } = await createIdentity(displayName);
      const state = await forkRepo(displayName, graphUri, identity, did);
      window.location.hash = graphUri;
      launchApp(state);
    } catch (e) {
      console.error('Failed to fork:', e);
      alert('Failed: ' + (e as Error).message);
    }
  });
}

function launchApp(state: AppState): void {
  app.innerHTML = '';
  renderApp(app, state);
}

showSetup();
