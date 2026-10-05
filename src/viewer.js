import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ClusterState } from 'augmenta-client-sdk';
import { speedFromVelocity } from './motion.js';
import { createZoneRenderer } from './zones.js';
import { collectZoneAddresses } from './zone-state.js';
import { VIEW_TRANSITION, viewTransitionEase } from './view-transition.js';
import { idColorValue, UNASSIGNED_ID_COLOR_VALUE } from './id-colors.js';
import { deriveOperatorVisualState, operatorLabelForCluster } from './operator-visual-state.js';

const FLOOR_Y = 0;
const PANEL_INSET_ANIMATION_DURATION_MS = 220;
const MIN_GEOMETRY_SIZE = 0.001;
const MIN_ARROW_LENGTH_M = 0.001;
const MIN_VISIBLE_SPEED_MPS = 0.001;
const PERSPECTIVE_MIN_POLAR_ANGLE = THREE.MathUtils.degToRad(2);
const PERSPECTIVE_MAX_POLAR_ANGLE = THREE.MathUtils.degToRad(178.5);
const ORTHOGRAPHIC_MIN_POLAR_ANGLE = 0.001;
const ORTHOGRAPHIC_MAX_POLAR_ANGLE = Math.PI - 0.001;
const CAMERA_NEAR_PLANE = 0.02;
const CAMERA_FAR_PLANE = 1000;
const MIN_CAMERA_DISTANCE = 0.05;
const MAX_CAMERA_DISTANCE = 500;
const MIN_CAMERA_OFFSET_SQ = 1e-8;
const ORTHOGRAPHIC_VIEW_ALIGNMENT_DOT = 0.99999;
const DEFAULT_ORTHO_HALF_WIDTH = 4;
const MIN_CAMERA_ZOOM = 0.05;
const MAX_CAMERA_ZOOM = 50;
const MIN_PROJECTION_ASPECT = 0.1;
const MIN_VIEWPORT_AFTER_INSET_PX = 80;
const PERSPECTIVE_VIEW_ID = 'home'; // Persisted value kept for backward compatibility.
const VIEW_DIRECTIONS = Object.freeze({
  // Three.js right-handed world axes, matching THREE.AxesHelper.
  front: new THREE.Vector3(0, 0, 1),
  back: new THREE.Vector3(0, 0, -1),
  right: new THREE.Vector3(1, 0, 0),
  left: new THREE.Vector3(-1, 0, 0),
  top: new THREE.Vector3(0, 1, 0),
  bottom: new THREE.Vector3(0, -1, 0)
});
const UNASSIGNED_COLOR = new THREE.Color(UNASSIGNED_ID_COLOR_VALUE);
const PICK_MAX_MOVEMENT_PX = 7;
const SELECTED_GLOW_OPACITY = 0.42;
const MANUAL_HITBOX_MIN_XZ_M = 0.38;
const MANUAL_RETURN_DURATION_MS = 680;
const MANUAL_PROXY_POINT_LIMIT = 180;
const LOOK_AT_MARKER_OPACITY = 0.58;
const LOOK_AT_MARKER_GHOST_OPACITY = 0.24;
const SOLO_DIMMED_BOX_OPACITY = 0.035;
const SOLO_DIMMED_POINT_OPACITY = 0.02;
const SOLO_DIMMED_LABEL_OPACITY = 0.025;
const SOLO_DIMMED_VECTOR_OPACITY = 0.025;
const SOLO_DIMMED_CENTROID_OPACITY = 0.035;
const LOCAL_BOX_Z = new THREE.Vector3(0, 0, 1);
export function createViewer(host) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0c0f14);
  scene.fog = new THREE.FogExp2(0x0c0f14, 0.014);

  const perspectiveCamera = new THREE.PerspectiveCamera(
    48,
    1,
    CAMERA_NEAR_PLANE,
    CAMERA_FAR_PLANE
  );
  const orthographicCamera = new THREE.OrthographicCamera(
    -1,
    1,
    1,
    -1,
    CAMERA_NEAR_PLANE,
    CAMERA_FAR_PLANE
  );
  let camera = perspectiveCamera;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  configureControls(controls);

  const grid = new THREE.GridHelper(100, 100, 0x4d5668, 0x252b35);
  grid.material.transparent = true;
  grid.material.opacity = 0.52;
  grid.material.depthWrite = false;
  scene.add(grid, new THREE.AxesHelper(1));

  const setupGroup = namedGroup(scene, 'Augmenta scene setup');
  const clusterGroup = namedGroup(scene, 'Tracked clusters');
  const pointGroup = namedGroup(scene, 'Point clouds');
  const vectorGroup = namedGroup(scene, 'Velocity vectors');
  const labelGroup = namedGroup(scene, 'Object IDs');
  const manualGroup = namedGroup(scene, 'Manual takeover');

  const visibility = {
    clusters: true,
    points: true,
    scene: true,
    zones: true,
    vectors: true
  };

  const views = new Map();
  const manualViews = new Map();
  const raycaster = new THREE.Raycaster();
  const pickPointer = new THREE.Vector2();
  const zoneRenderer = createZoneRenderer();
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const unitBoxEdges = new THREE.EdgesGeometry(unitBox);
  const unitHitBox = unitBox.clone();
  const selectedGlowTexture = makeGlowTexture();
  unitBox.dispose();
  // Integrate the look-at cue into the lower forward edge: a straight edge
  // with a centered outward triangle (___/\\___). The apex is intentionally
  // fairly sharp so direction remains obvious without adding a second arrow.
  const unitLookAtMarker = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-0.5, -0.495, 0.502),
    new THREE.Vector3(-0.12, -0.495, 0.502),
    new THREE.Vector3(0, -0.495, 0.70),
    new THREE.Vector3(0.12, -0.495, 0.502),
    new THREE.Vector3(0.5, -0.495, 0.502)
  ]);
  const centroidGeometry = new THREE.SphereGeometry(0.045, 12, 8);
  const groundDonutGeometry = new THREE.RingGeometry(0.09, 0.145, 36);
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -FLOOR_Y);
  const floorHit = new THREE.Vector3();

  const lookAtDirection = new THREE.Vector3();
  const renderedPositiveZ = new THREE.Vector3();
  const velocityDirection = new THREE.Vector3();
  const homePosition = new THREE.Vector3(0, 2.5, 7.5);
  const homeTarget = new THREE.Vector3(0, 1.2, 0);
  const perspectivePosition = homePosition.clone();
  const perspectiveTarget = homeTarget.clone();
  const cameraOffset = new THREE.Vector3();
  const cameraSpherical = new THREE.Spherical();
  const interactionStartDirection = new THREE.Vector3();
  let homeOrthoHalfWidth = DEFAULT_ORTHO_HALF_WIDTH;
  let orthoHalfWidth = DEFAULT_ORTHO_HALF_WIDTH;
  let leftInset = 0;
  let rightInset = 0;
  let insetAnimationFrame;
  let cameraTransitionFrame;
  let cameraInteractionArmed = false;
  let cameraInteractionActive = false;
  let cameraChangeHandler;
  let viewStateChangeHandler;
  let clusterSelectionHandler;
  let clusterDragHandler;
  let selectedClusterKey = null;
  let soloMode = false;
  let soloSlotIds = new Set();
  let soloClusterKeys = new Set();
  let pickGesture = null;
  let cameraUserControlled = false;
  let activeView = PERSPECTIVE_VIEW_ID;

  function getCameraView() {
    return {
      position: camera.position.toArray(),
      target: controls.target.toArray(),
      mode: camera.isOrthographicCamera ? 'orthographic' : 'perspective',
      zoom: camera.zoom,
      perspectiveZoom: perspectiveCamera.zoom,
      orthoHalfWidth,
      activeView,
      perspectivePosition: perspectivePosition.toArray(),
      perspectiveTarget: perspectiveTarget.toArray(),
      // Legacy keys keep older saved settings forward-compatible.
      isoPosition: perspectivePosition.toArray(),
      isoTarget: perspectiveTarget.toArray()
    };
  }

  function setCameraView(view) {
    const position = validVector3(view?.position);
    const target = validVector3(view?.target);
    if (!position || !target) return false;

    cancelCameraTransition();

    const restoringOrthographic = view?.mode === 'orthographic';
    const savedPerspectivePosition = validVector3(view?.perspectivePosition)
      ?? validVector3(view?.isoPosition);
    const savedPerspectiveTarget = validVector3(view?.perspectiveTarget)
      ?? validVector3(view?.isoTarget);

    if (!restoringOrthographic) {
      // A restored perspective pose is always authoritative.
      perspectivePosition.fromArray(position);
      perspectiveTarget.fromArray(target);
    } else if (savedPerspectivePosition && savedPerspectiveTarget) {
      perspectivePosition.fromArray(savedPerspectivePosition);
      perspectiveTarget.fromArray(savedPerspectiveTarget);
    } else {
      // Old/incomplete orthographic state has no trustworthy return pose.
      perspectivePosition.copy(homePosition);
      perspectiveTarget.copy(homeTarget);
    }

    if (Number.isFinite(view?.orthoHalfWidth) && view.orthoHalfWidth > 0) {
      orthoHalfWidth = view.orthoHalfWidth;
    }

    if (restoringOrthographic && Number.isFinite(view?.zoom) && view.zoom > 0) {
      orthographicCamera.zoom = THREE.MathUtils.clamp(
        view.zoom,
        MIN_CAMERA_ZOOM,
        MAX_CAMERA_ZOOM
      );
    }

    const restoredPerspectiveZoom = Number.isFinite(view?.perspectiveZoom) && view.perspectiveZoom > 0
      ? view.perspectiveZoom
      : !restoringOrthographic && Number.isFinite(view?.zoom) && view.zoom > 0
        ? view.zoom
        : 1;
    perspectiveCamera.zoom = THREE.MathUtils.clamp(
      restoredPerspectiveZoom,
      MIN_CAMERA_ZOOM,
      MAX_CAMERA_ZOOM
    );

    activeView = view?.mode === 'orthographic' && isOrthographicView(view?.activeView)
      ? view.activeView
      : view?.mode === 'orthographic'
        ? 'free'
        : PERSPECTIVE_VIEW_ID;

    switchCamera(view?.mode === 'orthographic' ? 'orthographic' : 'perspective');
    camera.position.fromArray(position);
    controls.target.fromArray(target);
    cameraUserControlled = true;
    updateCameraProjection();
    controls.update();
    notifyViewState();
    return true;
  }

  function setCameraChangeHandler(handler) {
    cameraChangeHandler = typeof handler === 'function' ? handler : undefined;
  }

  function setViewStateChangeHandler(handler) {
    viewStateChangeHandler = typeof handler === 'function' ? handler : undefined;
    notifyViewState();
  }

  function isCameraUserControlled() {
    return cameraUserControlled;
  }

  function currentViewState() {
    cameraOffset.copy(camera.position).sub(controls.target);
    if (cameraOffset.lengthSq() < MIN_CAMERA_OFFSET_SQ) {
      return {
        activeView,
        mode: camera.isOrthographicCamera ? 'orthographic' : 'perspective',
        interacting: cameraInteractionActive,
        cubeYaw: 0,
        cubeTransform: 'rotateX(0deg) rotateY(0deg) rotateZ(0deg)'
      };
    }

    cameraSpherical.setFromVector3(cameraOffset);
    const x = Math.round((THREE.MathUtils.radToDeg(cameraSpherical.phi) - 90) * 10) / 10;
    // Match Three.js' right-handed axes directly: +Z is Front, +X is Right.
    // CSS needs the inverse camera azimuth to bring that world-facing cube
    // side toward the viewer.
    const yaw = normalizeDegrees(-THREE.MathUtils.radToDeg(cameraSpherical.theta));
    const y = Math.round(yaw * 10) / 10;
    return {
      activeView,
      mode: camera.isOrthographicCamera ? 'orthographic' : 'perspective',
      interacting: cameraInteractionActive,
      cubeYaw: y,
      cubeTransform: `rotateX(${x}deg) rotateY(${y}deg) rotateZ(0deg)`
    };
  }

  function notifyViewState() {
    viewStateChangeHandler?.(currentViewState());
  }

  function cancelCameraTransition() {
    if (cameraTransitionFrame) cancelAnimationFrame(cameraTransitionFrame);
    cameraTransitionFrame = undefined;
  }

  function configureProjectionControls() {
    controls.minPolarAngle = camera.isOrthographicCamera
      ? ORTHOGRAPHIC_MIN_POLAR_ANGLE
      : PERSPECTIVE_MIN_POLAR_ANGLE;
    controls.maxPolarAngle = camera.isOrthographicCamera
      ? ORTHOGRAPHIC_MAX_POLAR_ANGLE
      : PERSPECTIVE_MAX_POLAR_ANGLE;
  }

  function switchCamera(mode) {
    const nextCamera = mode === 'orthographic' ? orthographicCamera : perspectiveCamera;
    if (camera === nextCamera) {
      configureProjectionControls();
      updateCameraProjection();
      return;
    }

    nextCamera.position.copy(camera.position);
    nextCamera.quaternion.copy(camera.quaternion);
    nextCamera.up.copy(camera.up);
    camera = nextCamera;
    controls.object = camera;
    configureProjectionControls();
    updateCameraProjection();
  }

  function animateCameraTo(
    position,
    target,
    {
      mode,
      duration = VIEW_TRANSITION.durationMs,
      path = 'orbit',
      easing = easeOutQuint,
      targetOrthoHalfWidth
    }
  ) {
    cancelCameraTransition();

    const startPosition = camera.position.clone();
    const startTarget = controls.target.clone();
    const startOffset = startPosition.clone().sub(startTarget);
    const endOffset = position.clone().sub(target);
    const canOrbit = path === 'orbit'
      && startOffset.lengthSq() > MIN_CAMERA_OFFSET_SQ
      && endOffset.lengthSq() > MIN_CAMERA_OFFSET_SQ;
    const animatedTarget = new THREE.Vector3();
    const animatedOffset = new THREE.Vector3();
    const animatedSpherical = new THREE.Spherical();
    const startSpherical = canOrbit
      ? new THREE.Spherical().setFromVector3(startOffset)
      : undefined;
    const endSpherical = canOrbit
      ? new THREE.Spherical().setFromVector3(endOffset)
      : undefined;
    const thetaDelta = canOrbit
      ? shortestAngleDelta(startSpherical.theta, endSpherical.theta)
      : 0;
    const startOrthoHalfWidth = orthoHalfWidth;
    const animateOrthoFraming = mode === 'orthographic'
      && Number.isFinite(targetOrthoHalfWidth)
      && targetOrthoHalfWidth > 0;

    switchCamera(mode);
    camera.position.copy(startPosition);
    controls.target.copy(startTarget);

    cameraUserControlled = true;
    notifyViewState();
    if (duration <= 0) {
      camera.position.copy(position);
      controls.target.copy(target);
      if (animateOrthoFraming) {
        orthoHalfWidth = targetOrthoHalfWidth;
        updateCameraProjection();
      }
      controls.update();
      cameraTransitionFrame = undefined;
      notifyViewState();
      return;
    }

    const startedAt = performance.now();
    const tick = (now) => {
      const t = Math.min((now - startedAt) / duration, 1);
      const progress = easing(t);
      animatedTarget.lerpVectors(startTarget, target, progress);

      if (canOrbit) {
        animatedSpherical.radius = THREE.MathUtils.lerp(
          startSpherical.radius,
          endSpherical.radius,
          progress
        );
        animatedSpherical.phi = THREE.MathUtils.lerp(
          startSpherical.phi,
          endSpherical.phi,
          progress
        );
        animatedSpherical.theta = startSpherical.theta + thetaDelta * progress;
        animatedOffset.setFromSpherical(animatedSpherical);
        camera.position.copy(animatedTarget).add(animatedOffset);
      } else {
        camera.position.lerpVectors(startPosition, position, progress);
      }

      controls.target.copy(animatedTarget);
      if (animateOrthoFraming) {
        orthoHalfWidth = THREE.MathUtils.lerp(
          startOrthoHalfWidth,
          targetOrthoHalfWidth,
          progress
        );
        updateCameraProjection();
      }
      controls.update();
      notifyViewState();

      if (t < 1) {
        cameraTransitionFrame = requestAnimationFrame(tick);
        return;
      }

      cameraTransitionFrame = undefined;
      camera.position.copy(position);
      controls.target.copy(target);
      if (animateOrthoFraming) {
        orthoHalfWidth = targetOrthoHalfWidth;
        updateCameraProjection();
      }
      controls.update();
      notifyViewState();
    };

    cameraTransitionFrame = requestAnimationFrame(tick);
  }

  function returnToPerspective() {
    activeView = PERSPECTIVE_VIEW_ID;

    if (camera.isPerspectiveCamera && !cameraTransitionFrame) {
      rememberPerspectiveView();
      notifyViewState();
      return false;
    }

    animateCameraTo(
      perspectivePosition.clone(),
      perspectiveTarget.clone(),
      {
        mode: 'perspective',
        duration: VIEW_TRANSITION.durationMs,
        path: 'direct',
        easing: viewTransitionEase
      }
    );
    return true;
  }

  function leaveOrthographicFromCurrentView() {
    if (!camera.isOrthographicCamera) return false;

    const offset = camera.position.clone().sub(controls.target);
    const distance = offset.length();
    if (distance * distance < MIN_CAMERA_OFFSET_SQ) return false;

    const orthoHalfHeight = (orthoHalfWidth / Math.max(orthographicCamera.zoom, MIN_CAMERA_ZOOM))
      / projectionMetrics().aspect;
    const perspectiveHalfAngle = THREE.MathUtils.degToRad(perspectiveCamera.fov) / 2;

    // Pleiades drives orthographic framing from the ArcRotate camera radius.
    // Preserve that radius/target and match the perspective scale optically,
    // so leaving Ortho does not move the camera in or out.
    perspectiveCamera.zoom = THREE.MathUtils.clamp(
      distance * Math.tan(perspectiveHalfAngle) / Math.max(orthoHalfHeight, MIN_CAMERA_ZOOM),
      MIN_CAMERA_ZOOM,
      MAX_CAMERA_ZOOM
    );

    cancelCameraTransition();
    activeView = PERSPECTIVE_VIEW_ID;
    switchCamera('perspective');
    cameraUserControlled = true;
    controls.update();
    rememberPerspectiveView();
    notifyViewState();
    return true;
  }

  function setOrthographicView(view, { duration = VIEW_TRANSITION.durationMs } = {}) {
    if (!isOrthographicView(view)) return false;

    const enteringFromPerspective = camera.isPerspectiveCamera;
    if (enteringFromPerspective) rememberPerspectiveView();

    activeView = view;
    const direction = VIEW_DIRECTIONS[view];
    const target = homeTarget.clone();
    const distance = Math.max(homePosition.distanceTo(homeTarget), 2);
    const position = target.clone().addScaledVector(direction, distance);
    const targetOrthoHalfWidth = homeOrthoHalfWidth;

    orthographicCamera.zoom = 1;

    if (enteringFromPerspective) {
      // Match the first Ortho frame to the current perspective framing. From
      // there, Pleiades-style direct position/target motion and the shared
      // ViewCube easing carry both camera and framing to the face preset.
      const currentDistance = camera.position.distanceTo(controls.target);
      const perspectiveHalfHeight = currentDistance
        * Math.tan(THREE.MathUtils.degToRad(perspectiveCamera.fov) / 2)
        / Math.max(perspectiveCamera.zoom, MIN_CAMERA_ZOOM);
      orthoHalfWidth = Math.max(
        perspectiveHalfHeight * projectionMetrics().aspect,
        MIN_CAMERA_ZOOM
      );
    } else {
      orthoHalfWidth = targetOrthoHalfWidth;
    }

    animateCameraTo(position, target, {
      mode: 'orthographic',
      duration: enteringFromPerspective ? duration : 0,
      path: 'direct',
      easing: viewTransitionEase,
      targetOrthoHalfWidth
    });
    return true;
  }

  function orbitCamera(deltaAzimuth, deltaPolar) {
    if (!Number.isFinite(deltaAzimuth) || !Number.isFinite(deltaPolar)) return false;
    if (deltaAzimuth === 0 && deltaPolar === 0) return true;
    if (cameraTransitionFrame || camera.isOrthographicCamera) return false;

    cameraOffset.copy(camera.position).sub(controls.target);
    if (cameraOffset.lengthSq() < MIN_CAMERA_OFFSET_SQ) return false;

    cameraSpherical.setFromVector3(cameraOffset);
    cameraSpherical.theta += deltaAzimuth;
    cameraSpherical.phi = THREE.MathUtils.clamp(
      cameraSpherical.phi + deltaPolar,
      controls.minPolarAngle,
      controls.maxPolarAngle
    );

    cameraOffset.setFromSpherical(cameraSpherical);
    camera.position.copy(controls.target).add(cameraOffset);
    cameraUserControlled = true;
    activeView = PERSPECTIVE_VIEW_ID;
    controls.update();
    return true;
  }

  function rememberPerspectiveView() {
    if (!camera.isPerspectiveCamera) return;
    perspectivePosition.copy(camera.position);
    perspectiveTarget.copy(controls.target);
  }

  function syncManualViewState() {
    if (camera.isPerspectiveCamera) {
      activeView = PERSPECTIVE_VIEW_ID;
      rememberPerspectiveView();
      return;
    }

    cameraOffset.copy(camera.position).sub(controls.target);
    if (cameraOffset.lengthSq() < MIN_CAMERA_OFFSET_SQ) return;
    cameraOffset.normalize();

    // Pan and zoom preserve direction and stay in Ortho. The first real orbit
    // transitions from the current Ortho framing into its matching perspective view.
    if (
      interactionStartDirection.lengthSq() >= MIN_CAMERA_OFFSET_SQ
      && cameraOffset.dot(interactionStartDirection) < ORTHOGRAPHIC_VIEW_ALIGNMENT_DOT
    ) {
      cameraInteractionArmed = false;
      interactionStartDirection.set(0, 0, 0);
      leaveOrthographicFromCurrentView();
    }
  }

  function beginCameraInteraction() {
    cancelCameraTransition();

    // OrbitControls damping can keep producing small camera changes after a
    // drag. Flush that residual motion before arming a new gesture, otherwise
    // a later click with no movement can briefly reveal the folded ViewCube.
    const dampingEnabled = controls.enableDamping;
    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = dampingEnabled;

    cameraInteractionArmed = true;
    cameraUserControlled = true;

    interactionStartDirection.set(0, 0, 0);
    if (camera.isOrthographicCamera) {
      cameraOffset.copy(camera.position).sub(controls.target);
      if (cameraOffset.lengthSq() >= MIN_CAMERA_OFFSET_SQ) {
        interactionStartDirection.copy(cameraOffset).normalize();
      }
    }
  }

  function endCameraInteraction() {
    const wasActive = cameraInteractionActive;
    cameraInteractionArmed = false;
    cameraInteractionActive = false;

    // An Ortho -> perspective transition already owns the camera pose. Do not
    // snapshot an intermediate animation frame as the new perspective history
    // when the pointer is released before that transition has finished.
    if (wasActive && !cameraTransitionFrame) syncManualViewState();
    interactionStartDirection.set(0, 0, 0);
    if (wasActive) notifyViewState();
  }

  controls.addEventListener('start', beginCameraInteraction);
  controls.addEventListener('end', endCameraInteraction);
  controls.addEventListener('change', () => {
    // A pointer-down only arms the interaction. The ViewCube becomes visible
    // only after OrbitControls reports an actual camera change, so a simple
    // click with no movement never flashes the folded ViewCube.
    if (!cameraTransitionFrame) {
      if (cameraInteractionArmed) cameraInteractionActive = true;
      syncManualViewState();
      notifyViewState();
    }
    cameraChangeHandler?.(getCameraView());
  });

  function resetCamera() {
    cancelCameraTransition();
    cameraInteractionArmed = false;
    cameraInteractionActive = false;
    cameraUserControlled = false;
    activeView = PERSPECTIVE_VIEW_ID;
    perspectiveCamera.zoom = 1;
    switchCamera('perspective');
    camera.position.copy(homePosition);
    controls.target.copy(homeTarget);
    perspectivePosition.copy(homePosition);
    perspectiveTarget.copy(homeTarget);
    controls.update();
    notifyViewState();
  }

  function projectionMetrics() {
    const width = Math.max(host.clientWidth, 1);
    const height = Math.max(host.clientHeight, 1);
    const horizontalInset = leftInset + rightInset;
    const hasInset = horizontalInset > 0 && width > horizontalInset + MIN_VIEWPORT_AFTER_INSET_PX;
    const virtualWidth = hasInset ? width + horizontalInset : width;

    return {
      width,
      height,
      hasInset,
      virtualWidth,
      viewOffsetX: hasInset ? rightInset : 0,
      aspect: Math.max(virtualWidth / height, MIN_PROJECTION_ASPECT)
    };
  }

  function updateCameraProjection() {
    const { width, height, hasInset, virtualWidth, viewOffsetX, aspect } = projectionMetrics();

    camera.clearViewOffset();
    if (camera.isPerspectiveCamera) {
      camera.aspect = aspect;
    } else {
      const halfHeight = orthoHalfWidth / aspect;
      camera.left = -orthoHalfWidth;
      camera.right = orthoHalfWidth;
      camera.top = halfHeight;
      camera.bottom = -halfHeight;
    }
    camera.updateProjectionMatrix();

    if (hasInset) {
      camera.setViewOffset(virtualWidth, height, viewOffsetX, 0, width, height);
    }
  }

  function updateLineMaterialResolution(
    width = Math.max(host.clientWidth, 1),
    height = Math.max(host.clientHeight, 1)
  ) {
    setupGroup.traverse((object) => {
      if (object.material?.isLineMaterial) object.material.resolution.set(width, height);
    });
  }

  function resize() {
    const width = Math.max(host.clientWidth, 1);
    const height = Math.max(host.clientHeight, 1);
    renderer.setSize(width, height, false);
    updateLineMaterialResolution(width, height);
    updateCameraProjection();
  }

  function setLeftInset(value, animate = false) {
    const target = Math.max(0, Number(value) || 0);
    if (insetAnimationFrame) cancelAnimationFrame(insetAnimationFrame);

    if (!animate) {
      leftInset = target;
      updateCameraProjection();
      return;
    }

    const start = leftInset;
    const startedAt = performance.now();
    const duration = PANEL_INSET_ANIMATION_DURATION_MS;

    const tick = (now) => {
      const t = Math.min((now - startedAt) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      leftInset = start + (target - start) * eased;
      updateCameraProjection();
      if (t < 1) insetAnimationFrame = requestAnimationFrame(tick);
      else insetAnimationFrame = undefined;
    };

    insetAnimationFrame = requestAnimationFrame(tick);
  }

  function setRightInset(value, animate = false) {
    const target = Math.max(0, Number(value) || 0);
    if (insetAnimationFrame) cancelAnimationFrame(insetAnimationFrame);

    if (!animate) {
      rightInset = target;
      updateCameraProjection();
      return;
    }

    const start = rightInset;
    const startedAt = performance.now();
    const duration = PANEL_INSET_ANIMATION_DURATION_MS;

    const tick = (now) => {
      const t = Math.min((now - startedAt) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      rightInset = start + (target - start) * eased;
      updateCameraProjection();
      if (t < 1) insetAnimationFrame = requestAnimationFrame(tick);
      else insetAnimationFrame = undefined;
    };

    insetAnimationFrame = requestAnimationFrame(tick);
  }

  function renderFrame(frame) {
    const sceneAddress = frame.getSceneInfo().getAddress() || '';
    const active = new Set();

    frame.getObjects().forEach((object, index) => {
      const id = object.getID();
      const uuid = object.getUUID();
      // IDs can repeat across scenes. Prefix by scene so "All scenes" can keep
      // multiple live scenes visible without one frame deleting another.
      const objectKey = uuid || `id:${id ?? index}`;
      const key = `${sceneAddress}|${objectKey}`;
      active.add(key);

      const view = views.get(key) || createObjectView(key, id, sceneAddress);
      views.set(key, view);

      if (object.hasCluster()) {
        updateLabel(view, id, uuid);
        updateCluster(view, object.getCluster());
      } else {
        view.label.visible = false;
        hideCluster(view);
      }

      if (object.hasPointCloud()) updatePoints(view, object.getPointCloud());
      else view.points.visible = false;
    });

    for (const [key, view] of views) {
      if (view.sceneAddress === sceneAddress && !active.has(key)) {
        disposeView(view);
        views.delete(key);
      }
    }

    refreshManualLinks();
    zoneRenderer.update(frame.getZoneEvents());
  }

  function createObjectView(key, id, sceneAddress) {
    const color = UNASSIGNED_COLOR.clone();
    const box = new THREE.LineSegments(
      unitBoxEdges,
      new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0
      })
    );

    const hitbox = new THREE.Mesh(
      unitHitBox,
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
        colorWrite: false
      })
    );
    hitbox.userData.clusterKey = key;
    box.add(hitbox);

    const lookAtMarker = new THREE.Line(
      unitLookAtMarker,
      new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false
      })
    );
    lookAtMarker.name = 'Look-at marker';
    lookAtMarker.userData.hasDirection = false;
    lookAtMarker.visible = false;
    lookAtMarker.renderOrder = 5;
    box.add(lookAtMarker);

    const centroid = new THREE.Mesh(
      centroidGeometry,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0 })
    );

    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: selectedGlowTexture,
        color,
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    );
    glow.visible = false;
    glow.renderOrder = 8;

    const groundDonut = new THREE.Mesh(
      groundDonutGeometry,
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide
      })
    );
    groundDonut.rotation.x = -Math.PI / 2;
    groundDonut.renderOrder = 9;

    const velocity = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(),
      MIN_ARROW_LENGTH_M,
      color.getHex(),
      0.12,
      0.07
    );
    configureArrow(velocity);

    const points = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({
        color,
        size: 0.03,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.70
      })
    );
    points.frustumCulled = false;

    const label = createLabelSprite(id === undefined ? '' : String(id), color);
    label.visible = id !== undefined;

    clusterGroup.add(box, centroid, glow, groundDonut);
    vectorGroup.add(velocity);
    pointGroup.add(points);
    labelGroup.add(label);

    return {
      key,
      box,
      hitbox,
      lookAtMarker,
      centroid,
      glow,
      groundDonut,
      velocity,
      points,
      label,
      labelText: id === undefined ? '' : String(id),
      labelColorHex: color.getHex(),
      sourceId: id,
      uuid: '',
      operatorStateReady: false,
      operatorId: null,
      operatorLabelText: '',
      assignedId: null,
      manualSource: false,
      clusterState: null,
      color,
      sceneAddress
    };
  }

  function updateLabel(view, id, uuid) {
  view.sourceId = id;
  view.uuid = uuid || '';
  const labelText = view.operatorStateReady
    ? view.operatorLabelText
    : id !== undefined ? String(id) : uuid ? uuid.slice(0, 8) : '';
  if (!labelText) {
    view.label.visible = false;
    return;
  }

  if (view.labelText !== labelText) {
    replaceLabelTexture(view.label, labelText, view.color);
    view.labelText = labelText;
  }
  view.label.visible = true;
}

  function updateCluster(view, cluster) {
    const center = cluster.getBoundingBoxCenter();
    const size = cluster.getBoundingBoxSize();
    const centroid = cluster.getCentroid();
    const velocity = cluster.getVelocity();
    const rotation = cluster.getBoundingBoxRotationQuaternions();

    view.box.visible = true;
    view.box.position.fromArray(center);
    view.box.scale.set(
      Math.max(Math.abs(size[0]), MIN_GEOMETRY_SIZE),
      Math.max(Math.abs(size[1]), MIN_GEOMETRY_SIZE),
      Math.max(Math.abs(size[2]), MIN_GEOMETRY_SIZE)
    );
    // Pleiades sends its native Y-up/left-handed quaternion. Reflect it across
    // Z to express the exact same orientation in Three.js' right-handed space.
    setLeftHandedQuaternion(view.box.quaternion, rotation);
    updateLookAtMarker(view, cluster.getLookAt());

    view.centroid.position.fromArray(centroid);
    view.glow.position.fromArray(centroid);
    const glowSize = Math.max(Math.abs(size[0]), Math.abs(size[1]), Math.abs(size[2]), 0.6) * 1.35;
    view.glow.scale.set(glowSize, glowSize, 1);
    view.groundDonut.position.set(centroid[0], FLOOR_Y + 0.012, centroid[2]);

    updateVelocity(view.velocity, center, velocity, view.color, velocityDirection);

    const state = cluster.getState();
    view.clusterState = state;
    applyInteractionStyle(view);

    const pointBounds = view.points.geometry.boundingSphere ?? new THREE.Sphere();
    pointBounds.center.fromArray(center);
    pointBounds.radius = Math.max(
      Math.hypot(Math.abs(size[0]), Math.abs(size[1]), Math.abs(size[2])) * 0.5,
      MIN_GEOMETRY_SIZE
    );
    view.points.geometry.boundingSphere = pointBounds;
    view.points.frustumCulled = true;

    const top = center[1] + Math.abs(size[1]) * 0.5 + 0.18;
    view.label.position.set(center[0], Math.max(top, FLOOR_Y + 0.16), center[2]);
  }

  function applyInteractionStyle(view) {
    if (view.clusterState === null) return;
    const selected = view.key === selectedClusterKey;
    const soloDimmed = soloMode && !soloClusterKeys.has(view.key);
    const selectedLive = selected && !view.manualSource;
    const color = view.manualSource ? UNASSIGNED_COLOR : view.color;
    const ghostFactor = view.clusterState === ClusterState.Ghost ? 0.55 : 1;

    view.box.material.color.copy(color);
    view.lookAtMarker.material.color.copy(color);
    view.centroid.material.color.copy(color);
    view.glow.material.color.copy(color);
    view.groundDonut.material.color.copy(color);
    view.velocity.setColor(color);
    view.points.material.color.copy(color);

    view.box.visible = true;
    view.box.material.opacity = selectedLive
      ? soloDimmed ? SOLO_DIMMED_BOX_OPACITY : ghostFactor
      : 0;
    view.centroid.visible = selectedLive;
    view.centroid.material.opacity = selectedLive
      ? soloDimmed ? SOLO_DIMMED_CENTROID_OPACITY : ghostFactor
      : 0;
    view.glow.visible = selectedLive && !soloDimmed;
    view.glow.material.opacity = view.glow.visible ? SELECTED_GLOW_OPACITY * ghostFactor : 0;
    view.groundDonut.visible = selectedLive;
    view.groundDonut.material.opacity = selectedLive
      ? soloDimmed ? SOLO_DIMMED_CENTROID_OPACITY : 0.9 * ghostFactor
      : 0;

    view.lookAtMarker.visible = selectedLive
      && visibility.vectors
      && view.lookAtMarker.userData.hasDirection;
    view.lookAtMarker.material.opacity = view.lookAtMarker.visible
      ? soloDimmed ? SOLO_DIMMED_VECTOR_OPACITY : LOOK_AT_MARKER_OPACITY * ghostFactor
      : 0;

    view.points.material.opacity = soloDimmed
      ? SOLO_DIMMED_POINT_OPACITY
      : view.manualSource ? 0.38 : selected ? 1 : 0.72 * ghostFactor;
    view.points.material.size = selectedLive ? 0.042 : 0.03;
    view.label.material.opacity = soloDimmed
      ? SOLO_DIMMED_LABEL_OPACITY
      : view.manualSource ? 0.44 : 0.92 * ghostFactor;
    setArrowOpacity(
      view.velocity,
      selectedLive && visibility.vectors
        ? soloDimmed ? SOLO_DIMMED_VECTOR_OPACITY : 0.95
        : 0
    );
    view.centroid.scale.setScalar(1);
  }

  function refreshInteractionStyles() {
    for (const view of views.values()) applyInteractionStyle(view);
  }

  function updateLookAtMarker(view, lookAt) {
    if (!validVector3(lookAt)) {
      view.lookAtMarker.userData.hasDirection = false;
      view.lookAtMarker.visible = false;
      return;
    }

    lookAtDirection.fromArray(lookAt);
    if (lookAtDirection.lengthSq() < 1e-8) {
      view.lookAtMarker.userData.hasDirection = false;
      view.lookAtMarker.visible = false;
      return;
    }
    lookAtDirection.normalize();

    // Pleiades streams look-at separately from the raw OBB quaternion. Compare
    // both after the viewer's handedness conversion, then flip the bottom
    // chevron so its tip points toward the corresponding local Z face.
    renderedPositiveZ.copy(LOCAL_BOX_Z)
      .applyQuaternion(view.box.quaternion)
      .normalize();
    const side = renderedPositiveZ.dot(lookAtDirection) >= 0 ? 1 : -1;

    view.lookAtMarker.scale.set(1, 1, side);
    view.lookAtMarker.userData.hasDirection = true;
    view.lookAtMarker.visible = visibility.vectors
      && view.key === selectedClusterKey
      && !view.manualSource;
  }

  function updatePoints(view, cloud) {
    const data = cloud.getPointsData();
    const position = view.points.geometry.getAttribute('position');

    if (position && position.array.length === data.length) {
      position.array.set(data);
      position.needsUpdate = true;
    } else {
      const nextPosition = new THREE.BufferAttribute(data, 3);
      nextPosition.setUsage(THREE.DynamicDrawUsage);
      view.points.geometry.setAttribute('position', nextPosition);
    }

    view.points.visible = data.length > 0;
  }

  function hideCluster(view) {
    view.box.visible = false;
    view.centroid.visible = false;
    view.glow.visible = false;
    view.groundDonut.visible = false;
    view.velocity.visible = false;
    view.points.frustumCulled = false;
  }

  function pickClusterAt(clientX, clientY) {
    if (!visibility.clusters) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    if (
      clientX < rect.left || clientX > rect.right
      || clientY < rect.top || clientY > rect.bottom
      || rect.width <= 0 || rect.height <= 0
    ) {
      return null;
    }

    pickPointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    scene.updateMatrixWorld(true);
    raycaster.setFromCamera(pickPointer, camera);
    const hitboxes = [...views.values()]
      .filter((view) => view.clusterState !== null)
      .map((view) => view.hitbox);
    const hit = raycaster.intersectObjects(hitboxes, false)[0];
    return hit?.object?.userData?.clusterKey ?? null;
  }

  function pickSceneTargetAt(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    if (
      clientX < rect.left || clientX > rect.right
      || clientY < rect.top || clientY > rect.bottom
      || rect.width <= 0 || rect.height <= 0
    ) {
      return null;
    }

    pickPointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    scene.updateMatrixWorld(true);
    raycaster.setFromCamera(pickPointer, camera);

    const manualHit = raycaster.intersectObjects(
      [...manualViews.values()]
        .filter((view) => !view.returning)
        .map((view) => view.hitbox),
      false
    )[0];
    if (manualHit) {
      return {
        kind: 'manual',
        id: manualHit.object.userData.manualId,
        key: manualHit.object.userData.clusterKey ?? null
      };
    }

    const liveHit = raycaster.intersectObjects(
      [...views.values()]
        .filter((view) => view.clusterState !== null)
        .map((view) => view.hitbox),
      false
    )[0];
    return liveHit
      ? { kind: 'cluster', id: null, key: liveHit.object.userData.clusterKey ?? null }
      : null;
  }

  function setClusterSelectionHandler(handler) {
    clusterSelectionHandler = typeof handler === 'function' ? handler : undefined;
  }

  function setClusterDragHandler(handler) {
    clusterDragHandler = typeof handler === 'function' ? handler : undefined;
  }

  function raycastFloor(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    pickPointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    raycaster.setFromCamera(pickPointer, camera);
    const hit = raycaster.ray.intersectPlane(floorPlane, floorHit);
    return hit ? [floorHit.x, FLOOR_Y, floorHit.z] : null;
  }

  function setOperatorState(snapshot) {
    const slots = snapshot?.slots ?? [];
    const clusters = snapshot?.clusters ?? [];
    const selected = snapshot?.selected ?? null;
    const operatorVisualState = deriveOperatorVisualState(slots);
    const slotByCluster = operatorVisualState.slotByCluster;
    soloMode = operatorVisualState.soloMode;
    soloSlotIds = operatorVisualState.soloSlotIds;
    soloClusterKeys = operatorVisualState.soloClusterKeys;

    selectedClusterKey = selected?.type === 'cluster'
      ? selected.key
      : selected?.type === 'id'
        ? slots.find((slot) => slot.id === selected.id)?.clusterKey ?? null
        : null;

    for (const view of views.values()) {
      const slot = slotByCluster.get(view.key);
      const nextColor = slot ? idColorValue(slot.id) : UNASSIGNED_ID_COLOR_VALUE;
      const colorChanged = view.color.getHex() !== nextColor;
      const wasManualSource = view.manualSource;
      view.color.setHex(nextColor);
      view.assignedId = slot?.id ?? null;
      view.manualSource = Boolean(slot?.manual);
      view.operatorStateReady = true;
      view.operatorId = slot?.id ?? null;
      view.operatorLabelText = operatorLabelForCluster(slot, view.key);
      if ((colorChanged || wasManualSource !== view.manualSource) && view.labelText) {
        const labelColor = view.manualSource ? UNASSIGNED_COLOR : view.color;
        replaceLabelTexture(view.label, view.labelText, labelColor);
        view.labelColorHex = labelColor.getHex();
      }
      updateLabel(view, view.sourceId, view.uuid);
    }

    syncManualViews(slots, clusters);
    refreshInteractionStyles();
  }

  function syncManualViews(slots, clusters) {
    const clusterByKey = new Map(clusters.map((cluster) => [cluster.key, cluster]));
    const active = new Set();

    for (const slot of slots) {
      if (!slot.manual) continue;
      active.add(slot.id);
      let view = manualViews.get(slot.id);
      if (!view) {
        view = createManualView(slot.id);
        manualViews.set(slot.id, view);
      }

      view.returning = false;
      if (view.returnFrame) {
        cancelAnimationFrame(view.returnFrame);
        view.returnFrame = undefined;
      }
      view.clusterKey = slot.clusterKey;
      view.hitbox.userData.clusterKey = slot.clusterKey;
      view.color.setHex(idColorValue(slot.id));
      setManualViewColor(view, view.color);
      const source = slot.clusterKey ? views.get(slot.clusterKey) : null;
      updateManualSilhouette(view, source);
      view.group.position.set(slot.manualPosition[0], FLOOR_Y + 0.016, slot.manualPosition[2]);
      view.label.position.set(0, manualProxyHeight(view) + 0.16, 0);
      applyManualSoloStyle(
        view,
        soloMode && !soloSlotIds.has(slot.id),
        Boolean(slot.clusterKey && slot.clusterKey === selectedClusterKey)
      );
      updateManualLink(view);
    }

    for (const [id, view] of manualViews) {
      if (active.has(id) || view.returning) continue;
      const source = view.clusterKey ? views.get(view.clusterKey) : null;
      if (source?.centroid) {
        source.manualSource = true;
        if (source.labelText) {
          replaceLabelTexture(source.label, source.labelText, UNASSIGNED_COLOR);
          source.labelColorHex = UNASSIGNED_COLOR.getHex();
        }
        applyInteractionStyle(source);
        startManualReturn(view, source);
      }
      else {
        disposeManualView(view);
        manualViews.delete(id);
      }
    }
  }

  function createManualView(id) {
    const color = new THREE.Color(idColorValue(id));
    const group = new THREE.Group();
    group.name = `Manual ID ${id}`;

    const points = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({
        color,
        size: 0.035,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.95,
        depthTest: false
      })
    );
    points.renderOrder = 9;

    const centroid = new THREE.Mesh(
      centroidGeometry,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: false })
    );
    centroid.position.y = 0.035;
    centroid.renderOrder = 10;

    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: selectedGlowTexture,
        color,
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    );
    glow.visible = false;
    glow.renderOrder = 8;

    const hitbox = new THREE.Mesh(
      unitHitBox,
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
        colorWrite: false
      })
    );
    hitbox.userData.manualId = id;

    const donut = new THREE.Mesh(
      groundDonutGeometry,
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide
      })
    );
    donut.rotation.x = -Math.PI / 2;
    donut.renderOrder = 10;

    const link = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineDashedMaterial({
        color,
        transparent: true,
        opacity: 0.68,
        dashSize: 0.12,
        gapSize: 0.075,
        depthTest: false
      })
    );
    link.renderOrder = 8;

    const label = createLabelSprite(`ID ${id} · Manual`, color);
    label.renderOrder = 11;
    group.add(points, centroid, glow, hitbox, donut, label);
    manualGroup.add(group, link);

    return {
      id,
      clusterKey: null,
      group,
      points,
      centroid,
      glow,
      hitbox,
      donut,
      link,
      label,
      color,
      proxyHeight: 1.6,
      returning: false,
      returnFrame: undefined
    };
  }

  function setManualViewColor(view, color) {
    view.points.material.color.copy(color);
    view.centroid.material.color.copy(color);
    view.glow.material.color.copy(color);
    view.donut.material.color.copy(color);
    view.link.material.color.copy(color);
    if (view.label.userData.colorHex !== color.getHex()) {
      replaceLabelTexture(view.label, `ID ${view.id} · Manual`, color);
      view.label.userData.colorHex = color.getHex();
    }
  }

  function manualProxyHeight(view) {
    return Math.max(view.proxyHeight || 1.6, 0.4);
  }

  function updateManualSilhouette(view, source) {
    const sourcePosition = source?.points?.geometry?.getAttribute('position');
    const sourceCentroid = source?.centroid?.position;
    if (!sourcePosition || !sourceCentroid || sourcePosition.count <= 0) {
      view.points.visible = false;
      view.proxyHeight = 1.6;
      view.hitbox.position.set(0, 0.8, 0);
      view.hitbox.scale.set(MANUAL_HITBOX_MIN_XZ_M, 1.6, MANUAL_HITBOX_MIN_XZ_M);
      view.glow.position.set(0, 0.8, 0);
      view.glow.scale.set(1.8, 1.8, 1);
      return;
    }

    const step = Math.max(1, Math.ceil(sourcePosition.count / MANUAL_PROXY_POINT_LIMIT));
    const sampled = [];
    let minY = Infinity;
    let maxY = -Infinity;
    for (let index = 0; index < sourcePosition.count; index += step) {
      const x = sourcePosition.getX(index);
      const y = sourcePosition.getY(index);
      const z = sourcePosition.getZ(index);
      sampled.push([x, y, z]);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      if (sampled.length >= MANUAL_PROXY_POINT_LIMIT) break;
    }

    const values = new Float32Array(sampled.length * 3);
    sampled.forEach(([x, y, z], index) => {
      const offset = index * 3;
      values[offset] = x - sourceCentroid.x;
      values[offset + 1] = y - minY + 0.025;
      values[offset + 2] = z - sourceCentroid.z;
    });
    view.points.geometry.setAttribute('position', new THREE.BufferAttribute(values, 3));
    view.points.geometry.computeBoundingSphere();
    view.points.visible = values.length > 0;
    view.proxyHeight = Number.isFinite(maxY - minY) ? maxY - minY : 1.6;

    const width = Math.max(source?.box?.scale?.x ?? 0, MANUAL_HITBOX_MIN_XZ_M);
    const depth = Math.max(source?.box?.scale?.z ?? 0, MANUAL_HITBOX_MIN_XZ_M);
    const height = manualProxyHeight(view);
    view.hitbox.position.set(0, height * 0.5, 0);
    view.hitbox.scale.set(width, height, depth);
    view.glow.position.set(0, height * 0.5, 0);
    const glowSize = Math.max(width, depth, height, 0.6) * 1.35;
    view.glow.scale.set(glowSize, glowSize, 1);
  }

  function applyManualSoloStyle(view, dimmed, selected) {
    const opacity = dimmed ? SOLO_DIMMED_POINT_OPACITY : 0.95;
    view.points.material.opacity = opacity;
    view.centroid.material.opacity = dimmed ? SOLO_DIMMED_CENTROID_OPACITY : 0.95;
    view.donut.material.opacity = dimmed ? SOLO_DIMMED_CENTROID_OPACITY : 0.95;
    view.glow.visible = selected && !dimmed;
    view.glow.material.opacity = view.glow.visible ? SELECTED_GLOW_OPACITY : 0;
    view.link.material.opacity = dimmed ? SOLO_DIMMED_VECTOR_OPACITY : 0.68;
    view.label.material.opacity = dimmed ? SOLO_DIMMED_LABEL_OPACITY : 1;
  }

  function updateManualLink(view) {
    const source = view.clusterKey ? views.get(view.clusterKey) : null;
    if (!source?.centroid) {
      view.link.visible = false;
      return;
    }

    const positions = view.link.geometry.getAttribute('position');
    positions.setXYZ(0, view.group.position.x, FLOOR_Y + 0.02, view.group.position.z);
    positions.setXYZ(1, source.centroid.position.x, source.centroid.position.y, source.centroid.position.z);
    positions.needsUpdate = true;
    view.link.geometry.computeBoundingSphere();
    view.link.computeLineDistances();
    view.link.visible = true;
  }

  function startManualReturn(view, source) {
    view.returning = true;
    const start = view.group.position.clone();
    const target = new THREE.Vector3(source.centroid.position.x, FLOOR_Y + 0.016, source.centroid.position.z);
    const startedAt = performance.now();

    const tick = (now) => {
      const t = Math.min((now - startedAt) / MANUAL_RETURN_DURATION_MS, 1);
      const eased = t * t * (3 - 2 * t);
      view.group.position.lerpVectors(start, target, eased);
      updateManualLink(view);
      if (t < 1) {
        view.returnFrame = requestAnimationFrame(tick);
        return;
      }
      view.returnFrame = undefined;
      source.manualSource = false;
      source.color.setHex(idColorValue(view.id));
      if (source.labelText) {
        replaceLabelTexture(source.label, source.labelText, source.color);
        source.labelColorHex = source.color.getHex();
      }
      applyInteractionStyle(source);
      disposeManualView(view);
      manualViews.delete(view.id);
    };
    view.returnFrame = requestAnimationFrame(tick);
  }

  function refreshManualLinks() {
    for (const view of manualViews.values()) updateManualLink(view);
  }

  function disposeManualView(view) {
    if (view.returnFrame) cancelAnimationFrame(view.returnFrame);
    manualGroup.remove(view.group, view.link);
    view.points.geometry.dispose();
    view.points.material.dispose();
    view.centroid.material.dispose();
    view.glow.material.dispose();
    view.hitbox.material.dispose();
    view.donut.material.dispose();
    view.link.geometry.dispose();
    view.link.material.dispose();
    disposeLabel(view.label);
  }

  function renderSetup(root, selectedSceneAddress) {
    clearGroup(setupGroup);
    zoneRenderer.resetViews();
    addContainer(root, setupGroup, selectedSceneAddress, false);
    zoneRenderer.pruneState(collectZoneAddresses(root));
    applySetupVisibility();
    updateLineMaterialResolution();
    updateHomeFromSetup();
  }

  function addContainer(container, parent, selectedSceneAddress, insideSelectedScene) {
    const address = container.getAddress();
    const isSelectedScene = Boolean(selectedSceneAddress && address === selectedSceneAddress);
    const renderContents = !selectedSceneAddress || insideSelectedScene || isSelectedScene;

    // Keep ancestors of the selected Scene so their transforms are preserved,
    // but skip unrelated branches entirely.
    if (
      selectedSceneAddress
      && !renderContents
      && !containsAddress(container, selectedSceneAddress)
    ) {
      return;
    }

    const group = new THREE.Group();
    group.name = `augmenta:${address}`;
    if (container.isZone()) group.userData.isZoneContainer = true;

    group.position.fromArray(container.getPosition());
    setSetupRotation(group, container.getRotation());
    parent.add(group);

    if (renderContents) {
      if (container.isScene()) {
        addSceneBox(container, group);
      } else if (container.isZone()) {
        zoneRenderer.addZone(container, group);
      }
    }

    for (const child of container.getChildren()) {
      addContainer(
        child,
        group,
        selectedSceneAddress,
        renderContents
      );
    }
  }

  function containsAddress(container, targetAddress) {
    if (container.getAddress() === targetAddress) return true;
    return container.getChildren().some((child) => containsAddress(child, targetAddress));
  }

  function addSceneBox(container, group) {
    const size = container.getSceneParameters().size;
    const geometry = new THREE.BoxGeometry(...positiveSize(size));
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({
        color: 0x7f858e,
        transparent: true,
        opacity: 0.55,
        depthWrite: false
      })
    );
    geometry.dispose();

    edges.name = 'Scene bounds';
    // AxisTransform returns size as positive magnitudes. In Y-up/right-handed
    // space the original +Z extent points toward local -Z.
    edges.position.set(size[0] / 2, size[1] / 2, -size[2] / 2);
    edges.renderOrder = 1;
    group.add(edges);
  }

  function updateHomeFromSetup() {
    const bounds = new THREE.Box3().setFromObject(setupGroup);
    if (bounds.isEmpty()) return;

    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const span = Math.max(size.x, size.y, size.z, 1);
    const fov = THREE.MathUtils.degToRad(perspectiveCamera.fov);
    const distance = Math.max(span / (2 * Math.tan(fov / 2)) * 1.35, 2);
    homeOrthoHalfWidth = Math.max(span * 0.82 + 1.8, 1);

    homeTarget.copy(center);
    // A centered, slightly elevated front view similar to Pleiades' default,
    // rather than an oblique corner view.
    homePosition.copy(center).add(
      new THREE.Vector3(0, distance * 0.14, distance * 1.08)
    );

    // Before the user has chosen a view, keep orbiting around the setup
    // center. A restored/panned/orbited camera keeps its own target so setup
    // refreshes cannot overwrite the persisted view.
    if (!cameraUserControlled) {
      perspectiveCamera.zoom = 1;
      controls.target.copy(center);
      perspectivePosition.copy(homePosition);
      perspectiveTarget.copy(homeTarget);
      controls.update();
    }
  }

  function applySetupVisibility() {
    setupGroup.traverse((object) => {
      if (object.name === 'Scene bounds') object.visible = visibility.scene;
      if (object.userData?.isZoneContainer) object.visible = visibility.zones;
    });
  }

  function setVisibility({ clusters, points, scene, zones, vectors }) {
    visibility.clusters = clusters;
    visibility.points = points;
    visibility.scene = scene;
    visibility.zones = zones;
    visibility.vectors = vectors;

    clusterGroup.visible = clusters;
    pointGroup.visible = points;
    vectorGroup.visible = vectors;
    for (const view of views.values()) {
      view.lookAtMarker.visible = vectors
        && view.key === selectedClusterKey
        && !view.manualSource
        && view.lookAtMarker.userData.hasDirection;
    }
    labelGroup.visible = clusters || points;
    applySetupVisibility();
    refreshInteractionStyles();
  }

  function clearTracking() {
    for (const view of views.values()) disposeView(view);
    views.clear();
    for (const view of manualViews.values()) disposeManualView(view);
    manualViews.clear();

    zoneRenderer.clearPresence();
  }

  function clearSetup() {
    clearGroup(setupGroup);
    zoneRenderer.clearPresence();
    zoneRenderer.resetViews();
    homePosition.set(0, 2.5, 7.5);
    homeTarget.set(0, 1.2, 0);
    if (!cameraUserControlled) {
      perspectiveCamera.zoom = 1;
      perspectivePosition.copy(homePosition);
      perspectiveTarget.copy(homeTarget);
    }
    homeOrthoHalfWidth = DEFAULT_ORTHO_HALF_WIDTH;
    orthoHalfWidth = DEFAULT_ORTHO_HALF_WIDTH;
  }

  function disposeView(view) {
    clusterGroup.remove(view.box, view.centroid, view.glow, view.groundDonut);
    vectorGroup.remove(view.velocity);
    pointGroup.remove(view.points);
    labelGroup.remove(view.label);

    view.box.material.dispose();
    view.hitbox.material.dispose();
    view.lookAtMarker.material.dispose();
    view.centroid.material.dispose();
    view.glow.material.dispose();
    view.groundDonut.material.dispose();
    view.points.geometry.dispose();
    view.points.material.dispose();

    disposeArrow(view.velocity);
    disposeLabel(view.label);
  }

  resetCamera();
  resize();
  new ResizeObserver(resize).observe(host);

  renderer.domElement.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const target = pickSceneTargetAt(event.clientX, event.clientY);
    pickGesture = {
      pointerId: event.pointerId,
      target,
      x: event.clientX,
      y: event.clientY,
      dragging: false
    };
    if (target) renderer.domElement.setPointerCapture?.(event.pointerId);
  });

  renderer.domElement.addEventListener('pointermove', (event) => {
    if (!pickGesture || pickGesture.pointerId !== event.pointerId || !pickGesture.target) return;
    const distance = Math.hypot(event.clientX - pickGesture.x, event.clientY - pickGesture.y);
    if (!pickGesture.dragging && distance >= PICK_MAX_MOVEMENT_PX) {
      pickGesture.dragging = true;
      clusterDragHandler?.({
        phase: 'start',
        kind: pickGesture.target.kind,
        id: pickGesture.target.id,
        key: pickGesture.target.key,
        clientX: event.clientX,
        clientY: event.clientY,
        floorPoint: raycastFloor(event.clientX, event.clientY)
      });
    }
    if (!pickGesture.dragging) return;
    event.preventDefault();
    clusterDragHandler?.({
      phase: 'move',
      kind: pickGesture.target.kind,
      id: pickGesture.target.id,
      key: pickGesture.target.key,
      clientX: event.clientX,
      clientY: event.clientY,
      floorPoint: raycastFloor(event.clientX, event.clientY)
    });
  }, { passive: false });

  renderer.domElement.addEventListener('pointerup', (event) => {
    if (!pickGesture || pickGesture.pointerId !== event.pointerId) return;
    const gesture = pickGesture;
    pickGesture = null;
    if (renderer.domElement.hasPointerCapture?.(event.pointerId)) {
      renderer.domElement.releasePointerCapture?.(event.pointerId);
    }
    if (gesture.dragging) {
      clusterDragHandler?.({
        phase: 'end',
        kind: gesture.target.kind,
        id: gesture.target.id,
        key: gesture.target.key,
        clientX: event.clientX,
        clientY: event.clientY,
        floorPoint: raycastFloor(event.clientX, event.clientY)
      });
      return;
    }
    clusterSelectionHandler?.(gesture.target?.key ?? null);
  });

  renderer.domElement.addEventListener('pointercancel', (event) => {
    if (pickGesture?.dragging && pickGesture.target) {
      clusterDragHandler?.({
        phase: 'cancel',
        kind: pickGesture.target.kind,
        id: pickGesture.target.id,
        key: pickGesture.target.key,
        clientX: event.clientX,
        clientY: event.clientY,
        floorPoint: raycastFloor(event.clientX, event.clientY)
      });
    }
    pickGesture = null;
  });

  renderer.domElement.addEventListener('dblclick', (event) => {
    if (event.button === 0) resetCamera();
  });

  renderer.setAnimationLoop(() => {
    controls.update();
    zoneRenderer.animate(performance.now());
    renderer.render(scene, camera);
  });

  return {
    renderFrame,
    renderSetup,
    clearTracking,
    clearSetup,
    beginCameraInteraction,
    endCameraInteraction,
    getCameraView,
    isCameraUserControlled,
    resetCamera,
    orbitCamera,
    setCameraChangeHandler,
    setCameraView,
    returnToPerspective,
    leaveOrthographicFromCurrentView,
    setOrthographicView,
    setLeftInset,
    setRightInset,
    setViewStateChangeHandler,
    setVisibility,
    pickClusterAt,
    setClusterSelectionHandler,
    setClusterDragHandler,
    setOperatorState
  };
}

