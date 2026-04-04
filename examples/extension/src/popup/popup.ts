import type { StatusResponse } from '../types.js';
import './popup.css';

const statusDot = document.getElementById('statusDot')!;
const identityInfo = document.getElementById('identityInfo')!;
const identityCreate = document.getElementById('identityCreate')!;
const identityDid = document.getElementById('identityDid')!;
const identityName = document.getElementById('identityName')!;
const graphsList = document.getElementById('graphsList')!;
const sharedGraphsList = document.getElementById('sharedGraphsList')!;
const createIdentityBtn = document.getElementById('createIdentityBtn')!;
const displayNameInput = document.getElementById('displayNameInput') as HTMLInputElement;

function showIdentity(did: string, displayName: string) {
  identityDid.textContent = did;
  identityName.textContent = displayName;
  identityInfo.classList.remove('hidden');
  identityCreate.classList.add('hidden');
}

function showCreateIdentity() {
  identityInfo.classList.add('hidden');
  identityCreate.classList.remove('hidden');
}

function renderGraphs(graphs: StatusResponse['graphs']) {
  if (graphs.length === 0) {
    graphsList.innerHTML = '<p class="empty">No graphs yet</p>';
    return;
  }
  graphsList.innerHTML = graphs.map(g =>
    `<div class="graph-item">
      <span class="graph-name">${g.name}</span>
      <span class="graph-meta">${g.tripleCount} triples</span>
    </div>`
  ).join('');
}

function renderSharedGraphs(graphs: StatusResponse['sharedGraphs']) {
  if (graphs.length === 0) {
    sharedGraphsList.innerHTML = '<p class="empty">No shared graphs</p>';
    return;
  }
  sharedGraphsList.innerHTML = graphs.map(g =>
    `<div class="graph-item">
      <span class="graph-name">${g.name}</span>
      <span class="graph-meta">${g.peerCount} peers · ${g.syncState}</span>
    </div>`
  ).join('');
}

async function loadStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_STATUS' }) as StatusResponse;
    statusDot.classList.toggle('inactive', !response.active);

    if (response.identity) {
      showIdentity(response.identity.did, response.identity.displayName);
    } else {
      showCreateIdentity();
    }

    renderGraphs(response.graphs);
    renderSharedGraphs(response.sharedGraphs);
  } catch {
    statusDot.classList.add('inactive');
    showCreateIdentity();
  }
}

createIdentityBtn.addEventListener('click', async () => {
  const displayName = displayNameInput.value.trim() || 'Anonymous';
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'CREATE_IDENTITY',
      displayName,
    });
    if (response?.did) {
      showIdentity(response.did, displayName);
    }
  } catch (err) {
    console.error('[Living Web Popup] Failed to create identity:', err);
  }
});

// Load status on popup open
loadStatus();
