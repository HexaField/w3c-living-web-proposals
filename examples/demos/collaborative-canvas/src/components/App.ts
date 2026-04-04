/**
 * Main app layout — toolbar, SVG canvas, layer panel, governance log
 */
import type { AppState, CanvasShapeData } from '../setup.js';
import { validateShapeAction } from '../graph/governance.js';
import { PREDICATES } from '../graph/shapes.js';
import { SemanticTriple } from '@living-web/personal-graph';

interface DrawState {
  drawing: boolean;
  startX: number;
  startY: number;
  currentPoints: { x: number; y: number }[];
}

export function renderApp(container: HTMLElement, state: AppState): void {
  container.innerHTML = '';
  container.className = 'canvas-app';

  // --- Layout ---
  const toolbar = document.createElement('div');
  toolbar.className = 'toolbar';

  const canvasArea = document.createElement('div');
  canvasArea.className = 'canvas-area';

  const rightPanel = document.createElement('div');
  rightPanel.className = 'right-panel';

  const govLog = document.createElement('div');
  govLog.className = 'gov-log';

  container.append(toolbar, canvasArea, rightPanel, govLog);

  // --- SVG Canvas ---
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.style.background = '#f8f9fa';
  canvasArea.appendChild(svg);

  // Cursor overlay for remote cursors
  const cursorLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  cursorLayer.setAttribute('id', 'cursors');
  svg.appendChild(cursorLayer);

  // In-progress remote strokes
  const strokePreview = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  strokePreview.setAttribute('id', 'stroke-preview');
  svg.appendChild(strokePreview);

  // Drawing state
  const drawState: DrawState = { drawing: false, startX: 0, startY: 0, currentPoints: [] };
  let previewEl: SVGElement | null = null;

  // --- Toolbar ---
  const tools = [
    { id: 'select', icon: '🔘', label: 'Select' },
    { id: 'rect', icon: '▭', label: 'Rectangle' },
    { id: 'circle', icon: '⭕', label: 'Circle' },
    { id: 'line', icon: '╱', label: 'Line' },
    { id: 'freehand', icon: '✏️', label: 'Freehand' },
    { id: 'text', icon: 'A', label: 'Text' },
    { id: 'eraser', icon: '🗑️', label: 'Eraser' },
  ];

  for (const tool of tools) {
    const btn = document.createElement('button');
    btn.className = 'tool-btn' + (tool.id === state.currentTool ? ' active' : '');
    btn.title = tool.label;
    btn.textContent = tool.icon;
    btn.dataset.tool = tool.id;
    btn.addEventListener('click', () => {
      state.currentTool = tool.id;
      toolbar.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
    toolbar.appendChild(btn);
  }

  // Color controls
  const colorDiv = document.createElement('div');
  colorDiv.className = 'color-controls';
  colorDiv.innerHTML = `
    <label title="Stroke">🖊️<input type="color" id="stroke-color" value="${state.currentStroke}" /></label>
    <label title="Fill">🎨<input type="color" id="fill-color" value="#ffffff" /></label>
    <label title="Width">━<input type="range" id="stroke-width" min="1" max="20" value="${state.currentStrokeWidth}" /></label>
  `;
  toolbar.appendChild(colorDiv);

  document.getElementById('stroke-color')?.addEventListener('input', (e) => {
    state.currentStroke = (e.target as HTMLInputElement).value;
  });
  document.getElementById('fill-color')?.addEventListener('input', (e) => {
    state.currentFill = (e.target as HTMLInputElement).value;
  });
  document.getElementById('stroke-width')?.addEventListener('input', (e) => {
    state.currentStrokeWidth = Number((e.target as HTMLInputElement).value);
  });

  // --- Layer Panel ---
  function renderLayers(): void {
    rightPanel.innerHTML = '<h3>Layers</h3>';
    const sorted = [...state.layers].sort((a, b) => b.order - a.order);
    for (const layer of sorted) {
      const row = document.createElement('div');
      row.className = 'layer-row' + (layer.id === state.activeLayerId ? ' active' : '');

      const vis = document.createElement('button');
      vis.className = 'layer-vis';
      vis.textContent = layer.visible ? '👁️' : '🚫';
      vis.addEventListener('click', (e) => {
        e.stopPropagation();
        layer.visible = !layer.visible;
        state.bc.postMessage({ type: 'canvas-layer-toggle', graphUri: state.graph.uri, layerId: layer.id, visible: layer.visible });
        renderLayers();
        renderShapes();
      });

      const lock = document.createElement('button');
      lock.className = 'layer-lock';
      lock.textContent = layer.locked ? '🔒' : '🔓';
      lock.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!state.isOwner) { addGovLog('Lock layer — owner only', false); return; }
        layer.locked = !layer.locked;
        if (layer.locked) state.governance.lockedLayers.add(layer.id);
        else state.governance.lockedLayers.delete(layer.id);
        state.bc.postMessage({ type: 'canvas-layer-lock', graphUri: state.graph.uri, layerId: layer.id, locked: layer.locked });
        renderLayers();
      });

      const name = document.createElement('span');
      name.className = 'layer-name';
      name.textContent = layer.name;

      row.append(vis, lock, name);
      row.addEventListener('click', () => {
        state.activeLayerId = layer.id;
        renderLayers();
      });
      rightPanel.appendChild(row);
    }

    // Add layer button
    const addBtn = document.createElement('button');
    addBtn.className = 'add-layer-btn';
    addBtn.textContent = '+ Layer';
    addBtn.addEventListener('click', () => {
      if (!state.isOwner) { addGovLog('Create layer — owner only', false); return; }
      const name = prompt('Layer name:');
      if (!name) return;
      const newLayer = {
        id: `layer:${crypto.randomUUID()}`,
        name, order: state.layers.length, visible: true, locked: false,
      };
      state.layers.push(newLayer);
      state.activeLayerId = newLayer.id;
      state.bc.postMessage({ type: 'canvas-layer-add', graphUri: state.graph.uri, layer: newLayer });
      renderLayers();
    });
    rightPanel.appendChild(addBtn);

    // Collaborators
    const collabH = document.createElement('h3');
    collabH.textContent = '👥 Online';
    rightPanel.appendChild(collabH);
    for (const c of state.collaborators) {
      const div = document.createElement('div');
      div.className = 'collab-row';
      div.innerHTML = `<span class="collab-dot" style="background:${c.color}"></span> ${c.name} <small>(${c.role})</small>`;
      rightPanel.appendChild(div);
    }
  }

  // --- Governance Log ---
  function addGovLog(text: string, accepted: boolean): void {
    state.governanceLogs.push({ text, accepted, time: Date.now() });
    renderGovLog();
  }

  function renderGovLog(): void {
    govLog.innerHTML = '<h4>📋 Governance</h4>';
    const recent = state.governanceLogs.slice(-8);
    for (const log of recent) {
      const div = document.createElement('div');
      div.className = 'gov-entry ' + (log.accepted ? 'accepted' : 'rejected');
      div.textContent = `${log.accepted ? '✅' : '⛔'} ${log.text}`;
      govLog.appendChild(div);
    }
  }

  // --- Shape Rendering ---
  function renderShapes(): void {
    // Clear all shape elements but keep cursors and stroke preview
    const toRemove: SVGElement[] = [];
    for (let i = 0; i < svg.children.length; i++) {
      const child = svg.children[i] as SVGElement;
      if (child.id !== 'cursors' && child.id !== 'stroke-preview') toRemove.push(child);
    }
    toRemove.forEach(el => el.remove());

    // Re-insert before cursors
    const sortedLayers = [...state.layers].sort((a, b) => a.order - b.order);
    for (const layer of sortedLayers) {
      if (!layer.visible) continue;
      const layerG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      layerG.setAttribute('data-layer', layer.id);
      if (layer.locked) layerG.setAttribute('opacity', '0.7');

      const layerShapes = state.shapes.filter(s => s.layerId === layer.id);
      for (const shape of layerShapes) {
        const el = createSVGElement(shape);
        if (el) {
          el.setAttribute('data-shape-id', shape.id);
          if (shape.id === state.selectedShapeId) {
            el.setAttribute('filter', 'url(#selection)');
          }
          // Click handler for select/eraser
          el.addEventListener('mousedown', (e: Event) => {
            const me = e as MouseEvent;
            if (state.currentTool === 'select') {
              e.stopPropagation();
              state.selectedShapeId = shape.id;
              renderShapes();
              // Start drag
              const startX = me.clientX;
              const startY = me.clientY;
              const origX = shape.x;
              const origY = shape.y;
              const onMove = (e2: MouseEvent) => {
                const v = validateShapeAction(state.governance, state.did, shape.layerId, state.isOwner);
                if (!v.allowed) return;
                shape.x = origX + (e2.clientX - startX);
                shape.y = origY + (e2.clientY - startY);
                renderShapes();
              };
              const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                state.bc.postMessage({
                  type: 'canvas-shape-move', graphUri: state.graph.uri,
                  shapeId: shape.id, x: shape.x, y: shape.y, did: state.did,
                });
                addGovLog(`Move shape by ${state.displayName}`, true);
              };
              document.addEventListener('mousemove', onMove);
              document.addEventListener('mouseup', onUp);
            } else if (state.currentTool === 'eraser') {
              e.stopPropagation();
              const v = validateShapeAction(state.governance, state.did, shape.layerId, state.isOwner);
              if (!v.allowed) { addGovLog(`Delete shape — ${v.reason}`, false); return; }
              const idx = state.shapes.findIndex(s => s.id === shape.id);
              if (idx !== -1) state.shapes.splice(idx, 1);
              state.bc.postMessage({
                type: 'canvas-shape-delete', graphUri: state.graph.uri,
                shapeId: shape.id, did: state.did,
              });
              addGovLog(`Delete shape by ${state.displayName}`, true);
              renderShapes();
            }
          });
          layerG.appendChild(el);
        }
      }
      svg.insertBefore(layerG, cursorLayer);
    }
  }

  function createSVGElement(shape: CanvasShapeData): SVGElement | null {
    let el: SVGElement;
    switch (shape.type) {
      case 'rect': {
        el = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        el.setAttribute('x', String(shape.x));
        el.setAttribute('y', String(shape.y));
        el.setAttribute('width', String(shape.width || 100));
        el.setAttribute('height', String(shape.height || 60));
        el.setAttribute('fill', shape.fill || 'transparent');
        el.setAttribute('stroke', shape.stroke);
        el.setAttribute('stroke-width', String(shape.strokeWidth));
        el.style.cursor = 'pointer';
        break;
      }
      case 'circle': {
        el = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
        const rx = (shape.width || 60) / 2;
        const ry = (shape.height || 60) / 2;
        el.setAttribute('cx', String(shape.x + rx));
        el.setAttribute('cy', String(shape.y + ry));
        el.setAttribute('rx', String(rx));
        el.setAttribute('ry', String(ry));
        el.setAttribute('fill', shape.fill || 'transparent');
        el.setAttribute('stroke', shape.stroke);
        el.setAttribute('stroke-width', String(shape.strokeWidth));
        el.style.cursor = 'pointer';
        break;
      }
      case 'line': {
        el = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        el.setAttribute('x1', String(shape.x));
        el.setAttribute('y1', String(shape.y));
        el.setAttribute('x2', String(shape.x2 || shape.x + 100));
        el.setAttribute('y2', String(shape.y2 || shape.y));
        el.setAttribute('stroke', shape.stroke);
        el.setAttribute('stroke-width', String(shape.strokeWidth));
        el.style.cursor = 'pointer';
        break;
      }
      case 'path': {
        el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        el.setAttribute('d', shape.pathData || '');
        el.setAttribute('fill', shape.fill || 'none');
        el.setAttribute('stroke', shape.stroke);
        el.setAttribute('stroke-width', String(shape.strokeWidth));
        el.setAttribute('stroke-linecap', 'round');
        el.setAttribute('stroke-linejoin', 'round');
        el.style.cursor = 'pointer';
        break;
      }
      case 'text': {
        el = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        el.setAttribute('x', String(shape.x));
        el.setAttribute('y', String(shape.y));
        el.setAttribute('fill', shape.stroke);
        el.setAttribute('font-size', String(shape.fontSize || 16));
        el.textContent = shape.text || 'Text';
        el.style.cursor = 'pointer';
        break;
      }
      default: return null;
    }
    return el;
  }

  // --- Selection filter ---
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  defs.innerHTML = `
    <filter id="selection" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="#3b82f6" flood-opacity="0.8"/>
    </filter>
  `;
  svg.insertBefore(defs, svg.firstChild);

  // --- Mouse handlers for drawing ---
  function getSVGPoint(e: MouseEvent): { x: number; y: number } {
    const rect = svg.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  svg.addEventListener('mousedown', (e: MouseEvent) => {
    if (e.button !== 0) return;
    const pt = getSVGPoint(e);
    const tool = state.currentTool;

    if (tool === 'select') {
      state.selectedShapeId = null;
      renderShapes();
      return;
    }

    if (tool === 'text') {
      const v = validateShapeAction(state.governance, state.did, state.activeLayerId, state.isOwner);
      if (!v.allowed) { addGovLog(`Text — ${v.reason}`, false); return; }
      const text = prompt('Enter text:');
      if (!text) return;
      const shape: CanvasShapeData = {
        id: `shape:${crypto.randomUUID()}`, layerId: state.activeLayerId,
        type: 'text', x: pt.x, y: pt.y, fill: 'transparent',
        stroke: state.currentStroke, strokeWidth: state.currentStrokeWidth,
        text, fontSize: 16 + state.currentStrokeWidth * 2, author: state.did,
      };
      state.shapes.push(shape);
      state.bc.postMessage({ type: 'canvas-shape-add', graphUri: state.graph.uri, shape });
      addGovLog(`Text shape by ${state.displayName}`, true);
      renderShapes();
      return;
    }

    // Validate before drawing
    const v = validateShapeAction(state.governance, state.did, state.activeLayerId, state.isOwner);
    if (!v.allowed) { addGovLog(`Draw — ${v.reason}`, false); return; }

    drawState.drawing = true;
    drawState.startX = pt.x;
    drawState.startY = pt.y;
    drawState.currentPoints = [pt];

    // Create preview element
    if (tool === 'rect') {
      previewEl = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      previewEl.setAttribute('fill', state.currentFill);
      previewEl.setAttribute('stroke', state.currentStroke);
      previewEl.setAttribute('stroke-width', String(state.currentStrokeWidth));
      previewEl.setAttribute('stroke-dasharray', '5,5');
      svg.appendChild(previewEl);
    } else if (tool === 'circle') {
      previewEl = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
      previewEl.setAttribute('fill', state.currentFill);
      previewEl.setAttribute('stroke', state.currentStroke);
      previewEl.setAttribute('stroke-width', String(state.currentStrokeWidth));
      previewEl.setAttribute('stroke-dasharray', '5,5');
      svg.appendChild(previewEl);
    } else if (tool === 'line') {
      previewEl = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      previewEl.setAttribute('stroke', state.currentStroke);
      previewEl.setAttribute('stroke-width', String(state.currentStrokeWidth));
      previewEl.setAttribute('stroke-dasharray', '5,5');
      svg.appendChild(previewEl);
    } else if (tool === 'freehand') {
      previewEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      previewEl.setAttribute('fill', 'none');
      previewEl.setAttribute('stroke', state.currentStroke);
      previewEl.setAttribute('stroke-width', String(state.currentStrokeWidth));
      previewEl.setAttribute('stroke-linecap', 'round');
      previewEl.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(previewEl);
    }
  });

  svg.addEventListener('mousemove', (e: MouseEvent) => {
    const pt = getSVGPoint(e);

    // Broadcast cursor position
    state.bc.postMessage({
      type: 'canvas-cursor', graphUri: state.graph.uri,
      cursor: { did: state.did, name: state.displayName, color: state.myColor, x: pt.x, y: pt.y, tool: state.currentTool },
    });

    if (!drawState.drawing || !previewEl) return;
    const tool = state.currentTool;

    if (tool === 'rect') {
      const x = Math.min(drawState.startX, pt.x);
      const y = Math.min(drawState.startY, pt.y);
      const w = Math.abs(pt.x - drawState.startX);
      const h = Math.abs(pt.y - drawState.startY);
      previewEl.setAttribute('x', String(x));
      previewEl.setAttribute('y', String(y));
      previewEl.setAttribute('width', String(w));
      previewEl.setAttribute('height', String(h));
    } else if (tool === 'circle') {
      const cx = (drawState.startX + pt.x) / 2;
      const cy = (drawState.startY + pt.y) / 2;
      const rx = Math.abs(pt.x - drawState.startX) / 2;
      const ry = Math.abs(pt.y - drawState.startY) / 2;
      previewEl.setAttribute('cx', String(cx));
      previewEl.setAttribute('cy', String(cy));
      previewEl.setAttribute('rx', String(rx));
      previewEl.setAttribute('ry', String(ry));
    } else if (tool === 'line') {
      previewEl.setAttribute('x1', String(drawState.startX));
      previewEl.setAttribute('y1', String(drawState.startY));
      previewEl.setAttribute('x2', String(pt.x));
      previewEl.setAttribute('y2', String(pt.y));
    } else if (tool === 'freehand') {
      drawState.currentPoints.push(pt);
      const d = pointsToPath(drawState.currentPoints);
      previewEl.setAttribute('d', d);
      // Broadcast in-progress stroke
      state.bc.postMessage({
        type: 'canvas-stroke-progress', graphUri: state.graph.uri,
        did: state.did, stroke: state.currentStroke, strokeWidth: state.currentStrokeWidth, d,
      });
    }
  });

  svg.addEventListener('mouseup', (e: MouseEvent) => {
    if (!drawState.drawing) return;
    drawState.drawing = false;
    const pt = getSVGPoint(e);
    const tool = state.currentTool;

    if (previewEl) { previewEl.remove(); previewEl = null; }

    let shape: CanvasShapeData | null = null;

    if (tool === 'rect') {
      shape = {
        id: `shape:${crypto.randomUUID()}`, layerId: state.activeLayerId,
        type: 'rect', x: Math.min(drawState.startX, pt.x), y: Math.min(drawState.startY, pt.y),
        width: Math.abs(pt.x - drawState.startX), height: Math.abs(pt.y - drawState.startY),
        fill: state.currentFill, stroke: state.currentStroke,
        strokeWidth: state.currentStrokeWidth, author: state.did,
      };
    } else if (tool === 'circle') {
      shape = {
        id: `shape:${crypto.randomUUID()}`, layerId: state.activeLayerId,
        type: 'circle', x: Math.min(drawState.startX, pt.x), y: Math.min(drawState.startY, pt.y),
        width: Math.abs(pt.x - drawState.startX), height: Math.abs(pt.y - drawState.startY),
        fill: state.currentFill, stroke: state.currentStroke,
        strokeWidth: state.currentStrokeWidth, author: state.did,
      };
    } else if (tool === 'line') {
      shape = {
        id: `shape:${crypto.randomUUID()}`, layerId: state.activeLayerId,
        type: 'line', x: drawState.startX, y: drawState.startY,
        x2: pt.x, y2: pt.y,
        fill: 'transparent', stroke: state.currentStroke,
        strokeWidth: state.currentStrokeWidth, author: state.did,
      };
    } else if (tool === 'freehand') {
      drawState.currentPoints.push(pt);
      const d = pointsToPath(drawState.currentPoints);
      shape = {
        id: `shape:${crypto.randomUUID()}`, layerId: state.activeLayerId,
        type: 'path', x: 0, y: 0, pathData: d,
        fill: 'transparent', stroke: state.currentStroke,
        strokeWidth: state.currentStrokeWidth, author: state.did,
      };
    }

    if (shape && (shape.width !== 0 || shape.height !== 0 || shape.type === 'path' || shape.type === 'line')) {
      state.shapes.push(shape);
      state.bc.postMessage({ type: 'canvas-shape-add', graphUri: state.graph.uri, shape });
      addGovLog(`${shape.type} shape by ${state.displayName} on ${state.layers.find(l => l.id === state.activeLayerId)?.name || 'layer'}`, true);
      renderShapes();
    }
  });

  // --- Remote cursor rendering ---
  function renderCursors(): void {
    cursorLayer.innerHTML = '';
    for (const [, cursor] of state.cursors) {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('transform', `translate(${cursor.x}, ${cursor.y})`);
      // Arrow cursor
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M0,0 L0,16 L4,12 L8,18 L10,17 L6,11 L12,10 Z');
      path.setAttribute('fill', cursor.color);
      path.setAttribute('stroke', '#fff');
      path.setAttribute('stroke-width', '1');
      g.appendChild(path);
      // Name label
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', '14');
      text.setAttribute('y', '12');
      text.setAttribute('fill', cursor.color);
      text.setAttribute('font-size', '11');
      text.setAttribute('font-weight', 'bold');
      text.textContent = cursor.name;
      g.appendChild(text);
      cursorLayer.appendChild(g);
    }
  }

  // --- Remote in-progress strokes ---
  const remoteStrokes = new Map<string, SVGPathElement>();
  document.addEventListener('canvas-stroke', ((e: CustomEvent) => {
    const { did, stroke, strokeWidth, d } = e.detail;
    let el = remoteStrokes.get(did);
    if (!el) {
      el = document.createElementNS('http://www.w3.org/2000/svg', 'path') as SVGPathElement;
      el.setAttribute('fill', 'none');
      el.setAttribute('stroke-linecap', 'round');
      el.setAttribute('stroke-linejoin', 'round');
      el.setAttribute('opacity', '0.5');
      strokePreview.appendChild(el);
      remoteStrokes.set(did, el);
    }
    el.setAttribute('d', d);
    el.setAttribute('stroke', stroke);
    el.setAttribute('stroke-width', String(strokeWidth));
  }) as EventListener);

  // Cleanup remote strokes when shape is added
  document.addEventListener('canvas-update', ((e: CustomEvent) => {
    if (e.detail.type === 'shape') {
      // Clear all remote stroke previews
      for (const [did, el] of remoteStrokes) { el.remove(); }
      remoteStrokes.clear();
    }
  }) as EventListener);

  // --- Event listeners for cross-tab updates ---
  document.addEventListener('canvas-update', () => {
    renderShapes();
    renderCursors();
    renderLayers();
    renderGovLog();
  });

  // --- Share button ---
  const header = document.createElement('div');
  header.className = 'canvas-header';
  header.innerHTML = `
    <h2>🎨 ${state.canvasName}</h2>
    <button id="share-btn">📋 Share</button>
  `;
  container.insertBefore(header, toolbar);

  document.getElementById('share-btn')?.addEventListener('click', () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => alert('Link copied!'));
  });

  // Initial render
  renderLayers();
  renderShapes();
  renderGovLog();
}

function pointsToPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i].x} ${points[i].y}`;
  }
  return d;
}
