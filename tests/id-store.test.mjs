import assert from 'node:assert/strict';
import test from 'node:test';
import { createIdStore } from '../src/id-store.js';

const cluster = (key, sourceId) => ({
  key,
  uuid: key,
  sourceId,
  visible: true,
  ghost: false,
  sceneAddress: '/Demo',
  centroid: [sourceId, 1, 0],
  size: [0.5, 1.8, 0.5]
});

test('incoming clusters prefer the matching free public ID', () => {
  const store = createIdStore({ count: 4 });
  store.syncFrame([cluster('a', 2), cluster('b', 1)]);
  const state = store.snapshot();
  assert.equal(state.slots[0].clusterKey, 'b');
  assert.equal(state.slots[1].clusterKey, 'a');
});

test('lock and learn reserves an ID while the learned cluster is missing', () => {
  const store = createIdStore({ count: 4 });
  store.syncFrame([cluster('alice', 1)]);
  store.lockAndLearn(1);
  store.syncFrame([]);

  let state = store.snapshot();
  assert.equal(state.slots[0].clusterKey, null);
  assert.equal(state.slots[0].identityKey, 'alice');
  assert.equal(state.slots[0].locked, true);

  store.syncFrame([cluster('friend', 1)]);
  state = store.snapshot();
  assert.notEqual(state.slots[0].clusterKey, 'friend');
  assert.equal(state.slots[1].clusterKey, 'friend');

  store.syncFrame([cluster('friend', 1), cluster('alice', 4)]);
  state = store.snapshot();
  assert.equal(state.slots[0].clusterKey, 'alice');
});

test('manual assignment kicks an occupied cluster to the next eligible ID', () => {
  const store = createIdStore({ count: 4 });
  store.syncFrame([cluster('a', 1), cluster('b', 2)]);
  const result = store.assignClusterToId('b', 1);
  const state = store.snapshot();

  assert.equal(result.ok, true);
  assert.equal(state.slots[0].clusterKey, 'b');
  assert.equal(state.slots[1].clusterKey, 'a');
});

test('pending lock on an empty ID waits for an explicit assignment and then learns it', () => {
  const store = createIdStore({ count: 2 });
  store.lockAndLearn(1);
  store.syncFrame([cluster('a', 1)]);

  let state = store.snapshot();
  assert.equal(state.slots[0].clusterKey, null);
  assert.equal(state.slots[1].clusterKey, 'a');
  assert.equal(state.slots[0].pendingLearn, true);

  store.assignClusterToId('a', 1);
  state = store.snapshot();
  assert.equal(state.slots[0].clusterKey, 'a');
  assert.equal(state.slots[0].identityKey, 'a');
  assert.equal(state.slots[0].pendingLearn, false);
});

test('manual takeover keeps the ID occupied when tracking disappears', () => {
  const store = createIdStore({ count: 2 });
  store.syncFrame([cluster('a', 1)]);
  store.setManual(1, true);
  store.syncFrame([]);
  const state = store.snapshot();

  assert.equal(state.slots[0].clusterKey, 'a');
  assert.equal(state.slots[0].manual, true);
});

test('lock all only locks active IDs so spare slots remain allocatable', () => {
  const store = createIdStore({ count: 4 });
  store.syncFrame([cluster('a', 1), cluster('b', 2)]);
  store.lockAllVisible();
  const state = store.snapshot();

  assert.equal(state.slots[0].locked, true);
  assert.equal(state.slots[1].locked, true);
  assert.equal(state.slots[2].locked, false);
  assert.equal(state.slots[3].locked, false);
});


test('solo state is independent from enable, lock and assignment', () => {
  const store = createIdStore({ count: 2 });
  store.syncFrame([cluster('a', 1)]);
  store.setSolo(1, true);
  store.setEnabled(1, false);
  store.lockAndLearn(1);
  const state = store.snapshot();

  assert.equal(state.slots[0].solo, true);
  assert.equal(state.slots[0].enabled, false);
  assert.equal(state.slots[0].locked, true);
  assert.equal(state.slots[0].clusterKey, 'a');
});


