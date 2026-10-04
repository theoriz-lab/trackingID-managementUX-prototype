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

- Desktop and touch/mobile use the same pointer interaction model.
- Click/tap a cluster directly in the **3D view** to select it and open its operator actions.
- Drag a **cluster → ID** from the live-cluster tray to assign it.
- Drag an **ID → cluster** either onto the live-cluster tray or directly onto the cluster in the 3D view.
- Drag an **ID → ID** to swap assignments.
- Tapping/clicking always offers the same actions in the inspector, so drag is never required.
- Occupied-ID reassignment kicks the previous cluster to the next eligible free ID.
- Locked identities reserve their ID while absent.
- An explicit operator assignment has priority over Identity Lock while that override cluster remains present; the locked identity can reclaim its ID after the override leaves.
- If Lock & Learn replaces an older learned identity, its stale identity name is cleared rather than being carried onto the new person.
- Locking an empty slot puts it in a learn state; the next cluster explicitly assigned there becomes the identity.
- **Lock active** locks only currently occupied IDs, leaving spare slots allocatable for the common LBE workflow.
- Selecting an ID or cluster highlights the corresponding tracked person in 3D.
- Slot visuals use a strict operator grammar: gray means empty, an occupied slot inherits the exact live cluster color, enabled empty slots keep a small green activity cue, and disabled slots are visibly muted.
- Lock is a separate visual layer: a closed padlock plus an amber frame. A locked empty/reserved slot stays gray so occupancy and reservation cannot be confused.
- Selection uses a neutral white outline instead of replacing the cluster color. Solo dims non-solo slots, while Manual and Override remain explicit secondary badges.
- Manual takeover uses a direct X/Z touch pad, keeps the tracked cluster association in the background, and draws a separate manual proxy linked to the automatic estimate.
- Keyboard: `L` toggles Lock & Learn, `M` toggles Manual takeover, `Esc` clears the selection.

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
