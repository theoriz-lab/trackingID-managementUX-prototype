const DRAG_START_DISTANCE_PX = 7;
const TOUCH_DRAG_HOLD_MS = 230;
const TOUCH_SCROLL_ESCAPE_PX = 9;
const MANUAL_PAD_HALF_RANGE_M = 5;

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function slotState(slot, clusterByKey) {
  if (!slot.enabled) return 'disabled';
  if (slot.manual) return 'manual';
  if (slot.clusterKey && clusterByKey.get(slot.clusterKey)?.visible) return 'assigned';
  if (slot.locked && slot.identityKey) return 'reserved';
  if (slot.locked && slot.pendingLearn) return 'learning';
  return 'free';
}

function stateLabel(state) {
  return {
    assigned: 'Assigned',
    free: 'Free',
    reserved: 'Reserved',
    learning: 'Learning',
    disabled: 'Disabled',
    manual: 'Manual'
  }[state] ?? state;
}

function stateMark(state) {
  return {
    assigned: '●',
    free: '○',
    reserved: '◌',
    learning: '◌',
    disabled: '—',
    manual: '+'
  }[state] ?? '○';
}

function shortClusterName(cluster) {
  if (!cluster) return '—';
  if (cluster.sourceId !== null) return `Cluster ${cluster.sourceId}`;
  if (cluster.uuid) return `Cluster ${cluster.uuid.slice(0, 6)}`;
  return 'Cluster';
}

function assignedSlotForCluster(snapshot, key) {
  return snapshot.slots.find((slot) => slot.clusterKey === key);
}

