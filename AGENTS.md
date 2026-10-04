# Repository guidance

This repository is an interaction prototype for Augmenta ID management. Keep it small, browser-native and easy to inspect.

## Architecture

- Keep protocol parsing and transport behavior in the Augmenta JavaScript SDK or `src/connection.js`. Do not reimplement the wire protocol in the prototype.
- Keep live setup merging in `src/setup-store.js` and 3D presentation/camera behavior in `src/viewer.js`.
- Keep the operator-only ID model in `src/id-store.js`. Until the backend contract exists, do not disguise local prototype mutations as server writes.
- Keep DOM/operator interaction in `src/id-interface.js` and app orchestration in `src/main.js`.
- The viewer consumes Augmenta data in the requested Three.js convention: Y-up, right-handed, bottom-left origin, absolute coordinates, metres.

## ID-management invariants

Keep these concepts separate in both state and UI:

1. Cluster → ID assignment.
2. Cluster → Identity naming/association.
3. Identity ↔ reserved ID through Lock & Learn.
4. Manual takeover of the published position.

Additional behavior:

- Default allocation uses the next eligible free ID.
- A disabled, occupied, identity-reserved or manually reserved ID is not automatically eligible.
- Explicit operator reassignment may override the normal allocator.
- An occupied Identity-Locked ID is an explicit operator override; ReID must not steal it while that override cluster remains present.
- Learning a different identity must not retain the previous identity's name.
- Dropping a cluster on an occupied ID moves the displaced cluster to the next eligible free ID when possible.
- Lock & Learn on an occupied ID learns that cluster; on an empty ID it waits for the next explicit assignment.
- Lock active affects occupied IDs only so spare slots remain free.
- Manual takeover keeps background tracking associated with the ID.
- `identityKey` is currently a cluster-key/UUID placeholder for UX testing, not a production ReID descriptor. Do not infer or claim true identity recognition in this prototype.

## Interaction

- Every primary action must work by click/tap; drag is an accelerator, never the only path.
- The 3D scene is an operator surface: cluster picking, selection highlighting and ID-to-cluster drops must stay synchronized with the ID store.
- Manual takeover must keep the automatic estimate visible while drawing the operator-controlled proxy separately.
- Use Pointer Events so drag/direct manipulation has one mouse/touch implementation.
- Avoid hover-only affordances.
- Keep targets comfortably usable on touch screens and preserve keyboard access on desktop.
- Follow Pleiades FrontEnd3 tokens and interaction language rather than creating a separate visual system.

## Validation

Before considering a change ready:

1. Validate syntax for `src/*.js`, `tests/*.mjs`, and `scripts/*.mjs`.
2. Run all Node tests, especially `tests/id-store.test.mjs`.
3. Build/test the pinned SDK when SDK-facing behavior changes.
4. Assemble the Pages artifact and verify it contains no runtime CDN dependency.
5. Manually qualify mouse and touch selection, cluster→ID, ID→cluster, ID→ID swap, Lock & Learn, warnings, manual X/Z takeover, mobile panels, orbit/pan/zoom and reconnect behavior.
