import * as THREE from 'three';
import { castGround, penetration } from './world.js';

// Body frame: +X right, +Y up, −Z forward (Three.js Object3D forward).
// Positive yaw (about +Y) turns the nose toward −X (left).
// Positive pitch (about +X) raises the nose. Positive roll (about +Z) lifts the right side.
// The origin is the centre of gravity. The ground is the plane y = 0.
//
// The Roadster is a car: four wheels on sprung struts, tyre grip, gravity always on.
// The cold-gas thrusters cannot hold it in the air. They fire a short lift burst
// (a hop) and give attitude control while airborne, so the car can flip and land.

export const MASS = 1600;
export const G = 9.81;
export const WEIGHT = MASS * G;
export const REST = 0.52;
export const WHEEL_R = 0.385;
export const TRACK = 0.855;
export const FRONT_AXLE = -1.45;
export const REAR_AXLE = 1.64;

const INERTIA = new THREE.Vector3(2400, 2700, 540);

const BOTTOM_MAX = 12000;
const LATERAL_MAX = 5000;
const JUMP_LIFT = 0.85;
const JUMP_MIN = 0.12;
const JUMP_MAX = 0.36;
const TRICK_BURN = 0.38;
const TRICK_POP = 0.12;
// Outside the lift burst the jets may never out-push gravity: attitude only.
const HOVER_CAP = 0.9 * 9.81 * 1600;
const CHARGE_DRAIN = 1.0;
const CHARGE_REFILL = 0.38;

const DRIVE_FORCE = 20000;
const DRIVE_POWER = 720000;
const TOP_SPEED = 75;
const REVERSE_SPEED = 11;
const MU = 1.35;
const SUSP_LEN = 0.22;
const SAG = 0.07;
const SPRING_CUBIC = 4e6;
const STEER_MAX = 0.56;

const UP = new THREE.Vector3(0, 1, 0);

// Strut hardpoints sit straight above each hub. At rest the hub is WHEEL_R off the ground.
const HARDPOINT_Y = WHEEL_R - REST + (SUSP_LEN - SAG);
const FRONT_SHARE = REAR_AXLE / (REAR_AXLE - FRONT_AXLE);

export const WHEELS = [
  { id: 'FL', x: -TRACK, z: FRONT_AXLE, front: true },
  { id: 'FR', x: TRACK, z: FRONT_AXLE, front: true },
  { id: 'RL', x: -TRACK, z: REAR_AXLE, front: false },
  { id: 'RR', x: TRACK, z: REAR_AXLE, front: false },
].map((w) => {
  const share = w.front ? FRONT_SHARE : 1 - FRONT_SHARE;
  const k = (WEIGHT * share) / 2 / SAG;
  return { ...w, y: HARDPOINT_Y, k, c: 2 * 0.42 * Math.sqrt(k * (MASS / 4)) };
});

export const SUSPENSION = { length: SUSP_LEN, sag: SAG };

// Nozzle positions are the single geometry record shared with the mesh.
export const BOTTOM = [
  { id: 'FL', x: -0.55, y: -0.36, z: -1.98 },
  { id: 'FR', x: 0.55, y: -0.36, z: -1.98 },
  { id: 'RL', x: -0.55, y: -0.36, z: 2.06 },
  { id: 'RR', x: 0.55, y: -0.36, z: 2.06 },
];

// exhaustX is the direction cold gas leaves. Thrust on the car is the opposite.
export const LATERAL = [
  { id: 'LF', x: -0.975, y: -0.2, z: -1.98, exhaustX: -1 },
  { id: 'LR', x: -0.99, y: -0.2, z: 2.08, exhaustX: -1 },
  { id: 'RF', x: 0.975, y: -0.2, z: -1.98, exhaustX: 1 },
  { id: 'RR', x: 0.99, y: -0.2, z: 2.08, exhaustX: 1 },
];

