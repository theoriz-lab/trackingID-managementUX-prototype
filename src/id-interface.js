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
  return cluster?.label ? `Cluster ${cluster.label}` : 'Cluster';
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

function capsuleTitle(cluster) {
  return shortClusterName(cluster);
}

export function createIdInterface({ store }) {
  const idList = document.querySelector('#id-list');
  const clusterTray = document.querySelector('#cluster-tray');
  const liveCount = document.querySelector('#live-count');
  const warningButton = document.querySelector('#warning-button');
  const slotCount = document.querySelector('#slot-count');
  const activeSlotCount = document.querySelector('#active-slot-count');
  const toggleAllEnabled = document.querySelector('#toggle-all-enabled');
  const settingsButton = document.querySelector('#id-settings-button');
  const settingsMenu = document.querySelector('#id-settings-menu');
  const strictModeInput = document.querySelector('#strict-mode');
  const strictModeLabel = document.querySelector('#strict-mode-label');
  const strictModeHelp = document.querySelector('#strict-mode-help');
  const minIdInput = document.querySelector('#min-id');
  const maxIdInput = document.querySelector('#max-id');
  const allowDeleteInput = document.querySelector('#allow-slot-delete');
  const restoreDeletedButton = document.querySelector('#restore-deleted-slots');
  const rangeSummary = document.querySelector('#range-summary');
  const connectionPill = document.querySelector('.connection-pill');
  const connectionStatus = document.querySelector('#connection-status');
  const connectionNote = document.querySelector('#connection-note');
  const sceneLabel = document.querySelector('#scene-label');

  let dragState = null;
  let sceneDrag = null;
  let activeDropTarget = null;
  let suppressClickUntil = 0;

  function clusterCapsuleMarkup(cluster, slot, { tray = false, selected = false } = {}) {
    const color = slot ? idColorCss(slot.id) : UNASSIGNED_ID_COLOR_CSS;
    const manual = Boolean(slot?.manual);
    const identityName = identityNameForCluster(slot, cluster?.key);
    const clusterLocked = Boolean(
      cluster?.lockRequested
      || slot?.locked
      || (slot?.identityKey && slot.identityKey === cluster?.key)
    );
    const classes = [
      'cluster-capsule',
      slot ? 'assigned' : 'unassigned',
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
        role="button"
        tabindex="0"
        aria-label="${escapeHtml(capsuleTitle(cluster))}"
      >
        <svg class="capsule-preview" viewBox="0 0 100 100" aria-hidden="true">
          <path class="capsule-preview-frame" d="M12 34 V12 H88 V34"></path>
          ${previewCircles(cluster.preview)}
        </svg>
        <span class="capsule-copy">
          <strong>${escapeHtml(capsuleTitle(cluster))}${manual ? ' · Manual' : ''}</strong>
          <small class="capsule-coords">${escapeHtml(coordinateText(cluster))}</small>
          <em class="capsule-assignment">${slot
            ? `ID ${slot.id}${identityName ? ` · ${escapeHtml(identityName)}` : ''}`
            : cluster?.lockRequested ? 'Unassigned · lock pending' : 'Unassigned'}</em>
        </span>
        <button
          class="cluster-lock-button${clusterLocked ? ' active' : ''}"
          type="button"
          data-action="toggle-cluster-lock"
          data-cluster-key="${escapeHtml(cluster.key)}"
          data-no-drag
          title="${clusterLocked ? 'Unlock cluster identity' : 'Lock cluster identity'}"
          aria-pressed="${clusterLocked}"
          aria-label="${clusterLocked ? 'Unlock' : 'Lock'} ${escapeHtml(shortClusterName(cluster))}"
        ><span class="lock-symbol ${clusterLocked ? 'closed' : 'open'}" aria-hidden="true"></span></button>
      </div>`;
  }

  function render() {
    const snapshot = store.snapshot();
    const clusterByKey = new Map(snapshot.clusters.map((cluster) => [cluster.key, cluster]));
    const visibleClusters = snapshot.clusters
      .filter((cluster) => cluster.visible)
      .sort((a, b) => (a.sourceId ?? Number.MAX_SAFE_INTEGER) - (b.sourceId ?? Number.MAX_SAFE_INTEGER));

    const operatorSlots = snapshot.slots.filter((slot) => slot.visible);
    const visualState = deriveOperatorVisualState(operatorSlots);
    const selectedClusterKey = snapshot.selected?.type === 'cluster'
      ? snapshot.selected.key
      : snapshot.selected?.type === 'id'
        ? snapshot.slots.find((slot) => slot.id === snapshot.selected.id)?.clusterKey ?? null
        : null;
    idList.classList.toggle('solo-mode', visualState.soloMode);
    idList.classList.toggle('deletion-enabled', snapshot.options.allowDelete);
    clusterTray.classList.toggle('solo-mode', visualState.soloMode);
    clusterTray.classList.toggle('has-selection', Boolean(selectedClusterKey));

    idList.innerHTML = operatorSlots.map((slot) => {
      const cluster = slot.clusterKey ? clusterByKey.get(slot.clusterKey) : null;
      const selected = snapshot.selected?.type === 'id'
        ? snapshot.selected.id === slot.id
        : snapshot.selected?.type === 'cluster' && snapshot.selected.key === slot.clusterKey;
      const warning = identityWarning(slot);
      const rowClasses = [
        'slot-row',
        slot.enabled ? 'enabled' : 'disabled',
        slot.solo ? 'solo' : '',
        slot.manual ? 'manual' : '',
        selected ? 'selected' : '',
        snapshot.options.allowDelete ? 'deletable' : ''
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
          <button
            class="slot-manual-button${slot.manual ? ' active' : ''}"
            type="button"
            data-action="toggle-manual"
            data-id="${slot.id}"
            data-no-drag
            title="${slot.manual ? 'Return smoothly to live tracking' : 'Start manual takeover'}"
            aria-pressed="${slot.manual}"
          >M</button>
          ${snapshot.options.allowDelete ? `
            <button
              class="slot-delete-button"
              type="button"
              data-action="delete-slot"
              data-id="${slot.id}"
              data-no-drag
              title="Delete ID ${slot.id} from the operator view"
              aria-label="Delete ID ${slot.id}"
            >×</button>` : ''}
        </article>`;
    }).join('');

    clusterTray.innerHTML = visibleClusters.length
      ? visibleClusters.map((cluster) => {
          const slot = assignedSlotForCluster(snapshot, cluster.key);
          const selected = selectedClusterKey === cluster.key;
          const solo = visualState.soloClusterKeys.has(cluster.key);
          return `<div class="${solo ? 'is-solo' : visualState.soloMode ? 'is-solo-muted' : ''}">${clusterCapsuleMarkup(cluster, slot, { tray: true, selected })}</div>`;
        }).join('')
      : '<div class="tray-empty">Waiting for live clusters…</div>';

    liveCount.textContent = `(${visibleClusters.length})`;
    slotCount.textContent = String(operatorSlots.length);
    activeSlotCount.textContent = String(operatorSlots.filter((slot) => slot.enabled).length);

    const hasVisibleSlots = operatorSlots.length > 0;
    const allVisibleDisabled = hasVisibleSlots && operatorSlots.every((slot) => !slot.enabled);
    toggleAllEnabled.textContent = allVisibleDisabled ? 'Enable all' : 'Disable all';
    toggleAllEnabled.dataset.enableAll = String(allVisibleDisabled);
    toggleAllEnabled.disabled = !hasVisibleSlots;

    if (document.activeElement !== strictModeInput) strictModeInput.checked = snapshot.options.strictMode;
    strictModeLabel.textContent = snapshot.options.strictMode ? 'Strict mode' : 'Non-strict mode';
    strictModeHelp.textContent = snapshot.options.strictMode
      ? 'Overflow clusters stay refused until they leave tracking'
      : 'Overflow clusters wait for the next free ID';
    if (document.activeElement !== allowDeleteInput) allowDeleteInput.checked = snapshot.options.allowDelete;
    if (document.activeElement !== minIdInput) minIdInput.value = String(snapshot.options.minId);
    if (document.activeElement !== maxIdInput) maxIdInput.value = String(snapshot.options.maxId);
    rangeSummary.textContent = `IDs ${snapshot.options.minId}–${snapshot.options.maxId}`;
    restoreDeletedButton.hidden = !snapshot.slots.some((slot) => !slot.visible);

    const warnings = operatorSlots
      .map((slot) => ({ slot, warning: identityWarning(slot) }))
      .filter(({ warning }) => warning);
    warningButton.hidden = warnings.length === 0;
    warningButton.textContent = warnings.length === 1 ? '1 warning' : `${warnings.length} warnings`;
    warningButton.dataset.firstWarningId = warnings[0]?.slot.id ?? '';

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

  function setSettingsOpen(open) {
    const next = Boolean(open);
    settingsMenu.hidden = !next;
    settingsButton.setAttribute('aria-expanded', String(next));
    settingsButton.classList.toggle('active', next);
  }

  function commitIdRange() {
    const min = Number.parseInt(minIdInput.value, 10);
    const max = Number.parseInt(maxIdInput.value, 10);
    if (!Number.isInteger(min) || !Number.isInteger(max)) {
      render();
      return;
    }
    store.setIdRange(min, max);
  }

  settingsButton.addEventListener('click', (event) => {
    event.stopPropagation();
    setSettingsOpen(settingsMenu.hidden);
  });

  strictModeInput.addEventListener('change', () => {
    store.setStrictMode(strictModeInput.checked);
  });

  allowDeleteInput.addEventListener('change', () => {
    store.setAllowDelete(allowDeleteInput.checked);
  });

  for (const input of [minIdInput, maxIdInput]) {
    input.addEventListener('change', commitIdRange);
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      input.blur();
      commitIdRange();
    });
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
      case 'toggle-cluster-lock': store.toggleClusterLock(key); break;
      case 'toggle-manual': store.setManual(id, !slot?.manual); break;
      case 'delete-slot': store.deleteSlot(id); break;
      case 'restore-slots': store.restoreDeletedSlots(); break;
      case 'lock-all-active': store.lockAllActive(); break;
      case 'lock-all': store.lockAll(); break;
      case 'unlock-all': store.unlockAll(); break;
      case 'set-all-enabled':
        store.setAllVisibleEnabled(target.dataset.enableAll === 'true');
        break;
      case 'select-cluster': store.selectCluster(key); break;
      case 'select-id':
        if (!target.closest?.('.cluster-capsule, .slot-lock-button, .slot-manual-button, .slot-delete-button')) {
          store.selectId(id);
        }
        break;
      default: return false;
    }
    return true;
  }

  document.addEventListener('click', (event) => {
    if (
      !settingsMenu.hidden
      && !event.target.closest?.('#id-settings-menu')
      && !event.target.closest?.('#id-settings-button')
    ) {
      setSettingsOpen(false);
    }

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
      setSettingsOpen(false);
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
    ghost.textContent = capsuleTitle(cluster);
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

  function assignDraggedCluster(
    key,
    targetId,
    { floorPoint = null, preserveManual = true } = {}
  ) {
    const before = store.snapshot();
    const sourceSlot = assignedSlotForCluster(before, key);
    const cluster = before.clusters.find((candidate) => candidate.key === key);
    const wasManual = Boolean(sourceSlot?.manual);
    const manualPoint = floorPoint
      ?? sourceSlot?.manualPosition
      ?? (cluster ? [cluster.centroid[0], 0, cluster.centroid[2]] : null);

    const result = store.assignClusterToId(key, targetId);
    if (!result.ok) return false;

    if (wasManual && sourceSlot?.id !== targetId) store.setManual(sourceSlot.id, false);
    if (wasManual && preserveManual) {
      store.setManual(targetId, true);
      if (manualPoint) store.setManualPosition(targetId, manualPoint);
    } else if (wasManual && sourceSlot?.id === targetId) {
      store.setManual(targetId, false);
    }
    return true;
  }

  function handle3dClusterDrag(event) {
    const key = event?.key;
    if (!key) return;

    if (event.phase === 'start' && event.kind === 'manual') {
      const snapshot = store.snapshot();
      const slot = snapshot.slots.find((candidate) => candidate.id === event.id);
      if (!slot?.manual || slot.clusterKey !== key) return;

      sceneDrag = {
        kind: 'manual',
        key,
        sourceId: slot.id,
        lastFloorPoint: event.floorPoint ?? slot.manualPosition
      };
      document.body.classList.add('dragging-cluster');
      store.selectCluster(key);
      if (sceneDrag.lastFloorPoint) store.setManualPosition(slot.id, sceneDrag.lastFloorPoint);
      return;
    }

    if (event.phase === 'start') {
      const snapshot = store.snapshot();
      const cluster = snapshot.clusters.find((candidate) => candidate.key === key);
      const sourceSlot = assignedSlotForCluster(snapshot, key);

      // Once Manual was explicitly enabled from the ID panel, the live tracked
      // source remains read-only. The separate manual proxy is the draggable one.
      if (sourceSlot?.manual) return;

      const floorPoint = event.floorPoint
        ?? (cluster ? [cluster.centroid[0], 0, cluster.centroid[2]] : null);

      sceneDrag = {
        kind: 'temporary',
        key,
        sourceId: sourceSlot?.id ?? null,
        lastFloorPoint: floorPoint
      };
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

    if (sceneDrag.kind === 'manual') {
      if (event.phase === 'move' && sceneDrag.lastFloorPoint) {
        store.setManualPosition(sceneDrag.sourceId, sceneDrag.lastFloorPoint);
      }
      if (event.phase === 'end' || event.phase === 'cancel') {
        document.body.classList.remove('dragging-cluster');
        sceneDrag = null;
      }
      return;
    }

    setActiveDropTarget(findIdDropTarget(event.clientX, event.clientY));

    if (event.phase === 'move') {
      if (sceneDrag.sourceId && sceneDrag.lastFloorPoint) {
        store.setManualPosition(sceneDrag.sourceId, sceneDrag.lastFloorPoint);
      }
      return;
    }

    if (event.phase === 'end' || event.phase === 'cancel') {
      const target = activeDropTarget;
      const sourceId = sceneDrag.sourceId;
      const lastFloorPoint = sceneDrag.lastFloorPoint;
      setActiveDropTarget(null);
      document.body.classList.remove('dragging-cluster');

      if (event.phase === 'end' && target) {
        assignDraggedCluster(key, target.id, {
          floorPoint: lastFloorPoint,
          preserveManual: false
        });
      } else if (sourceId) {
        store.setManual(sourceId, false);
      }

      // Direct manipulation of a live cluster is momentary. Releasing it
      // always returns to automatic tracking, regardless of where it ended.
      const after = store.snapshot();
      const assigned = assignedSlotForCluster(after, key);
      if (assigned?.manual) store.setManual(assigned.id, false);
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
