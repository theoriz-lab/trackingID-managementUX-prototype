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

- The 3D scene is the primary operator surface. Cluster picking, selection, drag and left-slot assignment must remain synchronized with the ID store.
- **ID color is identity-of-output:** all assigned cluster visuals must derive their color from `src/id-colors.js`. Never derive operator colors from cluster UUID/source ID. Unassigned clusters are always neutral gray.
- In the left list, the ID number and Solo button are fixed controls. Only the cluster capsule moves between slot wells.
- Clicking the ID number toggles Enabled. The adjacent `S` toggles Solo. Keep both usable by mouse and touch.
- Cluster capsules in the left list and bottom tray must keep a lightweight point-cloud silhouette preview and live centroid coordinates.
- A normal live cluster bounding box, center centroid, floor donut and look-at decoration are **selection-only**. Hidden decoration must not become visible again merely because a global visibility flag changes.
- Manual takeover is a floor-raycast interaction. The operator proxy is ID-colored, sparse-point only, and connected by a dashed line from its floor centroid to the live source centroid. The live source becomes gray and does not display a bounding box while takeover is active.
- Ending Manual takeover must visually converge the proxy back to the live cluster using a smooth easing curve; do not introduce a positional jump.
- Solo is a renderer-level focus state. Non-Solo clusters, point clouds, labels, vectors and manual proxies must all dim together while every active Solo target remains legible.
- A 3D identity label is valid only when the slot's `identityKey` matches the displayed cluster key. Never display a reserved identity name on a temporary operator override.
- Orbit is controlled by the camera cube. Keep direct OrbitControls rotate/pan disabled so cluster dragging cannot accidentally orbit the scene. Wheel/touch zoom may remain available unless explicitly changed.
- Bottom-tray right-click reassignment is an accelerator; ordinary capsule drag/drop remains available for touch-capable workflows.
- Use Pointer Events for direct manipulation and preserve touch scrolling/long-hold behavior where the UI needs both scrolling and dragging.
- Keep the left controls and bottom tray visually lightweight over the 3D stage; do not restore a permanent right-side inspector without an explicit product decision.

## Validation

Before considering a change ready:

1. Validate syntax for `src/*.js`, `tests/*.mjs`, and `scripts/*.mjs`.
2. Run all Node tests, especially `tests/id-store.test.mjs`.
3. Build/test the pinned SDK when SDK-facing behavior changes.
4. Assemble the Pages artifact and verify it contains no runtime CDN dependency.
5. Manually qualify mouse and touch selection, cluster→ID, ID→cluster, ID→ID swap, Lock & Learn, warnings, manual X/Z takeover, mobile panels, orbit/pan/zoom and reconnect behavior.
