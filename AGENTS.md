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

- Default allocation uses the next eligible free enabled ID. Explicit operator drag/drop may assign to a visible disabled slot without enabling it.
- A disabled, occupied, identity-reserved or manually reserved ID is not automatically eligible.
- Explicit operator reassignment may override the normal allocator.
- Identity state belongs to the locked cluster, not to the slot. The cluster owns `identityLocked` + its identity name; a slot only owns an `identityKey` reservation while it is locked.
- A locked cluster keeps its cached identity even while missing from live tracking. If it occupied a slot, that visible slot remains reserved for the identity and must reacquire it even when the slot is disabled.
- Unlocking a reserved slot also unlocks that identity and removes its name. An unlocked live cluster immediately falls back to its alphabetical operator label.
- Occupied-drop behavior is operator-selectable. **Kick** moves the displaced cluster to another eligible free ID, excluding the target and the dragged cluster's vacated source ID; if no eligible ID remains, the displaced cluster is explicitly released for its current tracking lifetime. **Swap** exchanges assignments with the dragged cluster's source ID; if the dragged cluster was unassigned, the displaced target cluster is explicitly released.
- Lock & Learn on an occupied ID learns that cluster; on an empty ID it waits for the next explicit assignment.
- Lock active affects occupied IDs only so spare slots remain free.
- Strict mode must match Pleiades Assign Cluster IDs semantics: an overflow cluster is refused for its current tracking lifetime; Non-strict overflow stays eligible for a later freed ID.
- Min/Max define the managed ID range and ID 0 is valid. Shrinking the range removes slots outside it; expanding creates fresh slots for newly included IDs.
- Deleted slots are hidden and disabled. Automatic allocation, Solo state and every bulk action must ignore hidden slots. Restoring a deleted slot must not silently re-enable it.
- Bulk actions are distinct: Lock all active targets occupied enabled visible slots; Lock all targets every visible slot; Unlock all targets every visible slot. The output-state bulk control shows Enable all only when every visible slot is disabled; otherwise it shows Disable all. Disable all and Unlock all occupy the left column.
- Manual takeover keeps background tracking associated with the ID.
- `identityKey` is currently a cluster-key/UUID placeholder for UX testing, not a production ReID descriptor. Do not infer or claim true identity recognition in this prototype.

## Interaction

- The 3D scene is the primary spatial operator surface for picking, selection and Manual movement. ID reassignment drag/drop must start only from cluster capsules in the left ID list or bottom tray; dragging a cluster in 3D must never assign it to an ID slot.
- Selection has one model everywhere: plain click selects one visible slot/assigned cluster; Shift+click is additive/toggle selection. An assigned cluster selection must also select its numeric slot. Every selected representation uses bold + glow consistently in the ID list, cluster tray and 3D view.
- **ID color is identity-of-output:** all assigned cluster visuals must derive their color from `src/id-colors.js`. Never derive operator colors from cluster UUID/source ID. Unassigned clusters are always neutral gray.
- Enabled/Disabled, Solo, Manual and selection visual state must agree between the ID panel, cluster tray and 3D. Disabled remains gray even under Solo; Solo changes focus/opacity, not enabled color.
- In the left list, the ID number, Solo button and Manual button are fixed controls. Only the cluster capsule moves between slot wells. While a capsule is dragged, its pointer label must always state the pending action with a question mark: assignment to an empty ID, Swap/Kick for an occupied ID, no change inside non-slot panel space, or removal when an assigned cluster is released outside the ID panel.
- Clicking the ID number toggles Enabled. The adjacent `S` toggles Solo. Keep both usable by mouse and touch.
- Cluster capsules in the left list and bottom tray must keep a lightweight **front-facing** point-cloud silhouette preview and live centroid coordinates. Derive the preview horizontal axis from cluster look-at/orientation; show only the upper framing edge/corners, not a full thumbnail box.
- Operator-facing cluster names are stable alphabetical labels (A, B, C…) for the lifetime of the tracked cluster; do not expose source cluster numbers as the primary name.
- Cluster Lock is available directly on every capsule. Lock immediately caches an identity on the cluster and gives it one stable generated name; that name replaces `Cluster A/B/…` in every cluster representation. When a locked cluster is assigned, its slot reservation follows the cluster. Missing locked identities remain in the cluster tray with an explicit Missing state.
- Normal 3D labels are bare numeric IDs. A locked assigned identity is formatted exactly as `<ID> : <name>`; a locked unassigned live cluster may show the identity name alone. Never render an identity name after its cluster has been unlocked.
- A normal live cluster bounding box, center centroid, floor donut and look-at decoration are **selection-only**. Hidden decoration must not become visible again merely because a global visibility flag changes.
- Manual takeover is a floor-raycast interaction. The operator proxy is ID-colored, sparse-point only, and connected by a dashed line from its floor centroid to the live source centroid. The live source becomes gray and does not display a bounding box while takeover is active.
- A direct left-drag from a live assigned cluster is **temporary Manual**: release/cancel must always clear Manual and return the proxy smoothly to automatic tracking. Manual enabled explicitly with the fixed M button is persistent; while it is active, only the separate Manual proxy is draggable and the live source is read-only.
- Manual takeover must be signaled by the same subtle pulse on the slot row and cluster capsule in both the ID list and bottom tray, including temporary Manual started by direct 3D drag. Ending Manual takeover must visually converge the proxy back to the live cluster using a smooth easing curve; do not introduce a positional jump.
- Solo is a renderer-level focus override and must ignore Enabled/Disabled state for focus. A visible disabled Solo slot remains fully legible in both UI and 3D; Enabled/Disabled still controls allocation/output eligibility. Non-Solo clusters, point clouds, labels, vectors and manual proxies must dim together.
- Solo is the only operator override state persisted locally. Persist visible Solo slot IDs only; deleted slots must never be restored as Solo. Do not write persistence on live tracking frames.
- A 3D identity label is valid only when the slot's `identityKey` matches the displayed cluster key. Never display a reserved identity name on a temporary operator override.
- Keep the ViewCube behavior in sync with the Augmenta ThreeJS example. On the canvas, left pointer drag is reserved for cluster/Manual interaction, right-button drag pans, middle-button drag orbits, wheel zoom remains available, and one-finger touch must not accidentally orbit the camera. Camera framing must account for the left ID panel so the spatial content is centered in the unobscured viewport.
- Cluster context actions are available by right-click in the bottom cluster tray. On the 3D canvas they are available only for an already-selected cluster. A right-button camera pan must suppress the context menu.
- Use Pointer Events for direct manipulation and preserve touch scrolling/long-hold behavior where the UI needs both scrolling and dragging.
- Keep the left controls and bottom tray visually lightweight over the 3D stage; do not restore a permanent right-side inspector without an explicit product decision.

## Validation

Before considering a change ready:

1. Validate syntax for `src/*.js`, `tests/*.mjs`, and `scripts/*.mjs`.
2. Run all Node tests, especially `tests/id-store.test.mjs`.
3. Build/test the pinned SDK when SDK-facing behavior changes.
4. Assemble the Pages artifact and verify it contains no runtime CDN dependency.
5. Manually qualify mouse/touch 3D selection, plain/Shift multi-selection, capsule→ID drag/reassignment, drag-action labels and outside-panel removal, confirmation that 3D→ID assignment is disabled, tray right-click, selected-only 3D right-click, Enabled/Solo/Manual controls, all bulk actions, Strict/Non-strict overflow, Min/Max range changes, delete/restore, locked identity disappearance/reappearance/unlock, Manual ground takeover + smooth return, ViewCube perspective/ortho behavior, mobile layout and reconnect behavior.
