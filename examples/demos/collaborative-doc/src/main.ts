/**
 * Collaborative Document — Main entry point
 */
import { createIdentity, createDoc, joinDoc, type AppState } from './setup.js';
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
    <h1>📄 Collaborative Document</h1>
    <p>Google Docs on the Living Web — real-time editing, comments, and governance. No server required.</p>
    <div class="field">
      <label>Display Name</label>
      <input id="display-name" type="text" placeholder="Enter your name..." />
    </div>
  `;

  if (hashUri) {
    card.innerHTML += `
      <div class="field">
        <label>Document URI</label>
        <input id="graph-uri" type="text" value="${hashUri}" readonly />
      </div>
      <div class="actions">
        <button id="btn-join">Join Document</button>
      </div>
      <div class="divider">or</div>
      <div class="actions">
        <button id="btn-create" class="btn-secondary">Create New Document</button>
      </div>
    `;
  } else {
    card.innerHTML += `
      <div class="field">
        <label>Document Title</label>
        <input id="doc-title" type="text" placeholder="My Document" />
      </div>
      <div class="actions">
        <button id="btn-create">Create Document</button>
      </div>
      <div class="divider">or</div>
      <div class="field">
        <label>Join Link (Graph URI)</label>
        <input id="graph-uri" type="text" placeholder="shared-graph://..." />
      </div>
      <div class="actions">
        <button id="btn-join" class="btn-secondary">Join Document</button>
      </div>
    `;
  }

  screen.appendChild(card);
  app.appendChild(screen);

  document.getElementById('btn-create')?.addEventListener('click', async () => {
    const displayName = (document.getElementById('display-name') as HTMLInputElement).value.trim();
    const docTitle = (document.getElementById('doc-title') as HTMLInputElement)?.value.trim() || 'Untitled Document';
    if (!displayName) { alert('Please enter a display name'); return; }
    try {
      const { did, identity } = await createIdentity(displayName);
      const state = await createDoc(displayName, docTitle, identity, did);
      window.location.hash = state.graph.uri;
      launchApp(state);
    } catch (e) {
      console.error('Failed to create document:', e);
      alert('Failed: ' + (e as Error).message);
    }
  });

  document.getElementById('btn-join')?.addEventListener('click', async () => {
    const displayName = (document.getElementById('display-name') as HTMLInputElement).value.trim();
    const graphUri = (document.getElementById('graph-uri') as HTMLInputElement).value.trim();
    if (!displayName) { alert('Please enter a display name'); return; }
    if (!graphUri) { alert('Please enter a graph URI'); return; }
    try {
      const { did, identity } = await createIdentity(displayName);
      const state = await joinDoc(displayName, graphUri, identity, did);
      window.location.hash = graphUri;
      launchApp(state);
    } catch (e) {
      console.error('Failed to join document:', e);
      alert('Failed: ' + (e as Error).message);
    }
  });
}

function launchApp(state: AppState): void {
  app.innerHTML = '';
  renderApp(app, state);
}

showSetup();
