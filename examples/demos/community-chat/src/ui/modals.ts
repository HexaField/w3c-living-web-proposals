/**
 * Modals — settings, role management, governance controls
 */

import type { AppState } from '../setup.js';
import { setSlowMode, setReadOnly, banMember, issueAdminZcap } from '../governance.js';

export function showSettingsModal(state: AppState): void {
  // Remove existing
  document.querySelectorAll('.modal-overlay').forEach(el => el.remove());

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  const modal = document.createElement('div');
  modal.className = 'modal';

  const title = document.createElement('h2');
  title.textContent = '⚙️ Community Settings';
  modal.appendChild(title);

  // Tab bar
  const tabBar = document.createElement('div');
  tabBar.className = 'tab-bar';
  const tabs = ['Channels', 'Members', 'Moderation'];
  let activeTab = 'Channels';

  const tabContent = document.createElement('div');

  function renderTab(): void {
    tabContent.innerHTML = '';
    tabBar.innerHTML = '';

    for (const tab of tabs) {
      const btn = document.createElement('button');
      btn.textContent = tab;
      btn.className = tab === activeTab ? 'active' : '';
      btn.addEventListener('click', () => { activeTab = tab; renderTab(); });
      tabBar.appendChild(btn);
    }

    if (activeTab === 'Channels') renderChannelsTab(tabContent, state, overlay);
    else if (activeTab === 'Members') renderMembersTab(tabContent, state, overlay);
    else if (activeTab === 'Moderation') renderModerationTab(tabContent, state, overlay);
  }

  modal.appendChild(tabBar);
  modal.appendChild(tabContent);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  renderTab();
}

function renderChannelsTab(container: HTMLElement, state: AppState, overlay: HTMLElement): void {
  for (const channel of state.channels) {
    const item = document.createElement('div');
    item.className = 'role-item';

    const nameEl = document.createElement('span');
    nameEl.className = 'role-name';
    nameEl.textContent = `# ${channel.name}`;
    item.appendChild(nameEl);

    // Slow mode toggle
    const slowBtn = document.createElement('button');
    const currentSlow = state.governance.slowModeChannels.get(channel.id);
    slowBtn.textContent = currentSlow ? `⏱️ ${currentSlow / 1000}s` : '⏱️ Off';
    slowBtn.style.fontSize = '0.75rem';
    slowBtn.addEventListener('click', () => {
      const seconds = currentSlow ? 0 : parseInt(prompt('Slow mode interval (seconds):') || '0', 10);
      setSlowMode(state.governance, channel.id, seconds * 1000);
      state.bc.postMessage({
        type: 'governance-update',
        graphUri: state.graph.uri,
        action: 'slow-mode',
        channelId: channel.id,
        interval: seconds * 1000,
      });
      state.governanceLogs.push({
        text: `Slow mode ${seconds > 0 ? `enabled (${seconds}s)` : 'disabled'} on #${channel.name}`,
        accepted: true,
        time: Date.now(),
      });
      document.dispatchEvent(new CustomEvent('chat-update', { detail: { type: 'governance' } }));
      overlay.remove();
      showSettingsModal(state);
    });
    item.appendChild(slowBtn);

    // Read-only toggle
    const roBtn = document.createElement('button');
    const isReadOnly = state.governance.readOnlyChannels.has(channel.id);
    roBtn.textContent = isReadOnly ? '📢 Read-only' : '📢 Normal';
    roBtn.style.fontSize = '0.75rem';
    roBtn.className = isReadOnly ? 'btn-danger' : 'btn-secondary';
    roBtn.addEventListener('click', () => {
      setReadOnly(state.governance, channel.id, !isReadOnly);
      state.bc.postMessage({
        type: 'governance-update',
        graphUri: state.graph.uri,
        action: 'read-only',
        channelId: channel.id,
        readOnly: !isReadOnly,
      });
      state.governanceLogs.push({
        text: `#${channel.name} set to ${!isReadOnly ? 'read-only' : 'normal'}`,
        accepted: true,
        time: Date.now(),
      });
      document.dispatchEvent(new CustomEvent('chat-update', { detail: { type: 'governance' } }));
      overlay.remove();
      showSettingsModal(state);
    });
    item.appendChild(roBtn);

    container.appendChild(item);
  }
}

