import { idColorCss, UNASSIGNED_ID_COLOR_CSS } from './id-colors.js';
import { deriveOperatorVisualState, identityNameForCluster } from './operator-visual-state.js';

const DRAG_START_DISTANCE_PX = 7;
const TOUCH_DRAG_HOLD_MS = 230;
const TOUCH_SCROLL_ESCAPE_PX = 9;
const PREVIEW_RADIUS = 1.65;

const FALLBACK_PREVIEW = Object.freeze([
  [0.50, 0.08], [0.46, 0.15], [0.54, 0.15], [0.50, 0.20],
  [0.42, 0.29], [0.50, 0.28], [0.58, 0.29], [0.38, 0.40],
  [0.50, 0.39], [0.62, 0.40], [0.43, 0.52], [0.57, 0.52],
  [0.44, 0.66], [0.56, 0.66], [0.42, 0.82], [0.58, 0.82],
  [0.40, 0.94], [0.60, 0.94]
]);

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function shortClusterName(cluster) {
  if (!cluster) return 'Cluster';
  if (cluster.sourceId !== null && cluster.sourceId !== undefined) return `Cluster ${cluster.sourceId}`;
  if (cluster.uuid) return `Cluster ${cluster.uuid.slice(0, 6)}`;
  return 'Cluster';
}

function assignedSlotForCluster(snapshot, key) {
  return snapshot.slots.find((slot) => slot.clusterKey === key);
}

function identityWarning(slot) {
  if (!slot.enabled || !slot.locked || !slot.identityKey) return null;
  if (!slot.clusterKey) return { type: 'missing', label: 'Identity missing' };
  if (slot.clusterKey !== slot.identityKey) return { type: 'override', label: 'Identity overridden' };
  return null;
}

function coordinateText(cluster) {
  const [x = 0, y = 0, z = 0] = cluster?.centroid ?? [];
  return `x ${Number(x).toFixed(2)}  y ${Number(y).toFixed(2)}  z ${Number(z).toFixed(2)}`;
}

function previewCircles(points) {
  const source = Array.isArray(points) && points.length ? points : FALLBACK_PREVIEW;
  return source.slice(0, 84).map(([x, y]) => {
    const cx = 7 + Math.max(0, Math.min(1, Number(x))) * 86;
    const cy = 4 + Math.max(0, Math.min(1, Number(y))) * 92;
    return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${PREVIEW_RADIUS}"></circle>`;
  }).join('');
}

function capsuleTitle(cluster, slot) {
  return identityNameForCluster(slot, cluster?.key) || shortClusterName(cluster);
}

