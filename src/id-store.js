export const DEFAULT_ID_COUNT = 12;
export const CLUSTER_RETENTION_MS = 30_000;

function normalizedId(value, fallback) {
  const numeric = Math.floor(Number(value));
  return Number.isInteger(numeric) && numeric >= 1 ? numeric : fallback;
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
    identityName: '',
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

  const clusters = new Map();
  const heldClusters = new Set();
  const refusedClusters = new Set();
  let selected = null;

  const publish = (reason) => onChange?.(snapshot(), reason);

  function snapshot() {
    return {
      slots: slots.map(cloneSlot),
      clusters: [...clusters.values()].map(cloneCluster),
      selected: selected ? { ...selected } : null,
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
    const sourceId = Number(cluster?.sourceId);
    if (!Number.isInteger(sourceId) || sourceId < 1) return null;
    const slot = getSlot(sourceId);
    return isAutoEligible(slot) ? slot : null;
  }

  function setLearnedIdentity(slot, clusterKey) {
    if (!clusterKey) return false;
    const changed = slot.identityKey !== clusterKey;
    if (changed && slot.identityKey) slot.identityName = '';
    slot.identityKey = clusterKey;
    slot.pendingLearn = false;
    return changed;
  }

  function learnIdentityIfNeeded(slot, clusterKey) {
    if (!slot.locked || !clusterKey) return false;
    if (slot.identityKey && !slot.pendingLearn) return false;
    return setLearnedIdentity(slot, clusterKey);
  }

  function assignClusterInternal(clusterKey, targetSlot, { operator = false } = {}) {
    const cluster = getCluster(clusterKey);
    if (!cluster || !targetSlot) return { ok: false, reason: 'not-found' };
    if (!targetSlot.visible) return { ok: false, reason: 'hidden' };
    if (!targetSlot.enabled) return { ok: false, reason: 'disabled' };

    if (operator) {
      heldClusters.delete(clusterKey);
      refusedClusters.delete(clusterKey);
    }

    const sourceSlot = slotForCluster(clusterKey);
    if (sourceSlot?.id === targetSlot.id) {
      learnIdentityIfNeeded(targetSlot, clusterKey);
      return { ok: true, moved: false };
    }

    const displacedKey = targetSlot.clusterKey;
    if (sourceSlot) sourceSlot.clusterKey = null;
    targetSlot.clusterKey = clusterKey;
    learnIdentityIfNeeded(targetSlot, clusterKey);

    let displacedTo = null;
    if (displacedKey && displacedKey !== clusterKey) {
      const free = nextFreeSlot(new Set([targetSlot.id]));
      if (free) {
        free.clusterKey = displacedKey;
        learnIdentityIfNeeded(free, displacedKey);
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
        uuid: item.uuid ? String(item.uuid) : '',
        sourceId: Number.isInteger(Number(item.sourceId)) ? Number(item.sourceId) : null,
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

    if (selected?.type === 'cluster' && !getCluster(selected.key)?.visible) {
      selected = null;
      changed = true;
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
      if (!cluster.visible && !referenced && now - cluster.lastSeen > CLUSTER_RETENTION_MS) {
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
    if (!slot.enabled) return { ok: false, reason: 'disabled' };

    const result = assignClusterInternal(String(clusterKey), slot, { operator: true });
    if (result.ok) {
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

    if (selected?.type === 'id' && !getSlot(selected.id)) selected = null;
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

    if (selected?.type === 'id' && selected.id === slot.id) selected = null;
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
      setLearnedIdentity(slot, slot.clusterKey);
    } else if (!slot.identityKey) {
      slot.pendingLearn = true;
    }
    publish('lock');
    return true;
  }

  function unlock(id) {
    const slot = getSlot(id);
    if (!slot?.visible || (!slot.locked && !slot.pendingLearn)) return false;
    slot.locked = false;
    slot.pendingLearn = false;
    publish('unlock');
    return true;
  }

  function lockAllActive() {
    let changed = false;
    for (const slot of visibleSlots()) {
      if (!slot.enabled || !slot.clusterKey) continue;
      slot.locked = true;
      setLearnedIdentity(slot, slot.clusterKey);
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
        setLearnedIdentity(slot, slot.clusterKey);
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
    for (const slot of visibleSlots()) {
      if (!slot.locked && !slot.pendingLearn) continue;
      slot.locked = false;
      slot.pendingLearn = false;
      changed = true;
    }
    if (changed) publish('unlock-all');
    return changed;
  }

  // Compatibility alias retained for the previous prototype/test vocabulary.
  function lockAllVisible() {
    return lockAllActive();
  }

  function setIdentityName(id, value) {
    const slot = getSlot(id);
    if (!slot?.visible) return false;
    const name = String(value ?? '').trim();
    if (slot.identityName === name) return false;
    slot.identityName = name;
    if (name && slot.clusterKey && !slot.identityKey) slot.identityKey = slot.clusterKey;
    publish('identity-name');
    return true;
  }

  function clearIdentity(id) {
    const slot = getSlot(id);
    if (!slot?.visible) return false;
    const changed = Boolean(slot.identityKey || slot.identityName || slot.pendingLearn);
    slot.identityKey = null;
    slot.identityName = '';
    slot.pendingLearn = slot.locked;
    if (changed) publish('identity-clear');
    return changed;
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
    slot.manualPosition = position.slice(0, 3).map((value) => Number(value) || 0);
    publish('manual-position');
    return true;
  }

  function selectId(id) {
    const slot = getSlot(id);
    selected = slot?.visible ? { type: 'id', id: slot.id } : null;
    publish('select');
  }

  function selectCluster(key) {
    const cluster = getCluster(key);
    selected = cluster ? { type: 'cluster', key: cluster.key } : null;
    publish('select');
  }

  function clearSelection() {
    if (!selected) return;
    selected = null;
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
    lockAllActive,
    lockAll,
    lockAllVisible,
    unlockAll,
    setIdentityName,
    clearIdentity,
    setSolo,
    setManual,
    setManualPosition,
    selectId,
    selectCluster,
    clearSelection,
    addSlots
  };
}
