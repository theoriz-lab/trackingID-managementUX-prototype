import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GHOST_CLUSTER_COLOR,
  clusterColorCss,
  clusterColorValue,
  clusterDisplayColorCss
} from '../src/cluster-color.js';

test('cluster color mapping is stable within a session', () => {
  assert.equal(clusterColorValue('/Demo|alice', 1), clusterColorValue('/Other|alice', 1));
  assert.equal(clusterColorCss('/Demo|alice', 1), clusterColorCss('/Demo|alice', 1));
});

test('cluster CSS color exactly represents the shared numeric color', () => {
  const value = clusterColorValue('/Demo|alice', 1);
  assert.equal(clusterColorCss('/Demo|alice', 1), `#${value.toString(16).padStart(6, '0')}`);
});

test('ghost display color uses the shared ghost gray', () => {
  assert.equal(
    clusterDisplayColorCss('/Demo|alice', 1, true),
    `#${GHOST_CLUSTER_COLOR.toString(16).padStart(6, '0')}`
  );
});
