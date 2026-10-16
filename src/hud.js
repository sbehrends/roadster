import * as THREE from 'three';
import { buildCar } from './car.js';

const ARC_START = 132;
const ARC_SWEEP = 276;
const G_MAX = 4;
const ALT_MAX_FT = 80;

function arcPath(cx, cy, radius, startDeg, sweepDeg) {
  const rad = (deg) => (deg * Math.PI) / 180;
  const end = startDeg + sweepDeg;
  const x0 = cx + radius * Math.cos(rad(startDeg));
  const y0 = cy + radius * Math.sin(rad(startDeg));
  const x1 = cx + radius * Math.cos(rad(end));
  const y1 = cy + radius * Math.sin(rad(end));
  const large = sweepDeg > 180 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${radius} ${radius} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

function gaugeSvg() {
  const track = arcPath(100, 100, 78, ARC_START, ARC_SWEEP);
  return `
    <svg viewBox="0 0 200 200" aria-hidden="true">
      <path class="track" d="${track}"></path>
      <path class="value" d="${track}"></path>
    </svg>
  `;
}

function setGauge(root, fraction) {
  const value = root.querySelector('.value');
  const f = Math.min(1, Math.max(0, fraction));
  const sweep = Math.max(1.2, ARC_SWEEP * f);
  value.setAttribute('d', arcPath(100, 100, 78, ARC_START, sweep));
}

export function createHud() {
  const root = document.createElement('div');
  root.className = 'hud';
  root.innerHTML = `
    <div class="cluster">
      <div class="gauge" id="g-gauge">
        ${gaugeSvg()}
        <div class="readout">
          <div class="kicker">G-force</div>
          <div class="num" id="g-num">1.0</div>
          <div class="unit">G</div>
        </div>
      </div>
      <div class="attitude" id="attitude"></div>
    </div>
    <p class="hint" id="hint">Loop ahead · W S drive · A D steer · space hop · F kickflip · B backflip · in the air: W S pitch · A D spin · Q E roll · R recover · drag to orbit · wheel zoom · C camera · V reset view</p>
    <div class="center">
      <div class="trick" id="trick"></div>
      <div class="speed"><span id="spd">0</span><small>KM/H</small></div>
      <div class="charge"><div class="charge-fill" id="charge"></div></div>
    </div>
    <div class="cluster">
      <svg class="plan" viewBox="0 0 86 156" aria-hidden="true">
        <path d="M22.8 9 L63.2 9 L68.2 13.5 L72 18 L73 30 L73 135 L72.7 143 L72.7 147.6 L13.3 147.6 L13.3 143 L13 135 L13 30 L14 18 L17.8 13.5 Z"></path>
        <path class="glass" d="M28 31.2 L58 31.2 L69.4 40.8 L67 48.9 L61.6 64.8 L58.9 86 L57.7 103 L54.7 120 L52 137.4 L34 137.4 L31.3 120 L28.3 103 L27.1 86 L24.4 64.8 L19 48.9 L16.6 40.8 Z"></path>
        <rect x="13.3" y="23" width="8.1" height="23.1" rx="2"></rect>
        <rect x="64.6" y="23" width="8.1" height="23.1" rx="2"></rect>
        <rect x="12.9" y="115.6" width="8.9" height="23.1" rx="2"></rect>
        <rect x="64.2" y="115.6" width="8.9" height="23.1" rx="2"></rect>
        <circle class="jet" data-jet="bottom-FL" cx="26.5" cy="18.6" r="2.6"></circle>
        <circle class="jet" data-jet="bottom-FR" cx="59.5" cy="18.6" r="2.6"></circle>
        <circle class="jet" data-jet="bottom-RL" cx="26.5" cy="139.8" r="2.6"></circle>
        <circle class="jet" data-jet="bottom-RR" cx="59.5" cy="139.8" r="2.6"></circle>
        <circle class="jet" data-jet="lateral-LF" cx="10" cy="18.6" r="2"></circle>
        <circle class="jet" data-jet="lateral-RF" cx="76" cy="18.6" r="2"></circle>
        <circle class="jet" data-jet="lateral-LR" cx="9.5" cy="140.4" r="2"></circle>
        <circle class="jet" data-jet="lateral-RR" cx="76.5" cy="140.4" r="2"></circle>
      </svg>
      <div class="gauge" id="alt-gauge">
        ${gaugeSvg()}
        <div class="readout">
          <div class="kicker">Altitude</div>
          <div class="num" id="alt-num">0.0</div>
          <div class="unit">FT</div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  const attitude = setupAttitude(root.querySelector('#attitude'));
  const gGauge = root.querySelector('#g-gauge');
  const altGauge = root.querySelector('#alt-gauge');
  const gNum = root.querySelector('#g-num');
  const altNum = root.querySelector('#alt-num');
  const hint = root.querySelector('#hint');
  const jets = [...root.querySelectorAll('.jet')];
  const spd = root.querySelector('#spd');
  const charge = root.querySelector('#charge');
  const trick = root.querySelector('#trick');
  let hintOn = true;
  let shownTrick = null;

  // Short centred caption: trick names and camera switches.
  function toast(text) {
    trick.textContent = text;
    trick.classList.remove('show');
    void trick.offsetWidth;
    trick.classList.add('show');
  }

  function update(state, usedInput) {
    gNum.textContent = state.gForce.toFixed(1);
    altNum.textContent = (state.altitudeM * 3.28084).toFixed(1);
    setGauge(gGauge, state.gForce / G_MAX);
    setGauge(altGauge, (state.altitudeM * 3.28084) / ALT_MAX_FT);
    attitude.car.quaternion.copy(state.quaternion);
    attitude.renderer.render(attitude.scene, attitude.camera);
    for (const jet of jets) {
      const [bank, id] = jet.dataset.jet.split('-');
      const amount = state[bank][id];
      jet.style.opacity = String(0.2 + amount * 0.8);
    }
    spd.textContent = String(Math.round(Math.abs(state.forwardSpeed) * 3.6));
    charge.style.transform = `scaleX(${state.charge.toFixed(3)})`;
    charge.classList.toggle('low', state.charge < 0.45);
    if (state.lastTrick && state.lastTrick !== shownTrick) {
      shownTrick = state.lastTrick;
      toast(shownTrick.name);
    }
    if (hintOn && usedInput) {
      hintOn = false;
      hint.classList.add('hint-hide');
    }
  }

  function resize() {
    const size = attitude.host.clientWidth;
    attitude.renderer.setSize(size, size, false);
  }

  return { update, resize, toast };
}

function setupAttitude(host) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 20);
  camera.position.set(-1.55, 0.72, 2.15);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(-2, 3, 2);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xdde7ff, 1.4);
  rim.position.set(2, 1, -2);
  scene.add(rim);

  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x9a9a9a,
    transparent: true,
    opacity: 0.55,
  });
  const horizon = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.008, 8, 64), ringMat);
  horizon.rotation.x = Math.PI / 2;
  const meridian = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.006, 8, 64), ringMat.clone());
  meridian.material.opacity = 0.35;
  meridian.rotation.y = Math.PI / 2;
  scene.add(horizon, meridian);

  const car = buildCar({ attitude: true }).group;
  scene.add(car);

  return { host, renderer, scene, camera, car };
}