function isOrthographicView(view) {
  return Object.hasOwn(VIEW_DIRECTIONS, view);
}

function normalizeDegrees(value) {
  return ((((value + 180) % 360) + 360) % 360) - 180;
}

function shortestAngleDelta(from, to) {
  return THREE.MathUtils.euclideanModulo(to - from + Math.PI, Math.PI * 2) - Math.PI;
}

function easeOutQuint(progress) {
  return 1 - Math.pow(1 - progress, 5);
}

function validVector3(value) {
  return Array.isArray(value)
    && value.length === 3
    && value.every((component) => Number.isFinite(component))
    ? value
    : undefined;
}

function setSetupRotation(object, mappedRotationDegrees) {
  const [x, y, mappedZ] = mappedRotationDegrees.map(THREE.MathUtils.degToRad);

  // Setup JSON has already been component-mapped by Pleiades from Y-up/left-
  // handed to Y-up/right-handed, so its Z Euler component is negated. Recover
  // the native Pleiades Z->Y->X rotation, then reflect the orientation itself.
  const leftHanded = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(x, y, -mappedZ, 'ZYX')
  );
  setLeftHandedQuaternion(object.quaternion, [
    leftHanded.x,
    leftHanded.y,
    leftHanded.z,
    leftHanded.w
  ]);
}

