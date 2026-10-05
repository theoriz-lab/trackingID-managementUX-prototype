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
    const focusedClusterKey = slot.clusterKey || slot.identityKey;
    if (focusedClusterKey) soloClusterKeys.add(focusedClusterKey);
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

export function slotReservesClusterIdentity(slot, cluster) {
  return Boolean(
    slot?.locked
    && cluster?.identityLocked
    && slot.identityKey === cluster.key
  );
}

export function operatorLabelForCluster(slot, cluster) {
  const identityName = identityNameForCluster(cluster);
  if (slot) {
    return identityName && slotReservesClusterIdentity(slot, cluster)
      ? `${slot.id} : ${identityName}`
      : String(slot.id);
  }
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
    if (!slot || !slotIds.has(slot.id)) continue;
    const selectedClusterKey = slot.clusterKey || slot.identityKey;
    if (selectedClusterKey) clusterKeys.add(selectedClusterKey);
  }

  if (selected?.type === 'cluster' && selected.key) clusterKeys.add(selected.key);

  return { slotIds, clusterKeys };
}