// Bodywork points that scrape the ground when the car lands on its side or roof.
const HULL = [];
for (const sx of [-1, 1]) {
  HULL.push(
    [sx * 0.9, -0.33, -2.25], [sx * 0.95, -0.35, 0], [sx * 0.95, -0.3, 2.25],
    [sx * 0.82, 0.04, -2.28], [sx * 1.0, 0.3, -1.0], [sx * 1.0, 0.33, 1.2],
    [sx * 0.95, 0.38, 2.28], [sx * 0.86, 0.42, -0.9], [sx * 0.53, 0.69, 0.3],
    [sx * 0.42, 0.53, 1.5], [sx * 0.95, 0.4, 0.4], [sx * 1.0, -0.1, -1.95],
  );
}
HULL.push([0, 0.7, 0.2], [0, 0.62, -0.4], [0, 0.04, -2.3], [0, 0.41, 2.3]);
const HULL_POINTS = HULL.map(([x, y, z]) => new THREE.Vector3(x, y, z));

export function createState() {
  return {
    position: new THREE.Vector3(0, REST, 0),
    velocity: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    omega: new THREE.Vector3(),
    flight: false,
    grounded: 4,
    gForce: 1,
    altitudeM: 0,
    pitch: 0,
    yaw: 0,
    roll: 0,
    speed: 0,
    forwardSpeed: 0,
    steer: 0,
    charge: 1,
    bottom: { FL: 0, FR: 0, RL: 0, RR: 0 },
    lateral: { LF: 0, LR: 0, RF: 0, RR: 0 },
    wheels: WHEELS.map(() => ({ contact: true, compression: SAG, spin: 0, spinRate: 0, steer: 0, load: 0 })),
    scrape: 0,
    jump: { active: false, time: 0, armed: true, groundTime: 1, forced: false },
    jumpHeld: false,
    latch: { forward: false, steer: false },
    trick: null,
    airRot: new THREE.Vector3(),
    airTime: 0,
    lastTrick: null,
    clock: 0,
  };
}

// keepPlace: recover upright where the car is, facing its current heading.
export function resetState(state, keepPlace = false) {
  const x = keepPlace ? state.position.x : 0;
  const z = keepPlace ? state.position.z : 0;
  const yaw = keepPlace ? headingOf(state.quaternion) : 0;
  Object.assign(state, createState());
  state.position.set(x, REST + (keepPlace ? 0.25 : 0), z);
  state.quaternion.setFromAxisAngle(UP, yaw);
}