export function createIdInterface({ store }) {
  const idList = document.querySelector('#id-list');
  const clusterTray = document.querySelector('#cluster-tray');
  const liveCount = document.querySelector('#live-count');
  const warningButton = document.querySelector('#warning-button');
  const slotCount = document.querySelector('#slot-count');
  const connectionPill = document.querySelector('.connection-pill');
  const connectionStatus = document.querySelector('#connection-status');
  const connectionNote = document.querySelector('#connection-note');
  const sceneLabel = document.querySelector('#scene-label');

  const contextMenu = document.createElement('div');
  contextMenu.className = 'cluster-context-menu';
  contextMenu.hidden = true;
  document.body.appendChild(contextMenu);

  let dragState = null;
  let sceneDrag = null;
  let activeDropTarget = null;
  let suppressClickUntil = 0;
  let contextClusterKey = null;

  function clusterCapsuleMarkup(cluster, slot, { tray = false, selected = false } = {}) {
    const color = slot ? idColorCss(slot.id) : UNASSIGNED_ID_COLOR_CSS;
    const manual = Boolean(slot?.manual);
    const classes = [
      'cluster-capsule',
      slot ? 'assigned' : 'unassigned',
      manual ? 'manual' : '',
      selected ? 'selected' : ''
    ].filter(Boolean).join(' ');

    return `
      <div
        class="${classes}"
        style="--capsule-color:${color}"
        data-action="select-cluster"
        data-cluster-key="${escapeHtml(cluster.key)}"
        data-drag-type="cluster"
        data-drag-key="${escapeHtml(cluster.key)}"
        data-live-cluster-key="${escapeHtml(cluster.key)}"
        ${tray ? `data-context-cluster-key="${escapeHtml(cluster.key)}"` : ''}
        role="button"
        tabindex="0"
        aria-label="${escapeHtml(capsuleTitle(cluster, slot))}"
      >
        <svg class="capsule-preview" viewBox="0 0 100 100" aria-hidden="true">
          ${previewCircles(cluster.preview)}
        </svg>
        <span class="capsule-copy">
          <strong>${escapeHtml(capsuleTitle(cluster, slot))}${manual ? ' · Manual' : ''}</strong>
          <small class="capsule-coords">${escapeHtml(coordinateText(cluster))}</small>
          <em class="capsule-assignment">${slot ? `ID ${slot.id}` : 'Unassigned'}</em>
        </span>
        ${manual ? `
          <button
            class="manual-return-button"
            type="button"
            data-action="release-manual"
            data-id="${slot.id}"
            data-no-drag
            title="Return smoothly to the live cluster"
            aria-label="Return ID ${slot.id} to live tracking"
          >↩</button>` : ''}
      </div>`;
  }

  function render() {
    const snapshot = store.snapshot();
    const clusterByKey = new Map(snapshot.clusters.map((cluster) => [cluster.key, cluster]));
    const visibleClusters = snapshot.clusters
      .filter((cluster) => cluster.visible)
      .sort((a, b) => (a.sourceId ?? Number.MAX_SAFE_INTEGER) - (b.sourceId ?? Number.MAX_SAFE_INTEGER));

    const visualState = deriveOperatorVisualState(snapshot.slots);
    idList.classList.toggle('solo-mode', visualState.soloMode);
    clusterTray.classList.toggle('solo-mode', visualState.soloMode);

    idList.innerHTML = snapshot.slots.map((slot) => {
      const cluster = slot.clusterKey ? clusterByKey.get(slot.clusterKey) : null;
      const selected = snapshot.selected?.type === 'id'
        ? snapshot.selected.id === slot.id
        : snapshot.selected?.type === 'cluster' && snapshot.selected.key === slot.clusterKey;
      const warning = identityWarning(slot);
      const rowClasses = [
        'slot-row',
        slot.enabled ? 'enabled' : 'disabled',
        slot.solo ? 'solo' : '',
        selected ? 'selected' : ''
      ].filter(Boolean).join(' ');
      const wellClasses = [
        'slot-well',
        cluster ? 'filled' : '',
        slot.locked ? 'locked' : '',
        warning?.type === 'override' ? 'override' : ''
      ].filter(Boolean).join(' ');

      return `
        <article class="${rowClasses}" style="--id-color:${idColorCss(slot.id)}" data-slot-id="${slot.id}">
          <button
            class="slot-id-button"
            type="button"
            data-action="toggle-enabled"
            data-id="${slot.id}"
            title="${slot.enabled ? 'Disable' : 'Enable'} ID ${slot.id}"
            aria-pressed="${slot.enabled}"
          >${slot.id}</button>
          <button
            class="slot-solo-button${slot.solo ? ' active' : ''}"
            type="button"
            data-action="toggle-solo"
            data-id="${slot.id}"
            title="Solo ID ${slot.id}"
            aria-pressed="${slot.solo}"
          >S</button>
          <div class="${wellClasses}" data-drop-type="id" data-id="${slot.id}" data-action="select-id">
            ${cluster ? clusterCapsuleMarkup(cluster, slot, { selected }) : ''}
            <button
              class="slot-lock-button${slot.locked ? ' active' : ''}"
              type="button"
              data-action="toggle-lock"
              data-id="${slot.id}"
              data-no-drag
              title="${slot.locked ? 'Unlock identity' : 'Lock & learn'}"
              aria-label="${slot.locked ? 'Unlock' : 'Lock and learn'} ID ${slot.id}"
            ><span class="lock-symbol ${slot.locked ? 'closed' : 'open'}" aria-hidden="true"></span></button>
          </div>
        </article>`;
    }).join('');

    clusterTray.innerHTML = visibleClusters.length
      ? visibleClusters.map((cluster) => {
          const slot = assignedSlotForCluster(snapshot, cluster.key);
          const selected = snapshot.selected?.type === 'cluster' && snapshot.selected.key === cluster.key;
          const solo = visualState.soloClusterKeys.has(cluster.key);
          return `<div class="${solo ? 'is-solo' : visualState.soloMode ? 'is-solo-muted' : ''}">${clusterCapsuleMarkup(cluster, slot, { tray: true, selected })}</div>`;
        }).join('')
      : '<div class="tray-empty">Waiting for live clusters…</div>';

    liveCount.textContent = `(${visibleClusters.length})`;
    slotCount.textContent = String(snapshot.slots.length);

    const warnings = snapshot.slots
      .map((slot) => ({ slot, warning: identityWarning(slot) }))
      .filter(({ warning }) => warning);
    warningButton.hidden = warnings.length === 0;
    warningButton.textContent = warnings.length === 1 ? '1 warning' : `${warnings.length} warnings`;
    warningButton.dataset.firstWarningId = warnings[0]?.slot.id ?? '';

    if (!contextMenu.hidden && contextClusterKey) renderContextMenu(contextClusterKey);
  }

  function updateTracking(items) {
    const clusterByKey = new Map((items ?? []).map((cluster) => [cluster.key, cluster]));
    document.querySelectorAll('[data-live-cluster-key]').forEach((capsule) => {
      const cluster = clusterByKey.get(capsule.dataset.liveClusterKey);
      if (!cluster) return;
      const coords = capsule.querySelector('.capsule-coords');
      const preview = capsule.querySelector('.capsule-preview');
      if (coords) coords.textContent = coordinateText(cluster);
      if (preview) preview.innerHTML = previewCircles(cluster.preview);
    });
  }

  function setConnectionState(state) {
    const phase = state?.phase ?? 'idle';
    const label = {
      idle: 'Idle',
      connecting: 'Connecting',
      retrying: 'Retrying',
      connected: 'Live',
      error: 'Error'
    }[phase] ?? 'Idle';
    connectionStatus.textContent = label;
    connectionPill.className = `connection-pill ${phase}`;
    connectionNote.textContent = state?.note ?? '';
  }

  function setScene(value) {
    sceneLabel.textContent = value || 'All scenes';
  }

  function slotById(id, snapshot = store.snapshot()) {
    return snapshot.slots.find((slot) => slot.id === Number(id));
  }

  function handleAction(target) {
    const action = target.dataset.action;
    if (!action) return false;
    const id = Number(target.dataset.id);
    const key = target.dataset.clusterKey;
    const snapshot = store.snapshot();
    const slot = slotById(id, snapshot);

    switch (action) {
      case 'toggle-enabled': store.setEnabled(id, !slot?.enabled); break;
      case 'toggle-solo': store.setSolo(id, !slot?.solo); break;
      case 'toggle-lock': slot?.locked ? store.unlock(id) : store.lockAndLearn(id); break;
      case 'lock-all': store.lockAllVisible(); break;
      case 'unlock-all': store.unlockAll(); break;
      case 'select-cluster': store.selectCluster(key); break;
      case 'select-id':
        if (!target.closest?.('.cluster-capsule, .slot-lock-button')) store.selectId(id);
        break;
      case 'release-manual': store.setManual(id, false); break;
      default: return false;
    }
    return true;
  }

  document.addEventListener('click', (event) => {
    if (!contextMenu.hidden && !event.target.closest?.('.cluster-context-menu')) closeContextMenu();

    if (performance.now() < suppressClickUntil && event.target.closest?.('[data-drag-type]')) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const action = event.target.closest?.('[data-action]');
    if (action && handleAction(action)) return;

    if (event.target === warningButton || warningButton.contains(event.target)) {
      const id = Number(warningButton.dataset.firstWarningId);
      if (id) {
        store.selectId(id);
        document.querySelector(`[data-slot-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
      }
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeContextMenu();
      store.clearSelection();
      return;
    }
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;

    const snapshot = store.snapshot();
    const selectedSlot = snapshot.selected?.type === 'id'
      ? slotById(snapshot.selected.id, snapshot)
      : snapshot.selected?.type === 'cluster'
        ? assignedSlotForCluster(snapshot, snapshot.selected.key)
        : null;
    if (!selectedSlot) return;

    if (event.key.toLowerCase() === 'l') {
      event.preventDefault();
      selectedSlot.locked ? store.unlock(selectedSlot.id) : store.lockAndLearn(selectedSlot.id);
    }
    if (event.key.toLowerCase() === 'm') {
      event.preventDefault();
      store.setManual(selectedSlot.id, !selectedSlot.manual);
    }
  });

  document.addEventListener('contextmenu', (event) => {
    const capsule = event.target.closest?.('.cluster-tray [data-context-cluster-key]');
    if (!capsule) return;
    event.preventDefault();
    openContextMenu(capsule.dataset.contextClusterKey, event.clientX, event.clientY);
  });

  contextMenu.addEventListener('click', (event) => {
    const button = event.target.closest?.('[data-context-action]');
    if (!button || !contextClusterKey) return;
    const snapshot = store.snapshot();
    const currentSlot = assignedSlotForCluster(snapshot, contextClusterKey);
    const action = button.dataset.contextAction;

    if (action === 'assign') {
      store.assignClusterToId(contextClusterKey, Number(button.dataset.id));
      closeContextMenu();
      return;
    }
    if (action === 'unassign' && currentSlot) {
      store.releaseId(currentSlot.id);
      closeContextMenu();
      return;
    }
    if (action === 'name' && currentSlot) {
      const name = window.prompt('Identity name', currentSlot.identityName || '');
      if (name !== null) store.setIdentityName(currentSlot.id, name);
      closeContextMenu();
    }
  });

  function openContextMenu(key, x, y) {
    contextClusterKey = key;
    renderContextMenu(key);
    contextMenu.hidden = false;
    const rect = contextMenu.getBoundingClientRect();
    contextMenu.style.left = `${Math.max(8, Math.min(window.innerWidth - rect.width - 8, x))}px`;
    contextMenu.style.top = `${Math.max(8, Math.min(window.innerHeight - rect.height - 8, y))}px`;
  }

  function renderContextMenu(key) {
    const snapshot = store.snapshot();
    const cluster = snapshot.clusters.find((candidate) => candidate.key === key);
    const currentSlot = assignedSlotForCluster(snapshot, key);
    contextMenu.innerHTML = `
      <header>${escapeHtml(shortClusterName(cluster))} · assign to ID</header>
      <div class="context-id-grid">
        ${snapshot.slots.map((slot) => `
          <button
            type="button"
            class="context-id"
            style="--id-color:${idColorCss(slot.id)}"
            data-context-action="assign"
            data-id="${slot.id}"
            ${slot.enabled ? '' : 'disabled'}
          >${slot.id}${currentSlot?.id === slot.id ? ' ·' : ''}</button>
        `).join('')}
      </div>
      <div class="context-menu-separator"></div>
      ${currentSlot ? `
        <button type="button" class="context-secondary" data-context-action="name">Identity name…</button>
        <button type="button" class="context-secondary" data-context-action="unassign">Unassign from ID ${currentSlot.id}</button>
      ` : ''}
    `;
  }

  function closeContextMenu() {
    contextMenu.hidden = true;
    contextClusterKey = null;
  }

  document.addEventListener('pointerdown', (event) => {
    if (event.target.closest?.('[data-no-drag]')) return;
    const handle = event.target.closest?.('[data-drag-type="cluster"]');
    if (!handle || event.button !== 0 || handle.closest('#canvas-host')) return;

    const key = handle.dataset.dragKey;
    if (!key) return;
    const isTouch = event.pointerType === 'touch';
    dragState = {
      pointerId: event.pointerId,
      key,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      dragging: false,
      armed: !isTouch,
      touch: isTouch,
      source: handle,
      ghost: null,
      holdTimer: null
    };

    if (!isTouch) {
      handle.setPointerCapture?.(event.pointerId);
      return;
    }

    dragState.holdTimer = window.setTimeout(() => {
      if (!dragState || dragState.pointerId !== event.pointerId || dragState.dragging) return;
      dragState.armed = true;
      dragState.source.setPointerCapture?.(event.pointerId);
      startDragAt(dragState.lastX, dragState.lastY);
    }, TOUCH_DRAG_HOLD_MS);
  });

  document.addEventListener('pointermove', (event) => {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    dragState.lastX = event.clientX;
    dragState.lastY = event.clientY;
    const distance = Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY);

    if (dragState.touch && !dragState.armed) {
      if (distance >= TOUCH_SCROLL_ESCAPE_PX) cancelPendingDrag();
      return;
    }

    if (!dragState.dragging && distance >= DRAG_START_DISTANCE_PX) startDragAt(event.clientX, event.clientY);
    if (!dragState?.dragging) return;
    event.preventDefault();
    moveDragAt(event.clientX, event.clientY);
  }, { passive: false });

  document.addEventListener('pointerup', finishDrag);
  document.addEventListener('pointercancel', finishDrag);

  function clearHoldTimer(state = dragState) {
    if (state?.holdTimer) window.clearTimeout(state.holdTimer);
    if (state) state.holdTimer = null;
  }

  function cancelPendingDrag() {
    clearHoldTimer();
    dragState = null;
    setActiveDropTarget(null);
  }

  function startDragAt(clientX, clientY) {
    if (!dragState) return;
    clearHoldTimer();
    dragState.dragging = true;
    document.body.classList.add('dragging-cluster');
    const snapshot = store.snapshot();
    const cluster = snapshot.clusters.find((candidate) => candidate.key === dragState.key);
    const slot = assignedSlotForCluster(snapshot, dragState.key);
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.style.setProperty('--capsule-color', slot ? idColorCss(slot.id) : UNASSIGNED_ID_COLOR_CSS);
    ghost.textContent = capsuleTitle(cluster, slot);
    document.body.appendChild(ghost);
    dragState.ghost = ghost;
    moveDragAt(clientX, clientY);
  }

  function findIdDropTarget(clientX, clientY) {
    const underPointer = document.elementFromPoint(clientX, clientY);
    const well = underPointer?.closest?.('.slot-well[data-drop-type="id"]');
    if (!well) return null;
    return { element: well, id: Number(well.dataset.id) };
  }

  function setActiveDropTarget(target) {
    if (activeDropTarget?.element === target?.element && activeDropTarget?.id === target?.id) return;
    activeDropTarget?.element?.classList.remove('drop-target');
    activeDropTarget = target;
    activeDropTarget?.element?.classList.add('drop-target');
  }

  function moveDragAt(clientX, clientY) {
    if (!dragState?.ghost) return;
    dragState.ghost.style.transform = `translate3d(${clientX + 12}px, ${clientY + 12}px, 0)`;
    dragState.ghost.hidden = true;
    setActiveDropTarget(findIdDropTarget(clientX, clientY));
    dragState.ghost.hidden = false;
  }

  function finishDrag(event) {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const current = dragState;
    clearHoldTimer(current);
    dragState = null;
    document.body.classList.remove('dragging-cluster');
    current.ghost?.remove();
    if (current.source.hasPointerCapture?.(event.pointerId)) current.source.releasePointerCapture?.(event.pointerId);

    const target = activeDropTarget;
    setActiveDropTarget(null);
    if (!current.dragging) return;

    suppressClickUntil = performance.now() + 260;
    event.preventDefault();
    if (target) assignDraggedCluster(current.key, target.id);
  }

  function assignDraggedCluster(key, targetId, floorPoint = null) {
    const before = store.snapshot();
    const sourceSlot = assignedSlotForCluster(before, key);
    const cluster = before.clusters.find((candidate) => candidate.key === key);
    const manualPoint = floorPoint ?? (cluster ? [cluster.centroid[0], 0, cluster.centroid[2]] : null);

    if (sourceSlot?.manual && sourceSlot.id !== targetId) store.setManual(sourceSlot.id, false);
    const result = store.assignClusterToId(key, targetId);
    if (!result.ok) return false;

    store.setManual(targetId, true);
    if (manualPoint) store.setManualPosition(targetId, manualPoint);
    return true;
  }

  function handle3dClusterDrag(event) {
    const key = event?.key;
    if (!key) return;

    if (event.phase === 'start') {
      const snapshot = store.snapshot();
      const cluster = snapshot.clusters.find((candidate) => candidate.key === key);
      const sourceSlot = assignedSlotForCluster(snapshot, key);
      const floorPoint = event.floorPoint ?? (cluster ? [cluster.centroid[0], 0, cluster.centroid[2]] : null);

      sceneDrag = { key, sourceId: sourceSlot?.id ?? null, lastFloorPoint: floorPoint };
      document.body.classList.add('dragging-cluster');
      store.selectCluster(key);

      if (sourceSlot) {
        store.setManual(sourceSlot.id, true);
        if (floorPoint) store.setManualPosition(sourceSlot.id, floorPoint);
      }
      setActiveDropTarget(findIdDropTarget(event.clientX, event.clientY));
      return;
    }

    if (!sceneDrag || sceneDrag.key !== key) return;
    if (event.floorPoint) sceneDrag.lastFloorPoint = event.floorPoint;
    setActiveDropTarget(findIdDropTarget(event.clientX, event.clientY));

    if (event.phase === 'move') {
      if (sceneDrag.sourceId && sceneDrag.lastFloorPoint) {
        store.setManualPosition(sceneDrag.sourceId, sceneDrag.lastFloorPoint);
      }
      return;
    }

    if (event.phase === 'end' || event.phase === 'cancel') {
      const target = activeDropTarget;
      setActiveDropTarget(null);
      document.body.classList.remove('dragging-cluster');

      if (event.phase === 'end' && target) {
        assignDraggedCluster(key, target.id, sceneDrag.lastFloorPoint);
      }
      sceneDrag = null;
    }
  }

  render();

  return {
    render,
    updateTracking,
    setConnectionState,
    setScene,
    handle3dClusterDrag
  };
}