function setLeftHandedQuaternion(target, [x, y, z, w]) {
  // Reflection M=diag(1,1,-1): R_rh = M * R_lh * M.
  target.set(-x, -y, z, w).normalize();
}

function configureControls(controls) {
  controls.enableDamping = true;
  controls.enableRotate = true;
  controls.enablePan = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = false;
  controls.rotateSpeed = 0.6;
  controls.panSpeed = 0.72;
  controls.zoomSpeed = 0.9;
  controls.minDistance = MIN_CAMERA_DISTANCE;
  controls.maxDistance = MAX_CAMERA_DISTANCE;
  controls.minZoom = MIN_CAMERA_ZOOM;
  controls.maxZoom = MAX_CAMERA_ZOOM;
  controls.zoomToCursor = false;
  controls.minPolarAngle = PERSPECTIVE_MIN_POLAR_ANGLE;
  controls.maxPolarAngle = PERSPECTIVE_MAX_POLAR_ANGLE;
  // Left drag belongs to cluster/manual interaction. Keep camera navigation
  // on the mouse buttons that do not conflict with operator picking.
  controls.mouseButtons.LEFT = -1;
  controls.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE;
  controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
  controls.touches.ONE = -1;
  controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
}

function configureArrow(arrow) {
  arrow.line.material.transparent = true;
  arrow.line.material.opacity = 0.95;
  arrow.line.material.depthTest = false;
  arrow.line.renderOrder = 8;

  arrow.cone.material.transparent = true;
  arrow.cone.material.opacity = 0.95;
  arrow.cone.material.depthTest = false;
  arrow.cone.renderOrder = 8;
}

