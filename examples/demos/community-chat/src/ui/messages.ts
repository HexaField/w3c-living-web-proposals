/**
 * Message list + input
 */

import type { AppState, ChatMessage } from '../setup.js';
import { validateSend, recordSend } from '../governance.js';

const EMOJIS = ['👍', '❤️', '😂', '🎉', '🤔', '👀', '🔥', '💯'];

export function renderMessages(container: HTMLElement, state: AppState, channelId: string): void {
  container.innerHTML = '';

  const channel = state.channels.find(c => c.id === channelId);
  if (!channel) return;

  // Channel header
  const header = document.createElement('div');
  header.className = 'channel-header';
  const hash = document.createElement('span');
  hash.className = 'hash';
  hash.textContent = '#';
  header.appendChild(hash);
  const name = document.createElement('span');
  name.textContent = channel.name;
  header.appendChild(name);

  if (state.governance.readOnlyChannels.has(channelId)) {
    const topic = document.createElement('span');
    topic.className = 'topic';
    topic.textContent = '📢 Announcements — read only';
    header.appendChild(topic);
  }
  const slowMode = state.governance.slowModeChannels.get(channelId);
  if (slowMode) {
    const topic = document.createElement('span');
    topic.className = 'topic';
    topic.textContent = `⏱️ Slow mode: ${slowMode / 1000}s`;
    header.appendChild(topic);
  }
  container.appendChild(header);

  // Message list
  const msgList = document.createElement('div');
  msgList.className = 'message-list';
  const messages = state.messages.get(channelId) ?? [];

  for (const msg of messages) {
    msgList.appendChild(renderMessage(msg, state, channelId));
  }
  container.appendChild(msgList);
  // Scroll to bottom
  requestAnimationFrame(() => { msgList.scrollTop = msgList.scrollHeight; });

  // Banned banner
  if (state.governance.bannedDids.has(state.did)) {
    const banner = document.createElement('div');
    banner.className = 'banned-banner';
    banner.textContent = '🚫 You have been banned from this community';
    container.appendChild(banner);
    return;
  }

  // Slow mode indicator
  const slowIndicator = document.createElement('div');
  slowIndicator.className = 'slow-mode-indicator';
  slowIndicator.id = 'slow-indicator';
  container.appendChild(slowIndicator);
  updateSlowIndicator(state, channelId, slowIndicator);

  // Message input
  const inputArea = document.createElement('div');
  inputArea.className = 'message-input-area';
  const wrapper = document.createElement('div');
  wrapper.className = 'message-input-wrapper';

  const input = document.createElement('input');
  const isReadOnly = state.governance.readOnlyChannels.has(channelId) && !state.isOwner;
  input.placeholder = isReadOnly ? 'This channel is read-only' : `Message #${channel.name}`;
  input.disabled = isReadOnly;

  const sendBtn = document.createElement('button');
  sendBtn.textContent = '⏎';
  sendBtn.disabled = isReadOnly;

  const doSend = async () => {
    const text = input.value.trim();
    if (!text) return;

    const validation = validateSend(state.governance, state.did, channelId, state.isOwner);

    state.governanceLogs.push({
      text: `Message by ${state.displayName}: "${text.slice(0, 40)}${text.length > 40 ? '...' : ''}" — ${validation.allowed ? 'ACCEPTED' : 'REJECTED: ' + validation.reason}`,
      accepted: validation.allowed,
      time: Date.now(),
    });

    if (!validation.allowed) {
      const indicator = document.getElementById('slow-indicator');
      if (indicator) {
        indicator.textContent = `⛔ ${validation.reason}`;
        indicator.style.color = '#f04747';
        setTimeout(() => {
          indicator.style.color = '';
          updateSlowIndicator(state, channelId, indicator);
        }, 2000);
      }
      document.dispatchEvent(new CustomEvent('chat-update', { detail: { type: 'governance-log' } }));
      return;
    }

    recordSend(state.governance, state.did, channelId);

    const msg: ChatMessage = {
      id: `msg:${crypto.randomUUID()}`,
      channelId,
      body: text,
      authorDid: state.did,
      authorName: state.displayName,
      timestamp: Date.now(),
      reactions: new Map(),
    };

    const chMsgs = state.messages.get(channelId) ?? [];
    chMsgs.push(msg);
    state.messages.set(channelId, chMsgs);

    // Broadcast to other tabs
    state.bc.postMessage({
      type: 'new-message',
      graphUri: state.graph.uri,
      message: {
        ...msg,
        reactions: {},
      },
    });

    input.value = '';
    document.dispatchEvent(new CustomEvent('chat-update', { detail: { type: 'message' } }));
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  });
  sendBtn.addEventListener('click', doSend);

  wrapper.appendChild(input);
  wrapper.appendChild(sendBtn);
  inputArea.appendChild(wrapper);
  container.appendChild(inputArea);
}

