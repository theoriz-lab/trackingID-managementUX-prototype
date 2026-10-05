import { idColorCss, UNASSIGNED_ID_COLOR_CSS } from './id-colors.js';
import {
  assignedSlotForCluster,
  describeClusterDropAction,
  resolveClusterDropAssignments,
  resolveClusterDropPreview
} from './id-drop-policy.js';
import {
  deriveOperatorVisualState,
  deriveSelectionState,
  identityNameForCluster,
  operatorClusterName,
  slotReservesClusterIdentity
} from './operator-visual-state.js';

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
  return operatorClusterName(cluster);
}

function reservedSlotForIdentity(snapshot, key) {
  return snapshot.slots.find(
    (slot) => slot.visible && slot.locked && slot.identityKey === key
  );
}

function displaySlotForCluster(snapshot, key) {
  return assignedSlotForCluster(snapshot, key) ?? reservedSlotForIdentity(snapshot, key);
}

function identityWarning(slot) {
  if (!slot.enabled || !slot.locked || !slot.identityKey) return null;
  if (!slot.clusterKey) return { type: 'missing', label: 'Identity missing' };
  if (slot.clusterKey !== slot.identityKey) return { type: 'override', label: 'Identity overridden' };
  return null;
}

function coordinateText(cluster) {
  if (!cluster?.visible && cluster?.identityLocked) return 'Missing · identity cached';
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

function previewMarkup(points) {
  return `<path class="capsule-preview-frame" d="M12 34 V12 H88 V34"></path>${previewCircles(points)}`;
}

function capsuleTitle(cluster) {
  return operatorClusterName(cluster);
}

export function createIdInterface({ store, onDropPreview } = {}) {
  const idPanel = document.querySelector('.id-panel');
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
  const occupiedDropKickInput = document.querySelector('#occupied-drop-kick');
  const occupiedDropSwapInput = document.querySelector('#occupied-drop-swap');
  const minIdInput = document.querySelector('#min-id');
  const maxIdInput = document.querySelector('#max-id');
  const allowDeleteInput = document.querySelector('#allow-slot-delete');
  const restoreDeletedButton = document.querySelector('#restore-deleted-slots');
  const rangeSummary = document.querySelector('#range-summary');
  const connectionPill = document.querySelector('.connection-pill');
  const connectionStatus = document.querySelector('#connection-status');
  const connectionNote = document.querySelector('#connection-note');
  const sceneLabel = document.querySelector('#scene-label');

  const contextMenu = document.createElement('div');
  contextMenu.className = 'cluster-context-menu';
  contextMenu.hidden = true;
  document.body.appendChild(contextMenu);

  let contextClusterKey = null;
  let dragState = null;
  let sceneDrag = null;
  let activeDropTarget = null;
  let dropPreviewSignature = '';
  let suppressClickUntil = 0;

  function clusterCapsuleMarkup(cluster, slot, { selected = false } = {}) {
    const disabled = Boolean(slot && !slot.enabled);
    const missing = Boolean(!cluster?.visible && cluster?.identityLocked);
    const color = slot && slot.enabled ? idColorCss(slot.id) : UNASSIGNED_ID_COLOR_CSS;
    const manual = Boolean(slot?.manual && cluster?.visible);
    const identityName = identityNameForCluster(cluster);
    const clusterLocked = Boolean(cluster?.identityLocked);
    const identityReserved = slotReservesClusterIdentity(slot, cluster);
    const classes = [
      'cluster-capsule',
      slot ? 'assigned' : 'unassigned',
      disabled ? 'disabled' : '',
      missing ? 'missing' : '',
      clusterLocked ? 'identity-locked' : '',
      identityReserved ? 'identity-reserved' : '',
      manual ? 'manual' : '',
      selected ? 'selected' : ''
    ].filter(Boolean).join(' ');
    const dragAttributes = cluster?.visible
      ? `data-drag-type="cluster" data-drag-key="${escapeHtml(cluster.key)}"`
      : '';
    const assignment = slot
      ? missing && identityReserved
        ? `Missing · ID ${slot.id} reserved`
        : identityReserved
          ? `ID ${slot.id} · locked`
          : `ID ${slot.id}`
      : clusterLocked
        ? 'Identity locked · unassigned'
        : 'Unassigned';

    return `
      <div
        class="${classes}"
        style="--capsule-color:${color}"
        data-action="select-cluster"
        data-cluster-key="${escapeHtml(cluster.key)}"
        ${dragAttributes}
        data-live-cluster-key="${escapeHtml(cluster.key)}"
        role="button"
        tabindex="0"
        aria-label="${escapeHtml(capsuleTitle(cluster))}"
      >
        <svg class="capsule-preview" viewBox="0 0 100 100" aria-hidden="true">
          ${previewMarkup(cluster.preview)}
        </svg>
        <span class="capsule-copy">
          <strong>${escapeHtml(capsuleTitle(cluster))}${manual ? ' · Manual' : ''}</strong>
          <small class="capsule-coords">${escapeHtml(coordinateText(cluster))}</small>
          <em class="capsule-assignment">${escapeHtml(assignment)}</em>
        </span>
        <button
          class="cluster-lock-button${clusterLocked ? ' active' : ''}"
          type="button"
          data-action="toggle-cluster-lock"
          data-cluster-key="${escapeHtml(cluster.key)}"
          data-no-drag
          title="${clusterLocked ? 'Unlock identity' : 'Lock identity'}"
          aria-pressed="${clusterLocked}"
          aria-label="${clusterLocked ? 'Unlock' : 'Lock'} ${escapeHtml(identityName || shortClusterName(cluster))}"
        ><span class="lock-symbol ${clusterLocked ? 'closed' : 'open'}" aria-hidden="true"></span></button>
      </div>`;
  }

  function render() {
    const snapshot = store.snapshot();
    const clusterByKey = new Map(snapshot.clusters.map((cluster) => [cluster.key, cluster]));
    const panelClusters = snapshot.clusters
      .filter((cluster) => cluster.visible || cluster.identityLocked)
      .sort((a, b) => {
        if (a.visible !== b.visible) return a.visible ? -1 : 1;
        return String(a.label ?? '').localeCompare(String(b.label ?? ''));
      });
    const visibleClusterCount = snapshot.clusters.filter((cluster) => cluster.visible).length;

    const operatorSlots = snapshot.slots.filter((slot) => slot.visible);
    const visualState = deriveOperatorVisualState(operatorSlots);
    const selection = deriveSelectionState(
      operatorSlots,
      snapshot.selected,
      snapshot.selectedSlotIds
    );
    const selectedSlotIds = selection.slotIds;
    const selectedClusterKeys = selection.clusterKeys;

    idList.classList.toggle('solo-mode', visualState.soloMode);
    idList.classList.toggle('deletion-enabled', snapshot.options.allowDelete);
    clusterTray.classList.toggle('solo-mode', visualState.soloMode);
    clusterTray.classList.toggle('has-selection', selectedClusterKeys.size > 0);

    idList.innerHTML = operatorSlots.map((slot) => {
      const liveCluster = slot.clusterKey ? clusterByKey.get(slot.clusterKey) : null;
      const cluster = liveCluster
        ?? (slot.identityKey ? clusterByKey.get(slot.identityKey) : null);
      const selected = selectedSlotIds.has(slot.id);
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
        <article
          class="${rowClasses}"
          style="--id-color:${idColorCss(slot.id)}"
          data-slot-id="${slot.id}"
          data-action="select-id"
          data-id="${slot.id}"
        >
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
          <div class="${wellClasses}" data-drop-type="id" data-id="${slot.id}">
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
            ${liveCluster ? '' : 'disabled'}
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

    clusterTray.innerHTML = panelClusters.length
      ? panelClusters.map((cluster) => {
          const slot = displaySlotForCluster(snapshot, cluster.key);
          const selected = selectedClusterKeys.has(cluster.key);
          const solo = visualState.soloClusterKeys.has(cluster.key);
          return `<div class="${solo ? 'is-solo' : visualState.soloMode ? 'is-solo-muted' : ''}">${clusterCapsuleMarkup(cluster, slot, { selected })}</div>`;
        }).join('')
      : '<div class="tray-empty">Waiting for live clusters…</div>';

    liveCount.textContent = `(${visibleClusterCount})`;
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
    if (document.activeElement !== occupiedDropKickInput && document.activeElement !== occupiedDropSwapInput) {
      occupiedDropKickInput.checked = snapshot.options.occupiedDropMode === 'kick';
      occupiedDropSwapInput.checked = snapshot.options.occupiedDropMode === 'swap';
    }
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
      if (preview) preview.innerHTML = previewMarkup(cluster.preview);
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

  for (const input of [occupiedDropKickInput, occupiedDropSwapInput]) {
    input.addEventListener('change', () => {
      if (input.checked) store.setOccupiedDropMode(input.value);
    });
  }

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

  function handleAction(target, event) {
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
      case 'select-cluster':
        store.selectCluster(key, { additive: Boolean(event?.shiftKey) });
        break;
      case 'select-id':
        store.selectId(id, { additive: Boolean(event?.shiftKey) });
        break;
      default: return false;
    }
    return true;
  }

  document.addEventListener('click', (event) => {
    if (!contextMenu.hidden && !event.target.closest?.('.cluster-context-menu')) closeContextMenu();
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
    if (action && handleAction(action, event)) return;

    if (event.target === warningButton || warningButton.contains(event.target)) {
      const id = Number(warningButton.dataset.firstWarningId);
      if (Number.isInteger(id)) {
        store.selectId(id);
        document.querySelector(`[data-slot-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
      }
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeContextMenu();
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

  clusterTray.addEventListener('contextmenu', (event) => {
    const capsule = event.target.closest?.('.cluster-capsule[data-cluster-key]');
    if (!capsule || !clusterTray.contains(capsule)) return;
    event.preventDefault();
    event.stopPropagation();
    openClusterContextMenu(
      capsule.dataset.clusterKey,
      event.clientX,
      event.clientY
    );
  }, { capture: true });

  contextMenu.addEventListener('click', (event) => {
    const button = event.target.closest?.('[data-context-action]');
    if (!button || !contextClusterKey) return;

    const snapshot = store.snapshot();
    const cluster = snapshot.clusters.find((candidate) => candidate.key === contextClusterKey);
    const currentSlot = assignedSlotForCluster(snapshot, contextClusterKey);
    const action = button.dataset.contextAction;

    if (action === 'assign' && cluster?.visible) {
      store.assignClusterToId(contextClusterKey, Number(button.dataset.id));
      closeContextMenu();
      return;
    }
    if (action === 'unassign' && currentSlot) {
      store.releaseId(currentSlot.id);
      closeContextMenu();
      return;
    }
    if (action === 'toggle-lock') {
      store.toggleClusterLock(contextClusterKey);
      closeContextMenu();
      return;
    }
    if (action === 'rename' && cluster?.identityLocked) {
      const name = window.prompt('Identity name', cluster.identityName || '');
      if (name !== null) store.setClusterIdentityName(contextClusterKey, name);
      closeContextMenu();
    }
  });

  function openClusterContextMenu(key, x, y, { requireSelected = false } = {}) {
    const snapshot = store.snapshot();
    const cluster = snapshot.clusters.find((candidate) => candidate.key === key);
    if (!cluster || (!cluster.visible && !cluster.identityLocked)) return false;

    if (requireSelected) {
      const selection = deriveSelectionState(
        snapshot.slots.filter((slot) => slot.visible),
        snapshot.selected,
        snapshot.selectedSlotIds
      );
      if (!selection.clusterKeys.has(key)) return false;
    }

    contextClusterKey = key;
    renderContextMenu(key);
    contextMenu.hidden = false;
    const rect = contextMenu.getBoundingClientRect();
    contextMenu.style.left = `${Math.max(8, Math.min(window.innerWidth - rect.width - 8, x))}px`;
    contextMenu.style.top = `${Math.max(8, Math.min(window.innerHeight - rect.height - 8, y))}px`;
    return true;
  }

  function renderContextMenu(key) {
    const snapshot = store.snapshot();
    const cluster = snapshot.clusters.find((candidate) => candidate.key === key);
    if (!cluster) {
      closeContextMenu();
      return;
    }

    const currentSlot = assignedSlotForCluster(snapshot, key);
    const reservedSlot = reservedSlotForIdentity(snapshot, key);
    const displaySlot = currentSlot ?? reservedSlot;
    const canAssign = Boolean(cluster.visible);

    contextMenu.innerHTML = `
      <header>${escapeHtml(capsuleTitle(cluster))}</header>
      <div class="context-status">${cluster.visible
        ? displaySlot ? `Current ID ${displaySlot.id}` : 'Live · unassigned'
        : displaySlot ? `Missing · ID ${displaySlot.id} reserved` : 'Missing · identity cached'}</div>
      <div class="context-id-grid">
        ${snapshot.slots.filter((slot) => slot.visible).map((slot) => `
          <button
            type="button"
            class="context-id${slot.enabled ? '' : ' disabled'}${displaySlot?.id === slot.id ? ' current' : ''}"
            style="--id-color:${slot.enabled ? idColorCss(slot.id) : UNASSIGNED_ID_COLOR_CSS}"
            data-context-action="assign"
            data-id="${slot.id}"
            ${canAssign ? '' : 'disabled'}
          >${slot.id}</button>
        `).join('')}
      </div>
      <div class="context-menu-separator"></div>
      <button type="button" class="context-secondary" data-context-action="toggle-lock">
        ${cluster.identityLocked ? 'Unlock identity' : 'Lock identity'}
      </button>
      ${cluster.identityLocked ? `
        <button type="button" class="context-secondary" data-context-action="rename">Rename identity…</button>
      ` : ''}
      ${currentSlot ? `
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
    const snapshot = store.snapshot();
    const sourceSlot = assignedSlotForCluster(snapshot, key);
    const isTouch = event.pointerType === 'touch';
    dragState = {
      pointerId: event.pointerId,
      key,
      sourceOrigin: handle.closest('#cluster-tray') ? 'tray' : 'id',
      sourceSlotId: sourceSlot?.id ?? null,
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
    clearDropPreview();
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
    ghost.innerHTML = `
      <strong class="drag-ghost-cluster">${escapeHtml(capsuleTitle(cluster))}</strong>
      <span class="drag-ghost-action"></span>
    `;
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

  function slotCapsule(id) {
    if (id === null || id === undefined) return null;
    return idList.querySelector(`[data-slot-id="${id}"] .slot-well > .cluster-capsule`);
  }

  function slotWell(id) {
    if (id === null || id === undefined) return null;
    return idList.querySelector(`.slot-well[data-id="${id}"]`);
  }

  function clearPreviewElement(element) {
    if (!element) return;
    element.classList.remove('drop-preview-moving', 'drop-preview-removing');
    element.style.removeProperty('--drop-preview-x');
    element.style.removeProperty('--drop-preview-y');
  }

  function clearDropPreview() {
    idList.querySelectorAll('.drop-preview-moving, .drop-preview-removing').forEach(clearPreviewElement);
    dropPreviewSignature = '';
    onDropPreview?.(null);
  }

  function previewOffset(origin, destination) {
    const from = origin?.getBoundingClientRect();
    const to = destination?.getBoundingClientRect();
    if (!from || !to) return null;
    return {
      x: to.left + to.width / 2 - (from.left + from.width / 2),
      y: to.top + to.height / 2 - (from.top + from.height / 2)
    };
  }

  function setMovingPreview(element, origin, destination) {
    if (!element || !origin || !destination) return;
    const offset = previewOffset(origin, destination);
    if (!offset) return;
    element.classList.remove('drop-preview-removing');
    element.style.setProperty('--drop-preview-x', `${offset.x}px`);
    element.style.setProperty('--drop-preview-y', `${offset.y}px`);
    element.classList.add('drop-preview-moving');
  }

  function setRemovingPreview(element) {
    if (!element) return;
    element.classList.remove('drop-preview-moving');
    element.style.removeProperty('--drop-preview-x');
    element.style.removeProperty('--drop-preview-y');
    element.classList.add('drop-preview-removing');
  }

  function reconcileDropPreview(desired) {
    const current = new Set(
      idList.querySelectorAll('.drop-preview-moving, .drop-preview-removing')
    );

    for (const [element, preview] of desired) {
      current.delete(element);
      if (preview.kind === 'move') {
        setMovingPreview(element, preview.origin, preview.destination);
      } else if (preview.kind === 'remove') {
        setRemovingPreview(element);
      }
    }

    for (const element of current) clearPreviewElement(element);
  }

  function applyDropPreview(clientX, clientY, target) {
    if (!dragState) return;
    const insideIdPanel = pointInsideIdPanel(clientX, clientY);
    const signature = [
      dragState.key,
      dragState.sourceOrigin,
      target?.id ?? 'none',
      insideIdPanel ? 'inside' : 'outside',
      store.snapshot().options.occupiedDropMode
    ].join('|');
    if (signature === dropPreviewSignature) return;

    dropPreviewSignature = signature;

    const snapshot = store.snapshot();
    const sourceSlot = assignedSlotForCluster(snapshot, dragState.key);
    const sourceCapsule = slotCapsule(sourceSlot?.id);
    const desired = new Map();

    if (!target) {
      if (!insideIdPanel && dragState.sourceOrigin === 'id' && sourceCapsule) {
        desired.set(sourceCapsule, { kind: 'remove' });
        onDropPreview?.(new Map([[dragState.key, null]]));
      } else {
        onDropPreview?.(null);
      }
      reconcileDropPreview(desired);
      return;
    }

    const targetWell = slotWell(target.id);
    const sourceWell = slotWell(sourceSlot?.id);
    if (!targetWell || sourceSlot?.id === target.id) {
      onDropPreview?.(
        targetWell
          ? resolveClusterDropAssignments(snapshot, dragState.key, target.id)
          : null
      );
      reconcileDropPreview(desired);
      return;
    }

    if (sourceCapsule && sourceWell) {
      desired.set(sourceCapsule, {
        kind: 'move',
        origin: sourceWell,
        destination: targetWell
      });
    }

    const preview = resolveClusterDropPreview(snapshot, dragState.key, target.id);
    if (preview.displaced) {
      const targetCapsule = slotCapsule(target.id);
      if (targetCapsule) {
        const displacedDestination = slotWell(preview.displacedTo);
        if (displacedDestination) {
          desired.set(targetCapsule, {
            kind: 'move',
            origin: targetWell,
            destination: displacedDestination
          });
        } else {
          desired.set(targetCapsule, { kind: 'remove' });
        }
      }
    }

    onDropPreview?.(resolveClusterDropAssignments(snapshot, dragState.key, target.id));
    reconcileDropPreview(desired);
  }

  function pointInsideIdPanel(clientX, clientY) {
    const rect = idPanel.getBoundingClientRect();
    return clientX >= rect.left
      && clientX <= rect.right
      && clientY >= rect.top
      && clientY <= rect.bottom;
  }

  function updateDragGhostAction(clientX, clientY, target) {
    if (!dragState?.ghost) return;
    const snapshot = store.snapshot();
    const label = describeClusterDropAction(snapshot, dragState.key, target?.id ?? null, {
      insideIdPanel: pointInsideIdPanel(clientX, clientY),
      sourceOrigin: dragState.sourceOrigin
    });
    const action = dragState.ghost.querySelector('.drag-ghost-action');
    if (action) action.textContent = label;
  }

  function moveDragAt(clientX, clientY) {
    if (!dragState?.ghost) return;
    dragState.ghost.style.transform = `translate3d(${clientX + 12}px, ${clientY + 12}px, 0)`;
    dragState.ghost.hidden = true;
    const target = findIdDropTarget(clientX, clientY);
    setActiveDropTarget(target);
    dragState.ghost.hidden = false;
    updateDragGhostAction(clientX, clientY, target);
    applyDropPreview(clientX, clientY, target);
  }

  function finishDrag(event) {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const current = dragState;
    clearHoldTimer(current);
    dragState = null;
    document.body.classList.remove('dragging-cluster');
    clearDropPreview();
    current.ghost?.remove();
    if (current.source.hasPointerCapture?.(event.pointerId)) current.source.releasePointerCapture?.(event.pointerId);

    const target = activeDropTarget;
    setActiveDropTarget(null);
    if (!current.dragging) return;

    suppressClickUntil = performance.now() + 260;
    event.preventDefault();
    if (event.type !== 'pointerup') return;

    if (target) {
      assignDraggedCluster(current.key, target.id);
      return;
    }

    if (
      current.sourceOrigin === 'id'
      && !pointInsideIdPanel(event.clientX, event.clientY)
      && current.sourceSlotId !== null
    ) {
      store.releaseId(current.sourceSlotId);
    }
  }

  function assignDraggedCluster(key, targetId) {
    return store.assignClusterToId(key, targetId).ok;
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

      // Direct 3D manipulation is a temporary Manual takeover and therefore
      // requires an assigned ID. Unassigned live clusters stay pickable but
      // are not draggable.
      if (!sourceSlot || sourceSlot.manual) return;

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

    if (event.phase === 'move') {
      if (sceneDrag.sourceId && sceneDrag.lastFloorPoint) {
        store.setManualPosition(sceneDrag.sourceId, sceneDrag.lastFloorPoint);
      }
      return;
    }

    if (event.phase === 'end' || event.phase === 'cancel') {
      const sourceId = sceneDrag.sourceId;
      setActiveDropTarget(null);
      document.body.classList.remove('dragging-cluster');

      if (sourceId) store.setManual(sourceId, false);

      // Direct manipulation in the 3D view is only a temporary Manual move.
      // ID assignment is intentionally limited to drags from the ID panel or
      // the bottom cluster tray; dropping a 3D cluster over the panel does nothing.
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
    handle3dClusterDrag,
    openClusterContextMenu
  };
}
