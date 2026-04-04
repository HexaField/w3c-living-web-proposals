/**
 * P2P VCS — App renderer (main layout + all components)
 */
import {
  type AppState, type FileEntry,
  createCommit, createBranch, switchBranch, broadcastEditing,
} from './setup.js';
import { computeDiff, timeAgo } from './utils/helpers.js';

export function renderApp(root: HTMLElement, state: AppState): void {
  let showHistory = true;
  let showGovLog = true;
  let showNewFile = false;
  let diffMode = false;
  let diffCommitId: string | null = null;

  function render(): void {
    root.innerHTML = '';

    const layout = document.createElement('div');
    layout.className = 'vcs-layout';

    // === Top bar ===
    const topBar = document.createElement('div');
    topBar.className = 'top-bar';

    const repoLabel = document.createElement('span');
    repoLabel.className = 'repo-name';
    repoLabel.innerHTML = `<span class="icon">📦</span>${state.repoName}`;

    const branchSelect = document.createElement('select');
    branchSelect.className = 'branch-select';
    for (const b of state.branches) {
      const opt = document.createElement('option');
      opt.value = b.id;
      opt.textContent = `${b.protected ? '🔒 ' : ''}${b.name}`;
      opt.selected = b.id === state.currentBranchId;
      branchSelect.appendChild(opt);
    }
    branchSelect.addEventListener('change', () => {
      switchBranch(state, branchSelect.value);
      diffMode = false;
      diffCommitId = null;
      render();
    });

    const newBranchBtn = document.createElement('button');
    newBranchBtn.textContent = '+ Branch';
    newBranchBtn.style.fontSize = '0.75rem';
    newBranchBtn.style.padding = '4px 10px';
    newBranchBtn.addEventListener('click', () => {
      const name = prompt('Branch name:');
      if (name?.trim()) {
        const b = createBranch(state, name.trim());
        switchBranch(state, b.id);
        render();
      }
    });

    const spacer = document.createElement('span');
    spacer.className = 'spacer';

    const contribCount = document.createElement('span');
    contribCount.className = 'contributor-count';
    contribCount.textContent = `👥 ${state.contributors.length} contributor${state.contributors.length !== 1 ? 's' : ''}`;

    topBar.append(repoLabel, branchSelect, newBranchBtn, spacer, contribCount);
    layout.appendChild(topBar);

    // === Sidebar ===
    const sidebar = document.createElement('div');
    sidebar.className = 'sidebar';

    const sideHeader = document.createElement('div');
    sideHeader.className = 'sidebar-header';
    sideHeader.innerHTML = '<span>Files</span>';
    const addFileBtn = document.createElement('button');
    addFileBtn.textContent = '+ New';
    addFileBtn.addEventListener('click', () => { showNewFile = !showNewFile; render(); });
    sideHeader.appendChild(addFileBtn);
    sidebar.appendChild(sideHeader);

    if (showNewFile) {
      const nf = document.createElement('div');
      nf.className = 'new-file-dialog';
      const nfInput = document.createElement('input');
      nfInput.placeholder = 'path/to/file.ts';
      const nfBtn = document.createElement('button');
      nfBtn.textContent = 'Create';
      nfBtn.addEventListener('click', () => {
        const path = nfInput.value.trim();
        if (path) {
          state.workingFiles.push({ path, contentId: '', content: '', hash: '' });
          state.selectedFile = path;
          showNewFile = false;
          broadcastEditing(state, path);
          render();
        }
      });
      nf.append(nfInput, nfBtn);
      sidebar.appendChild(nf);
    }

    const fileTree = document.createElement('div');
    fileTree.className = 'file-tree';
    const ul = document.createElement('ul');
    if (state.workingFiles.length === 0) {
      const li = document.createElement('li');
      li.style.color = 'var(--text-muted)';
      li.textContent = 'No files yet';
      ul.appendChild(li);
    }
    for (const file of state.workingFiles.sort((a, b) => a.path.localeCompare(b.path))) {
      const li = document.createElement('li');
      li.className = state.selectedFile === file.path ? 'active' : '';
      li.innerHTML = `<span class="icon">📄</span>${file.path}`;
      const indicator = state.editingIndicators.get(file.path);
      if (indicator) {
        const badge = document.createElement('span');
        badge.style.cssText = 'margin-left:auto;font-size:0.7rem;color:var(--bg-accent)';
        badge.textContent = `✏️ ${indicator}`;
        li.appendChild(badge);
      }
      li.addEventListener('click', () => {
        state.selectedFile = file.path;
        diffMode = false;
        diffCommitId = null;
        broadcastEditing(state, file.path);
        render();
      });
      ul.appendChild(li);
    }
    fileTree.appendChild(ul);
    sidebar.appendChild(fileTree);

    // Contributors
    const contribPanel = document.createElement('div');
    contribPanel.className = 'contributors-panel';
    contribPanel.innerHTML = '<h4>Contributors</h4>';
    for (const c of state.contributors) {
      const item = document.createElement('div');
      item.className = 'contributor-item';
      const dot = document.createElement('span');
      dot.className = 'contributor-dot';
      dot.style.background = c.role === 'owner' ? '#f0b232' : c.role === 'contributor' ? '#43b581' : '#6d6f78';
      const name = document.createElement('span');
      name.textContent = c.name;
      const role = document.createElement('span');
      role.className = 'contributor-role';
      role.textContent = c.role;
      item.append(dot, name, role);
      contribPanel.appendChild(item);
    }
    sidebar.appendChild(contribPanel);

    // Invite URL
    const invite = document.createElement('div');
    invite.className = 'invite-section';
    invite.innerHTML = '<label>Fork Link</label>';
    const invInput = document.createElement('input');
    invInput.value = state.graph.uri;
    invInput.readOnly = true;
    invInput.addEventListener('click', () => { invInput.select(); navigator.clipboard?.writeText(invInput.value); });
    invite.appendChild(invInput);
    sidebar.appendChild(invite);

    layout.appendChild(sidebar);

    // === Main area ===
    const main = document.createElement('div');
    main.className = 'main-area';

    if (diffMode && diffCommitId) {
      // Diff view
      renderDiffView(main, state, diffCommitId, () => { diffMode = false; diffCommitId = null; render(); });
    } else if (state.selectedFile) {
      // Editor
      const file = state.workingFiles.find(f => f.path === state.selectedFile);
      if (file) {
        renderEditor(main, state, file, render);
      }
    } else {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'Select a file or create one to start editing';
      main.appendChild(empty);
    }

    // Commit bar
    const commitBar = document.createElement('div');
    commitBar.className = 'commit-bar';
    const commitInput = document.createElement('input');
    commitInput.placeholder = 'Commit message...';
    const commitBtn = document.createElement('button');
    commitBtn.textContent = '⏎ Commit';
    commitBtn.addEventListener('click', async () => {
      const msg = commitInput.value.trim();
      if (!msg) { alert('Enter a commit message'); return; }
      if (state.workingFiles.length === 0) { alert('No files to commit'); return; }
      const result = await createCommit(state, msg, [...state.workingFiles]);
      if (result.success) {
        commitInput.value = '';
        render();
      } else {
        alert('Commit rejected: ' + result.reason);
        render();
      }
    });
    const signedAs = document.createElement('span');
    signedAs.className = 'signed-as';
    signedAs.textContent = `🔏 ${state.did.slice(0, 20)}...`;
    commitBar.append(commitInput, commitBtn, signedAs);
    main.appendChild(commitBar);

    layout.appendChild(main);

    // === History panel toggle ===
    const histToggle = document.createElement('div');
    histToggle.className = 'history-toggle';
    histToggle.textContent = showHistory ? '▼ Commit History' : '▶ Commit History';
    histToggle.addEventListener('click', () => { showHistory = !showHistory; render(); });
    layout.appendChild(histToggle);

    if (showHistory) {
      const histPanel = document.createElement('div');
      histPanel.className = 'history-panel';
      histPanel.style.gridColumn = '1 / -1';

      const branchCommits = getCommitsForBranch(state);
      for (const commit of branchCommits.reverse()) {
        const entry = document.createElement('div');
        entry.className = `commit-entry${diffCommitId === commit.id ? ' active' : ''}`;
        entry.innerHTML = `
          <span class="commit-dot"></span>
          <span class="commit-hash">${commit.id.slice(-8)}</span>
          <span class="commit-msg">${escapeHtml(commit.message)}</span>
          <span class="commit-author">${escapeHtml(commit.authorName)}</span>
          <span class="commit-time">${timeAgo(commit.time)}</span>
        `;
        entry.addEventListener('click', () => {
          diffMode = true;
          diffCommitId = commit.id;
          render();
        });
        histPanel.appendChild(entry);
      }

      if (branchCommits.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'padding:12px 16px;color:var(--text-muted);font-size:0.8rem';
        empty.textContent = 'No commits yet';
        histPanel.appendChild(empty);
      }

      layout.appendChild(histPanel);
    }

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

  // Listen for updates
  document.addEventListener('vcs-update', () => render());
  render();
}

function renderEditor(container: HTMLElement, state: AppState, file: FileEntry, rerender: () => void): void {
  const wrapper = document.createElement('div');
  wrapper.className = 'editor-wrapper';

  const tabBar = document.createElement('div');
  tabBar.className = 'editor-tab-bar';
  const tab = document.createElement('div');
  tab.className = 'editor-tab active';
  tab.textContent = file.path;
  tabBar.appendChild(tab);
  wrapper.appendChild(tabBar);

  const editorContent = document.createElement('div');
  editorContent.className = 'editor-content';
  const textarea = document.createElement('textarea');
  textarea.className = 'code-editor';
  textarea.value = file.content;
  textarea.spellcheck = false;
  textarea.addEventListener('input', () => {
    file.content = textarea.value;
  });
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      textarea.value = textarea.value.substring(0, start) + '  ' + textarea.value.substring(end);
      textarea.selectionStart = textarea.selectionEnd = start + 2;
      file.content = textarea.value;
    }
  });
  editorContent.appendChild(textarea);
  wrapper.appendChild(editorContent);
  container.appendChild(wrapper);
}

