# Augmenta ID Management Interface Prototype

Prototype for the Augmenta ID-management operator interface.

The repository is intentionally based on the Augmenta Three.js example so the prototype consumes the same live Augmenta WebSocket stream through the official JavaScript SDK and displays the real tracking scene while operator workflows are explored.

## Prototype scope

The interface explores four deliberately separate concepts:

- **Cluster → ID assignment** — move a tracked person to a public output ID.
- **Cluster → Identity** — give the tracked person a persistent operator-facing identity/name.
- **Identity ↔ ID lock** — reserve an ID for a learned identity and return it when that identity reappears.
- **Manual takeover** — keep tracking in the background while an operator overrides the published position.

The current operator state is a **front-end prototype only**. Assignments, Lock & Learn, identity names and manual positions are modeled locally in the browser; they are not written back to Pleiades yet. Live cluster position/state comes from the real Augmenta SDK stream.

Identity recognition itself is **not implemented here**: the prototype currently uses the live cluster key/UUID as an identity placeholder so the Lock & Learn UX can be exercised. A production ReID descriptor/matcher will replace that placeholder.

## UX

The current prototype is intentionally **3D-first**. There is no right-side inspector: the live spatial view stays dominant and the left ID list plus bottom live-cluster tray carry the operator workflow.

- **Colors belong to public IDs, not clusters.** IDs use a fixed punchy palette from `src/id-colors.js`; an unassigned cluster is neutral gray. The same ID color is reused in the left capsule, bottom tray and 3D representation.
- The visual pass intentionally follows the approved reference image more closely: ID-colored capsules, selected states, active controls and Manual mode use restrained luminous glows while the panels remain translucent over the 3D scene.
- The left list is a stable slot structure: the **ID number never moves**, clicking it enables/disables that slot, the adjacent **S** button toggles Solo, and only the cluster capsule is draggable between slots.
- A fixed **M** button sits to the right of each slot well. It enters Manual takeover directly; when Manual is active the button and capsule pulse, and pressing **M** again returns smoothly to live tracking.
- An empty slot is a hollow capsule-shaped well. Dropping a cluster capsule into it assigns that cluster to the ID. Dropping on an occupied slot uses the existing operator reassignment/displacement rules.
- The bulk toolbar contains **Lock all active**, **Lock all**, **Unlock all**, and one dynamic **Enable all / Disable all** button. Every bulk operation acts on **visible slots only**.
- **Lock all active** learns/locks only occupied enabled visible IDs. **Lock all** locks every visible slot, including empty slots waiting for their next explicit assignment. **Unlock all** clears lock state on visible slots.
- The header reports both the number of **visible slots** and the number of **active (enabled) visible slots**.
- The cog menu exposes **Strict mode**, **Min ID**, **Max ID**, and **Allow slot deletion**.
  - **Non-strict** overflow clusters wait unassigned and can acquire a slot later when one becomes free.
  - **Strict** matches Pleiades' Assign Cluster IDs semantics: a cluster that enters while all available IDs are occupied is refused for the rest of that tracking lifetime and only becomes eligible after it leaves and re-enters.
  - Changing **Min ID / Max ID** changes the managed slot range itself. IDs outside the new range are removed rather than merely hidden; IDs newly brought into range are new slots.
  - When slot deletion is enabled, a per-slot delete control hides and disables that slot. Deleted slots are excluded from all bulk operations and automatic allocation. Restore makes them visible again but leaves them disabled.
- Every left and bottom cluster capsule shows a small live point-cloud silhouette plus current centroid coordinates `x / y / z`.
- Right-clicking a cluster in the bottom tray opens a compact ID reassignment menu. Identity naming and unassignment are also available there when relevant.
- Clicking/tapping a cluster in the **3D view** selects it. The cluster bounding box, center centroid and a small donut marker projected onto the floor are drawn only for the selected live cluster.
- Assigned clusters use their ID color in 3D; unassigned clusters are gray. A learned identity name is displayed above the matching cluster with the public ID underneath.
- **Solo is a spatial focus mode:** every enabled visible Solo target stays fully legible while non-Solo clusters, point clouds, labels and manual proxies are reduced to only a few percent opacity.
- Dragging an assigned cluster directly in the 3D view starts **Manual takeover**. The pointer is raycast onto the floor, producing an ID-colored sparse-point proxy with a floor centroid/donut. The live tracked source stays gray and loses its selected-cluster decoration.
- During Manual takeover, a dashed line links the floor proxy to the live source centroid. Dragging the 3D cluster onto a left slot can reassign it while preserving the ground takeover position.
- Releasing Manual takeover animates the proxy back toward the live tracked position with a smooth acceleration/deceleration curve rather than jumping.
- Camera orbit uses the **same ViewCube implementation as the Augmenta ThreeJS example**. Drag the cube to orbit, click its faces for orthographic presets, use the ortho preset panel/Tab navigation, and Escape/close to return to perspective. This prototype only adapts the cube visually to remain translucent.
- Direct canvas orbit/pan stays disabled so cluster manipulation owns the 3D pointer gesture.
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
