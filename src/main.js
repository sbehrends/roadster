import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildCar, updateCar } from './car.js';
import { createEnvironment, setStudio, updateEnvironment } from './environment.js';
import { createHud } from './hud.js';
import { readInput } from './input.js';
import { createState, headingOf, resetState, step } from './physics.js';
import { createSmoke, updateSmoke } from './smoke.js';
import { CAMERAS, createRig, cycleRig, dragRig, fitFov, resetRig, rigOffset, settleRig, zoomRig } from './camera.js';
import { mergeInput } from './controls.js';
import { createTouchControls, wantsTouch } from './touch.js';
import { buildArena } from './arena.js';

// Phones get on-screen controls and a lighter render: fewer pixels, less MSAA, smaller targets.
const touchMode = wantsTouch();
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
const pixelRatio = Math.min(window.devicePixelRatio, touchMode ? 1.5 : 2);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = false;
renderer.domElement.className = 'view';
document.body.prepend(renderer.domElement);

const camera = new THREE.PerspectiveCamera(36, window.innerWidth / window.innerHeight, 0.1, 300);
const env = createEnvironment(renderer, { lite: touchMode });
const car = buildCar({ envMap: env.envMap });
env.scene.add(car.group);
const arena = buildArena(env.scene);
const smoke = createSmoke();
env.scene.add(smoke.points);

const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: touchMode ? 2 : 4 });
const composer = new EffectComposer(renderer, target);
composer.addPass(new RenderPass(env.scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.32, 0.18, 3.2);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const state = createState();
const hud = createHud();
const touch = touchMode ? createTouchControls({ onCamera: () => hud.toast(`${cycleRig(rig).name} camera`) }) : null;

const shadowHide = [
  env.ground, env.reflector, env.pool, smoke.points, arena.group,
  ...Object.values(car.plumes.bottom), ...Object.values(car.plumes.lateral),
];

const camPos = new THREE.Vector3(0, 2.2, 8);
const offset = new THREE.Vector3(0, 1.7, 8);
const offsetGoal = new THREE.Vector3();
const look = new THREE.Vector3();
const camGoal = new THREE.Vector3();
const lookGoal = new THREE.Vector3();
const back = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);
const bodyUp = new THREE.Vector3();
const bodyFwd = new THREE.Vector3();
const rideGoal = new THREE.Vector3();
let ride = 0;
let heading = 0;
const rig = createRig();
let pose = null;
// Narrow portrait screens get a wider lens so the road ahead stays in view.
const MIN_HORIZONTAL_FOV = 44;
let dragging = false;
let lastX = 0;
let lastY = 0;
let resetHeld = false;

// Camera controls: drag orbits and tilts, the wheel zooms, C switches camera, V resets the view.
const view = renderer.domElement;
view.style.touchAction = 'none';
// Two fingers on the view pinch to zoom; one finger drags to orbit.
const pointers = new Map();
let pinch = 0;
view.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = Math.hypot(a.x - b.x, a.y - b.y);
  }
  dragging = pointers.size === 1;
  lastX = event.clientX;
  lastY = event.clientY;
  try {
    view.setPointerCapture(event.pointerId);
  } catch {
    // Synthetic or already-released pointers cannot be captured; dragging still works.
  }
});
const endDrag = (event) => {
  pointers.delete(event.pointerId);
  dragging = false;
};
view.addEventListener('pointerup', endDrag);
view.addEventListener('pointercancel', endDrag);
view.addEventListener('pointermove', (event) => {
  if (pointers.has(event.pointerId)) pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    zoomRig(rig, (pinch - d) * 3);
    pinch = d;
    return;
  }
  if (!dragging) return;
  dragRig(rig, event.clientX - lastX, event.clientY - lastY);
  lastX = event.clientX;
  lastY = event.clientY;
});
view.addEventListener('wheel', (event) => {
  event.preventDefault();
  zoomRig(rig, event.deltaY);
}, { passive: false });
window.addEventListener('keydown', (event) => {
  if (event.repeat) return;
  if (event.code === 'KeyC') hud.toast(`${cycleRig(rig).name} camera`);
  if (event.code === 'KeyV') {
    resetRig(rig);
    hud.toast('View reset');
  }
});

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  composer.setPixelRatio(pixelRatio);
  smoke.points.material.uniforms.uScale.value = (h * pixelRatio) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  hud.resize();
}
window.addEventListener('resize', resize);
resize();