test('release keeps a live cluster intentionally unassigned until it leaves tracking', () => {
  const store = createIdStore({ count: 2 });
  store.syncFrame([cluster('a', 1)]);
  assert.equal(store.releaseId(1), true);

  store.syncFrame([cluster('a', 1)]);
  let state = store.snapshot();
  assert.equal(state.slots[0].clusterKey, null);
  assert.equal(state.slots[1].clusterKey, null);

  store.syncFrame([]);
  store.syncFrame([cluster('a', 1)]);
  state = store.snapshot();
  assert.equal(state.slots[0].clusterKey, 'a');
});

test('swap refuses disabled IDs', () => {
  const store = createIdStore({ count: 2 });
  store.syncFrame([cluster('a', 1), cluster('b', 2)]);
  store.setEnabled(2, false);

  assert.equal(store.swapAssignments(1, 2), false);
  const state = store.snapshot();
  assert.equal(state.slots[0].clusterKey, 'a');
  assert.equal(state.slots[1].clusterKey, 'b');
});

test('swap into a pending Lock & Learn ID learns the arriving cluster', () => {
  const store = createIdStore({ count: 3 });
  store.lockAndLearn(1);
  store.syncFrame([cluster('a', 2), cluster('b', 3)]);

  assert.equal(store.swapAssignments(1, 2), true);
  const state = store.snapshot();
  assert.equal(state.slots[0].clusterKey, 'a');
  assert.equal(state.slots[0].identityKey, 'a');
  assert.equal(state.slots[0].pendingLearn, false);
});

test('a selected cluster is cleared when it leaves tracking', () => {
  const store = createIdStore({ count: 2 });
  store.syncFrame([cluster('a', 1)]);
  store.selectCluster('a');
  store.syncFrame([]);

  assert.equal(store.snapshot().selected, null);
});


test('operator assignment keeps priority over identity lock while the override cluster is present', () => {
  const store = createIdStore({ count: 3 });
  store.syncFrame([cluster('alice', 1), cluster('bob', 2)]);
  store.setIdentityName(1, 'Alice');
  store.lockAndLearn(1);

  store.assignClusterToId('bob', 1);
  let state = store.snapshot();
  assert.equal(state.slots[0].clusterKey, 'bob');
  assert.equal(state.slots[1].clusterKey, 'alice');

  store.syncFrame([cluster('alice', 1), cluster('bob', 2)]);
  state = store.snapshot();
  assert.equal(state.slots[0].clusterKey, 'bob');
  assert.equal(state.slots[1].clusterKey, 'alice');

  store.syncFrame([cluster('alice', 1)]);
  store.syncFrame([cluster('alice', 1)]);
  state = store.snapshot();
  assert.equal(state.slots[0].clusterKey, 'alice');
});

test('learning a different identity clears the stale identity name', () => {
  const store = createIdStore({ count: 2 });
  store.syncFrame([cluster('alice', 1)]);
  store.setIdentityName(1, 'Alice');
  store.lockAndLearn(1);
  store.unlock(1);

  store.syncFrame([]);
  store.syncFrame([cluster('bob', 1)]);
  store.lockAndLearn(1);

  const state = store.snapshot();
  assert.equal(state.slots[0].identityKey, 'bob');
  assert.equal(state.slots[0].identityName, '');
});


test('manual takeover starts on the floor under the live centroid', () => {
  const store = createIdStore({ count: 2 });
  const tracked = cluster('a', 1);
  tracked.centroid = [1.25, 1.42, -2.5];
  store.syncFrame([tracked]);

  store.setManual(1, true);
  const state = store.snapshot();

  assert.deepEqual(state.slots[0].manualPosition, [1.25, 0, -2.5]);
});

test('point preview data is cloned through snapshots', () => {
  const store = createIdStore({ count: 2 });
  const tracked = cluster('a', 1);
  tracked.preview = [[0.1, 0.2], [0.8, 0.9]];
  store.syncFrame([tracked]);

  const first = store.snapshot();
  first.clusters[0].preview[0][0] = 999;
  const second = store.snapshot();

  assert.deepEqual(second.clusters[0].preview, [[0.1, 0.2], [0.8, 0.9]]);
});