function setArrowOpacity(arrow, opacity) {
  arrow.line.material.opacity = opacity;
  arrow.cone.material.opacity = opacity;
}

function updateVelocity(arrow, origin, velocity, color, direction) {
  const speed = speedFromVelocity(velocity);

  if (!Number.isFinite(speed) || speed < MIN_VISIBLE_SPEED_MPS) {
    arrow.visible = false;
    return;
  }

  direction.fromArray(velocity).normalize();
  arrow.visible = true;
  arrow.position.fromArray(origin);
  arrow.setDirection(direction);

  const headLength = Math.min(Math.max(speed * 0.28, 0.08), 0.28);
  const headWidth = Math.min(Math.max(headLength * 0.55, 0.05), 0.16);
  arrow.setLength(speed, headLength, headWidth);
  arrow.setColor(color);
}

function disposeArrow(arrow) {
  arrow.line.geometry.dispose();
  arrow.line.material.dispose();
  arrow.cone.geometry.dispose();
  arrow.cone.material.dispose();
  arrow.parent?.remove(arrow);
}

function createLabelSprite(text, color) {
  const material = new THREE.SpriteMaterial({
    map: makeLabelTexture(text, color),
    transparent: true,
    depthTest: false,
    depthWrite: false
  });
  const sprite = new THREE.Sprite(material);
  updateLabelScale(sprite, text);
  sprite.renderOrder = 10;
  return sprite;
}

