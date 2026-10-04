const DRAG_DEGREES_PER_PIXEL = 0.42;
const DRAG_THRESHOLD_PX = 3;

export function createCameraCube({ element, viewer }) {
  if (!element || !viewer) return { destroy() {} };

  const cube = element.querySelector('.camera-cube-inner');
  let gesture = null;

  const onViewState = (state) => {
    if (!cube) return;
    cube.style.transform = state?.cubeTransform || 'rotateX(0deg) rotateY(0deg)';
  };
  viewer.setViewStateChangeHandler(onViewState);

  element.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    gesture = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false
    };
    element.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });

  element.addEventListener('pointermove', (event) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) gesture.moved = true;
    if (!gesture.moved) return;

    gesture.x = event.clientX;
    gesture.y = event.clientY;
    viewer.orbitCamera(
      -dx * DRAG_DEGREES_PER_PIXEL * Math.PI / 180,
      -dy * DRAG_DEGREES_PER_PIXEL * Math.PI / 180
    );
    event.preventDefault();
  }, { passive: false });

  const finish = (event) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const moved = gesture.moved;
    gesture = null;
    element.releasePointerCapture?.(event.pointerId);

    if (!moved) {
      const face = event.target.closest?.('[data-camera-view]');
      const view = face?.dataset.cameraView;
      if (view) viewer.setOrthographicView(view);
    }
  };

  element.addEventListener('pointerup', finish);
  element.addEventListener('pointercancel', finish);

  return {
    destroy() {
      viewer.setViewStateChangeHandler(undefined);
    }
  };
}
