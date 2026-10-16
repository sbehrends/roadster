import * as THREE from 'three';
import { BOTTOM, LATERAL } from './physics.js';

// Cold-gas exhaust: white puffs that leave each active nozzle, slow down,
// and spread into a rolling cloud when they reach the floor.

const MAX = 3000;

const vertex = /* glsl */ `
  attribute float aAge;
  attribute float aSize;
  attribute float aSeed;
  varying float vAge;
  varying float vSeed;
  varying float vNear;
  uniform float uScale;
  void main() {
    vAge = aAge;
    vSeed = aSeed;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float depth = -mv.z;
    // Puffs at or behind the lens would blow up to the GPU's max point size.
    vNear = smoothstep(0.6, 2.5, depth);
    if (depth < 0.3 || aAge < 0.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }
    gl_Position = projectionMatrix * mv;
    gl_PointSize = min(aSize * uScale / depth, 420.0);
  }
`;

const fragment = /* glsl */ `
  varying float vAge;
  varying float vSeed;
  varying float vNear;
  void main() {
    if (vAge < 0.0 || vAge > 1.0) discard;
    vec2 p = gl_PointCoord - 0.5;
    float r = length(p) * 2.0;
    float soft = exp(-r * r * 3.2) * (1.0 - smoothstep(0.85, 1.0, r));
    float life = smoothstep(0.0, 0.08, vAge) * pow(max(1.0 - vAge, 0.0), 1.6);
    float a = clamp(soft * life * 0.2 * vNear, 0.0, 1.0);
    vec3 col = mix(vec3(0.95, 0.97, 1.0), vec3(0.55, 0.57, 0.62), vAge * 0.8 + r * 0.25);
    gl_FragColor = vec4(col * a, a);
  }
`;

export function createSmoke() {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(MAX * 3);
  const age = new Float32Array(MAX).fill(-1);
  const size = new Float32Array(MAX);
  const seed = new Float32Array(MAX);
  for (let i = 0; i < MAX; i += 1) seed[i] = Math.random();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aAge', new THREE.BufferAttribute(age, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 600 } },
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  points.renderOrder = 20;
  const vel = new Float32Array(MAX * 3);
  const life = new Float32Array(MAX).fill(1);
  const t = new Float32Array(MAX).fill(2);
  return { points, pos, vel, age, size, life, t, cursor: 0, carry: { bottom: {}, lateral: {} } };
}

const _p = new THREE.Vector3();
const _d = new THREE.Vector3();
const _v = new THREE.Vector3();

function spawn(smoke, origin, dir, carVel, strength) {
  const i = smoke.cursor;
  smoke.cursor = (i + 1) % MAX;
  const j = i * 3;
  const jitter = 0.18;
  smoke.pos[j] = origin.x + (Math.random() - 0.5) * 0.06;
  smoke.pos[j + 1] = origin.y + (Math.random() - 0.5) * 0.06;
  smoke.pos[j + 2] = origin.z + (Math.random() - 0.5) * 0.06;
  const speed = 9 + strength * 12 + Math.random() * 4;
  smoke.vel[j] = (dir.x + (Math.random() - 0.5) * jitter) * speed + carVel.x * 0.6;
  smoke.vel[j + 1] = (dir.y + (Math.random() - 0.5) * jitter) * speed + carVel.y * 0.6;
  smoke.vel[j + 2] = (dir.z + (Math.random() - 0.5) * jitter) * speed + carVel.z * 0.6;
  smoke.t[i] = 0;
  smoke.life[i] = 1.1 + Math.random() * 1.2;
  smoke.age[i] = 0;
  smoke.size[i] = 0.25;
}

export function updateSmoke(smoke, state, carGroup, dt) {
  const banks = [
    [BOTTOM, state.bottom, 'bottom', (spec) => _d.set(0, -1, 0), 0.07],
    [LATERAL, state.lateral, 'lateral', (spec) => _d.set(spec.exhaustX, 0, 0), 0.03],
  ];
  for (const [specs, amounts, key, dirOf, lip] of banks) {
    for (const spec of specs) {
      const amount = amounts[spec.id];
      if (amount < 0.04) continue;
      dirOf(spec).transformDirection(carGroup.matrixWorld);
      _p.set(spec.x, spec.y, spec.z).applyMatrix4(carGroup.matrixWorld).addScaledVector(_d, lip + 0.05);
      const rate = 150 * amount * (key === 'bottom' ? 1 : 0.6);
      const carry = (smoke.carry[key][spec.id] ?? 0) + rate * dt;
      const n = Math.floor(carry);
      smoke.carry[key][spec.id] = carry - n;
      for (let k = 0; k < n; k += 1) spawn(smoke, _p, _d, state.velocity, amount);
    }
  }

  for (let i = 0; i < MAX; i += 1) {
    if (smoke.age[i] < 0) continue;
    smoke.t[i] += dt;
    const a = smoke.t[i] / smoke.life[i];
    if (a >= 1) {
      smoke.age[i] = -1;
      continue;
    }
    const j = i * 3;
    _v.set(smoke.vel[j], smoke.vel[j + 1], smoke.vel[j + 2]);
    const drag = Math.exp(-dt * 3.2);
    _v.multiplyScalar(drag);
    _v.y += dt * 0.6;
    let y = smoke.pos[j + 1] + _v.y * dt;
    // Hitting the floor turns downward speed into a radial roll-out.
    if (y < 0.18) {
      const hit = Math.max(0, -_v.y);
      if (hit > 0.2) {
        const ang = Math.random() * Math.PI * 2;
        _v.x += Math.cos(ang) * hit * 0.9;
        _v.z += Math.sin(ang) * hit * 0.9;
      }
      _v.y = Math.abs(_v.y) * 0.08;
      y = 0.18;
    }
    smoke.pos[j] += _v.x * dt;
    smoke.pos[j + 1] = y;
    smoke.pos[j + 2] += _v.z * dt;
    smoke.vel[j] = _v.x;
    smoke.vel[j + 1] = _v.y;
    smoke.vel[j + 2] = _v.z;
    smoke.age[i] = a;
    smoke.size[i] = 0.35 + Math.sqrt(a) * 2.6;
  }
  const geo = smoke.points.geometry;
  geo.attributes.position.needsUpdate = true;
  geo.attributes.aAge.needsUpdate = true;
  geo.attributes.aSize.needsUpdate = true;
}