export function headingOf(q) {
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  if (f.x * f.x + f.z * f.z < 0.04) {
    const u = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const sign = u.y < 0 ? 1 : -1;
    return Math.atan2(sign * u.x, sign * u.z);
  }
  return Math.atan2(-f.x, -f.z);
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function clamp01(v) {
  return clamp(v, 0, 1);
}

// Symmetric mixer. +strafe pushes the car right. +yaw turns the nose left.
export function mixLateral(strafe, yaw) {
  const right = Math.max(strafe, 0);
  const left = Math.max(-strafe, 0);
  const yawLeft = Math.max(yaw, 0);
  const yawRight = Math.max(-yaw, 0);
  return {
    LF: clamp01(right + yawRight),
    LR: clamp01(right + yawLeft),
    RF: clamp01(left + yawLeft),
    RR: clamp01(left + yawRight),
  };
}

// lift in newtons, torques in N·m about body +X (pitch) and +Z (roll).
// Jets only push, so a pure torque request borrows a little lift; maxTotal
// caps the summed thrust so that borrowing can never become flight.
export function mixBottom(lift, torqueX, torqueZ, maxTotal = Infinity) {
  const zf = BOTTOM[0].z;
  const zr = BOTTOM[2].z;
  const x = BOTTOM[1].x;
  const frontShare = zr / (zr - zf);
  const front = (lift * frontShare) / 2;
  const rear = (lift * (1 - frontShare)) / 2;
  const p = torqueX / (2 * (zr - zf));
  const r = torqueZ / (4 * x);
  let t = [front + p - r, front + p + r, rear - p - r, rear - p + r];
  const min = Math.min(...t);
  if (min < 0) t = t.map((v) => v - min);
  t = t.map((v) => Math.min(v, BOTTOM_MAX));
  const sum = t.reduce((a, b) => a + b, 0);
  if (sum > maxTotal) t = t.map((v) => (v * maxTotal) / sum);
  return {
    FL: clamp01(t[0] / BOTTOM_MAX),
    FR: clamp01(t[1] / BOTTOM_MAX),
    RL: clamp01(t[2] / BOTTOM_MAX),
    RR: clamp01(t[3] / BOTTOM_MAX),
  };
}

const TRICKS = {
  kickflip: { axis: 'z', peak: 8.5, accel: 16 },
  backflip: { axis: 'x', peak: 6.2, accel: 11 },
};

export function step(state, input, dt) {
  const h = 1 / 240;
  let left = Math.min(Math.max(dt, 0), 0.05);
  frameInput(state, input, left);
  while (left > 1e-8) {
    const d = Math.min(h, left);
    substep(state, input, d);
    left -= d;
  }
}

// Edge-triggered actions run once per frame, not per substep.
function frameInput(state, input, dt) {
  const pressed = input.climb > 0;
  const tap = pressed && !state.jumpHeld;
  state.jumpHeld = pressed;
  const ready = state.grounded >= 2 && state.jump.armed && !state.jump.active;
  if (tap && ready && state.charge > 0.12) startJump(state, false);
  const spec = TRICKS[input.trick];
  if (spec && !state.trick && ready && state.charge > 0.45) {
    const dir = input.trick === 'kickflip' && input.strafe > 0 ? -1 : 1;
    state.trick = { ...spec, kind: input.trick, dir, angle: 0, time: 0, done: false };
    startJump(state, true);
  }
  const target = clamp(input.steer, -1, 1);
  state.steer += (target - state.steer) * Math.min(1, dt * (target === 0 ? 7 : 5));
}

function startJump(state, forced) {
  state.jump.active = true;
  state.jump.time = 0;
  state.jump.forced = forced;
  state.jump.armed = false;
}

const _qi = new THREE.Quaternion();
const _bodyUp = new THREE.Vector3();
const _down = new THREE.Vector3();
const _flatFwd = new THREE.Vector3();
const _force = new THREE.Vector3();
const _torqueW = new THREE.Vector3();
const _tBody = new THREE.Vector3();
const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _omegaW = new THREE.Vector3();
const _r = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _f = new THREE.Vector3();
const _side = new THREE.Vector3();
const _fw = new THREE.Vector3();
const _hit = { normal: new THREE.Vector3() };
const _hp = new THREE.Vector3();
const _cp = new THREE.Vector3();
const _vc = new THREE.Vector3();
const _accel = new THREE.Vector3();
const _wDes = new THREE.Vector3();
const _upB = new THREE.Vector3();
const _iw = new THREE.Vector3();
const _gyro = new THREE.Vector3();
const _euler = new THREE.Euler();
const _wq = new THREE.Quaternion();

function addForceAt(force, point) {
  _force.add(force);
  _r.subVectors(point, _p);
  _torqueW.add(_r.cross(force));
}

function pointVelocity(point, target) {
  _r.subVectors(point, _p);
  return target.crossVectors(_omegaW, _r).add(_v);
}

function substep(state, input, dt) {
  const q = state.quaternion;
  const w = state.omega;
  _qi.copy(q).invert();
  _p.copy(state.position);
  _v.copy(state.velocity);
  _omegaW.copy(w).applyQuaternion(q);
  _bodyUp.set(0, 1, 0).applyQuaternion(q);
  _down.copy(_bodyUp).negate();
  _force.set(0, -WEIGHT, 0);
  _torqueW.set(0, 0, 0);
  state.clock += dt;

  // Speeds along the body, not the horizon, so throttle and brakes work on the loop wall.
  _flatFwd.set(0, 0, -1).applyQuaternion(q);
  const vFwd = _v.dot(_flatFwd);
  const hSpeed = _v.length();

  // W/S is throttle, brake, then reverse once stopped.
  const throttle = input.forward;
  let drive = 0;
  let brake = 0;
  if (throttle > 0) {
    if (vFwd < -0.6) brake = 1;
    else drive = throttle;
  } else if (throttle < 0) {
    if (vFwd > 0.6) brake = 1;
    else drive = throttle;
  }
  let driveForce = drive * Math.min(DRIVE_FORCE, DRIVE_POWER / Math.max(Math.abs(vFwd), 1));
  if (drive > 0) driveForce *= clamp((TOP_SPEED - vFwd) / 6, 0, 1);
  if (drive < 0) driveForce *= clamp((REVERSE_SPEED + vFwd) / 3, 0, 1);
  const steerAngle = (state.steer * STEER_MAX) / (1 + hSpeed / 14);

  let contacts = 0;
  for (let i = 0; i < WHEELS.length; i += 1) {
    const spec = WHEELS[i];
    const wheel = state.wheels[i];
    wheel.steer = spec.front ? steerAngle : 0;
    wheel.load = 0;
    _hp.set(spec.x, spec.y, spec.z).applyQuaternion(q).add(_p);
    // Strut ray along the body's down axis against the floor and the loop.
    const t = castGround(_hp, _down, SUSP_LEN + WHEEL_R * 3, _hit);
    const cos = t < Infinity ? -_down.dot(_hit.normal) : 0;
    const length = cos > 0.25 ? t - WHEEL_R / cos : SUSP_LEN;
    wheel.contact = length < SUSP_LEN;
    if (!wheel.contact) {
      wheel.compression += -wheel.compression * Math.min(1, dt * 18);
      wheel.spinRate *= 1 - Math.min(1, dt * 0.35);
      wheel.spinRate += drive * dt * 60;
      wheel.spin += wheel.spinRate * dt;
      continue;
    }
    contacts += 1;
    const compression = SUSP_LEN - length;
    pointVelocity(_hp, _vc);
    // Progressive spring: soft at rest, stiff enough for the loop's g-load.
    let fs = spec.k * compression + SPRING_CUBIC * compression ** 3 + spec.c * (_vc.dot(_down) / cos);
    // Damped bump stop: absorbs hard landings instead of bouncing off them.
    if (length < 0) fs += -length * 900000 + Math.max(0, _vc.dot(_down) / cos) * 40000;
    fs = Math.max(0, fs);
    wheel.compression = Math.min(compression, SUSP_LEN + 0.05);
    _tmp.copy(_bodyUp).multiplyScalar(fs);
    addForceAt(_tmp, _hp);

    const n = _hit.normal;
    const fz = fs * cos;
    wheel.load = fz;
    _cp.copy(_down).multiplyScalar(t).add(_hp);
    // Tyre axes live in the contact plane.
    _fw.set(-Math.sin(wheel.steer), 0, -Math.cos(wheel.steer)).applyQuaternion(q);
    _fw.addScaledVector(n, -_fw.dot(n));
    if (_fw.lengthSq() < 1e-6) continue;
    _fw.normalize();
    _side.crossVectors(_fw, n);
    pointVelocity(_cp, _vc);
    const vLong = _vc.dot(_fw);
    const vLat = _vc.dot(_side);

    const slip = Math.atan2(vLat, Math.max(Math.abs(vLong), 4));
    let fy = -MU * fz * Math.tanh(slip * 9);
    let fx = driveForce / 4;
    if (brake > 0) {
      fx -= Math.tanh(vLong / 0.6) * MU * 0.95 * fz;
    } else if (drive === 0) {
      const hold = hSpeed < 0.4 ? 0.9 : 0.05;
      fx -= Math.tanh(vLong / 0.25) * hold * fz + vLong * 18;
    }
    const limit = MU * fz;
    const mag = Math.hypot(fx, fy);
    if (mag > limit) {
      fx *= limit / mag;
      fy *= limit / mag;
    }
    _f.copy(_fw).multiplyScalar(fx).addScaledVector(_side, fy);
    addForceAt(_f, _cp);

    wheel.spinRate = vLong / WHEEL_R;
    if (drive !== 0 && Math.abs(fx) >= limit * 0.98) wheel.spinRate += drive * 6;
    wheel.spin += wheel.spinRate * dt;
  }

  // Bodywork contact keeps a rolled car out of the floor, the loop and the walls.
  let scrape = 0;
  for (const local of HULL_POINTS) {
    _cp.copy(local).applyQuaternion(q).add(_p);
    const depth = penetration(_cp, _hit);
    if (depth <= 0) continue;
    const n = _hit.normal;
    pointVelocity(_cp, _vc);
    const vn = _vc.dot(n);
    const fn = Math.max(0, depth * 260000 - vn * 14000);
    _tmp.copy(_vc).addScaledVector(n, -vn);
    const vt = _tmp.length();
    const fric = (0.5 * fn) / Math.max(vt, 0.3);
    _f.copy(n).multiplyScalar(fn).addScaledVector(_tmp, -fric);
    addForceAt(_f, _cp);
    scrape = Math.max(scrape, vt * Math.min(1, fn / 6000));
  }
  state.scrape = scrape;
  state.grounded = contacts;
  const airborne = contacts === 0 && scrape === 0;

  // Lift burst. Re-arms only after the car has settled back on its wheels.
  const jump = state.jump;
  if (contacts >= 2 && !jump.active) {
    jump.groundTime += dt;
    if (jump.groundTime > 0.18) jump.armed = true;
  } else {
    jump.groundTime = 0;
  }
  let lift = 0;
  if (jump.active) {
    jump.time += dt;
    const held = input.climb > 0 || jump.forced;
    const maxTime = jump.forced ? TRICK_BURN : JUMP_MAX;
    if (state.charge <= 0 || jump.time > maxTime || (!held && jump.time > JUMP_MIN)) jump.active = false;
    else lift = JUMP_LIFT * 4 * BOTTOM_MAX;
  }

  // Attitude control: rate commands, self-levelling, and scripted tricks.
  _upB.set(0, 1, 0).applyQuaternion(_qi);
  // Keys held through take-off stay throttle/steering until released and pressed again.
  if (contacts > 0) {
    state.latch.forward = input.forward !== 0;
    state.latch.steer = input.steer !== 0;
  } else {
    if (input.forward === 0) state.latch.forward = false;
    if (input.steer === 0) state.latch.steer = false;
  }
  const pitchIn = state.latch.forward ? 0 : -input.forward;
  const yawIn = state.latch.steer ? 0 : input.steer;
  const rollIn = -input.strafe;
  const trick = state.trick;
  let torqueX = 0;
  let torqueY = 0;
  let torqueZ = 0;
  const tricking = trick && !trick.done;
  if (airborne || jump.active || tricking) {
    // Pilot rates only once properly airborne, so W held through a jump stays throttle.
    const pilot = airborne && state.airTime > 0.15 && !tricking ? 1 : 0;
    _wDes.set(pitchIn * 5 * pilot, yawIn * 3.4 * pilot, rollIn * 7.5 * pilot);
    const tilt = Math.acos(clamp(_upB.y, -1, 1));
    if (tilt < 1.25) {
      if (pitchIn * pilot === 0) _wDes.x += _upB.z * 3.2;
      if (rollIn * pilot === 0) _wDes.z -= _upB.x * 3.2;
    } else if (airborne && !tricking && rollIn * pilot === 0 && state.airTime > 0.25) {
      // Badly tilted in free fall (off the top of the loop): roll back upright.
      _wDes.z = (_upB.x >= 0 ? -1 : 1) * 4.5;
    }
    if (trick && !trick.done) {
      trick.time += dt;
      const rate = (trick.axis === 'z' ? w.z : w.x) * trick.dir;
      trick.angle += rate * dt;
      const remaining = Math.max(Math.PI * 2 - trick.angle, 0);
      // Pop straight up first, then rotate, so the roll does not eat the launch.
      const cmd = trick.time < TRICK_POP ? 0 : clamp(Math.sqrt(2 * trick.accel * remaining), 0.8, trick.peak) * trick.dir;
      if (trick.axis === 'z') _wDes.z = cmd;
      else _wDes.x = cmd;
      if (remaining < 0.12 || trick.time > 2.6) trick.done = true;
    }
    const gain = 9;
    torqueX = INERTIA.x * (_wDes.x - w.x) * gain;
    torqueY = INERTIA.y * (_wDes.y - w.y) * gain;
    torqueZ = INERTIA.z * (_wDes.z - w.z) * gain;
    if (!airborne && !tricking) {
      torqueX = 0;
      torqueY = 0;
      torqueZ = 0;
    }
  } else if (rollIn !== 0) {
    // On the ground Q/E fires one side's bottom jets: a side hop onto two wheels.
    torqueZ = rollIn * 9000;
  }
  if (trick && trick.done && contacts >= 2) state.trick = null;

  const fuel = state.charge > 0;
  const cap = jump.active ? Infinity : HOVER_CAP;
  const bottom = fuel ? mixBottom(lift, torqueX, torqueZ, cap) : mixBottom(0, 0, 0);
  const yawCmd = fuel && airborne ? clamp(torqueY / (2 * Math.abs(LATERAL[0].z) * LATERAL_MAX), -1, 1) : 0;
  const lateral = mixLateral(0, yawCmd);
  let usage = 0;
  for (const spec of BOTTOM) {
    const level = bottom[spec.id];
    state.bottom[spec.id] = level;
    usage += level;
    _tmp.set(0, level * BOTTOM_MAX, 0).applyQuaternion(q);
    _hp.set(spec.x, spec.y, spec.z).applyQuaternion(q).add(_p);
    addForceAt(_tmp, _hp);
  }
  for (const spec of LATERAL) {
    const level = lateral[spec.id];
    state.lateral[spec.id] = level;
    usage += level * 0.4;
    _tmp.set(-spec.exhaustX * level * LATERAL_MAX, 0, 0).applyQuaternion(q);
    _hp.set(spec.x, spec.y, spec.z).applyQuaternion(q).add(_p);
    addForceAt(_tmp, _hp);
  }
  if (usage > 0.01) state.charge = Math.max(0, state.charge - (usage / 4) * CHARGE_DRAIN * dt);
  else if (contacts >= 2) state.charge = Math.min(1, state.charge + CHARGE_REFILL * dt);

  _force.addScaledVector(_v, -0.42 * _v.length());
  _tBody.copy(_torqueW).applyQuaternion(_qi);
  _tBody.x -= w.x * 40;
  _tBody.y -= w.y * 60;
  _tBody.z -= w.z * 20;

  _accel.copy(_force).multiplyScalar(1 / MASS);
  state.velocity.addScaledVector(_accel, dt);
  state.position.addScaledVector(state.velocity, dt);

  // Euler's rigid-body equation in the body frame.
  _iw.set(w.x * INERTIA.x, w.y * INERTIA.y, w.z * INERTIA.z);
  _gyro.crossVectors(w, _iw);
  w.x += ((_tBody.x - _gyro.x) / INERTIA.x) * dt;
  w.y += ((_tBody.y - _gyro.y) / INERTIA.y) * dt;
  w.z += ((_tBody.z - _gyro.z) / INERTIA.z) * dt;
  const om = w.length();
  if (om > 14) w.multiplyScalar(14 / om);

  _wq.set(w.x, w.y, w.z, 0).premultiply(q);
  const half = 0.5 * dt;
  q.x += _wq.x * half;
  q.y += _wq.y * half;
  q.z += _wq.z * half;
  q.w += _wq.w * half;
  q.normalize();

  if (airborne) {
    state.airTime += dt;
    state.airRot.addScaledVector(w, dt);
  } else if (contacts >= 3) {
    if (state.airTime > 0.35) nameTrick(state);
    state.airTime = 0;
    state.airRot.set(0, 0, 0);
  }

  _euler.setFromQuaternion(q, 'YXZ');
  state.pitch = _euler.x;
  state.yaw = _euler.y;
  state.roll = _euler.z;
  state.flight = airborne;
  state.speed = state.velocity.length();
  state.forwardSpeed = vFwd;
  state.altitudeM = Math.max(0, state.position.y - REST);
  _accel.y += G;
  state.gForce += (_accel.length() / G - state.gForce) * Math.min(1, dt * 6);
}

function nameTrick(state) {
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(state.quaternion);
  if (up.y < 0.7) return;
  const turns = (v) => Math.round(Math.abs(v) / (Math.PI * 2));
  const times = (n, name) => (n > 1 ? `${n}× ${name}` : name);
  const roll = turns(state.airRot.z);
  const pitch = turns(state.airRot.x);
  const spin = Math.round(Math.abs(state.airRot.y) / Math.PI) * 180;
  const parts = [];
  if (roll >= 1) parts.push(times(roll, 'Kickflip'));
  if (pitch >= 1) parts.push(times(pitch, state.airRot.x > 0 ? 'Backflip' : 'Frontflip'));
  if (spin >= 180) parts.push(String(spin));
  if (parts.length) state.lastTrick = { name: parts.join(' + '), at: state.clock };
}
