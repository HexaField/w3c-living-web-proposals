/**
 * Main entry point — routing between setup and app
 */
import { createIdentity, createCanvas, joinCanvas, type AppState } from './setup.js';
import { renderApp } from './components/App.js';

const app = document.getElementById('app')!;
const hashUri = window.location.hash.slice(1);

function showSetup(): void {
  app.innerHTML = '';
  const screen = document.createElement('div');
  screen.className = 'setup-screen';
  const card = document.createElement('div');
  card.className = 'setup-card';

  card.innerHTML = `
    <h1>🎨 Collaborative Canvas</h1>
    <p>A real-time collaborative drawing canvas built on the Living Web — decentralized identity, shared graphs, and governance. No server required.</p>
    <div class="field">
      <label>Display Name</label>
      <input id="display-name" type="text" placeholder="Enter your name..." />
    </div>
  `;

  if (hashUri) {
    card.innerHTML += `
      <div class="field">
        <label>Graph URI</label>
        <input id="graph-uri" type="text" value="${hashUri}" readonly />
      </div>
      <div class="actions"><button id="btn-join">Join Canvas</button></div>
      <div class="divider">or</div>
      <div class="actions"><button id="btn-create" class="btn-secondary">Create New Canvas</button></div>
    `;
  } else {
    card.innerHTML += `
      <div class="field">
        <label>Canvas Name</label>
        <input id="canvas-name" type="text" placeholder="Team Whiteboard" />
      </div>
      <div class="actions"><button id="btn-create">Create Canvas</button></div>
      <div class="divider">or</div>
      <div class="field">
        <label>Invite Link (Graph URI)</label>
        <input id="graph-uri" type="text" placeholder="shared-graph://..." />
      </div>
      <div class="actions"><button id="btn-join" class="btn-secondary">Join Canvas</button></div>
    `;
  }

  screen.appendChild(card);
  app.appendChild(screen);

  document.getElementById('btn-create')?.addEventListener('click', async () => {
    const displayName = (document.getElementById('display-name') as HTMLInputElement).value.trim();
    const canvasName = (document.getElementById('canvas-name') as HTMLInputElement)?.value.trim() || 'My Canvas';
    if (!displayName) { alert('Please enter a display name'); return; }
    try {
      const { did, identity } = await createIdentity(displayName);
      const state = await createCanvas(displayName, canvasName, identity, did);
      window.location.hash = state.graph.uri;
      launchApp(state);
    } catch (e) { alert('Failed: ' + (e as Error).message); }
  });

  document.getElementById('btn-join')?.addEventListener('click', async () => {
    const displayName = (document.getElementById('display-name') as HTMLInputElement).value.trim();
    const graphUri = (document.getElementById('graph-uri') as HTMLInputElement).value.trim();
    if (!displayName) { alert('Please enter a display name'); return; }
    if (!graphUri) { alert('Please enter a graph URI'); return; }
    try {
      const { did, identity } = await createIdentity(displayName);
      const state = await joinCanvas(displayName, graphUri, identity, did);
      window.location.hash = graphUri;
      launchApp(state);
    } catch (e) { alert('Failed: ' + (e as Error).message); }
  });
}

function launchApp(state: AppState): void {
  app.innerHTML = '';
  renderApp(app, state);
}

showSetup();
