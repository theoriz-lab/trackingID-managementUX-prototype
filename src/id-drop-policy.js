export function assignedSlotForCluster(snapshot, key) {
  return snapshot?.slots?.find((slot) => slot.clusterKey === key) ?? null;
}

export function isAutoEligibleSlot(slot) {
  return Boolean(
    slot?.visible
      && slot.enabled
      && !slot.manual
      && !slot.clusterKey
      && !slot.locked
  );
}

export function findNextEligibleFreeSlot(slots = [], excludedIds = new Set()) {
  return slots.find(
    (slot) => !excludedIds.has(slot.id) && isAutoEligibleSlot(slot)
  ) ?? null;
}

export function describeClusterDropAction(
  snapshot,
  key,
  targetId,
  { insideIdPanel = false, sourceOrigin = 'id' } = {}
) {
  const sourceSlot = assignedSlotForCluster(snapshot, key);
  const hasTargetId = targetId !== null
    && targetId !== undefined
    && Number.isInteger(Number(targetId));
  const targetSlot = hasTargetId
    ? snapshot.slots.find((slot) => slot.id === Number(targetId))
    : null;

  if (targetSlot) {
    if (sourceSlot?.id === targetSlot.id) return `Keep ID ${targetSlot.id}?`;
    if (targetSlot.clusterKey && targetSlot.clusterKey !== key) {
      return snapshot.options.occupiedDropMode === 'swap'
        ? `Swap with ID ${targetSlot.id}?`
        : `Kick ID ${targetSlot.id}?`;
    }
    return `Assign to ID ${targetSlot.id}?`;
  }

  if (insideIdPanel) return 'No change?';
  if (sourceOrigin === 'tray') return sourceSlot ? 'No change?' : 'Leave unassigned?';
  if (sourceSlot) return `Remove from ID ${sourceSlot.id}?`;
  return 'Leave unassigned?';
}

export function resolveClusterDropPreview(snapshot, key, targetId) {
  const sourceSlot = assignedSlotForCluster(snapshot, key);
  const targetSlot = snapshot.slots.find((slot) => slot.id === Number(targetId));
  if (!targetSlot || sourceSlot?.id === targetSlot.id) {
    return {
      sourceId: sourceSlot?.id ?? null,
      targetId: targetSlot?.id ?? null,
      displacedTo: null,
      displaced: false
    };
  }

  const displaced = Boolean(targetSlot.clusterKey && targetSlot.clusterKey !== key);
  if (!displaced) {
    return {
      sourceId: sourceSlot?.id ?? null,
      targetId: targetSlot.id,
      displacedTo: null,
      displaced: false
    };
  }

  if (snapshot.options.occupiedDropMode === 'swap') {
    return {
      sourceId: sourceSlot?.id ?? null,
      targetId: targetSlot.id,
      displacedTo: sourceSlot?.id ?? null,
      displaced: true
    };
  }

  const excludedIds = new Set([targetSlot.id]);
  if (sourceSlot) excludedIds.add(sourceSlot.id);
  const destination = findNextEligibleFreeSlot(snapshot.slots, excludedIds);

  return {
    sourceId: sourceSlot?.id ?? null,
    targetId: targetSlot.id,
    displacedTo: destination?.id ?? null,
    displaced: true
  };
}
