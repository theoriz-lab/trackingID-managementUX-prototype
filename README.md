# Augmenta ID Management Interface Prototype

Prototype for the Augmenta ID-management operator interface.

The repository is intentionally based on the Augmenta Three.js example so the prototype consumes the same live Augmenta WebSocket stream through the official JavaScript SDK and displays the real tracking scene while operator workflows are explored.

## Prototype scope

The interface explores four deliberately separate concepts:

- **Cluster → ID assignment** — move a tracked person to a public output ID.
- **Cluster → Identity** — locking a cluster caches a persistent operator-facing identity/name on that cluster.
- **Identity ↔ ID lock** — when that locked cluster occupies an ID slot, the slot reserves the cached identity and keeps looking for it if tracking disappears.
- **Manual takeover** — keep tracking in the background while an operator overrides the published position.

The current operator state is a **front-end prototype only**. Assignments, Lock & Learn, identity names and manual positions are modeled locally in the browser; they are not written back to Pleiades yet. Live cluster position/state comes from the real Augmenta SDK stream.

Identity recognition itself is **not implemented here**: the prototype currently uses the live cluster key/UUID as an identity placeholder so the Lock & Learn UX can be exercised. A production ReID descriptor/matcher will replace that placeholder.

## UX

The current prototype is intentionally **3D-first**. There is no right-side inspector: the live spatial view stays dominant and the left ID list plus bottom live-cluster tray carry the operator workflow.

- **Colors belong to public IDs, not clusters.** IDs use a fixed punchy palette from `src/id-colors.js`; an unassigned cluster is neutral gray. The same ID color is reused in the left capsule, bottom tray and 3D representation.
- The visual pass intentionally follows the approved reference image more closely: ID-colored capsules, selected states, active controls and Manual mode use restrained luminous glows while the panels remain translucent over the 3D scene.
- The left list is a stable slot structure: the **ID number never moves**, clicking it enables/disables that slot, the adjacent **S** button toggles Solo, and only the cluster capsule is draggable between slots.
- A fixed **M** button sits to the right of each slot well. It enters Manual takeover directly; while Manual is active a subtle ID-colored frame pulses around the **entire slot row**, and pressing **M** again returns smoothly to live tracking.
- An empty slot is a hollow capsule-shaped well. Dropping a cluster capsule into it assigns that cluster to the ID. Explicit drag/drop is also allowed onto a visible **disabled** slot; the slot remains disabled after assignment. Dropping on an occupied slot uses the existing operator reassignment/displacement rules.
- The bulk toolbar keeps **Disable all / Enable all** and **Unlock all** in the left column, with **Lock all active** and **Lock all** on the right. The left output-state button shows **Enable all only when every visible slot is disabled**; otherwise it shows **Disable all**. Every bulk operation acts on **visible slots only**.
- **Lock all active** learns/locks only occupied enabled visible IDs. **Lock all** locks every visible slot, including empty slots waiting for their next explicit assignment. **Unlock all** acts only on non-deleted visible slots; unassigned cached identities remain managed from their own cluster Lock control.
- The header reports both the number of **visible slots** and the number of **active (enabled) visible slots**.
- The cog menu exposes **Strict mode**, **Min ID**, **Max ID**, and **Allow slot deletion**.
  - **Non-strict** overflow clusters wait unassigned and can acquire a slot later when one becomes free.
  - **Strict** matches Pleiades' Assign Cluster IDs semantics: a cluster that enters while all available IDs are occupied is refused for the rest of that tracking lifetime and only becomes eligible after it leaves and re-enters.
  - Changing **Min ID / Max ID** changes the managed slot range itself. **ID 0 is valid**. IDs outside the new range are removed rather than merely hidden; IDs newly brought into range are new slots.
  - When slot deletion is enabled, a per-slot delete control hides and disables that slot. Deleted slots are excluded from all bulk operations and automatic allocation. Restore makes them visible again but leaves them disabled.