export function createIdInterface({ store, pickClusterAt, setDropCluster }) {
  const idList = document.querySelector('#id-list');
  const clusterTray = document.querySelector('#cluster-tray');
  const inspector = document.querySelector('#inspector-content');
  const liveCount = document.querySelector('#live-count');
  const warningButton = document.querySelector('#warning-button');
  const slotCount = document.querySelector('#slot-count');
  const connectionStatus = document.querySelector('#connection-status');
  const connectionNote = document.querySelector('#connection-note');
  const sceneLabel = document.querySelector('#scene-label');
  const mobileTabs = document.querySelector('#mobile-tabs');

  let dragState = null;
  let activeDropTarget = null;
  let suppressClickUntil = 0;

  function render() {
    const snapshot = store.snapshot();
    const clusterByKey = new Map(snapshot.clusters.map((cluster) => [cluster.key, cluster]));
    const visibleClusters = snapshot.clusters
      .filter((cluster) => cluster.visible)
      .sort((a, b) => (a.sourceId ?? Number.MAX_SAFE_INTEGER) - (b.sourceId ?? Number.MAX_SAFE_INTEGER));

    idList.classList.toggle('dense', snapshot.slots.length > 24);
    idList.innerHTML = snapshot.slots.map((slot) => {
      const state = slotState(slot, clusterByKey);
      const cluster = slot.clusterKey ? clusterByKey.get(slot.clusterKey) : null;
      const selected = snapshot.selected?.type === 'id' && snapshot.selected.id === slot.id;
      const identity = slot.identityName || (slot.identityKey ? `Identity ${slot.id}` : '');
      const detail = state === 'assigned' || state === 'manual'
        ? shortClusterName(cluster)
        : state === 'reserved'
          ? 'Identity missing'
          : state === 'learning'
            ? 'Waiting to learn'
            : stateLabel(state);

      return `
        <article class="id-row state-${state}${selected ? ' selected' : ''}" data-drop-type="id" data-id="${slot.id}">
          <button class="drag-grip" type="button" data-drag-type="id" data-drag-id="${slot.id}" aria-label="Drag ID ${slot.id}">⋮⋮</button>
          <button class="id-main" type="button" data-action="select-id" data-id="${slot.id}">
            <span class="state-mark" aria-hidden="true">${stateMark(state)}</span>
            <span class="id-number">${slot.id}</span>
            <span class="id-copy">
              <strong>${escapeHtml(identity || detail)}</strong>
              <small>${escapeHtml(identity ? detail : stateLabel(state))}</small>
            </span>
          </button>
          <div class="id-flags" aria-label="ID ${slot.id} flags">
            ${slot.locked ? '<span class="mini-flag accent">LOCK</span>' : ''}
            ${slot.solo ? '<span class="mini-flag solo">SOLO</span>' : ''}
            ${slot.manual ? '<span class="mini-flag">MANUAL</span>' : ''}
          </div>
          <button class="row-action${slot.locked ? ' active' : ''}" type="button" data-action="toggle-lock" data-id="${slot.id}" title="${slot.locked ? 'Unlock identity' : 'Lock and learn'}" aria-label="${slot.locked ? 'Unlock' : 'Lock and learn'} ID ${slot.id}">L</button>
        </article>`;
    }).join('');

    clusterTray.innerHTML = visibleClusters.length
      ? visibleClusters.map((cluster) => {
          const slot = assignedSlotForCluster(snapshot, cluster.key);
          const selected = snapshot.selected?.type === 'cluster' && snapshot.selected.key === cluster.key;
          return `
            <button
              class="cluster-chip${selected ? ' selected' : ''}${cluster.ghost ? ' ghost' : ''}"
              type="button"
              data-action="select-cluster"
              data-cluster-key="${escapeHtml(cluster.key)}"
              data-drag-type="cluster"
              data-drag-key="${escapeHtml(cluster.key)}"
              data-drop-type="cluster"
              title="Select or drag ${escapeHtml(shortClusterName(cluster))}"
            >
              <span class="cluster-live-dot"></span>
              <span>${escapeHtml(shortClusterName(cluster))}</span>
              <strong>${slot ? `ID ${slot.id}` : 'Unassigned'}</strong>
            </button>`;
        }).join('')
      : '<div class="tray-empty">Waiting for live clusters…</div>';

    liveCount.textContent = `${visibleClusters.length} live`;
    slotCount.textContent = `${snapshot.slots.length} IDs`;

    const warnings = snapshot.slots.filter((slot) => {
      if (!slot.enabled || !slot.locked || !slot.identityKey || slot.clusterKey) return false;
      return true;
    });
    warningButton.hidden = warnings.length === 0;
    warningButton.textContent = warnings.length === 1 ? '1 warning' : `${warnings.length} warnings`;
    warningButton.dataset.firstWarningId = warnings[0]?.id ?? '';

    renderInspector(snapshot, clusterByKey);
  }

  function renderInspector(snapshot, clusterByKey) {
    if (snapshot.selected?.type === 'id') {
      const slot = snapshot.slots.find((candidate) => candidate.id === snapshot.selected.id);
      if (!slot) return renderEmptyInspector(snapshot);
      const cluster = slot.clusterKey ? clusterByKey.get(slot.clusterKey) : null;
      const state = slotState(slot, clusterByKey);
      const position = slot.manualPosition;
      const padX = 50 + (position[0] / MANUAL_PAD_HALF_RANGE_M) * 50;
      const padY = 50 - (position[2] / MANUAL_PAD_HALF_RANGE_M) * 50;

      inspector.innerHTML = `
        <div class="inspector-heading">
          <div>
            <span class="eyebrow">Selected ID</span>
            <h2>ID ${slot.id}</h2>
          </div>
          <span class="state-chip state-${state}">${stateMark(state)} ${stateLabel(state)}</span>
        </div>

        <section class="inspector-section">
          <div class="section-title">Assignment</div>
          <div class="value-card">
            <span>${cluster ? escapeHtml(shortClusterName(cluster)) : 'No visible cluster'}</span>
            ${slot.clusterKey ? '<button type="button" class="text-action" data-action="release-id" data-id="' + slot.id + '">Release</button>' : ''}
          </div>
        </section>

        <section class="inspector-section">
          <div class="section-title">Identity</div>
          <label class="field-label" for="identity-name-${slot.id}">Name</label>
          <input id="identity-name-${slot.id}" class="text-input" data-identity-name="${slot.id}" value="${escapeHtml(slot.identityName)}" placeholder="Alice, Singer A…" autocomplete="off">
          <div class="action-grid two">
            <button type="button" class="control-button${slot.locked ? ' active' : ''}" data-action="toggle-lock" data-id="${slot.id}">${slot.locked ? 'Unlock identity' : 'Lock & learn'}</button>
            <button type="button" class="control-button" data-action="clear-identity" data-id="${slot.id}" ${slot.identityKey || slot.identityName ? '' : 'disabled'}>Clear identity</button>
          </div>
          ${slot.locked && !slot.clusterKey && slot.identityKey ? '<p class="inline-warning">Identity is reserved but currently missing.</p>' : ''}
          ${slot.pendingLearn ? '<p class="muted-copy">Locked empty slot: the next cluster assigned here will become its learned identity.</p>' : ''}
        </section>

        <section class="inspector-section">
          <div class="section-title">Output</div>
          <div class="toggle-row">
            <span><strong>Enabled</strong><small>Publish this ID to outputs</small></span>
            <button type="button" class="switch${slot.enabled ? ' on' : ''}" role="switch" aria-checked="${slot.enabled}" data-action="toggle-enabled" data-id="${slot.id}"><i></i></button>
          </div>
          <div class="toggle-row">
            <span><strong>Solo</strong><small>Publish only solo IDs when any solo is active</small></span>
            <button type="button" class="switch${slot.solo ? ' on' : ''}" role="switch" aria-checked="${slot.solo}" data-action="toggle-solo" data-id="${slot.id}"><i></i></button>
          </div>
          <div class="toggle-row">
            <span><strong>Manual takeover</strong><small>Override published position locally</small></span>
            <button type="button" class="switch${slot.manual ? ' on' : ''}" role="switch" aria-checked="${slot.manual}" data-action="toggle-manual" data-id="${slot.id}"><i></i></button>
          </div>
          ${slot.manual ? `
            <div class="manual-pad-wrap">
              <div class="manual-pad" data-manual-pad="${slot.id}" aria-label="Manual X Z position pad">
                <span class="pad-axis pad-axis-x"></span>
                <span class="pad-axis pad-axis-z"></span>
                <i class="manual-point" style="left:${Math.max(0, Math.min(100, padX))}%;top:${Math.max(0, Math.min(100, padY))}%"></i>
              </div>
              <div class="manual-readout" data-manual-readout="${slot.id}"><span>X ${position[0].toFixed(2)} m</span><span>Z ${position[2].toFixed(2)} m</span></div>
            </div>` : ''}
        </section>`;
      return;
    }

    if (snapshot.selected?.type === 'cluster') {
      const cluster = clusterByKey.get(snapshot.selected.key);
      if (!cluster) return renderEmptyInspector(snapshot);
      const assigned = assignedSlotForCluster(snapshot, cluster.key);
      inspector.innerHTML = `
        <div class="inspector-heading">
          <div>
            <span class="eyebrow">Selected cluster</span>
            <h2>${escapeHtml(shortClusterName(cluster))}</h2>
          </div>
          <span class="state-chip ${cluster.ghost ? 'state-reserved' : 'state-assigned'}">${cluster.ghost ? '◌ Ghost' : '● Live'}</span>
        </div>

        <section class="inspector-section">
          <div class="section-title">Current assignment</div>
          <div class="value-card">
            <span>${assigned ? `ID ${assigned.id}` : 'Unassigned'}</span>
            ${assigned ? '<button type="button" class="text-action" data-action="select-id" data-id="' + assigned.id + '">Open ID</button>' : ''}
          </div>
        </section>

        <section class="inspector-section">
          <div class="section-title">Assign ID</div>
          <div class="assign-grid">
            ${snapshot.slots.map((slot) => {
              const state = slotState(slot, clusterByKey);
              const isCurrent = assigned?.id === slot.id;
              return `<button type="button" class="assign-id${isCurrent ? ' current' : ''}" data-action="assign-cluster" data-id="${slot.id}" data-cluster-key="${escapeHtml(cluster.key)}" ${slot.enabled ? '' : 'disabled'}><strong>${slot.id}</strong><small>${stateLabel(state)}</small></button>`;
            }).join('')}
          </div>
          <p class="muted-copy">Tap an ID, or drag this cluster onto any ID row. Dropping onto an occupied ID moves its current cluster to the next free ID.</p>
        </section>`;
      return;
    }

    renderEmptyInspector(snapshot);
  }

  function renderEmptyInspector(snapshot) {
    const warnings = snapshot.slots.filter((slot) => slot.enabled && slot.locked && slot.identityKey && !slot.clusterKey);
    inspector.innerHTML = `
      <div class="inspector-heading">
        <div>
          <span class="eyebrow">Operator</span>
          <h2>ID management</h2>
        </div>
      </div>
      <section class="inspector-section intro-copy">
        <p>Select an ID or a live cluster to edit it. On desktop or touch, drag an ID onto a cluster or a cluster onto an ID for a direct reassignment.</p>
        <div class="shortcut-row"><kbd>L</kbd><span>Lock / unlock selected ID</span></div>
        <div class="shortcut-row"><kbd>M</kbd><span>Manual takeover selected ID</span></div>
        <div class="shortcut-row"><kbd>Esc</kbd><span>Clear selection</span></div>
      </section>
      ${warnings.length ? `
        <section class="inspector-section">
          <div class="section-title">Warnings</div>
          <div class="warning-list">
            ${warnings.map((slot) => `<button type="button" data-action="select-id" data-id="${slot.id}"><span>◌</span><strong>ID ${slot.id}</strong><small>${escapeHtml(slot.identityName || `Identity ${slot.id}`)} missing</small></button>`).join('')}
          </div>
        </section>` : ''}`;
  }

  function setConnectionState(state) {
    const phase = state?.phase ?? 'idle';
    const label = {
      idle: 'Idle',
      connecting: 'Connecting',
      retrying: 'Retrying',
      connected: 'Connected',
      error: 'Error'
    }[phase] ?? 'Idle';
    connectionStatus.textContent = label;
    connectionStatus.className = `connection-status ${phase}`;
    connectionNote.textContent = state?.note ?? '';
  }

  function setScene(value) {
    sceneLabel.textContent = value || 'All scenes';
  }

  function handleAction(target) {
    const action = target.dataset.action;
    if (!action) return false;
    const id = Number(target.dataset.id);
    const key = target.dataset.clusterKey;
    const snapshot = store.snapshot();
    const slot = snapshot.slots.find((candidate) => candidate.id === id);

    switch (action) {
      case 'select-id': store.selectId(id); break;
      case 'select-cluster': store.selectCluster(key); break;
      case 'toggle-lock': slot?.locked ? store.unlock(id) : store.lockAndLearn(id); break;
      case 'toggle-enabled': store.setEnabled(id, !slot?.enabled); break;
      case 'toggle-solo': store.setSolo(id, !slot?.solo); break;
      case 'toggle-manual': store.setManual(id, !slot?.manual); break;
      case 'release-id': store.releaseId(id); break;
      case 'clear-identity': store.clearIdentity(id); break;
      case 'assign-cluster': store.assignClusterToId(key, id); break;
      case 'lock-all': store.lockAllVisible(); break;
      case 'unlock-all': store.unlockAll(); break;
      case 'add-slots': store.addSlots(4); break;
      case 'clear-selection': store.clearSelection(); break;
      case 'mobile-pane': setMobilePane(target.dataset.pane); break;
      default: return false;
    }
    return true;
  }

  document.addEventListener('click', (event) => {
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
        setMobilePane('inspector');
      }
    }
  });

  document.addEventListener('change', (event) => {
    const input = event.target.closest?.('[data-identity-name]');
    if (!input) return;
    store.setIdentityName(Number(input.dataset.identityName), input.value);
  });

  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    const snapshot = store.snapshot();
    if (event.key === 'Escape') {
      store.clearSelection();
      return;
    }
    if (snapshot.selected?.type !== 'id') return;
    const slot = snapshot.slots.find((candidate) => candidate.id === snapshot.selected.id);
    if (!slot) return;
    if (event.key.toLowerCase() === 'l') {
      event.preventDefault();
      slot.locked ? store.unlock(slot.id) : store.lockAndLearn(slot.id);
    }
    if (event.key.toLowerCase() === 'm') {
      event.preventDefault();
      store.setManual(slot.id, !slot.manual);
    }
  });

  document.addEventListener('pointerdown', (event) => {
    const pad = event.target.closest?.('[data-manual-pad]');
    if (pad) {
      beginManualPad(event, pad);
      return;
    }

    const handle = event.target.closest?.('[data-drag-type]');
    if (!handle || event.button !== 0) return;
    const type = handle.dataset.dragType;
    const key = type === 'id' ? Number(handle.dataset.dragId) : handle.dataset.dragKey;
    if (!key) return;

    const isTouch = event.pointerType === 'touch';
    dragState = {
      pointerId: event.pointerId,
      type,
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

    // Touch keeps native panel/tray scrolling. A short hold intentionally
    // enters direct manipulation; moving first is treated as scrolling/tap.
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

  document.addEventListener('pointerup', (event) => finishDrag(event));
  document.addEventListener('pointercancel', (event) => finishDrag(event));
  document.addEventListener('contextmenu', (event) => {
    if (event.target.closest?.('[data-drag-type]') && dragState?.touch) event.preventDefault();
  });

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
    document.body.classList.add('dragging');
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.textContent = dragState.type === 'id' ? `ID ${dragState.key}` : clusterDragLabel(dragState.key);
    document.body.appendChild(ghost);
    dragState.ghost = ghost;
    moveDragAt(clientX, clientY);
  }

  function clusterDragLabel(key) {
    const cluster = store.snapshot().clusters.find((candidate) => candidate.key === key);
    return shortClusterName(cluster);
  }

  function findDropTarget(element, clientX, clientY) {
    const target = element?.closest?.('[data-drop-type]');
    if (target) {
      const type = target.dataset.dropType;
      if (dragState.type === 'id' && (type === 'cluster' || type === 'id')) {
        return {
          element: target,
          type,
          id: Number(target.dataset.id) || null,
          clusterKey: target.dataset.clusterKey || null
        };
      }
      if (dragState.type === 'cluster' && type === 'id') {
        return {
          element: target,
          type,
          id: Number(target.dataset.id),
          clusterKey: null
        };
      }
    }

    if (dragState.type === 'id') {
      const clusterKey = pickClusterAt?.(clientX, clientY);
      if (clusterKey) {
        return { element: null, type: 'cluster', id: null, clusterKey };
      }
    }
    return null;
  }

  function sameDropTarget(first, second) {
    if (!first || !second) return first === second;
    return first.element === second.element
      && first.type === second.type
      && first.id === second.id
      && first.clusterKey === second.clusterKey;
  }

  function setActiveDropTarget(target) {
    if (sameDropTarget(activeDropTarget, target)) return;
    activeDropTarget?.element?.classList.remove('drop-target');
    activeDropTarget = target;
    activeDropTarget?.element?.classList.add('drop-target');
    setDropCluster?.(target?.type === 'cluster' ? target.clusterKey : null);
  }

  function moveDragAt(clientX, clientY) {
    if (!dragState?.ghost) return;
    dragState.ghost.style.transform = `translate3d(${clientX + 12}px, ${clientY + 12}px, 0)`;
    dragState.ghost.hidden = true;
    const underPointer = document.elementFromPoint(clientX, clientY);
    dragState.ghost.hidden = false;
    setActiveDropTarget(findDropTarget(underPointer, clientX, clientY));
  }

  function finishDrag(event) {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const current = dragState;
    clearHoldTimer(current);
    dragState = null;
    document.body.classList.remove('dragging');
    current.ghost?.remove();
    if (current.source.hasPointerCapture?.(event.pointerId)) {
      current.source.releasePointerCapture?.(event.pointerId);
    }

    const target = activeDropTarget;
    setActiveDropTarget(null);
    if (!current.dragging) return;

    // Prevent the synthetic click that browsers normally dispatch after a
    // completed pointer drag from changing selection immediately afterward.
    suppressClickUntil = performance.now() + 260;
    event.preventDefault();

    if (!target) return;
    if (current.type === 'cluster' && target.type === 'id') {
      store.assignClusterToId(current.key, target.id);
      setMobilePane('inspector');
      return;
    }

    if (current.type === 'id' && target.type === 'cluster') {
      store.assignClusterToId(target.clusterKey, current.key);
      return;
    }

    if (current.type === 'id' && target.type === 'id') {
      store.swapAssignments(current.key, target.id);
    }
  }

  function beginManualPad(event, pad) {
    if (event.button !== 0) return;
    const id = Number(pad.dataset.manualPad);
    if (!id) return;
    event.preventDefault();
    pad.setPointerCapture?.(event.pointerId);

    const update = (pointerEvent) => {
      const rect = pad.getBoundingClientRect();
      const nx = Math.max(0, Math.min(1, (pointerEvent.clientX - rect.left) / rect.width));
      const nz = Math.max(0, Math.min(1, (pointerEvent.clientY - rect.top) / rect.height));
      const snapshot = store.snapshot();
      const slot = snapshot.slots.find((candidate) => candidate.id === id);
      if (!slot) return;
      store.setManualPosition(id, [
        (nx * 2 - 1) * MANUAL_PAD_HALF_RANGE_M,
        slot.manualPosition[1],
        ((1 - nz) * 2 - 1) * MANUAL_PAD_HALF_RANGE_M
      ]);
    };

    const move = (pointerEvent) => {
      if (pointerEvent.pointerId !== event.pointerId) return;
      pointerEvent.preventDefault();
      update(pointerEvent);
    };
    const end = (pointerEvent) => {
      if (pointerEvent.pointerId !== event.pointerId) return;
      pad.removeEventListener('pointermove', move);
      pad.removeEventListener('pointerup', end);
      pad.removeEventListener('pointercancel', end);
    };

    pad.addEventListener('pointermove', move, { passive: false });
    pad.addEventListener('pointerup', end);
    pad.addEventListener('pointercancel', end);
    update(event);
  }

  function updateManualPosition(snapshot = store.snapshot()) {
    if (snapshot.selected?.type !== 'id') return;
    const slot = snapshot.slots.find((candidate) => candidate.id === snapshot.selected.id);
    if (!slot?.manual) return;

    const point = inspector.querySelector(`[data-manual-pad="${slot.id}"] .manual-point`);
    const readout = inspector.querySelector(`[data-manual-readout="${slot.id}"]`);
    if (!point || !readout) return;

    const padX = 50 + (slot.manualPosition[0] / MANUAL_PAD_HALF_RANGE_M) * 50;
    const padY = 50 - (slot.manualPosition[2] / MANUAL_PAD_HALF_RANGE_M) * 50;
    point.style.left = `${Math.max(0, Math.min(100, padX))}%`;
    point.style.top = `${Math.max(0, Math.min(100, padY))}%`;

    const values = readout.querySelectorAll('span');
    if (values[0]) values[0].textContent = `X ${slot.manualPosition[0].toFixed(2)} m`;
    if (values[1]) values[1].textContent = `Z ${slot.manualPosition[2].toFixed(2)} m`;
  }

  function setMobilePane(pane) {
    const next = pane === 'inspector' ? 'inspector' : 'ids';
    document.body.dataset.mobilePane = next;
    mobileTabs?.querySelectorAll('[data-action="mobile-pane"]').forEach((button) => {
      button.classList.toggle('active', button.dataset.pane === next);
      button.setAttribute('aria-selected', String(button.dataset.pane === next));
    });
  }

  setMobilePane('ids');
  render();

  return {
    render,
    updateManualPosition,
    setConnectionState,
    setScene,
    openInspector() { setMobilePane('inspector'); }
  };
}
