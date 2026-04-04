/**
 * Collaborative Document — App renderer
 */
import {
  type AppState, type Block, type Comment,
  broadcastBlockUpdate, broadcastNewBlock, broadcastDeleteBlock,
  promoteCollaborator,
} from './setup.js';
import { validateEdit, validateComment, recordComment, type DocRole } from './graph/governance.js';

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return `${Math.floor(diff / 3600000)}h ago`;
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export function renderApp(root: HTMLElement, state: AppState): void {
  let showGovLog = true;
  let showResolved = false;
  let commentBlockId: string | null = null;

  function render(): void {
    root.innerHTML = '';
    const layout = document.createElement('div');
    layout.className = 'doc-layout';

    // === Top bar ===
    const topBar = document.createElement('div');
    topBar.className = 'top-bar';

    const titleInput = document.createElement('input');
    titleInput.className = 'doc-title';
    titleInput.value = state.docTitle;
    titleInput.addEventListener('change', () => {
      state.docTitle = titleInput.value;
      state.bc.postMessage({ type: 'doc-title-change', graphUri: state.graph.uri, did: state.did, title: titleInput.value });
    });
    if (!state.isOwner) titleInput.readOnly = true;

    const roleBadge = document.createElement('span');
    roleBadge.className = `role-badge role-${state.myRole}`;
    roleBadge.textContent = state.myRole;

    const spacer = document.createElement('span');
    spacer.className = 'spacer';

    const shareBtn = document.createElement('button');
    shareBtn.className = 'share-btn';
    shareBtn.textContent = '🔗 Share';
    shareBtn.addEventListener('click', () => {
      navigator.clipboard?.writeText(state.graph.uri);
      shareBtn.textContent = '✓ Copied!';
      setTimeout(() => { shareBtn.textContent = '🔗 Share'; }, 2000);
    });

    const online = document.createElement('span');
    online.className = 'online-count';
    online.textContent = `👥 ${state.collaborators.length}`;

    topBar.append(titleInput, roleBadge, spacer, shareBtn, online);
    layout.appendChild(topBar);

    // === Toolbar ===
    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar';
    const blockTypes: [string, string][] = [
      ['¶', 'paragraph'], ['H1', 'heading1'], ['H2', 'heading2'], ['H3', 'heading3'],
      ['•', 'bullet_list'], ['1.', 'numbered_list'], ['""', 'quote'], ['</>', 'code'], ['―', 'divider'],
    ];
    for (const [label, type] of blockTypes) {
      const btn = document.createElement('button');
      btn.textContent = label;
      const activeBlock = state.blocks.find(b => b.id === state.activeBlockId);
      if (activeBlock?.type === type) btn.classList.add('active');
      btn.addEventListener('click', () => {
        if (!state.activeBlockId) return;
        const v = validateEdit(state.governance, state.did, state.isOwner);
        if (!v.allowed) {
          state.governanceLogs.push({ text: `Block type change REJECTED — ${v.reason}`, accepted: false, time: Date.now() });
          document.dispatchEvent(new CustomEvent('doc-update', { detail: { type: 'governance' } }));
          return;
        }
        const block = state.blocks.find(b => b.id === state.activeBlockId);
        if (block) {
          block.type = type as Block['type'];
          broadcastBlockUpdate(state, block.id, block.content, block.type);
          render();
        }
      });
      toolbar.appendChild(btn);
    }

    // Bold/Italic
    const boldBtn = document.createElement('button');
    boldBtn.textContent = 'B';
    boldBtn.style.fontWeight = '700';
    boldBtn.addEventListener('click', () => document.execCommand('bold'));
    const italicBtn = document.createElement('button');
    italicBtn.textContent = 'I';
    italicBtn.style.fontStyle = 'italic';
    italicBtn.addEventListener('click', () => document.execCommand('italic'));
    toolbar.append(boldBtn, italicBtn);

    layout.appendChild(toolbar);

    // === Editor area ===
    const editorArea = document.createElement('div');
    editorArea.className = 'editor-area';

    for (const block of state.blocks) {
      const blockEl = document.createElement('div');
      blockEl.className = `block${block.id === state.activeBlockId ? ' active' : ''}${block.locked ? ' locked' : ''}`;
      blockEl.setAttribute('data-type', block.type);
      blockEl.setAttribute('data-block-id', block.id);

      if (block.type !== 'divider') {
        blockEl.contentEditable = (state.myRole === 'owner' || state.myRole === 'editor') ? 'true' : 'false';
        blockEl.innerHTML = block.content || '';

        if (!block.content && block.id === state.activeBlockId) {
          blockEl.classList.add('block-placeholder');
          blockEl.setAttribute('data-placeholder', 'Type something...');
        }

        // Remote cursor indicator
        for (const [, cursor] of state.remoteCursors) {
          if (cursor.blockId === block.id) {
            const cursorEl = document.createElement('div');
            cursorEl.className = 'remote-cursor';
            cursorEl.style.background = cursor.color;
            cursorEl.style.right = '-12px';
            cursorEl.style.top = '4px';
            cursorEl.innerHTML = `<div class="remote-cursor-label" style="background:${cursor.color}">${escapeHtml(cursor.name)}</div>`;
            blockEl.appendChild(cursorEl);
          }
        }

        blockEl.addEventListener('focus', () => {
          state.activeBlockId = block.id;
          // Remove active class from all blocks
          editorArea.querySelectorAll('.block.active').forEach(el => el.classList.remove('active'));
          blockEl.classList.add('active');
        });

        let debounceTimer: ReturnType<typeof setTimeout>;
        blockEl.addEventListener('input', () => {
          const v = validateEdit(state.governance, state.did, state.isOwner);
          if (!v.allowed) {
            state.governanceLogs.push({ text: `Block edit REJECTED — ${v.reason}`, accepted: false, time: Date.now() });
            blockEl.innerHTML = block.content;
            document.dispatchEvent(new CustomEvent('doc-update', { detail: { type: 'governance' } }));
            return;
          }
          block.content = blockEl.innerHTML;
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            broadcastBlockUpdate(state, block.id, block.content);
            state.governanceLogs.push({ text: `Block edit by ${state.displayName} ACCEPTED`, accepted: true, time: Date.now() });
          }, 300);
        });

        blockEl.addEventListener('keydown', (e: KeyboardEvent) => {
          if (e.key === 'Enter' && !e.shiftKey && block.type !== 'code') {
            e.preventDefault();
            const v = validateEdit(state.governance, state.did, state.isOwner);
            if (!v.allowed) return;

            const newBlock: Block = {
              id: `block:${crypto.randomUUID()}`,
              type: 'paragraph',
              content: '',
              authorDid: state.did,
              locked: false,
              lockedBy: null,
            };
            const idx = state.blocks.findIndex(b => b.id === block.id);
            state.blocks.splice(idx + 1, 0, newBlock);
            broadcastNewBlock(state, block.id, newBlock);
            state.activeBlockId = newBlock.id;
            render();
            // Focus new block
            setTimeout(() => {
              const newEl = editorArea.querySelector(`[data-block-id="${newBlock.id}"]`) as HTMLElement;
              newEl?.focus();
            }, 10);
          }

          if (e.key === 'Backspace' && block.content === '' && state.blocks.length > 1) {
            e.preventDefault();
            const v = validateEdit(state.governance, state.did, state.isOwner);
            if (!v.allowed) return;
            const idx = state.blocks.findIndex(b => b.id === block.id);
            state.blocks.splice(idx, 1);
            broadcastDeleteBlock(state, block.id);
            state.activeBlockId = state.blocks[Math.max(0, idx - 1)]?.id || null;
            render();
          }
        });

        // Comment on block via right-click context
        blockEl.addEventListener('contextmenu', (e: MouseEvent) => {
          if (state.myRole === 'viewer') return;
          e.preventDefault();
          commentBlockId = block.id;
          render();
        });
      }

      editorArea.appendChild(blockEl);
    }

    layout.appendChild(editorArea);

    // === Comment sidebar ===
    const sidebar = document.createElement('div');
    sidebar.className = 'comment-sidebar';

    const sideHeader = document.createElement('div');
    sideHeader.className = 'sidebar-header';
    sideHeader.innerHTML = '<span>💬 Comments</span>';
    const resolvedToggle = document.createElement('button');
    resolvedToggle.style.cssText = 'font-size:0.7rem;padding:4px 8px;background:var(--bg-tertiary)';
    resolvedToggle.textContent = showResolved ? 'Hide resolved' : `Show resolved (${state.comments.filter(c => c.resolved).length})`;
    resolvedToggle.addEventListener('click', () => { showResolved = !showResolved; render(); });
    sideHeader.appendChild(resolvedToggle);
    sidebar.appendChild(sideHeader);

    const commentList = document.createElement('div');
    commentList.className = 'comment-list';

    const visibleComments = state.comments.filter(c => showResolved || !c.resolved);
    for (const comment of visibleComments) {
      const thread = document.createElement('div');
      thread.className = `comment-thread${comment.resolved ? ' resolved' : ''}`;

      thread.innerHTML = `
        <div>
          <span class="comment-author">${escapeHtml(comment.authorName)}</span>
          <span class="comment-time">${timeAgo(comment.time)}</span>
        </div>
        <div class="comment-body">${escapeHtml(comment.body)}</div>
      `;

      // Replies
      for (const reply of comment.replies) {
        const replyEl = document.createElement('div');
        replyEl.className = 'comment-reply';
        replyEl.innerHTML = `
          <span class="comment-author">${escapeHtml(reply.authorName)}</span>
          <span class="comment-time">${timeAgo(reply.time)}</span>
          <div class="comment-body">${escapeHtml(reply.body)}</div>
        `;
        thread.appendChild(replyEl);
      }

      const actions = document.createElement('div');
      actions.className = 'comment-actions';

      if (!comment.resolved && state.myRole !== 'viewer') {
        // Reply
        const replyBtn = document.createElement('button');
        replyBtn.textContent = 'Reply';
        replyBtn.addEventListener('click', () => {
          const body = prompt('Reply:');
          if (!body?.trim()) return;
          const reply = {
            id: `reply:${crypto.randomUUID()}`,
            body: body.trim(),
            authorDid: state.did,
            authorName: state.displayName,
            time: Date.now(),
          };
          comment.replies.push(reply);
          state.bc.postMessage({
            type: 'doc-new-reply', graphUri: state.graph.uri,
            did: state.did, commentId: comment.id, reply,
          });
          render();
        });
        actions.appendChild(replyBtn);

        if (state.myRole === 'owner' || state.myRole === 'editor') {
          const resolveBtn = document.createElement('button');
          resolveBtn.textContent = '✓ Resolve';
          resolveBtn.addEventListener('click', () => {
            comment.resolved = true;
            state.bc.postMessage({
              type: 'doc-resolve-comment', graphUri: state.graph.uri, commentId: comment.id,
            });
            render();
          });
          actions.appendChild(resolveBtn);
        }
      }
      thread.appendChild(actions);
      commentList.appendChild(thread);
    }

    if (visibleComments.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:16px;color:var(--text-muted);font-size:0.85rem;text-align:center';
      empty.textContent = 'No comments yet. Right-click a block to add one.';
      commentList.appendChild(empty);
    }

    sidebar.appendChild(commentList);

    // Add comment form (if commenting on a block)
    if (commentBlockId && state.myRole !== 'viewer') {
      const form = document.createElement('div');
      form.className = 'add-comment-form';
      const label = document.createElement('div');
      label.style.cssText = 'font-size:0.75rem;color:var(--text-muted);margin-bottom:4px';
      label.textContent = `Comment on block...`;
      const ta = document.createElement('textarea');
      ta.placeholder = 'Write a comment...';
      const submitBtn = document.createElement('button');
      submitBtn.textContent = 'Add Comment';
      submitBtn.addEventListener('click', () => {
        const body = ta.value.trim();
        if (!body) return;
        const v = validateComment(state.governance, state.did, state.isOwner);
        if (!v.allowed) {
          state.governanceLogs.push({ text: `Comment REJECTED — ${v.reason}`, accepted: false, time: Date.now() });
          document.dispatchEvent(new CustomEvent('doc-update', { detail: { type: 'governance' } }));
          return;
        }
        recordComment(state.governance, state.did);
        const comment: Comment = {
          id: `comment:${crypto.randomUUID()}`,
          body,
          authorDid: state.did,
          authorName: state.displayName,
          blockId: commentBlockId!,
          time: Date.now(),
          resolved: false,
          replies: [],
        };
        state.comments.push(comment);
        state.bc.postMessage({
          type: 'doc-new-comment', graphUri: state.graph.uri,
          did: state.did, comment,
        });
        state.governanceLogs.push({ text: `Comment by ${state.displayName} ACCEPTED`, accepted: true, time: Date.now() });
        commentBlockId = null;
        render();
      });
      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Cancel';
      cancelBtn.style.background = 'var(--bg-tertiary)';
      cancelBtn.addEventListener('click', () => { commentBlockId = null; render(); });
      form.append(label, ta, submitBtn, cancelBtn);
      sidebar.appendChild(form);
    }

    // Member list
    const memberList = document.createElement('div');
    memberList.className = 'member-list';
    memberList.innerHTML = '<h4>Collaborators</h4>';
    for (const collab of state.collaborators) {
      const item = document.createElement('div');
      item.className = 'member-item';
      const dot = document.createElement('span');
      dot.className = 'member-dot';
      dot.style.background = collab.color;
      const name = document.createElement('span');
      name.textContent = collab.name;
      const role = document.createElement('span');
      role.className = 'member-role';
      role.textContent = collab.role;
      item.append(dot, name, role);

      if (state.isOwner && collab.did !== state.did) {
        const promoteBtn = document.createElement('select');
        promoteBtn.className = 'member-promote';
        for (const r of ['viewer', 'commenter', 'editor'] as DocRole[]) {
          const opt = document.createElement('option');
          opt.value = r;
          opt.textContent = r;
          opt.selected = collab.role === r;
          promoteBtn.appendChild(opt);
        }
        promoteBtn.addEventListener('change', () => {
          promoteCollaborator(state, collab.did, promoteBtn.value as DocRole);
          render();
        });
        item.appendChild(promoteBtn);
      }

      memberList.appendChild(item);
    }
    sidebar.appendChild(memberList);
    layout.appendChild(sidebar);

    // === Governance log ===
    const govToggle = document.createElement('div');
    govToggle.className = 'gov-log-toggle';
    govToggle.textContent = showGovLog ? '▼ Governance Log' : '▶ Governance Log';
    govToggle.addEventListener('click', () => { showGovLog = !showGovLog; render(); });
    layout.appendChild(govToggle);

    if (showGovLog) {
      const govLog = document.createElement('div');
      govLog.className = 'governance-log';
      for (const log of state.governanceLogs.slice(-20)) {
        const entry = document.createElement('div');
        entry.className = `log-entry ${log.accepted ? 'accepted' : 'rejected'}`;
        entry.textContent = `${log.accepted ? '✅' : '⛔'} ${log.text}`;
        govLog.appendChild(entry);
      }
      if (state.governanceLogs.length === 0) {
        const entry = document.createElement('div');
        entry.className = 'log-entry';
        entry.textContent = 'No governance events yet';
        govLog.appendChild(entry);
      }
      layout.appendChild(govLog);
    }

    root.appendChild(layout);
  }

  // Listen for updates — only re-render non-block updates or full refreshes
  document.addEventListener('doc-update', (e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (detail?.type === 'block' && detail.blockId) {
      // Update just the block content without full re-render
      const blockEl = root.querySelector(`[data-block-id="${detail.blockId}"]`) as HTMLElement;
      const block = state.blocks.find(b => b.id === detail.blockId);
      if (blockEl && block && document.activeElement !== blockEl) {
        blockEl.innerHTML = block.content;
        if (block.type) blockEl.setAttribute('data-type', block.type);
      }
    } else if (detail?.type === 'cursor') {
      // Update cursor indicators without full re-render for performance
      // Simple approach: full render (acceptable at 500ms intervals)
      render();
    } else {
      render();
    }
  });

  render();
}
