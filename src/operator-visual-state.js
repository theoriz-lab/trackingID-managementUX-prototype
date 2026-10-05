export function deriveOperatorVisualState(slots = []) {
  const slotByCluster = new Map();
  const soloSlotIds = new Set();
  const soloClusterKeys = new Set();

  for (const slot of slots) {
    if (!slot || slot.visible === false) continue;
    if (slot.clusterKey) slotByCluster.set(slot.clusterKey, slot);
    if (!slot.enabled || !slot.solo) continue;
    soloSlotIds.add(slot.id);
    if (slot.clusterKey) soloClusterKeys.add(slot.clusterKey);
  }

  return {
    slotByCluster,
    soloSlotIds,
    soloClusterKeys,
    soloMode: soloSlotIds.size > 0
  };
}

export function identityNameForCluster(slot, clusterKey) {
  if (!slot || !clusterKey || slot.identityKey !== clusterKey) return '';
  return String(slot.identityName ?? '').trim();
}

export function operatorLabelForCluster(slot, clusterKey) {
  if (!slot) return '';
  const identityName = identityNameForCluster(slot, clusterKey);
  return identityName
    ? `${identityName}
ID ${slot.id}`
    : `ID ${slot.id}`;
}