function renderMessage(msg: ChatMessage, state: AppState, channelId: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'message';

  // Avatar
  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = msg.authorName.charAt(0).toUpperCase();
  // Color by role
  const member = state.members.find(m => m.did === msg.authorDid);
  if (member && member.roleIds.length > 0) {
    const role = state.roles.find(r => member.roleIds.includes(r.id));
    if (role) avatar.style.background = role.color;
  }
  el.appendChild(avatar);

  // Content
  const content = document.createElement('div');
  content.className = 'message-content';

  const headerEl = document.createElement('div');
  headerEl.className = 'message-header';
  const authorEl = document.createElement('span');
  authorEl.className = 'message-author';
  authorEl.textContent = msg.authorName;
  if (member && member.roleIds.length > 0) {
    const role = state.roles.find(r => member.roleIds.includes(r.id));
    if (role) authorEl.style.color = role.color;
  }
  headerEl.appendChild(authorEl);

  const timeEl = document.createElement('span');
  timeEl.className = 'message-time';
  timeEl.textContent = new Date(msg.timestamp).toLocaleTimeString();
  headerEl.appendChild(timeEl);
  content.appendChild(headerEl);

  const body = document.createElement('div');
  body.className = 'message-body';
  body.textContent = msg.body;
  content.appendChild(body);

  // Reactions
  if (msg.reactions.size > 0) {
    const reactionsEl = document.createElement('div');
    reactionsEl.className = 'message-reactions';
    for (const [emoji, dids] of msg.reactions) {
      const badge = document.createElement('span');
      badge.className = 'reaction-badge';
      badge.innerHTML = `${emoji} <span class="count">${dids.size}</span>`;
      badge.addEventListener('click', () => addReaction(state, channelId, msg.id, emoji));
      reactionsEl.appendChild(badge);
    }
    content.appendChild(reactionsEl);
  }

  el.appendChild(content);

  // Actions (hover)
  const actions = document.createElement('div');
  actions.className = 'message-actions';

  // React button
  const reactBtn = document.createElement('button');
  reactBtn.className = 'msg-action-btn';
  reactBtn.textContent = '😀';
  reactBtn.title = 'React';
  reactBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showEmojiPicker(e.target as HTMLElement, state, channelId, msg.id);
  });
  actions.appendChild(reactBtn);

  // Delete (owner/moderator)
  if (state.isOwner || msg.authorDid === state.did) {
    const delBtn = document.createElement('button');
    delBtn.className = 'msg-action-btn';
    delBtn.textContent = '🗑️';
    delBtn.title = 'Delete';
    delBtn.addEventListener('click', () => deleteMessage(state, channelId, msg.id));
    actions.appendChild(delBtn);
  }

  el.appendChild(actions);
  return el;
}

function addReaction(state: AppState, channelId: string, messageId: string, emoji: string): void {
  const chMsgs = state.messages.get(channelId) ?? [];
  const msg = chMsgs.find(m => m.id === messageId);
  if (!msg) return;

  if (!msg.reactions.has(emoji)) msg.reactions.set(emoji, new Set());
  msg.reactions.get(emoji)!.add(state.did);

  state.bc.postMessage({
    type: 'reaction',
    graphUri: state.graph.uri,
    channelId, messageId, emoji,
    authorDid: state.did,
  });

  state.governanceLogs.push({
    text: `Reaction ${emoji} by ${state.displayName} — ACCEPTED`,
    accepted: true,
    time: Date.now(),
  });

  document.dispatchEvent(new CustomEvent('chat-update', { detail: { type: 'reaction' } }));
}

function deleteMessage(state: AppState, channelId: string, messageId: string): void {
  const chMsgs = state.messages.get(channelId) ?? [];
  const idx = chMsgs.findIndex(m => m.id === messageId);
  if (idx === -1) return;

  chMsgs.splice(idx, 1);
  state.bc.postMessage({
    type: 'delete-message',
    graphUri: state.graph.uri,
    channelId, messageId,
  });

  state.governanceLogs.push({
    text: `Message deleted by ${state.displayName} — ACCEPTED`,
    accepted: true,
    time: Date.now(),
  });

  document.dispatchEvent(new CustomEvent('chat-update', { detail: { type: 'message' } }));
}

function showEmojiPicker(anchor: HTMLElement, state: AppState, channelId: string, messageId: string): void {
  // Remove existing
  document.querySelectorAll('.emoji-picker').forEach(el => el.remove());

  const picker = document.createElement('div');
  picker.className = 'emoji-picker';
  picker.style.position = 'fixed';
  const rect = anchor.getBoundingClientRect();
  picker.style.left = `${rect.left}px`;
  picker.style.top = `${rect.top - 60}px`;

  for (const emoji of EMOJIS) {
    const btn = document.createElement('button');
    btn.textContent = emoji;
    btn.addEventListener('click', () => {
      addReaction(state, channelId, messageId, emoji);
      picker.remove();
    });
    picker.appendChild(btn);
  }

  document.body.appendChild(picker);
  setTimeout(() => {
    const handler = () => { picker.remove(); document.removeEventListener('click', handler); };
    document.addEventListener('click', handler);
  }, 0);
}

function updateSlowIndicator(state: AppState, channelId: string, el: HTMLElement): void {
  const interval = state.governance.slowModeChannels.get(channelId);
  if (!interval) {
    el.textContent = '';
    return;
  }
  const key = `${state.did}:${channelId}`;
  const last = state.governance.lastMessageTime.get(key) ?? 0;
  const remaining = Math.max(0, interval - (Date.now() - last));
  if (remaining > 0) {
    el.textContent = `⏱️ Slow mode: wait ${Math.ceil(remaining / 1000)}s`;
    setTimeout(() => updateSlowIndicator(state, channelId, el), 1000);
  } else {
    el.textContent = `⏱️ Slow mode: ${interval / 1000}s interval`;
  }
}
