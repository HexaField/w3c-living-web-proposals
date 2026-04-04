/**
 * Main layout — Discord-like three-column layout
 */

import type { AppState } from '../setup.js';
import { renderSidebar } from './sidebar.js';
import { renderMessages } from './messages.js';
import { renderMembers } from './members.js';

export function renderApp(container: HTMLElement, state: AppState): void {
  container.innerHTML = '';

  const layout = document.createElement('div');
  layout.className = 'app-layout';

  // Left sidebar
  const sidebarLeft = document.createElement('div');
  sidebarLeft.className = 'sidebar-left';
  renderSidebar(sidebarLeft, state);

  // Center — messages
  const messageArea = document.createElement('div');
  messageArea.className = 'message-area';

  // Right sidebar — members
  const sidebarRight = document.createElement('div');
  sidebarRight.className = 'sidebar-right';
  renderMembers(sidebarRight, state);

  layout.appendChild(sidebarLeft);
  layout.appendChild(messageArea);
  layout.appendChild(sidebarRight);

  // Governance log toggle + panel
  const logToggle = document.createElement('div');
  logToggle.className = 'gov-log-toggle';
  logToggle.textContent = '📋 Governance Log';
  let logVisible = false;

  const logWrapper = document.createElement('div');
  logWrapper.className = 'gov-log-wrapper';
  logWrapper.style.display = 'none';

  const logPanel = document.createElement('div');
  logPanel.className = 'governance-log';
  logPanel.id = 'governance-log';
  logWrapper.appendChild(logPanel);

  logToggle.addEventListener('click', () => {
    logVisible = !logVisible;
    logWrapper.style.display = logVisible ? 'block' : 'none';
  });

  layout.appendChild(logToggle);
  layout.appendChild(logWrapper);

  container.appendChild(layout);

  // Initial channel render
  const activeChannel = state.channels[0];
  if (activeChannel) {
    renderMessages(messageArea, state, activeChannel.id);
  }

  // Listen for updates
  document.addEventListener('chat-update', () => {
    renderSidebar(sidebarLeft, state);
    renderMembers(sidebarRight, state);
    // Re-render messages for current channel
    const currentChannel = sidebarLeft.querySelector('.channel-item.active')?.getAttribute('data-channel-id') || state.channels[0]?.id;
    if (currentChannel) {
      renderMessages(messageArea, state, currentChannel);
    }
    renderGovernanceLogs(logPanel, state);
  });
}

function renderGovernanceLogs(container: HTMLElement, state: AppState): void {
  container.innerHTML = '';
  const recent = state.governanceLogs.slice(-20);
  for (const log of recent) {
    const entry = document.createElement('div');
    entry.className = `log-entry ${log.accepted ? 'accepted' : 'rejected'}`;
    const icon = log.accepted ? '✅' : '⛔';
    const time = new Date(log.time).toLocaleTimeString();
    entry.textContent = `${time} ${icon} ${log.text}`;
    container.appendChild(entry);
  }
  container.scrollTop = container.scrollHeight;
}
