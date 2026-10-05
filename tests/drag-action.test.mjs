import assert from 'node:assert/strict';
import test from 'node:test';
import { createIdStore } from '../src/id-store.js';
import { describeClusterDropAction } from '../src/id-interface.js';

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

test('drag label describes assignment to an empty ID', () => {
  const store = createIdStore({ count: 3 });
  store.syncFrame([cluster('a', 1)]);
  const state = store.snapshot();
  assert.equal(describeClusterDropAction(state, 'a', 3, { insideIdPanel: true }), 'Assign to ID 3?');
});

test('drag label describes Swap and Kick for occupied target IDs', () => {
  const store = createIdStore({ count: 3, occupiedDropMode: 'kick' });
  store.syncFrame([cluster('a', 1), cluster('b', 2)]);

  let state = store.snapshot();
  assert.equal(describeClusterDropAction(state, 'a', 2, { insideIdPanel: true }), 'Kick ID 2?');

  store.setOccupiedDropMode('swap');
  state = store.snapshot();
  assert.equal(describeClusterDropAction(state, 'a', 2, { insideIdPanel: true }), 'Swap with ID 2?');
});

test('drag label describes removal only outside the ID panel', () => {
  const store = createIdStore({ count: 2 });
  store.syncFrame([cluster('a', 1)]);
  const state = store.snapshot();

  assert.equal(describeClusterDropAction(state, 'a', null, { insideIdPanel: true }), 'No change?');
  assert.equal(describeClusterDropAction(state, 'a', null, { insideIdPanel: false }), 'Remove from ID 1?');
});

test('unassigned cluster drag outside keeps it unassigned', () => {
  const store = createIdStore({ count: 1 });
  store.syncFrame([cluster('occupied', 1), cluster('waiting', 2)]);
  const state = store.snapshot();

  assert.equal(describeClusterDropAction(state, 'waiting', null, { insideIdPanel: false }), 'Leave unassigned?');
});
