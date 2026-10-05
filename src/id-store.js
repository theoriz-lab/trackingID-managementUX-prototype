export const DEFAULT_ID_COUNT = 12;
export const CLUSTER_RETENTION_MS = 30_000;

const FUNNY_IDENTITY_NAMES = Object.freeze([
  'Biscuit', 'Mochi', 'Pickle', 'Waffles', 'Noodle', 'Mango',
  'Pebble', 'Sprout', 'Banjo', 'Tofu', 'Rocket', 'Doodle',
  'Kiwi', 'Pancake', 'Nimbus', 'Pudding', 'Taco', 'Bubbles'
]);

function normalizedId(value, fallback) {
  const numeric = Math.floor(Number(value));
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : fallback;
}

function clusterLetter(index) {
  let value = Math.max(0, Math.floor(index));
  let label = '';
  do {
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return label;
}


function makeSlot(id) {
  return {
    id,
    visible: true,
    enabled: true,
    clusterKey: null,
    locked: false,
    pendingLearn: false,
    identityKey: null,
    manual: false,
    solo: false,
    manualPosition: [0, 0, 0]
  };
}

function cloneCluster(cluster) {
  return {
    ...cluster,
    centroid: [...cluster.centroid],
    size: [...cluster.size],
    preview: Array.isArray(cluster.preview)
      ? cluster.preview.map((point) => Array.isArray(point) ? [...point] : point)
      : []
  };
}

function cloneSlot(slot) {
  return {
    ...slot,
    manualPosition: [...slot.manualPosition]
  };
}

export function createIdStore({
  count = DEFAULT_ID_COUNT,
  minId = 1,
  maxId,
  strictMode = false,
  allowDelete = false,
  initialSoloIds = [],
  onChange
} = {}) {
  const firstId = normalizedId(minId, 1);
  const fallbackMaxId = firstId + Math.max(1, Math.floor(count)) - 1;
  const lastId = Math.max(firstId, normalizedId(maxId, fallbackMaxId));

  let options = {
    strictMode: Boolean(strictMode),
    allowDelete: Boolean(allowDelete),
    minId: firstId,
    maxId: lastId
  };

  let slots = Array.from(
    { length: lastId - firstId + 1 },
    (_, index) => makeSlot(firstId + index)
  );
  const initialSoloSet = new Set(
    (initialSoloIds ?? [])
      .map(Number)
      .filter(Number.isInteger)
  );
  for (const slot of slots) slot.solo = initialSoloSet.has(slot.id);

  const clusters = new Map();
  let nextClusterOrdinal = 0;
  const heldClusters = new Set();
  const refusedClusters = new Set();
  let selected = null;
  const selectedSlotIds = new Set();

  const publish = (reason) => onChange?.(snapshot(), reason);

  function visibleSelectedSlotIds() {
    return [...selectedSlotIds].filter((id) => getSlot(id)?.visible);
  }

  function fallbackPrimarySelection() {
    const ids = visibleSelectedSlotIds();
    selected = ids.length ? { type: 'id', id: ids.at(-1) } : null;
  }

  function pruneSelection() {
    for (const id of [...selectedSlotIds]) {
      if (!getSlot(id)?.visible) selectedSlotIds.delete(id);
    }
    if (selected?.type === 'id' && !getSlot(selected.id)?.visible) fallbackPrimarySelection();
  }

  function snapshot() {
    return {
      slots: slots.map(cloneSlot),
      clusters: [...clusters.values()].map(cloneCluster),
      selected: selected ? { ...selected } : null,
      selectedSlotIds: visibleSelectedSlotIds(),
      options: { ...options }
    };
  }

  function getSlot(id) {
    return slots.find((slot) => slot.id === Number(id));
  }

  function getCluster(key) {
    return clusters.get(String(key));
  }

  function visibleSlots() {
    return slots.filter((slot) => slot.visible);
  }

  function slotForCluster(key) {
    return slots.find((slot) => slot.clusterKey === key);
  }

  function slotForIdentity(key) {
    return slots.find(
      (slot) => slot.visible
        && slot.enabled
        && slot.locked
        && slot.identityKey === key
    );
  }

  function isAutoEligible(slot) {
    return Boolean(
      slot?.visible
      && slot.enabled
      && !slot.manual
      && !slot.clusterKey
      && !slot.locked
    );
  }

  function nextFreeSlot(excludedIds = new Set()) {
    return slots.find((slot) => !excludedIds.has(slot.id) && isAutoEligible(slot));
  }

  function preferredSlotForCluster(cluster) {
    if (cluster?.sourceId === null || cluster?.sourceId === undefined) return null;
    const sourceId = Number(cluster.sourceId);
    if (!Number.isInteger(sourceId) || sourceId < 0) return null;
    const slot = getSlot(sourceId);
    return isAutoEligible(slot) ? slot : null;
  }

  function funnyIdentityName(clusterKey) {
    const used = new Set(
      [...clusters.values()]
        .filter((cluster) => cluster.identityLocked && cluster.identityName)
        .map((cluster) => cluster.identityName)
    );
    const start = Math.floor(Math.random() * FUNNY_IDENTITY_NAMES.length);
    for (let offset = 0; offset < FUNNY_IDENTITY_NAMES.length; offset += 1) {
      const candidate = FUNNY_IDENTITY_NAMES[(start + offset) % FUNNY_IDENTITY_NAMES.length];
      if (!used.has(candidate)) return candidate;
    }
    return `Buddy ${clusterLetter(nextClusterOrdinal)}`;
  }

  function clearSlotReservation(slot, { unlockIdentity = false } = {}) {
    if (!slot) return false;
    const identityKey = slot.identityKey;
    const changed = Boolean(slot.locked || slot.pendingLearn || identityKey);
    slot.locked = false;
    slot.pendingLearn = false;
    slot.identityKey = null;

    if (unlockIdentity && identityKey) {
      const cluster = getCluster(identityKey);
      if (cluster) {
        cluster.identityLocked = false;
        cluster.identityName = '';
        if (!cluster.visible && selected?.type === 'cluster' && selected.key === cluster.key) {
          selected = null;
          selectedSlotIds.delete(slot.id);
        }
      }
    }
    return changed;
  }

  function lockClusterIdentity(clusterKey) {
    const cluster = getCluster(clusterKey);
    if (!cluster) return false;
    cluster.identityLocked = true;
    if (!cluster.identityName) cluster.identityName = funnyIdentityName(clusterKey);
    return true;
  }

  function reserveClusterIdentity(slot, clusterKey) {
    const cluster = getCluster(clusterKey);
    if (!slot || !cluster) return false;

    for (const candidate of slots) {
      if (candidate === slot || candidate.identityKey !== clusterKey) continue;
      clearSlotReservation(candidate);
    }

    if (slot.identityKey && slot.identityKey !== clusterKey) {
      clearSlotReservation(slot);
    }

    lockClusterIdentity(clusterKey);
    slot.locked = true;
    slot.pendingLearn = false;
    slot.identityKey = clusterKey;
    return true;
  }

  function unlockClusterIdentity(clusterKey) {
    const cluster = getCluster(clusterKey);
    if (!cluster) return false;
    let changed = Boolean(cluster.identityLocked || cluster.identityName);

    cluster.identityLocked = false;
    cluster.identityName = '';

    for (const slot of slots) {
      if (slot.identityKey !== clusterKey) continue;
      changed = clearSlotReservation(slot) || changed;
    }

    if (!cluster.visible && selected?.type === 'cluster' && selected.key === clusterKey) {
      selected = null;
      fallbackPrimarySelection();
      changed = true;
    }

    if (!cluster.visible && !slots.some((slot) => slot.clusterKey === clusterKey || slot.identityKey === clusterKey)) {
      clusters.delete(clusterKey);
    }
    return changed;
  }

  function learnIdentityIfNeeded(slot, clusterKey) {
    if (!slot?.locked || !clusterKey) return false;
    if (slot.identityKey && !slot.pendingLearn) return false;
    return reserveClusterIdentity(slot, clusterKey);
  }

  function assignClusterInternal(clusterKey, targetSlot, { operator = false } = {}) {
    const cluster = getCluster(clusterKey);
    if (!cluster || !targetSlot) return { ok: false, reason: 'not-found' };
    if (!targetSlot.visible) return { ok: false, reason: 'hidden' };
    if (!targetSlot.enabled && !operator) return { ok: false, reason: 'disabled' };

    if (operator) {
      heldClusters.delete(clusterKey);
      refusedClusters.delete(clusterKey);
    }

    const sourceSlot = slotForCluster(clusterKey);
    if (sourceSlot?.id === targetSlot.id) {
      if (cluster.identityLocked) reserveClusterIdentity(targetSlot, clusterKey);
      else learnIdentityIfNeeded(targetSlot, clusterKey);
      return { ok: true, moved: false };
    }

    const displacedKey = targetSlot.clusterKey;
    const displacedCluster = displacedKey ? getCluster(displacedKey) : null;

    if (sourceSlot) {
      sourceSlot.clusterKey = null;
      if (sourceSlot.identityKey === clusterKey) clearSlotReservation(sourceSlot);
    }

    if (
      displacedKey
      && targetSlot.identityKey === displacedKey
      && displacedCluster?.identityLocked
    ) {
      clearSlotReservation(targetSlot);
    }

    targetSlot.clusterKey = clusterKey;
    if (cluster.identityLocked) reserveClusterIdentity(targetSlot, clusterKey);
    else learnIdentityIfNeeded(targetSlot, clusterKey);

    let displacedTo = null;
    if (displacedKey && displacedKey !== clusterKey) {
      const free = nextFreeSlot(new Set([targetSlot.id]));
      if (free) {
        free.clusterKey = displacedKey;
        if (displacedCluster?.identityLocked) reserveClusterIdentity(free, displacedKey);
        else learnIdentityIfNeeded(free, displacedKey);
        displacedTo = free.id;
      }
    }

    return {
      ok: true,
      moved: true,
      from: sourceSlot?.id ?? null,
      to: targetSlot.id,
      displacedKey: displacedKey ?? null,
      displacedTo
    };
  }

  function tryAutoAssign(cluster) {
    if (!cluster?.visible) return false;
    const key = cluster.key;
    if (heldClusters.has(key) || refusedClusters.has(key)) return false;

    // Identity Lock has priority over an ordinary current assignment. During
    // an operator override the learned person may temporarily sit in another
    // slot; as soon as the reserved ID becomes empty, move them back.
    const identitySlot = slotForIdentity(key);
    if (identitySlot && identitySlot.clusterKey !== key && !identitySlot.clusterKey) {
      const result = assignClusterInternal(key, identitySlot);
      return result.ok && result.moved;
    }

    if (slotForCluster(key)) return false;

    const target = preferredSlotForCluster(cluster) ?? nextFreeSlot();
    if (target) {
      const result = assignClusterInternal(key, target);
      return result.ok && result.moved;
    }

    if (options.strictMode) refusedClusters.add(key);
    return false;
  }

  function assignWaitingClusters() {
    let changed = false;
    for (const cluster of clusters.values()) {
      if (tryAutoAssign(cluster)) changed = true;
    }
    return changed;
  }

  function syncFrame(items, now = Date.now()) {
    const seen = new Set();
    let changed = false;

    for (const item of items ?? []) {
      const key = String(item?.key ?? '');
      if (!key) continue;
      seen.add(key);

      const previous = clusters.get(key);
      const next = {
        key,
        label: previous?.label ?? clusterLetter(nextClusterOrdinal++),
        identityLocked: Boolean(previous?.identityLocked),
        identityName: previous?.identityName ?? '',
        uuid: item.uuid ? String(item.uuid) : '',
        sourceId: item.sourceId !== null
          && item.sourceId !== undefined
          && Number.isInteger(Number(item.sourceId))
          ? Number(item.sourceId)
          : null,
        visible: true,
        ghost: Boolean(item.ghost),
        sceneAddress: String(item.sceneAddress ?? ''),
        centroid: Array.isArray(item.centroid) ? item.centroid.slice(0, 3).map(Number) : [0, 0, 0],
        size: Array.isArray(item.size) ? item.size.slice(0, 3).map(Number) : [0, 0, 0],
        preview: Array.isArray(item.preview)
          ? item.preview.map((point) => Array.isArray(point) ? point.slice(0, 2).map(Number) : point)
          : [],
        lastSeen: now
      };

      clusters.set(key, next);
      if (!previous || !previous.visible || previous.ghost !== next.ghost || previous.sourceId !== next.sourceId) {
        changed = true;
      }
    }

    // Free assignments first so a cluster entering on the same frame can use
    // an ID released by a cluster that just left.
    for (const cluster of clusters.values()) {
      if (seen.has(cluster.key) || !cluster.visible) continue;
      cluster.visible = false;
      heldClusters.delete(cluster.key);
      refusedClusters.delete(cluster.key);
      changed = true;
    }

    if (selected?.type === 'cluster') {
      const selectedCluster = getCluster(selected.key);
      if (selectedCluster && !selectedCluster.visible && !selectedCluster.identityLocked) {
        const missingSlot = slotForCluster(selected.key) ?? slotForIdentity(selected.key);
        if (missingSlot) selectedSlotIds.delete(missingSlot.id);
        fallbackPrimarySelection();
        changed = true;
      }
    }

    for (const slot of slots) {
      if (!slot.clusterKey || slot.manual) continue;
      const cluster = getCluster(slot.clusterKey);
      if (cluster?.visible) continue;
      slot.clusterKey = null;
      changed = true;
    }

    for (const [key, cluster] of clusters) {
      const referenced = slots.some((slot) => slot.clusterKey === key || slot.identityKey === key);
      if (
        !cluster.visible
        && !cluster.identityLocked
        && !referenced
        && now - cluster.lastSeen > CLUSTER_RETENTION_MS
      ) {
        clusters.delete(key);
      }
    }

    if (assignWaitingClusters()) changed = true;

    if (changed) publish('frame');
    return changed;
  }

  function assignClusterToId(clusterKey, id) {
    const slot = getSlot(id);
    if (!slot) return { ok: false, reason: 'not-found' };
    if (!slot.visible) return { ok: false, reason: 'hidden' };

    const result = assignClusterInternal(String(clusterKey), slot, { operator: true });
    if (result.ok) {
      selectedSlotIds.clear();
      selectedSlotIds.add(slot.id);
      selected = { type: 'id', id: slot.id };
      publish('assign');
    }
    return result;
  }

  function swapAssignments(firstId, secondId) {
    const first = getSlot(firstId);
    const second = getSlot(secondId);
    if (
      !first?.visible
      || !second?.visible
      || first.id === second.id
      || !first.enabled
      || !second.enabled
    ) {
      return false;
    }

    const firstCluster = first.clusterKey;
    const secondCluster = second.clusterKey;
    first.clusterKey = secondCluster;
    second.clusterKey = firstCluster;

    if (first.clusterKey) {
      heldClusters.delete(first.clusterKey);
      refusedClusters.delete(first.clusterKey);
    }
    if (second.clusterKey) {
      heldClusters.delete(second.clusterKey);
      refusedClusters.delete(second.clusterKey);
    }

    learnIdentityIfNeeded(first, first.clusterKey);
    learnIdentityIfNeeded(second, second.clusterKey);

    publish('swap');
    return true;
  }

  function releaseId(id) {
    const slot = getSlot(id);
    if (!slot?.visible || !slot.clusterKey) return false;
    heldClusters.add(slot.clusterKey);
    slot.clusterKey = null;
    publish('release');
    return true;
  }

  function setEnabled(id, enabled) {
    const slot = getSlot(id);
    if (!slot?.visible) return false;
    const next = Boolean(enabled);
    if (slot.enabled === next) return false;
    slot.enabled = next;
    if (next) assignWaitingClusters();
    publish('enabled');
    return true;
  }

  function setStrictMode(enabled) {
    const next = Boolean(enabled);
    if (options.strictMode === next) return false;
    options.strictMode = next;
    refusedClusters.clear();
    assignWaitingClusters();
    publish('strict-mode');
    return true;
  }

  function setAllowDelete(enabled) {
    const next = Boolean(enabled);
    if (options.allowDelete === next) return false;
    options.allowDelete = next;
    publish('allow-delete');
    return true;
  }

  function setIdRange(minValue, maxValue) {
    const nextMin = normalizedId(minValue, options.minId);
    const nextMax = Math.max(nextMin, normalizedId(maxValue, options.maxId));
    if (nextMin === options.minId && nextMax === options.maxId) return false;

    const byId = new Map(slots.map((slot) => [slot.id, slot]));
    slots = Array.from(
      { length: nextMax - nextMin + 1 },
      (_, index) => byId.get(nextMin + index) ?? makeSlot(nextMin + index)
    );

    options = { ...options, minId: nextMin, maxId: nextMax };
    refusedClusters.clear();

    pruneSelection();
    assignWaitingClusters();
    publish('id-range');
    return true;
  }

  function deleteSlot(id) {
    if (!options.allowDelete) return false;
    const slot = getSlot(id);
    if (!slot?.visible) return false;

    slot.visible = false;
    slot.enabled = false;
    slot.solo = false;
    slot.manual = false;
    slot.locked = false;
    slot.pendingLearn = false;
    slot.clusterKey = null;

    selectedSlotIds.delete(slot.id);
    if (selected?.type === 'id' && selected.id === slot.id) fallbackPrimarySelection();
    assignWaitingClusters();
    publish('delete-slot');
    return true;
  }

  function restoreDeletedSlots() {
    let changed = false;
    for (const slot of slots) {
      if (slot.visible) continue;
      slot.visible = true;
      changed = true;
    }
    if (changed) publish('restore-slots');
    return changed;
  }

  function setAllVisibleEnabled(enabled) {
    const next = Boolean(enabled);
    let changed = false;
    for (const slot of visibleSlots()) {
      if (slot.enabled === next) continue;
      slot.enabled = next;
      changed = true;
    }
    if (changed) {
      if (next) assignWaitingClusters();
      publish(next ? 'enable-all' : 'disable-all');
    }
    return changed;
  }

  function lockAndLearn(id) {
    const slot = getSlot(id);
    if (!slot?.visible) return false;

    slot.locked = true;
    if (slot.clusterKey) {
      reserveClusterIdentity(slot, slot.clusterKey);
    } else if (!slot.identityKey) {
      slot.pendingLearn = true;
    }

    publish('lock');
    return true;
  }

  function unlock(id) {
    const slot = getSlot(id);
    if (!slot?.visible || (!slot.locked && !slot.pendingLearn && !slot.identityKey)) return false;
    const changed = clearSlotReservation(slot, { unlockIdentity: true });
    if (changed) {
      assignWaitingClusters();
      publish('unlock');
    }
    return changed;
  }

  function toggleClusterLock(clusterKey) {
    const key = String(clusterKey ?? '');
    const cluster = getCluster(key);
    if (!cluster || (!cluster.visible && !cluster.identityLocked)) return false;

    if (cluster.identityLocked) {
      const changed = unlockClusterIdentity(key);
      if (changed) {
        assignWaitingClusters();
        publish('cluster-unlock');
      }
      return changed;
    }

    lockClusterIdentity(key);
    const assignedSlot = slotForCluster(key);
    if (assignedSlot) reserveClusterIdentity(assignedSlot, key);
    publish('cluster-lock');
    return true;
  }

  function lockAllActive() {
    let changed = false;
    for (const slot of visibleSlots()) {
      if (!slot.enabled || !slot.clusterKey) continue;
      reserveClusterIdentity(slot, slot.clusterKey);
      changed = true;
    }
    if (changed) publish('lock-all-active');
    return changed;
  }

  function lockAll() {
    let changed = false;
    for (const slot of visibleSlots()) {
      if (slot.locked && !slot.pendingLearn) continue;
      slot.locked = true;
      if (slot.clusterKey) {
        reserveClusterIdentity(slot, slot.clusterKey);
      } else if (!slot.identityKey) {
        slot.pendingLearn = true;
      }
      changed = true;
    }
    if (changed) publish('lock-all');
    return changed;
  }

  function unlockAll() {
    let changed = false;

    for (const cluster of clusters.values()) {
      if (!cluster.identityLocked) continue;
      cluster.identityLocked = false;
      cluster.identityName = '';
      changed = true;
    }

    for (const slot of visibleSlots()) {
      if (!slot.locked && !slot.pendingLearn && !slot.identityKey) continue;
      clearSlotReservation(slot);
      changed = true;
    }

    for (const [key, cluster] of [...clusters]) {
      if (!cluster.visible && !cluster.identityLocked && !slots.some((slot) => slot.clusterKey === key || slot.identityKey === key)) {
        clusters.delete(key);
      }
    }

    if (changed) {
      assignWaitingClusters();
      publish('unlock-all');
    }
    return changed;
  }

  function setClusterIdentityName(clusterKey, value) {
    const cluster = getCluster(clusterKey);
    if (!cluster?.identityLocked) return false;
    const name = String(value ?? '').trim();
    if (!name || cluster.identityName === name) return false;
    cluster.identityName = name;
    publish('identity-name');
    return true;
  }

  function setSolo(id, enabled) {
    const slot = getSlot(id);
    if (!slot?.visible) return false;
    const next = Boolean(enabled);
    if (slot.solo === next) return false;
    slot.solo = next;
    publish('solo');
    return true;
  }

  function setManual(id, enabled) {
    const slot = getSlot(id);
    if (!slot?.visible) return false;
    const next = Boolean(enabled);
    if (next && !slot.clusterKey) return false;
    if (slot.manual === next) return false;
    slot.manual = next;
    if (next) {
      const cluster = getCluster(slot.clusterKey);
      if (cluster) slot.manualPosition = [cluster.centroid[0], 0, cluster.centroid[2]];
    }
    publish('manual');
    return true;
  }

  function setManualPosition(id, position) {
    const slot = getSlot(id);
    if (
      !slot?.visible
      || !slot.manual
      || !Array.isArray(position)
      || position.length < 3
    ) {
      return false;
    }
    const nextPosition = position.slice(0, 3).map((value) => Number(value) || 0);
    if (slot.manualPosition.every((value, index) => value === nextPosition[index])) return false;
    slot.manualPosition = nextPosition;
    publish('manual-position');
    return true;
  }

  function selectId(id, { additive = false } = {}) {
    const slot = getSlot(id);
    if (!slot?.visible) return false;

    if (!additive) {
      selectedSlotIds.clear();
      selectedSlotIds.add(slot.id);
      selected = { type: 'id', id: slot.id };
      publish('select');
      return true;
    }

    if (selectedSlotIds.has(slot.id)) {
      selectedSlotIds.delete(slot.id);
      const selectedClusterSlotId = selected?.type === 'cluster'
        ? slotForCluster(selected.key)?.id
        : null;
      if (
        (selected?.type === 'id' && selected.id === slot.id)
        || selectedClusterSlotId === slot.id
      ) {
        fallbackPrimarySelection();
      }
    } else {
      selectedSlotIds.add(slot.id);
      selected = { type: 'id', id: slot.id };
    }
    publish('select');
    return true;
  }

  function selectCluster(key, { additive = false } = {}) {
    const cluster = getCluster(key);
    if (!cluster || (!cluster.visible && !cluster.identityLocked)) return false;
    const slot = slotForCluster(cluster.key) ?? slotForIdentity(cluster.key);

    if (!additive) selectedSlotIds.clear();
    if (slot?.visible) selectedSlotIds.add(slot.id);
    selected = { type: 'cluster', key: cluster.key };
    publish('select');
    return true;
  }

  function clearSelection() {
    if (!selected && selectedSlotIds.size === 0) return;
    selected = null;
    selectedSlotIds.clear();
    publish('select');
  }

  function addSlots(amount = 4) {
    const countToAdd = Math.max(1, Math.floor(amount));
    return setIdRange(options.minId, options.maxId + countToAdd);
  }

  return {
    snapshot,
    syncFrame,
    assignClusterToId,
    swapAssignments,
    releaseId,
    setEnabled,
    setStrictMode,
    setAllowDelete,
    setIdRange,
    deleteSlot,
    restoreDeletedSlots,
    setAllVisibleEnabled,
    lockAndLearn,
    unlock,
    toggleClusterLock,
    lockAllActive,
    lockAll,
    unlockAll,
    setClusterIdentityName,
    setSolo,
    setManual,
    setManualPosition,
    selectId,
    selectCluster,
    clearSelection,
    addSlots
  };
}
