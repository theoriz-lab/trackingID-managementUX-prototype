import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deriveOperatorVisualState,
  identityNameForCluster,
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

test('disabled solo slots do not activate solo mode', () => {
  const state = deriveOperatorVisualState([
    { id: 1, enabled: false, solo: true, clusterKey: 'alice' }
  ]);

  assert.equal(state.soloMode, false);
});

test('identity names do not follow a temporary operator override', () => {
  const slot = {
    id: 1,
    clusterKey: 'bob',
    identityKey: 'alice',
    identityName: 'Alice'
  };

  assert.equal(identityNameForCluster(slot, 'bob'), '');
  assert.equal(operatorLabelForCluster(slot, 'bob'), 'ID 1');
  assert.equal(identityNameForCluster(slot, 'alice'), 'Alice');
});

test('matching identities render above their public ID', () => {
  const slot = {
    id: 4,
    clusterKey: 'singer-a',
    identityKey: 'singer-a',
    identityName: 'Singer A'
  };

  assert.equal(operatorLabelForCluster(slot, 'singer-a'), 'Singer A\nID 4');
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
