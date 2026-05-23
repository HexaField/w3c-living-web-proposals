/**
 * Left sidebar — channel list
 */

import type { AppState } from '../setup.js';
import { Triple } from '@living-web/personal-graph';
import { PREDICATES } from '../shapes.js';
import { renderMessages } from './messages.js';
import { showSettingsModal } from './modals.js';

export function renderSidebar(container: HTMLElement, state: AppState): void {
  container.innerHTML = '';

  // Community header
  const header = document.createElement('div');
  header.className = 'community-header';
  const nameSpan = document.createElement('span');
  nameSpan.textContent = state.communityName;
  header.appendChild(nameSpan);

  // Show group DID (Spec 06)
  if (state.groupDid) {
    const didEl = document.createElement('div');
    didEl.className = 'group-did';
    didEl.textContent = state.groupDid;
    didEl.title = `Group DID: ${state.groupDid}`;
    didEl.style.cssText = 'font-size:10px;color:#72767d;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;padding:0 8px;';
    didEl.addEventListener('click', () => {
      navigator.clipboard?.writeText(state.groupDid);
      didEl.textContent = 'Copied!';
      setTimeout(() => { didEl.textContent = state.groupDid; }, 1500);
    });
    header.appendChild(didEl);
  }

  if (state.isOwner) {
    const settingsBtn = document.createElement('button');
    settingsBtn.className = 'settings-btn';
    settingsBtn.textContent = '⚙️';
    settingsBtn.addEventListener('click', () => showSettingsModal(state));
    header.appendChild(settingsBtn);
  }
  container.appendChild(header);

  // Channel list
  const channelList = document.createElement('div');
  channelList.className = 'channel-list';

  const catLabel = document.createElement('div');
  catLabel.className = 'channel-category';
  catLabel.textContent = 'Text Channels';
  channelList.appendChild(catLabel);

  for (const channel of state.channels) {
    const item = document.createElement('div');
    item.className = 'channel-item';
    item.setAttribute('data-channel-id', channel.id);

    const hash = document.createElement('span');
    hash.className = 'hash';
    hash.textContent = '#';
    item.appendChild(hash);

    const name = document.createElement('span');
    name.textContent = channel.name;
    item.appendChild(name);

    // Indicators
    if (state.governance.readOnlyChannels.has(channel.id)) {
      const badge = document.createElement('span');
      badge.textContent = ' 📢';
      badge.title = 'Read-only (announcements)';
      item.appendChild(badge);
    }
    const slowMode = state.governance.slowModeChannels.get(channel.id);
    if (slowMode) {
      const badge = document.createElement('span');
      badge.textContent = ` ⏱️`;
      badge.title = `Slow mode: ${slowMode / 1000}s`;
      item.appendChild(badge);
    }

    item.addEventListener('click', () => {
      container.querySelectorAll('.channel-item').forEach(el => el.classList.remove('active'));
      item.classList.add('active');
      const msgArea = document.querySelector('.message-area') as HTMLElement;
      if (msgArea) renderMessages(msgArea, state, channel.id);
    });

    channelList.appendChild(item);
  }

  // Set first channel active
  const first = channelList.querySelector('.channel-item');
  if (first) first.classList.add('active');

  // Add channel button (owner/admin only)
  if (state.isOwner) {
    const addCh = document.createElement('div');
    addCh.className = 'add-channel';
    addCh.textContent = '+ Create Channel';
    addCh.addEventListener('click', () => createChannelPrompt(state));
    channelList.appendChild(addCh);
  }

  container.appendChild(channelList);

  // Invite URL
  const invite = document.createElement('div');
  invite.className = 'invite-url';
  const label = document.createElement('label');
  label.textContent = 'Invite Link';
  invite.appendChild(label);
  const input = document.createElement('input');
  input.readOnly = true;
  input.value = state.groupDid;
  input.addEventListener('click', () => {
    input.select();
    navigator.clipboard.writeText(state.groupDid).catch(() => {});
  });
  invite.appendChild(input);
  container.appendChild(invite);
}

async function createChannelPrompt(state: AppState): Promise<void> {
  const name = prompt('Channel name:');
  if (!name || !name.trim()) return;

  const channelId = `channel:${crypto.randomUUID()}`;
  await state.context.createShapeInstance('Channel', channelId, { name: name.trim() });
  await state.context.addTriple(new Triple(state.communityId, PREDICATES.HAS_CHILD, channelId));

  state.channels.push({ id: channelId, name: name.trim() });
  state.messages.set(channelId, []);

  state.bc.postMessage({
    type: 'new-channel',
    groupDid: state.context.did,
    channel: { id: channelId, name: name.trim() },
  });

  document.dispatchEvent(new CustomEvent('chat-update', { detail: { type: 'channel' } }));
}