function replaceLabelTexture(sprite, text, color) {
  sprite.material.map?.dispose();
  sprite.material.map = makeLabelTexture(text, color);
  sprite.material.needsUpdate = true;
  updateLabelScale(sprite, text);
}

function updateLabelScale(sprite, text) {
  sprite.scale.set(1.0, String(text).includes('\n') ? 0.36 : 0.31, 1);
}

function makeGlowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,255,255,0.86)');
  gradient.addColorStop(0.28, 'rgba(255,255,255,0.42)');
  gradient.addColorStop(0.68, 'rgba(255,255,255,0.11)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

function makeLabelTexture(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 128;

  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  const cssColor = `#${color.getHexString()}`;
  const lines = String(text ?? '').split('\n', 2);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  roundedRect(ctx, 20, 14, 344, 100, 24);
  ctx.fillStyle = 'rgba(10, 13, 18, 0.88)';
  ctx.fill();

  ctx.strokeStyle = cssColor;
  ctx.lineWidth = 5;
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (lines.length > 1) {
    ctx.font = '600 40px Inter, Arial, sans-serif';
    ctx.fillText(lines[0], 192, 46, 320);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.74)';
    ctx.font = '500 24px Inter, Arial, sans-serif';
    ctx.fillText(lines[1], 192, 86, 320);
  } else {
    ctx.font = '500 42px Inter, Arial, sans-serif';
    ctx.fillText(lines[0], 192, 65, 320);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

function disposeLabel(sprite) {
  sprite.material.map?.dispose();
  sprite.material.dispose();
  sprite.parent?.remove(sprite);
}

function namedGroup(scene, name) {
  const group = new THREE.Group();
  group.name = name;
  scene.add(group);
  return group;
}

function objectColor() {
  return UNASSIGNED_COLOR.clone();
}

// Scene dimensions are magnitudes. Placement above preserves the requested
// Y-up/right-handed direction while this helper keeps geometry sizes valid.
function positiveSize(size) {
  return size.map((v) => Math.max(Math.abs(v), MIN_GEOMETRY_SIZE));
}

function clearGroup(group) {
  while (group.children.length) disposeObject(group.children[0]);
}

function disposeObject(object) {
  for (const child of [...object.children]) disposeObject(child);
  object.geometry?.dispose();

  if (object.material) {
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      material.map?.dispose();
      material.dispose();
    }
  }

  object.parent?.remove(object);
}
