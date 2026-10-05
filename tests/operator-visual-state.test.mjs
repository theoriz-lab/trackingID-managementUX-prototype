import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deriveOperatorVisualState,
  deriveSelectionState,
  identityNameForCluster,
  operatorClusterName,
  operatorLabelForCluster
} from '../src/operator-visual-state.js';

test('solo mode keeps every enabled solo slot as a focus target', () => {
  const state = deriveOperatorVisualState([
    { id: 1, enabled: true, solo: true, clusterKey: 'alice' },
    { id: 2, enabled: true, solo: false, clusterKey: 'bob' },
    { id: 3, enabled: true, solo: true, clusterKey: 'carol' }
  ]);

  assert.equal(state.soloMode, true);
  assert.deepEqual([...state.soloSlotIds], [1, 3]);
  assert.deepEqual([...state.soloClusterKeys], ['alice', 'carol']);
});

test('an enabled manual solo slot without a cluster still activates solo mode', () => {
  const state = deriveOperatorVisualState([
    { id: 1, enabled: true, solo: true, clusterKey: null }
  ]);

  assert.equal(state.soloMode, true);
  assert.equal(state.soloClusterKeys.size, 0);
});

test('Solo overrides disabled state for operator focus', () => {
  const state = deriveOperatorVisualState([
    { id: 1, enabled: false, solo: true, clusterKey: 'alice' },
    { id: 2, enabled: true, solo: false, clusterKey: 'bob' }
  ]);

  assert.equal(state.soloMode, true);
  assert.deepEqual([...state.soloSlotIds], [1]);
  assert.deepEqual([...state.soloClusterKeys], ['alice']);
});

test('identity names belong to the locked cluster, not the temporary slot occupant', () => {
  const slot = {
    id: 1,
    clusterKey: 'bob',
    identityKey: 'alice'
  };
  const bob = { key: 'bob', label: 'B', identityLocked: false, identityName: '' };
  const alice = { key: 'alice', label: 'A', identityLocked: true, identityName: 'Alice' };

  assert.equal(identityNameForCluster(bob), '');
  assert.equal(operatorLabelForCluster(slot, bob), '1');
  assert.equal(identityNameForCluster(alice), 'Alice');
  assert.equal(operatorClusterName(alice), 'Alice');
});

test('matching identities render as ID colon name', () => {
  const slot = {
    id: 4,
    clusterKey: 'singer-a',
    identityKey: 'singer-a'
  };
  const cluster = {
    key: 'singer-a',
    label: 'A',
    identityLocked: true,
    identityName: 'Singer A'
  };

  assert.equal(operatorLabelForCluster(slot, cluster), '4 : Singer A');
  assert.equal(operatorClusterName(cluster), 'Singer A');
});

test('unlocking identity state falls back to the alphabetical cluster name', () => {
  const cluster = {
    key: 'a',
    label: 'A',
    identityLocked: false,
    identityName: 'Pancake'
  };

  assert.equal(identityNameForCluster(cluster), '');
  assert.equal(operatorClusterName(cluster), 'Cluster A');
});


test('deleted slots do not participate in Solo or cluster mapping', () => {
  const state = deriveOperatorVisualState([
    { id: 1, visible: false, enabled: true, solo: true, clusterKey: 'hidden' },
    { id: 2, visible: true, enabled: true, solo: false, clusterKey: 'visible' }
  ]);

  assert.equal(state.soloMode, false);
  assert.equal(state.slotByCluster.has('hidden'), false);
  assert.equal(state.slotByCluster.get('visible')?.id, 2);
});


test('selection derivation is shared between slots and clusters', () => {
  const slots = [
    { id: 1, visible: true, clusterKey: 'a' },
    { id: 2, visible: true, clusterKey: 'b' },
    { id: 3, visible: false, clusterKey: 'hidden' }
  ];

  const state = deriveSelectionState(
    slots,
    { type: 'cluster', key: 'free-cluster' },
    [1, 2, 3]
  );

  assert.deepEqual([...state.slotIds], [1, 2]);
  assert.deepEqual([...state.clusterKeys], ['a', 'b', 'free-cluster']);
});


test('a selected reserved slot selects its missing cached identity', () => {
  const slots = [
    {
      id: 3,
      visible: true,
      clusterKey: null,
      locked: true,
      identityKey: 'pancake'
    }
  ];

  const state = deriveSelectionState(slots, { type: 'id', id: 3 }, [3]);
  assert.deepEqual([...state.slotIds], [3]);
  assert.deepEqual([...state.clusterKeys], ['pancake']);
});

test('Solo focus follows a reserved identity while the live cluster is missing', () => {
  const state = deriveOperatorVisualState([
    {
      id: 3,
      visible: true,
      enabled: false,
      solo: true,
      clusterKey: null,
      locked: true,
      identityKey: 'pancake'
    }
  ]);

  assert.equal(state.soloMode, true);
  assert.deepEqual([...state.soloSlotIds], [3]);
  assert.deepEqual([...state.soloClusterKeys], ['pancake']);
});
