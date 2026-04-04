/**
 * Right sidebar — member list
 */

import type { AppState } from '../setup.js';

export function renderMembers(container: HTMLElement, state: AppState): void {
  container.innerHTML = '';

  // Group members by their highest role
  const roleGroups = new Map<string, { role: { name: string; color: string; position: number }; members: typeof state.members }>();

  // Initialize role groups
  for (const role of [...state.roles].sort((a, b) => b.position - a.position)) {
    roleGroups.set(role.id, { role, members: [] });
  }

  // No-role group
  const noRole = { name: 'Online', color: '#b5bac1', position: 0 };

  for (const member of state.members) {
    if (member.roleIds.length > 0) {
      // Get highest role
      let highest: { id: string; position: number } | null = null;
      for (const rid of member.roleIds) {
        const role = state.roles.find(r => r.id === rid);
        if (role && (!highest || role.position > highest.position)) {
          highest = { id: rid, position: role.position };
        }
      }
      if (highest && roleGroups.has(highest.id)) {
        roleGroups.get(highest.id)!.members.push(member);
      }
    } else {
      // Will be in "Online"
      if (!roleGroups.has('none')) {
        roleGroups.set('none', { role: noRole, members: [] });
      }
      roleGroups.get('none')!.members.push(member);
    }
  }

  for (const [, group] of roleGroups) {
    if (group.members.length === 0) continue;

    const section = document.createElement('div');
    section.className = 'member-section';

    const title = document.createElement('div');
    title.className = 'member-section-title';
    title.textContent = `${group.role.name} — ${group.members.length}`;
    title.style.color = group.role.color;
    section.appendChild(title);

    for (const member of group.members) {
      const item = document.createElement('div');
      item.className = 'member-item';

      const dot = document.createElement('div');
      dot.className = 'member-dot';
      dot.style.background = '#43b581'; // online
      item.appendChild(dot);

      const nameEl = document.createElement('span');
      nameEl.className = 'member-name';
      nameEl.textContent = member.name;
      nameEl.style.color = group.role.color;
      item.appendChild(nameEl);

      // Ban indicator
      if (state.governance.bannedDids.has(member.did)) {
        const ban = document.createElement('span');
        ban.textContent = ' 🚫';
        ban.title = 'Banned';
        item.appendChild(ban);
      }

      section.appendChild(item);
    }

    container.appendChild(section);
  }
}
