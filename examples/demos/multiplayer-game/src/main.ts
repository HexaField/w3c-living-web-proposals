/**
 * Main entry point — setup screen + launch game
 */
import { createIdentity, createWorld, joinWorld, type AppState } from './setup.js';
import { launchGame } from './game/scene.js';

const app = document.getElementById('app')!;
const hashUri = window.location.hash.slice(1);

function showSetup(): void {
  app.innerHTML = '';
  const screen = document.createElement('div');
  screen.className = 'setup-screen';
  const card = document.createElement('div');
  card.className = 'setup-card';

  card.innerHTML = `
    <h1>🎮 Multiplayer Game</h1>
    <p>A 3D multiplayer world built on the Living Web — explore, collect items, chat with other players. No server required.</p>
    <div class="field">
      <label>Display Name</label>
      <input id="display-name" type="text" placeholder="Enter your name..." />
    </div>
  `;

  if (hashUri) {
    card.innerHTML += `
      <div class="field"><label>World URI</label><input id="graph-uri" type="text" value="${hashUri}" readonly /></div>
      <div class="actions"><button id="btn-join">Join World</button></div>
      <div class="divider">or</div>
      <div class="actions"><button id="btn-create" class="btn-secondary">Create New World</button></div>
    `;
  } else {
    card.innerHTML += `
      <div class="field"><label>World Name</label><input id="world-name" type="text" placeholder="Demo Arena" /></div>
      <div class="actions"><button id="btn-create">Create World</button></div>
      <div class="divider">or</div>
      <div class="field"><label>World Link (Graph URI)</label><input id="graph-uri" type="text" placeholder="shared-graph://..." /></div>
      <div class="actions"><button id="btn-join" class="btn-secondary">Join World</button></div>
    `;
  }

  screen.appendChild(card);
  app.appendChild(screen);

  document.getElementById('btn-create')?.addEventListener('click', async () => {
    const displayName = (document.getElementById('display-name') as HTMLInputElement).value.trim();
    const worldName = (document.getElementById('world-name') as HTMLInputElement)?.value.trim() || 'Demo Arena';
    if (!displayName) { alert('Please enter a display name'); return; }
    try {
      const { did, identity } = await createIdentity(displayName);
      const state = await createWorld(displayName, worldName, identity, did);
      window.location.hash = state.graph.uri;
      startGame(state);
    } catch (e) { alert('Failed: ' + (e as Error).message); }
  });

  document.getElementById('btn-join')?.addEventListener('click', async () => {
    const displayName = (document.getElementById('display-name') as HTMLInputElement).value.trim();
    const graphUri = (document.getElementById('graph-uri') as HTMLInputElement).value.trim();
    if (!displayName) { alert('Please enter a display name'); return; }
    if (!graphUri) { alert('Please enter a world URI'); return; }
    try {
      const { did, identity } = await createIdentity(displayName);
      const state = await joinWorld(displayName, graphUri, identity, did);
      window.location.hash = graphUri;
      startGame(state);
    } catch (e) { alert('Failed: ' + (e as Error).message); }
  });
}

function startGame(state: AppState): void {
  app.innerHTML = '';
  launchGame(app, state);
}

showSetup();
