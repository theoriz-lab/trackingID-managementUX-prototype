export const DEFAULT_ID_COUNT = 12;
export const CLUSTER_RETENTION_MS = 30_000;

function makeSlot(id) {
  return {
    id,
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
    size: [...cluster.size]
  };
}

function cloneSlot(slot) {
  return {
    ...slot,
    manualPosition: [...slot.manualPosition]
  };
}

export function createIdStore({ count = DEFAULT_ID_COUNT, onChange } = {}) {
  let slots = Array.from({ length: Math.max(1, Math.floor(count)) }, (_, index) => makeSlot(index + 1));
  const clusters = new Map();
  const heldClusters = new Set();
  let selected = null;

  const publish = (reason) => onChange?.(snapshot(), reason);

  function snapshot() {
    return {
      slots: slots.map(cloneSlot),
      clusters: [...clusters.values()].map(cloneCluster),
      selected: selected ? { ...selected } : null
    };
  }

  function getSlot(id) {
    return slots.find((slot) => slot.id === Number(id));
  }

  function getCluster(key) {
    return clusters.get(String(key));
  }

  function slotForCluster(key) {
    return slots.find((slot) => slot.clusterKey === key);
  }

  function slotForIdentity(key) {
    return slots.find((slot) => slot.locked && slot.identityKey === key);
  }

  function isAutoEligible(slot) {
    if (!slot?.enabled || slot.manual || slot.clusterKey || slot.locked) return false;
    return true;
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

  function learnIdentityIfNeeded(slot, clusterKey) {
    if (!slot.locked || !clusterKey) return false;
    if (slot.identityKey && !slot.pendingLearn) return false;
    slot.identityKey = clusterKey;
    slot.pendingLearn = false;
    return true;
  }

  function assignClusterInternal(clusterKey, targetSlot, { operator = false } = {}) {
    const cluster = getCluster(clusterKey);
    if (!cluster || !targetSlot) return { ok: false, reason: 'not-found' };
    if (!targetSlot.enabled) return { ok: false, reason: 'disabled' };
    if (operator) heldClusters.delete(clusterKey);

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
        lastSeen: now
      };

      clusters.set(key, next);
      if (!previous || !previous.visible || previous.ghost !== next.ghost || previous.sourceId !== next.sourceId) {
        changed = true;
      }

      // A released live cluster stays intentionally unassigned until it leaves
      // tracking or the operator explicitly assigns it again.
      if (heldClusters.has(key)) continue;

      const identitySlot = slotForIdentity(key);
      if (identitySlot && identitySlot.clusterKey !== key) {
        const result = assignClusterInternal(key, identitySlot);
        changed ||= result.ok && result.moved;
        continue;
      }

      if (slotForCluster(key)) continue;

      const target = preferredSlotForCluster(next) ?? nextFreeSlot();
      if (target) {
        const result = assignClusterInternal(key, target);
        changed ||= result.ok && result.moved;
      }
    }

    for (const cluster of clusters.values()) {
      if (seen.has(cluster.key) || !cluster.visible) continue;
      cluster.visible = false;
      heldClusters.delete(cluster.key);
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

    if (changed) publish('frame');
    return changed;
  }

  function assignClusterToId(clusterKey, id) {
    const slot = getSlot(id);
    if (!slot) return { ok: false, reason: 'not-found' };
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
    if (!first || !second || first.id === second.id || !first.enabled || !second.enabled) return false;

    const firstCluster = first.clusterKey;
    const secondCluster = second.clusterKey;
    first.clusterKey = secondCluster;
    second.clusterKey = firstCluster;

    if (first.clusterKey) heldClusters.delete(first.clusterKey);
    if (second.clusterKey) heldClusters.delete(second.clusterKey);
    learnIdentityIfNeeded(first, first.clusterKey);
    learnIdentityIfNeeded(second, second.clusterKey);

    publish('swap');
    return true;
  }

  function releaseId(id) {
    const slot = getSlot(id);
    if (!slot || !slot.clusterKey) return false;
    heldClusters.add(slot.clusterKey);
    slot.clusterKey = null;
    publish('release');
    return true;
  }

  function setEnabled(id, enabled) {
    const slot = getSlot(id);
    if (!slot) return false;
    const next = Boolean(enabled);
    if (slot.enabled === next) return false;
    slot.enabled = next;
    publish('enabled');
    return true;
  }

  function lockAndLearn(id) {
    const slot = getSlot(id);
    if (!slot) return false;
    slot.locked = true;
    if (slot.clusterKey) {
      slot.identityKey = slot.clusterKey;
      slot.pendingLearn = false;
    } else if (!slot.identityKey) {
      slot.pendingLearn = true;
    }
    publish('lock');
    return true;
  }

  function unlock(id) {
    const slot = getSlot(id);
    if (!slot || (!slot.locked && !slot.pendingLearn)) return false;
    slot.locked = false;
    slot.pendingLearn = false;
    publish('unlock');
    return true;
  }

  function lockAllVisible() {
    let changed = false;
    for (const slot of slots) {
      if (!slot.enabled || !slot.clusterKey) continue;
      slot.locked = true;
      slot.pendingLearn = false;
      slot.identityKey = slot.clusterKey;
      changed = true;
    }
    if (changed) publish('lock-all');
    return changed;
  }

  function unlockAll() {
    let changed = false;
    for (const slot of slots) {
      if (!slot.locked && !slot.pendingLearn) continue;
      slot.locked = false;
      slot.pendingLearn = false;
      changed = true;
    }
    if (changed) publish('unlock-all');
    return changed;
  }

  function setIdentityName(id, value) {
    const slot = getSlot(id);
    if (!slot) return false;
    const name = String(value ?? '').trim();
    if (slot.identityName === name) return false;
    slot.identityName = name;
    if (name && slot.clusterKey && !slot.identityKey) slot.identityKey = slot.clusterKey;
    publish('identity-name');
    return true;
  }

  function clearIdentity(id) {
    const slot = getSlot(id);
    if (!slot) return false;
    const changed = Boolean(slot.identityKey || slot.identityName || slot.pendingLearn);
    slot.identityKey = null;
    slot.identityName = '';
    slot.pendingLearn = slot.locked;
    if (changed) publish('identity-clear');
    return changed;
  }

  function setSolo(id, enabled) {
    const slot = getSlot(id);
    if (!slot) return false;
    const next = Boolean(enabled);
    if (slot.solo === next) return false;
    slot.solo = next;
    publish('solo');
    return true;
  }

  function setManual(id, enabled) {
    const slot = getSlot(id);
    if (!slot) return false;
    const next = Boolean(enabled);
    if (slot.manual === next) return false;
    slot.manual = next;
    if (next) {
      const cluster = getCluster(slot.clusterKey);
      if (cluster) slot.manualPosition = [...cluster.centroid];
    }
    publish('manual');
    return true;
  }

  function setManualPosition(id, position) {
    const slot = getSlot(id);
    if (!slot || !slot.manual || !Array.isArray(position) || position.length < 3) return false;
    slot.manualPosition = position.slice(0, 3).map((value) => Number(value) || 0);
    publish('manual-position');
    return true;
  }

  function selectId(id) {
    const slot = getSlot(id);
    selected = slot ? { type: 'id', id: slot.id } : null;
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
    const first = slots.length + 1;
    slots = [...slots, ...Array.from({ length: countToAdd }, (_, index) => makeSlot(first + index))];
    publish('resize');
  }

  return {
    snapshot,
    syncFrame,
    assignClusterToId,
    swapAssignments,
    releaseId,
    setEnabled,
    lockAndLearn,
    unlock,
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