test('strict overflow clusters stay refused until they leave tracking', () => {
  const store = createIdStore({ count: 2, strictMode: true });
  store.syncFrame([cluster('a', 1), cluster('b', 2), cluster('c', 3)]);

  let state = store.snapshot();
  assert.equal(state.slots[0].clusterKey, 'a');
  assert.equal(state.slots[1].clusterKey, 'b');
  assert.equal(state.slots.some((slot) => slot.clusterKey === 'c'), false);

  // A leaves and frees ID 1, but c was refused while the range was full.
  store.syncFrame([cluster('b', 2), cluster('c', 3)]);
  state = store.snapshot();
  assert.equal(state.slots[0].clusterKey, null);
  assert.equal(state.slots[1].clusterKey, 'b');

  // Once c actually leaves, re-entering makes it eligible again.
  store.syncFrame([cluster('b', 2)]);
  store.syncFrame([cluster('b', 2), cluster('c', 3)]);
  state = store.snapshot();
  assert.equal(state.slots[0].clusterKey, 'c');
});

test('non-strict overflow clusters acquire an ID when one becomes free', () => {
  const store = createIdStore({ count: 2, strictMode: false });
  store.syncFrame([cluster('a', 1), cluster('b', 2), cluster('c', 3)]);

  store.syncFrame([cluster('b', 2), cluster('c', 3)]);
  const state = store.snapshot();

  assert.equal(state.slots[0].clusterKey, 'c');
  assert.equal(state.slots[1].clusterKey, 'b');
});

test('changing Min and Max IDs removes slots outside the managed range', () => {
  const store = createIdStore({ count: 5 });
  store.setIdRange(2, 4);
  let state = store.snapshot();

  assert.deepEqual(state.slots.map((slot) => slot.id), [2, 3, 4]);
  assert.deepEqual(state.options, {
    strictMode: false,
    allowDelete: false,
    minId: 2,
    maxId: 4
  });

  store.setIdRange(4, 6);
  state = store.snapshot();
  assert.deepEqual(state.slots.map((slot) => slot.id), [4, 5, 6]);
  assert.equal(state.slots.find((slot) => slot.id === 4)?.visible, true);
});

test('slot deletion hides and disables the slot until restored', () => {
  const store = createIdStore({ count: 3, allowDelete: true });
  assert.equal(store.deleteSlot(2), true);

  let state = store.snapshot();
  const deleted = state.slots.find((slot) => slot.id === 2);
  assert.equal(deleted.visible, false);
  assert.equal(deleted.enabled, false);

  store.setAllVisibleEnabled(false);
  state = store.snapshot();
  assert.equal(state.slots.find((slot) => slot.id === 1).enabled, false);
  assert.equal(state.slots.find((slot) => slot.id === 2).enabled, false);
  assert.equal(state.slots.find((slot) => slot.id === 3).enabled, false);

  assert.equal(store.restoreDeletedSlots(), true);
  state = store.snapshot();
  assert.equal(state.slots.find((slot) => slot.id === 2).visible, true);
  assert.equal(state.slots.find((slot) => slot.id === 2).enabled, false);
});

test('slot deletion is blocked until enabled in options', () => {
  const store = createIdStore({ count: 2 });
  assert.equal(store.deleteSlot(1), false);
  store.setAllowDelete(true);
  assert.equal(store.deleteSlot(1), true);
});

test('bulk lock operations only affect visible slots', () => {
  const store = createIdStore({ count: 3, allowDelete: true });
  store.syncFrame([cluster('a', 1), cluster('b', 2)]);
  store.deleteSlot(2);

  store.lockAll();
  let state = store.snapshot();

  assert.equal(state.slots.find((slot) => slot.id === 1).locked, true);
  assert.equal(state.slots.find((slot) => slot.id === 2).locked, false);
  assert.equal(state.slots.find((slot) => slot.id === 3).locked, true);

  store.unlockAll();
  state = store.snapshot();
  assert.equal(state.slots.find((slot) => slot.id === 1).locked, false);
  assert.equal(state.slots.find((slot) => slot.id === 2).locked, false);
  assert.equal(state.slots.find((slot) => slot.id === 3).locked, false);
});

test('Lock all active only locks occupied enabled visible IDs', () => {
  const store = createIdStore({ count: 4, allowDelete: true });
  store.syncFrame([cluster('a', 1), cluster('b', 2)]);
  store.deleteSlot(2);
  store.setEnabled(3, false);

  store.lockAllActive();
  const state = store.snapshot();

  assert.equal(state.slots.find((slot) => slot.id === 1).locked, true);
  assert.equal(state.slots.find((slot) => slot.id === 2).locked, false);
  assert.equal(state.slots.find((slot) => slot.id === 3).locked, false);
  assert.equal(state.slots.find((slot) => slot.id === 4).locked, false);
});