function renderMembersTab(container: HTMLElement, state: AppState, overlay: HTMLElement): void {
  for (const member of state.members) {
    if (member.did === state.did) continue; // Skip self

    const item = document.createElement('div');
    item.className = 'member-manage-item';

    const nameEl = document.createElement('span');
    nameEl.className = 'name';
    nameEl.textContent = member.name;
    const role = state.roles.find(r => member.roleIds.includes(r.id));
    if (role) nameEl.style.color = role.color;
    item.appendChild(nameEl);

    // Promote button
    const promoteBtn = document.createElement('button');
    promoteBtn.textContent = '⬆️ Promote';
    promoteBtn.style.fontSize = '0.75rem';
    promoteBtn.addEventListener('click', () => {
      issueAdminZcap(state.governance, member.did, state.did);
      const adminRole = state.roles.find(r => r.name === 'Moderator');
      if (adminRole && !member.roleIds.includes(adminRole.id)) {
        member.roleIds = [adminRole.id];
      }
      state.bc.postMessage({
        type: 'governance-update',
        graphUri: state.graph.uri,
        action: 'promote',
        targetDid: member.did,
        ownerDid: state.did,
      });
      state.governanceLogs.push({
        text: `${member.name} promoted to Moderator`,
        accepted: true,
        time: Date.now(),
      });
      document.dispatchEvent(new CustomEvent('chat-update', { detail: { type: 'member' } }));
      overlay.remove();
      showSettingsModal(state);
    });
    item.appendChild(promoteBtn);

    // Ban button
    const banned = state.governance.bannedDids.has(member.did);
    const banBtn = document.createElement('button');
    banBtn.textContent = banned ? '🚫 Banned' : '🔨 Ban';
    banBtn.className = 'btn-danger';
    banBtn.style.fontSize = '0.75rem';
    banBtn.disabled = banned;
    banBtn.addEventListener('click', () => {
      if (!confirm(`Ban ${member.name}?`)) return;
      banMember(state.governance, member.did);
      state.bc.postMessage({
        type: 'governance-update',
        graphUri: state.graph.uri,
        action: 'ban',
        targetDid: member.did,
      });
      state.governanceLogs.push({
        text: `${member.name} BANNED from community`,
        accepted: true,
        time: Date.now(),
      });
      document.dispatchEvent(new CustomEvent('chat-update', { detail: { type: 'member' } }));
      overlay.remove();
      showSettingsModal(state);
    });
    item.appendChild(banBtn);

    container.appendChild(item);
  }

  if (state.members.length <= 1) {
    const empty = document.createElement('p');
    empty.style.color = 'var(--text-muted)';
    empty.textContent = 'No other members yet. Share the invite link!';
    container.appendChild(empty);
  }
}

function renderModerationTab(container: HTMLElement, state: AppState, _overlay: HTMLElement): void {
  const info = document.createElement('div');
  info.style.color = 'var(--text-secondary)';
  info.style.fontSize = '0.85rem';
  info.innerHTML = `
    <h3 style="margin-bottom: 12px;">Governance Controls</h3>
    <p style="margin-bottom: 8px;">This demo showcases the Living Web governance engine:</p>
    <ul style="padding-left: 20px; line-height: 1.8;">
      <li><strong>Slow mode</strong> — Set on the Channels tab. Limits message frequency per user.</li>
      <li><strong>Read-only channels</strong> — Set on the Channels tab. Only owner can post.</li>
      <li><strong>Ban</strong> — Set on the Members tab. Revokes all capabilities for a DID.</li>
      <li><strong>Promote</strong> — Set on the Members tab. Delegates moderator ZCAP.</li>
    </ul>
    <p style="margin-top: 12px;">All governance is enforced client-side via ZCAP-LD capabilities.<br>
    No server — just math and cryptography.</p>
    <h3 style="margin: 16px 0 8px;">Active Constraints</h3>
  `;

  // Show active constraints
  const constraints: string[] = [];
  for (const [chId, interval] of state.governance.slowModeChannels) {
    const ch = state.channels.find(c => c.id === chId);
    constraints.push(`⏱️ Slow mode on #${ch?.name ?? 'unknown'}: ${interval / 1000}s`);
  }
  for (const chId of state.governance.readOnlyChannels) {
    const ch = state.channels.find(c => c.id === chId);
    constraints.push(`📢 Read-only: #${ch?.name ?? 'unknown'}`);
  }
  for (const did of state.governance.bannedDids) {
    const member = state.members.find(m => m.did === did);
    constraints.push(`🚫 Banned: ${member?.name ?? did.slice(0, 20) + '...'}`);
  }

  if (constraints.length > 0) {
    const list = document.createElement('ul');
    list.style.paddingLeft = '20px';
    list.style.lineHeight = '1.8';
    for (const c of constraints) {
      const li = document.createElement('li');
      li.textContent = c;
      list.appendChild(li);
    }
    info.appendChild(list);
  } else {
    const none = document.createElement('p');
    none.style.color = 'var(--text-muted)';
    none.textContent = 'No active constraints.';
    info.appendChild(none);
  }

  container.appendChild(info);
}