function renderDiffView(container: HTMLElement, state: AppState, commitId: string, onClose: () => void): void {
  const commit = state.commits.find(c => c.id === commitId);
  if (!commit) return;

  const parent = commit.parentCommit ? state.commits.find(c => c.id === commit.parentCommit) : null;

  const wrapper = document.createElement('div');
  wrapper.className = 'editor-wrapper';

  const header = document.createElement('div');
  header.className = 'diff-header';
  header.innerHTML = `
    <span>Diff: ${escapeHtml(commit.message)} (${commit.id.slice(-8)})</span>
  `;
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕ Close';
  closeBtn.style.cssText = 'font-size:0.75rem;padding:4px 8px';
  closeBtn.addEventListener('click', onClose);
  header.appendChild(closeBtn);
  wrapper.appendChild(header);

  const diffView = document.createElement('div');
  diffView.className = 'diff-view';

  const parentFiles = parent?.files || [];
  const commitFiles = commit.files;

  // Get all unique paths
  const allPaths = new Set([...parentFiles.map(f => f.path), ...commitFiles.map(f => f.path)]);

  for (const path of Array.from(allPaths).sort()) {
    const oldFile = parentFiles.find(f => f.path === path);
    const newFile = commitFiles.find(f => f.path === path);
    const oldContent = oldFile?.content || '';
    const newContent = newFile?.content || '';

    if (oldContent === newContent) continue;

    const fileHeader = document.createElement('div');
    fileHeader.style.cssText = 'font-weight:700;margin:12px 0 4px;color:var(--text-primary)';
    fileHeader.textContent = `📄 ${path}${!oldFile ? ' (new)' : !newFile ? ' (deleted)' : ''}`;
    diffView.appendChild(fileHeader);

    const lines = computeDiff(oldContent, newContent);
    for (const line of lines) {
      const div = document.createElement('div');
      div.className = `diff-line ${line.type}`;
      const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
      div.textContent = `${prefix} ${line.text}`;
      diffView.appendChild(div);
    }
  }

  if (diffView.children.length === 0) {
    diffView.innerHTML = '<div style="color:var(--text-muted)">No changes in this commit</div>';
  }

  wrapper.appendChild(diffView);
  container.appendChild(wrapper);
}

function getCommitsForBranch(state: AppState): import('./setup.js').Commit[] {
  const branch = state.branches.find(b => b.id === state.currentBranchId);
  if (!branch) return [];

  const result: import('./setup.js').Commit[] = [];
  let currentId: string | null = branch.headCommitId;

  while (currentId) {
    const commit = state.commits.find(c => c.id === currentId);
    if (!commit) break;
    result.push(commit);
    currentId = commit.parentCommit;
  }

  return result.reverse();
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
