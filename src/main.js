import { ClusterState } from 'augmenta-client-sdk';
import { APP_VERSION } from './app-info.js';
import { createViewCube } from './view-cube.js';
import { createConnectionController } from './connection.js';
import { createIdInterface } from './id-interface.js';
import { createIdStore } from './id-store.js';
import { createSetupStore } from './setup-store.js';
import { samplePointPreview } from './point-preview.js';
import { readConnectionOptionsFromUrl } from './share-link.js';
import { createViewer } from './viewer.js';

const DISCONNECT_CLEANUP_DELAY_MS = 500;

const DEFAULT_CONNECTION = Object.freeze({
  address: '127.0.0.1',
  port: '6060',
  protocol: 'auto',
  downsample: '1'
});

const viewer = createViewer(document.querySelector('#canvas-host'));
viewer.setVisibility({
  clusters: true,
  points: true,
  scene: true,
  zones: true,
  vectors: false
});

const setupStore = createSetupStore();
let idInterface;
const idStore = createIdStore({
  onChange: (snapshot) => {
    viewer.setOperatorState(snapshot);
    idInterface?.render();
  }
});
idInterface = createIdInterface({ store: idStore });

viewer.setClusterSelectionHandler((key) => idStore.selectCluster(key));
viewer.setClusterDragHandler((event) => idInterface.handle3dClusterDrag(event));
viewer.setOperatorState(idStore.snapshot());

createViewCube(document.querySelector('#view-cube'), viewer);

let hasInitialCameraFrame = false;
let lastSceneLabel = '';
let disconnectCleanupTimer;

function connectionSettings() {
  const shared = readConnectionOptionsFromUrl(window.location.href);
  return { ...DEFAULT_CONNECTION, ...shared };
}

function sceneLabel() {
  const scenes = setupStore.getScenes();
  if (scenes.length === 0) return 'All scenes';
  if (scenes.length === 1) return scenes[0].getName() || 'Scene';
  return `${scenes.length} scenes`;
}

function refreshSceneLabel() {
  const label = sceneLabel();
  if (label === lastSceneLabel) return;
  lastSceneLabel = label;
  idInterface.setScene(label);
}

function setSetup(root) {
  setupStore.setRoot(root);
  viewer.renderSetup(root);
  refreshSceneLabel();
  if (!hasInitialCameraFrame && !viewer.isCameraUserControlled()) {
    viewer.resetCamera();
    hasInitialCameraFrame = true;
  }
}

function applySetupUpdate(container) {
  const root = setupStore.applyUpdate(container);
  if (!root) return;
  viewer.renderSetup(root);
  refreshSceneLabel();
}

function normalizeTrackedObjects(frame) {
  const sceneAddress = frame.getSceneInfo().getAddress() || '';
  return frame.getObjects().flatMap((object, index) => {
    if (!object.hasCluster()) return [];
    const cluster = object.getCluster();
    const sourceId = object.getID();
    const uuid = object.getUUID();
    const objectKey = uuid || `id:${sourceId ?? index}`;

    return [{
      key: `${sceneAddress}|${objectKey}`,
      uuid: uuid || '',
      sourceId,
      ghost: cluster.getState() === ClusterState.Ghost,
      sceneAddress,
      centroid: cluster.getCentroid(),
      size: cluster.getBoundingBoxSize(),
      preview: object.hasPointCloud()
        ? samplePointPreview(object.getPointCloud().getPointsData())
        : []
    }];
  });
}

function handleFrame(frame) {
  const items = normalizeTrackedObjects(frame);
  viewer.renderFrame(frame);
  idStore.syncFrame(items);
  idInterface.updateTracking(items);
}

function handleConnectionState(state) {
  idInterface.setConnectionState(state);
  if (disconnectCleanupTimer) window.clearTimeout(disconnectCleanupTimer);
  disconnectCleanupTimer = undefined;

  if (state?.phase === 'connected' || state?.phase === 'connecting') return;
  if (state?.phase === 'retrying' || state?.phase === 'error') {
    disconnectCleanupTimer = window.setTimeout(() => {
      disconnectCleanupTimer = undefined;
      viewer.clearTracking();
      idStore.syncFrame([]);
      idInterface.updateTracking([]);
    }, DISCONNECT_CLEANUP_DELAY_MS);
  }
}

const connection = createConnectionController({
  getSettings: connectionSettings,
  onState: handleConnectionState,
  onSetup: (message) => setSetup(message.getRootObject()),
  onUpdate: (message) => applySetupUpdate(message.getRootObject()),
  onData: handleFrame
});

connection.start();

window.addEventListener('pagehide', () => {
  connection.stop();
}, { once: true });

console.info(`Augmenta ID Management prototype ${APP_VERSION}`);