function angleLerp(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function frameCamera(dt) {
  if (pose) {
    camera.position.set(...pose.pos);
    camera.lookAt(...pose.look);
    if (pose.fov && camera.fov !== pose.fov) {
      camera.fov = pose.fov;
      camera.updateProjectionMatrix();
    }
    return;
  }
  // Follow the heading only while the car is roughly upright, so flips do not whip the camera.
  bodyUp.set(0, 1, 0).applyQuaternion(state.quaternion);
  const speed = Math.hypot(state.velocity.x, state.velocity.z);
  // In a fast flight (off the loop) follow the direction of travel; otherwise the nose.
  const cam = CAMERAS[rig.mode];
  settleRig(rig, dt, speed, dragging);
  if (state.flight && speed > 8) heading = angleLerp(heading, Math.atan2(-state.velocity.x, -state.velocity.z), 1 - Math.exp(-dt * 2.2));
  else if (bodyUp.y > 0.5) heading = angleLerp(heading, headingOf(state.quaternion), 1 - Math.exp(-dt * (state.flight ? 1.5 : cam.follow)));
  const yaw = heading + rig.orbit;
  back.set(Math.sin(yaw), 0, Math.cos(yaw));
  // Smooth the offset from the car, not the absolute position, so speed never stretches the view.
  const rigged = rigOffset(rig, speed);
  offsetGoal.copy(back).multiplyScalar(rigged.back).addScaledVector(up, rigged.up);
  // On the loop the close camera rides the track behind the car, rollercoaster style,
  // close enough to stay inside the curve. The wide camera stays on the floor and watches.
  bodyFwd.set(0, 0, -1).applyQuaternion(state.quaternion);
  const riding = cam.ride && state.grounded > 0 && bodyUp.y < 0.85;
  ride += ((riding ? 1 : 0) - ride) * (1 - Math.exp(-dt * (riding ? 6 : 2)));
  rideGoal.copy(bodyFwd).multiplyScalar(-6.5).addScaledVector(bodyUp, 3.0);
  offsetGoal.lerp(rideGoal, ride);
  offset.lerp(offsetGoal, 1 - Math.exp(-dt * (4 + 10 * ride)));
  camGoal.copy(state.position).add(offset);
  // Small hops stay framed from low; big airs are tracked.
  const lift = Math.min(state.position.y, 3) * 0.6 + Math.max(state.position.y - 3, 0) * 0.92;
  const groundY = Math.max(0.55, lift + offset.y);
  camGoal.y = THREE.MathUtils.lerp(groundY, state.position.y + offset.y, ride);
  camPos.lerp(camGoal, 1 - Math.exp(-dt * 18));
  lookGoal.copy(state.position);
  lookGoal.y = THREE.MathUtils.lerp(Math.max(0.35, Math.min(state.position.y, 3) * 0.75 + Math.max(state.position.y - 3, 0) + 0.1), state.position.y, ride);
  look.lerp(lookGoal, 1 - Math.exp(-dt * 14));
  camera.position.copy(camPos);
  camera.up.set(0, 1, 0).lerp(bodyUp, ride).normalize();
  camera.lookAt(look);
  // Fit the camera's base lens to the screen, then add the speed kick so it survives in portrait.
  const fov = fitFov(rigged.fov, camera.aspect, MIN_HORIZONTAL_FOV) + Math.min(speed, 70) * 0.13;
  if (Math.abs(camera.fov - fov) > 0.01) {
    camera.fov += (fov - camera.fov) * Math.min(1, dt * 3);
    camera.updateProjectionMatrix();
    smoke.points.material.uniforms.uScale.value = (window.innerHeight * pixelRatio) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  }
}

let last = performance.now();
let paused = false;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const input = touch ? mergeInput(readInput(), touch.state) : readInput();
  if (input.reset && !resetHeld) resetState(state, true);
  resetHeld = input.reset;
  if (!paused) step(state, input, dt);

  car.group.position.copy(state.position);
  car.group.quaternion.copy(state.quaternion);
  car.group.updateMatrixWorld();
  updateCar(car, state, dt);
  updateSmoke(smoke, state, car.group, paused ? 0 : dt);
  frameCamera(dt);
  updateEnvironment(env, state.position, state.quaternion, camera);
  env.shadow.render(renderer, env.scene, shadowHide);
  composer.render(dt);

  const used = input.forward || input.steer || input.strafe || input.climb || input.reset || input.trick;
  hud.update(state, used);
  requestAnimationFrame(frame);
}

// Dev hooks for screenshot checks against the reference photos.
// ?studio=light swaps to a light cyclorama, ?view=side|front34|... frames a reference angle, ?hud=0 hides the HUD.
const VIEWS = {
  side: { pos: [-48, 0.62, 0.08], look: [0, 0.62, 0.08], fov: 5.4 },
  front: { pos: [0, 0.95, -26], look: [0, 0.55, 0], fov: 5.4 },
  rear: { pos: [0, 1.0, 26], look: [0, 0.55, 0], fov: 5.4 },
  top: { pos: [0, 40, 0.001], look: [0, 0, 0], fov: 7.6 },
  front34: { pos: [-2.3, 0.86, -5.7], look: [0.45, 0.52, 0.2], fov: 31 },
  rear34: { pos: [-5.2, 1.15, 4.6], look: [0.2, 0.5, 0.2], fov: 30 },
  reartop: { pos: [0, 5.0, 6.9], look: [0, 0.35, 0.55], fov: 31 },
  fronttop: { pos: [0, 6.6, -5.6], look: [0, 0.35, -0.3], fov: 31 },
  arena: { pos: [30, 26, -82], look: [-8, 2, -140], fov: 52 },
  elev34: { pos: [-8.2, 4.4, -1.9], look: [0, 0.35, 0.25], fov: 26 },
};
const params = new URLSearchParams(window.location.search);
if (params.get('studio') === 'light') setStudio(env, 'light');
if (params.get('hud') === '0') document.body.classList.add('no-hud');
if (VIEWS[params.get('view')]) pose = VIEWS[params.get('view')];
window.__pose = (next) => {
  pose = typeof next === 'string' ? VIEWS[next] : next;
};
window.__studio = (mode) => setStudio(env, mode);
window.__scene = { env, car, camera, renderer, bloom };
window.__state = state;
window.__pause = (on) => {
  paused = on;
};

requestAnimationFrame(frame);
