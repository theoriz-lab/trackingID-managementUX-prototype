export function deriveOperatorVisualState(slots = []) {
  const slotByCluster = new Map();
  const soloSlotIds = new Set();
  const soloClusterKeys = new Set();

  for (const slot of slots) {
    if (!slot || slot.visible === false) continue;
    if (slot.clusterKey) slotByCluster.set(slot.clusterKey, slot);

    // Solo is a presentation override, not an output/allocation state.
    // A visible slot remains a Solo focus target even while its ID is disabled.
    if (!slot.solo) continue;
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
  return identityName ? `${slot.id} : ${identityName}` : String(slot.id);
}


export function deriveSelectionState(slots = [], selected = null, selectedSlotIds = []) {
  const slotIds = new Set(selectedSlotIds);
  const clusterKeys = new Set();

  for (const slot of slots) {
    if (!slot || slot.visible === false || !slotIds.has(slot.id) || !slot.clusterKey) continue;
    clusterKeys.add(slot.clusterKey);
  }

  if (selected?.type === 'cluster' && selected.key) clusterKeys.add(selected.key);

  return { slotIds, clusterKeys };
}
