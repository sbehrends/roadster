// The chase-camera rig: which camera is active and how the user has moved it.
// Pure numbers; main.js turns the offset into a camera position each frame.

export const CAMERAS = [
  { name: 'Chase', dist: 7.4, height: 1.6, fov: 36, follow: 4, ride: true },
  { name: 'Wide', dist: 17, height: 5.2, fov: 40, follow: 2, ride: false },
];

const ZOOM_MIN = 0.6;
const ZOOM_MAX = 2.2;
const TILT_MIN = -0.2;
const TILT_MAX = 1.1;
const ELEVATION_MIN = 0.03;
const ELEVATION_MAX = 1.35;
const RECENTER_AFTER = 2.5;

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

export function createRig() {
  // Starts a little off-axis so the first frame shows the car's flank.
  return { mode: 0, orbit: 0.55, tilt: 0, zoom: 1, idle: 0 };
}

// Pointer drag in pixels: sideways orbits round the car, vertical tilts up or down.
export function dragRig(rig, dx, dy) {
  rig.orbit -= dx * 0.005;
  rig.tilt = clamp(rig.tilt + dy * 0.004, TILT_MIN, TILT_MAX);
  rig.idle = 0;
}

// Wheel delta: positive pulls the camera back.
export function zoomRig(rig, deltaY) {
  rig.zoom = clamp(rig.zoom * Math.exp(deltaY * 0.001), ZOOM_MIN, ZOOM_MAX);
  rig.idle = 0;
}

export function cycleRig(rig) {
  rig.mode = (rig.mode + 1) % CAMERAS.length;
  return CAMERAS[rig.mode];
}

export function resetRig(rig) {
  rig.orbit = 0;
  rig.tilt = 0;
  rig.zoom = 1;
  rig.idle = 0;
}

// Once the user lets go and drives, the view eases back behind the car.
// Zoom is a preference and stays; a parked car keeps whatever angle was chosen.
export function settleRig(rig, dt, speed, dragging) {
  if (dragging) {
    rig.idle = 0;
    return;
  }
  rig.idle += dt;
  if (rig.idle < RECENTER_AFTER || speed < 5) return;
  const k = 1 - Math.exp(-dt * 1.4);
  rig.orbit = Math.atan2(Math.sin(rig.orbit), Math.cos(rig.orbit));
  rig.orbit -= rig.orbit * k;
  rig.tilt -= rig.tilt * k;
}

// Offset of the camera from the car: distance behind and height above, plus fov.
export function rigOffset(rig, speed) {
  const cam = CAMERAS[rig.mode];
  const s = Math.min(speed, 60);
  const dist = cam.dist * (1 + s * 0.0027);
  const height = cam.height + s * 0.006;
  const r = Math.hypot(dist, height) * rig.zoom;
  const elevation = clamp(Math.atan2(height, dist) + rig.tilt, ELEVATION_MIN, ELEVATION_MAX);
  return { back: Math.cos(elevation) * r, up: Math.sin(elevation) * r, fov: cam.fov };
}
