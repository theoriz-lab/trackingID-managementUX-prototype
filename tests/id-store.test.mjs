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

test('pending lock on an empty ID learns the next cluster assigned there', () => {
  const store = createIdStore({ count: 2 });
  store.lockAndLearn(1);
  store.syncFrame([cluster('a', 1)]);
  const state = store.snapshot();

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
  store.lockAndLearn(1);
  const state = store.snapshot();

  assert.equal(state.slots[0].solo, true);
  assert.equal(state.slots[0].enabled, true);
  assert.equal(state.slots[0].locked, true);
  assert.equal(state.slots[0].clusterKey, 'a');
});
