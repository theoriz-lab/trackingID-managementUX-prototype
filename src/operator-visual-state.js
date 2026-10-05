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

export function identityNameForCluster(cluster) {
  if (!cluster?.identityLocked) return '';
  return String(cluster.identityName ?? '').trim();
}

export function operatorClusterName(cluster) {
  const identityName = identityNameForCluster(cluster);
  return identityName || (cluster?.label ? `Cluster ${cluster.label}` : 'Cluster');
}

export function operatorLabelForCluster(slot, cluster) {
  const identityName = identityNameForCluster(cluster);
  if (slot) return identityName ? `${slot.id} : ${identityName}` : String(slot.id);
  return identityName;
}


export function deriveSelectionState(slots = [], selected = null, selectedSlotIds = []) {
  const visibleSlotIds = new Set(
    slots
      .filter((slot) => slot && slot.visible !== false)
      .map((slot) => slot.id)
  );
  const slotIds = new Set(
    selectedSlotIds.filter((id) => visibleSlotIds.has(id))
  );
  const clusterKeys = new Set();

  for (const slot of slots) {
    if (!slot || !slotIds.has(slot.id) || !slot.clusterKey) continue;
    clusterKeys.add(slot.clusterKey);
  }

  if (selected?.type === 'cluster' && selected.key) clusterKeys.add(selected.key);

  return { slotIds, clusterKeys };
}
