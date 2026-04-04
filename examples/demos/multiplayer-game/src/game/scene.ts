/**
 * Three.js game scene — 3D world, player controls, rendering
 */
import * as THREE from 'three';
import type { AppState, PlayerData, CollectibleData } from '../setup.js';
import { validateCollect, validateChat, recordChat } from '../graph/governance.js';

export function launchGame(container: HTMLElement, state: AppState): void {
  // --- Three.js Setup ---
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.Fog(0x87ceeb, 50, 100);

  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 200);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  // --- Lighting ---
  const ambientLight = new THREE.AmbientLight(0x404060, 0.8);
  scene.add(ambientLight);
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
  dirLight.position.set(20, 30, 10);
  dirLight.castShadow = true;
  dirLight.shadow.camera.near = 0.1;
  dirLight.shadow.camera.far = 100;
  dirLight.shadow.camera.left = -30;
  dirLight.shadow.camera.right = 30;
  dirLight.shadow.camera.top = 30;
  dirLight.shadow.camera.bottom = -30;
  scene.add(dirLight);

  // --- Ground ---
  const groundGeo = new THREE.PlaneGeometry(50, 50);
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x556b2f, roughness: 0.9 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Grid helper
  const grid = new THREE.GridHelper(50, 50, 0x444444, 0x444444);
  grid.position.y = 0.01;
  scene.add(grid);

  // --- World Objects ---
  const objectMeshes: THREE.Mesh[] = [];
  for (const obj of state.objects) {
    const geo = new THREE.BoxGeometry(obj.width, obj.height, obj.depth);
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(obj.color) });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(obj.x, obj.y, obj.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    objectMeshes.push(mesh);
  }

  // --- Collectibles ---
  const collectibleMeshes = new Map<string, THREE.Mesh>();
  for (const coll of state.collectibles) {
    if (coll.collectedBy) continue;
    const geo = coll.type === 'gem'
      ? new THREE.OctahedronGeometry(0.4)
      : new THREE.SphereGeometry(0.3, 16, 16);
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(coll.color),
      emissive: new THREE.Color(coll.color),
      emissiveIntensity: 0.5,
      metalness: 0.8,
      roughness: 0.2,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(coll.x, coll.y, coll.z);
    mesh.castShadow = true;
    scene.add(mesh);
    collectibleMeshes.set(coll.id, mesh);
  }

  // --- Remote Player Meshes ---
  const playerMeshes = new Map<string, THREE.Group>();

  function createPlayerMesh(player: PlayerData): THREE.Group {
    const group = new THREE.Group();
    // Capsule body
    const bodyGeo = new THREE.CapsuleGeometry(0.3, 0.8, 8, 16);
    const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(player.color) });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.7;
    body.castShadow = true;
    group.add(body);

    // Name label (using sprite)
    const canvas2d = document.createElement('canvas');
    canvas2d.width = 256;
    canvas2d.height = 64;
    const ctx = canvas2d.getContext('2d')!;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.roundRect(0, 0, 256, 64, 8);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(player.name, 128, 42);
    const texture = new THREE.CanvasTexture(canvas2d);
    const spriteMat = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.position.y = 1.8;
    sprite.scale.set(2, 0.5, 1);
    group.add(sprite);

    group.position.set(player.x, 0, player.z);
    return group;
  }

  // --- Player controls state ---
  const keys: Record<string, boolean> = {};
  let yaw = 0;
  let pitch = 0;
  let isPointerLocked = false;
  const playerSpeed = 8; // units per second
  let velocityY = 0;
  const gravity = -15;
  const jumpForce = 7;
  let isGrounded = true;

  // --- Pointer Lock ---
  renderer.domElement.addEventListener('click', () => {
    if (!isPointerLocked && !chatActive) renderer.domElement.requestPointerLock();
  });
  document.addEventListener('pointerlockchange', () => {
    isPointerLocked = document.pointerLockElement === renderer.domElement;
  });
  document.addEventListener('mousemove', (e) => {
    if (!isPointerLocked) return;
    yaw -= e.movementX * 0.002;
    pitch -= e.movementY * 0.002;
    pitch = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, pitch));
  });

  document.addEventListener('keydown', (e) => {
    if (chatActive && e.key !== 'Escape') return;
    keys[e.code] = true;
    if (e.code === 'Space' && isGrounded) {
      velocityY = jumpForce;
      isGrounded = false;
    }
  });
  document.addEventListener('keyup', (e) => { keys[e.code] = false; });

  // --- HUD (DOM overlay) ---
  const hud = document.createElement('div');
  hud.className = 'hud';
  hud.innerHTML = `
    <div class="hud-top-left">
      <div id="hud-name" class="hud-name"></div>
      <div id="hud-score" class="hud-score">⭐ 0</div>
    </div>
    <div id="player-list" class="player-list"></div>
    <div id="chat-overlay" class="chat-overlay">
      <div id="chat-log" class="chat-log"></div>
      <div id="chat-input-wrap" class="chat-input-wrap" style="display:none">
        <input id="chat-input" type="text" placeholder="Type a message..." maxlength="200" />
      </div>
    </div>
    <div class="hud-controls">WASD: move | Mouse: look | Space: jump | Enter: chat | Click to start</div>
    <div id="gov-log" class="gov-log-game"></div>
    <button id="share-btn" class="share-btn">📋 Share</button>
  `;
  container.appendChild(hud);

  document.getElementById('hud-name')!.textContent = `🎮 ${state.worldName}`;
  document.getElementById('share-btn')?.addEventListener('click', () => {
    navigator.clipboard.writeText(window.location.href).then(() => alert('Link copied!'));
  });

  // Chat
  let chatActive = false;
  const chatLog = document.getElementById('chat-log')!;
  const chatInputWrap = document.getElementById('chat-input-wrap')!;
  const chatInput = document.getElementById('chat-input') as HTMLInputElement;

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !chatActive) {
      e.preventDefault();
      chatActive = true;
      chatInputWrap.style.display = 'flex';
      chatInput.focus();
      if (isPointerLocked) document.exitPointerLock();
    } else if (e.key === 'Enter' && chatActive) {
      e.preventDefault();
      const body = chatInput.value.trim();
      if (body) {
        const v = validateChat(state.governance, state.did);
        if (v.allowed) {
          recordChat(state.governance, state.did);
          const msg: import('../setup.js').ChatMsg = {
            id: crypto.randomUUID(), body, authorDid: state.did, authorName: state.displayName, time: Date.now(),
          };
          state.chatMessages.push(msg);
          state.bc.postMessage({ type: 'game-chat', graphUri: state.graph.uri, msg });
          addGovLog(`Chat by ${state.displayName}`, true);
        } else {
          addGovLog(`Chat — ${v.reason}`, false);
        }
      }
      chatInput.value = '';
      chatActive = false;
      chatInputWrap.style.display = 'none';
    } else if (e.key === 'Escape' && chatActive) {
      chatActive = false;
      chatInput.value = '';
      chatInputWrap.style.display = 'none';
    }
  });

  function renderChat(): void {
    const recent = state.chatMessages.slice(-20);
    chatLog.innerHTML = recent.map(m => {
      const color = m.authorDid === 'system' ? '#aaa' :
        (state.players.get(m.authorDid)?.color || '#fff');
      return `<div style="color:${color}"><b>${m.authorName}:</b> ${escapeHtml(m.body)}</div>`;
    }).join('');
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function renderPlayerList(): void {
    const list = document.getElementById('player-list')!;
    let html = '<h4>👥 Players</h4>';
    for (const [, p] of state.players) {
      html += `<div class="player-entry"><span class="player-dot" style="background:${p.color}"></span> ${escapeHtml(p.name)} <small>⭐${p.score}</small></div>`;
    }
    list.innerHTML = html;
  }

  // Governance log
  function addGovLog(text: string, accepted: boolean): void {
    state.governanceLogs.push({ text, accepted, time: Date.now() });
    renderGovLog();
  }

  function renderGovLog(): void {
    const el = document.getElementById('gov-log')!;
    const recent = state.governanceLogs.slice(-5);
    el.innerHTML = '<h4>📋 Governance</h4>' + recent.map(l =>
      `<div class="${l.accepted ? 'gov-ok' : 'gov-fail'}">${l.accepted ? '✅' : '⛔'} ${l.text}</div>`
    ).join('');
  }

  // --- Collectible proximity check ---
  function checkCollectibles(): void {
    const px = state.myPlayer.x;
    const pz = state.myPlayer.z;
    for (const coll of state.collectibles) {
      if (coll.collectedBy) continue;
      const dx = px - coll.x;
      const dz = pz - coll.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < 1.2) {
        const v = validateCollect(state.governance, coll.id, state.did);
        if (v.allowed) {
          coll.collectedBy = state.did;
          state.governance.collectedItems.add(coll.id);
          state.myPlayer.score += coll.value;
          const mesh = collectibleMeshes.get(coll.id);
          if (mesh) { scene.remove(mesh); collectibleMeshes.delete(coll.id); }
          state.bc.postMessage({
            type: 'game-collect', graphUri: state.graph.uri,
            collectibleId: coll.id, did: state.did, playerName: state.displayName,
          });
          state.chatMessages.push({
            id: crypto.randomUUID(),
            body: `⭐ ${state.displayName} collected a ${coll.type}! (+${coll.value})`,
            authorDid: 'system', authorName: 'System', time: Date.now(),
          });
          addGovLog(`Collect ${coll.type} by ${state.displayName}`, true);
        } else {
          addGovLog(`Collect — ${v.reason}`, false);
        }
      }
    }
  }

  // --- Simple AABB collision ---
  function checkCollision(x: number, z: number): boolean {
    const playerRadius = 0.4;
    for (const obj of state.objects) {
      const halfW = obj.width / 2 + playerRadius;
      const halfD = obj.depth / 2 + playerRadius;
      if (x > obj.x - halfW && x < obj.x + halfW &&
          z > obj.z - halfD && z < obj.z + halfD) {
        return true;
      }
    }
    return false;
  }

  // --- Position broadcast ---
  let lastBroadcast = 0;
  const broadcastInterval = 50; // ~20fps

  function broadcastPosition(): void {
    const now = performance.now();
    if (now - lastBroadcast < broadcastInterval) return;
    lastBroadcast = now;
    state.bc.postMessage({
      type: 'game-position', graphUri: state.graph.uri,
      did: state.did, x: state.myPlayer.x, y: state.myPlayer.y,
      z: state.myPlayer.z, rotation: yaw,
    });
  }

  // --- Game update events ---
  document.addEventListener('game-update', ((e: CustomEvent) => {
    const { type } = e.detail;
    if (type === 'collect') {
      // Remove collected meshes
      for (const coll of state.collectibles) {
        if (coll.collectedBy && collectibleMeshes.has(coll.id)) {
          scene.remove(collectibleMeshes.get(coll.id)!);
          collectibleMeshes.delete(coll.id);
        }
      }
    }
  }) as EventListener);

  // --- Game Loop ---
  const clock = new THREE.Clock();
  let animTime = 0;

  function animate(): void {
    requestAnimationFrame(animate);
    const delta = Math.min(clock.getDelta(), 0.05);
    animTime += delta;

    // --- Player movement ---
    if (!chatActive) {
      const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      const move = new THREE.Vector3();
      if (keys['KeyW']) move.add(forward);
      if (keys['KeyS']) move.sub(forward);
      if (keys['KeyA']) move.sub(right);
      if (keys['KeyD']) move.add(right);
      if (move.length() > 0) move.normalize().multiplyScalar(playerSpeed * delta);

      const newX = state.myPlayer.x + move.x;
      const newZ = state.myPlayer.z + move.z;

      // Boundary
      const bound = 24;
      const clampedX = Math.max(-bound, Math.min(bound, newX));
      const clampedZ = Math.max(-bound, Math.min(bound, newZ));

      if (!checkCollision(clampedX, clampedZ)) {
        state.myPlayer.x = clampedX;
        state.myPlayer.z = clampedZ;
      }

      // Gravity / jump
      velocityY += gravity * delta;
      state.myPlayer.y += velocityY * delta;
      if (state.myPlayer.y <= 1) {
        state.myPlayer.y = 1;
        velocityY = 0;
        isGrounded = true;
      }

      state.myPlayer.rotation = yaw;
    }

    // Camera — third-person behind player
    const cameraDistance = 5;
    const cameraHeight = 3;
    camera.position.set(
      state.myPlayer.x + Math.sin(yaw) * cameraDistance,
      state.myPlayer.y + cameraHeight + Math.sin(pitch) * 2,
      state.myPlayer.z + Math.cos(yaw) * cameraDistance,
    );
    camera.lookAt(state.myPlayer.x, state.myPlayer.y + 1, state.myPlayer.z);

    // --- Update remote players ---
    for (const [did, player] of state.players) {
      if (did === state.did) continue;
      let group = playerMeshes.get(did);
      if (!group) {
        group = createPlayerMesh(player);
        scene.add(group);
        playerMeshes.set(did, group);
      }
      // Smooth interpolation
      group.position.x += (player.x - group.position.x) * 0.15;
      group.position.z += (player.z - group.position.z) * 0.15;
      group.rotation.y = player.rotation;
    }

    // Remove disconnected players (no update in 10s would need heartbeat — skip for demo)

    // --- Animate collectibles ---
    for (const [, mesh] of collectibleMeshes) {
      mesh.rotation.y += delta * 2;
      mesh.position.y = mesh.position.y + Math.sin(animTime * 3) * 0.002;
    }

    // --- Check collectibles ---
    checkCollectibles();

    // --- Broadcast position ---
    broadcastPosition();

    // --- Update HUD ---
    document.getElementById('hud-score')!.textContent = `⭐ ${state.myPlayer.score}`;
    renderChat();
    renderPlayerList();

    // --- Render ---
    renderer.render(scene, camera);
  }

  // --- Window resize ---
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  animate();
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