- Every left and bottom cluster capsule shows a small **front-facing** point-cloud silhouette plus current centroid coordinates `x / y / z`. The thumbnail uses the cluster look-at orientation and only draws the upper part of its framing box.
- Live clusters start with stable operator letters (`Cluster A`, `Cluster B`, …) instead of exposing incoming numeric cluster IDs. Once locked, the generated identity name **replaces** that cluster label everywhere, e.g. `Pancake`. Unlocking removes the identity name immediately and the live cluster returns to its alphabetical name.
- Each cluster capsule has its own Lock control. Locking caches the identity on the cluster itself. A locked unassigned cluster carries that identity until assignment; a locked assigned cluster also locks/reserves its current slot. If the tracked cluster disappears, its cached identity remains visible in the cluster tray as a Missing identity, and the slot remains reserved for it.
- Clicking/tapping a cluster in the **3D view** selects it; clicking empty 3D space clears the selection. Clicking a slot or assigned cluster selects that slot exclusively; **Shift+click** adds/removes slots from the selection. Every selected slot/cluster uses the same bold + glow treatment in the ID list, bottom cluster tray and 3D scene, and selecting an assigned cluster also highlights its numeric ID control.
- Selected live clusters get the luminous 3D halo plus bounding box, centroid and floor donut. The bottom tray dims clusters that are not selected.
- Assigned clusters use the same visual state in the ID panel and 3D: enabled IDs use their ID color, disabled IDs are gray, Solo only overrides focus/dimming, and selected IDs use the bold/glow treatment. A normal 3D label is the numeric public ID; a locked identity is `<ID> : <name>`, while a locked but unassigned live cluster is labeled by its identity name. Unlocking removes the identity name from 3D immediately.
- **Solo is a spatial focus override:** every visible Solo target stays fully legible even when that ID is disabled, while non-Solo clusters, point clouds, labels and manual proxies are reduced to only a few percent opacity. Disabled state still controls allocation/output eligibility; it does not suppress Solo focus. Solo flags are saved locally in the browser and restored on reload; deleted slots are never persisted as Solo targets.
- Dragging an assigned live cluster directly in the 3D view starts a **temporary Manual takeover**. The pointer is raycast onto the floor and drives an ID-colored sparse-point proxy while the automatic tracked source stays in place. Releasing the pointer always exits Manual mode and smoothly returns the proxy to live tracking. Temporary Manual uses the same pulse treatment as button-triggered Manual, on both the slot row and the cluster capsule in the bottom tray.
- Pressing the fixed **M** button starts a persistent Manual takeover. In that mode only the separate Manual proxy is draggable; the automatic live cluster remains read-only in its tracked position until M is released.
- During either Manual interaction, a dashed line links the floor proxy to the live source centroid. A temporary live-cluster drag may still be dropped onto a left slot to reassign the cluster, but the release ends Manual mode.
- Camera orbit keeps the **same ViewCube implementation as the Augmenta ThreeJS example**. Drag the cube to orbit, click its faces for orthographic presets, use the ortho preset panel/Tab navigation, and Escape/close to return to perspective.
- On the canvas, **right-button drag pans**, **middle-button / scroll-wheel-click drag orbits**, and the wheel still zooms. Left drag remains exclusively reserved for cluster/Manual interaction. The camera projection is offset so the tracked scene is centered in the unobscured workspace beside the left ID panel.
- **Right-click** on a cluster in the bottom cluster tray opens the compact assignment/identity menu. In the 3D view the same context menu is available only when the cluster is already selected; right-button drag still pans and does not open the menu.
- Keyboard: `L` toggles Lock & Learn for the selected assignment, `M` toggles Manual takeover, and `Esc` clears selection/context UI.

## Live connection

The prototype automatically connects using the inherited Three.js example defaults:

- address: `127.0.0.1`
- port: `6060`
- protocol: automatic
- point-cloud downsample: `1`

There is intentionally no connection/settings UI in this prototype. URL query parameters from the inherited example still provide a convenient temporary override, for example `?address=192.168.1.42&port=6060`. This is useful when opening the prototype from a phone on the same LAN.

## Run locally

Clone with submodules, build the SDK, then serve the repository over HTTP:

```bash
git clone --recurse-submodules <repository-url>
cd trackingID-managementUX-prototype
npm ci --prefix vendor/AugmentaClientSDK-JS --no-audit --no-fund
npm run build --prefix vendor/AugmentaClientSDK-JS
python3 -m http.server 8000
```

Open `http://localhost:8000`.

## Validation

```bash
for file in src/*.js tests/*.mjs scripts/*.mjs; do
  node --input-type=module --check < "$file"
done

mkdir -p node_modules
ln -s ../vendor/AugmentaClientSDK-JS node_modules/augmenta-client-sdk
node --test tests/*.test.mjs
```

The GitHub Pages build validates the SDK, JavaScript syntax and tests before assembling a self-contained deployment.
