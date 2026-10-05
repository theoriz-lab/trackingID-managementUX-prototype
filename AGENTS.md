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
- Strict mode must match Pleiades Assign Cluster IDs semantics: an overflow cluster is refused for its current tracking lifetime; Non-strict overflow stays eligible for a later freed ID.
- Min/Max define the managed ID range. Shrinking the range removes slots outside it; expanding creates fresh slots for newly included IDs.
- Deleted slots are hidden and disabled. Automatic allocation, Solo state and every bulk action must ignore hidden slots. Restoring a deleted slot must not silently re-enable it.
- Bulk actions are distinct: Lock all active targets occupied enabled visible slots; Lock all targets every visible slot; Unlock all targets every visible slot. The output-state bulk control shows Enable all only when every visible slot is disabled; otherwise it shows Disable all. Disable all and Unlock all occupy the left column.
- Manual takeover keeps background tracking associated with the ID.
- `identityKey` is currently a cluster-key/UUID placeholder for UX testing, not a production ReID descriptor. Do not infer or claim true identity recognition in this prototype.

## Interaction

- The 3D scene is the primary operator surface. Cluster picking, selection, drag and left-slot assignment must remain synchronized with the ID store.
- **ID color is identity-of-output:** all assigned cluster visuals must derive their color from `src/id-colors.js`. Never derive operator colors from cluster UUID/source ID. Unassigned clusters are always neutral gray.
- In the left list, the ID number, Solo button and Manual button are fixed controls. Only the cluster capsule moves between slot wells.
- Clicking the ID number toggles Enabled. The adjacent `S` toggles Solo. Keep both usable by mouse and touch.
- Cluster capsules in the left list and bottom tray must keep a lightweight point-cloud silhouette preview and live centroid coordinates.
- A normal live cluster bounding box, center centroid, floor donut and look-at decoration are **selection-only**. Hidden decoration must not become visible again merely because a global visibility flag changes.
- Manual takeover is a floor-raycast interaction. The operator proxy is ID-colored, sparse-point only, and connected by a dashed line from its floor centroid to the live source centroid. The live source becomes gray and does not display a bounding box while takeover is active.
- A direct left-drag from a live assigned cluster is **temporary Manual**: release/cancel must always clear Manual and return the proxy smoothly to automatic tracking. Manual enabled explicitly with the fixed M button is persistent; while it is active, only the separate Manual proxy is draggable and the live source is read-only.
- Manual takeover must be signaled by a subtle ID-colored pulse/frame around the entire slot row, not only the capsule or M button. Ending Manual takeover must visually converge the proxy back to the live cluster using a smooth easing curve; do not introduce a positional jump.
- Solo is a renderer-level focus override and must ignore Enabled/Disabled state for focus. A visible disabled Solo slot remains fully legible in both UI and 3D; Enabled/Disabled still controls allocation/output eligibility. Non-Solo clusters, point clouds, labels, vectors and manual proxies must dim together.
- A 3D identity label is valid only when the slot's `identityKey` matches the displayed cluster key. Never display a reserved identity name on a temporary operator override.
- Keep the ViewCube behavior in sync with the Augmenta ThreeJS example. On the canvas, left pointer drag is reserved for cluster/Manual interaction, right-button drag pans, middle-button drag orbits, wheel zoom remains available, and one-finger touch must not accidentally orbit the camera. Camera framing must account for the left ID panel so the spatial content is centered in the unobscured viewport.
- Bottom-tray right-click reassignment is an accelerator; ordinary capsule drag/drop remains available for touch-capable workflows.
- Use Pointer Events for direct manipulation and preserve touch scrolling/long-hold behavior where the UI needs both scrolling and dragging.
- Keep the left controls and bottom tray visually lightweight over the 3D stage; do not restore a permanent right-side inspector without an explicit product decision.

## Validation

Before considering a change ready:

1. Validate syntax for `src/*.js`, `tests/*.mjs`, and `scripts/*.mjs`.
2. Run all Node tests, especially `tests/id-store.test.mjs`.
3. Build/test the pinned SDK when SDK-facing behavior changes.
4. Assemble the Pages artifact and verify it contains no runtime CDN dependency.
5. Manually qualify mouse/touch 3D selection, 3D→ID drag, capsule→ID drag/reassignment, bottom-tray right-click assignment, Enabled/Solo/Manual controls, all bulk actions, Strict/Non-strict overflow, Min/Max range changes, delete/restore, Lock & Learn, Manual ground takeover + smooth return, ViewCube perspective/ortho behavior, mobile layout and reconnect behavior.
