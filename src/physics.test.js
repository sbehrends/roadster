import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { bodyFacesPointOutward, buildCar } from './car.js';
import {
  REST,
  createState,
  mixBottom,
  mixLateral,
  resetState,
  step,
} from './physics.js';
import { LOOP, OBSTACLES } from './world.js';

const IDLE = { forward: 0, strafe: 0, steer: 0, climb: 0, trick: null };
const UP = new THREE.Vector3(0, 1, 0);

function simulate(input, seconds, state = createState(), onStep) {
  const dt = 1 / 60;
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i += 1) {
    step(state, input, dt);
    if (onStep) onStep(state);
  }
  return state;
}

function upright(state) {
  return new THREE.Vector3(0, 1, 0).applyQuaternion(state.quaternion).y;
}

test('the car rests on its four wheels when idle', () => {
  const s = simulate(IDLE, 3);
  assert.ok(Math.abs(s.position.y - REST) < 0.03, `y=${s.position.y.toFixed(3)}`);
  assert.ok(Math.hypot(s.position.x, s.position.z) < 0.05, 'idle drifts');
  assert.ok(Math.abs(s.pitch) < 0.01 && Math.abs(s.roll) < 0.01, `pitch=${s.pitch} roll=${s.roll}`);
  assert.equal(s.flight, false);
  assert.equal(s.grounded, 4);
  assert.ok(Math.abs(s.gForce - 1) < 0.05, `g=${s.gForce.toFixed(2)}`);
});

test('W drives toward −Z on four wheels with the velocity following the nose', () => {
  const s = simulate({ ...IDLE, forward: 1 }, 3);
  assert.ok(s.position.z < -20, `z=${s.position.z.toFixed(2)}`);
  assert.ok(s.forwardSpeed > 22, `v=${s.forwardSpeed.toFixed(1)}`);
  assert.equal(s.grounded, 4);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(s.quaternion).setY(0).normalize();
  const vHat = s.velocity.clone().setY(0).normalize();
  assert.ok(fwd.dot(vHat) > 0.98, `dot=${fwd.dot(vHat).toFixed(3)}`);
});

test('S brakes to a stop', () => {
  const s = simulate({ ...IDLE, forward: 1 }, 3);
  simulate({ ...IDLE, forward: -1 }, 3, s);
  assert.ok(s.forwardSpeed < 0.5, `v=${s.forwardSpeed.toFixed(2)}`);
});

test('A steers left and D steers right without rolling over', () => {
  const left = simulate({ ...IDLE, forward: 1 }, 1.5);
  simulate({ ...IDLE, forward: 0.6, steer: 1 }, 1.5, left);
  const right = simulate({ ...IDLE, forward: 1 }, 1.5);
  simulate({ ...IDLE, forward: 0.6, steer: -1 }, 1.5, right);
  assert.ok(left.yaw > 0.5, `left yaw=${left.yaw.toFixed(3)}`);
  assert.ok(right.yaw < -0.5, `right yaw=${right.yaw.toFixed(3)}`);
  assert.ok(upright(left) > 0.95 && upright(right) > 0.95);
});

test('after a left quarter-turn, W moves toward −X', () => {
  const s = createState();
  s.quaternion.setFromAxisAngle(UP, Math.PI / 2);
  simulate({ ...IDLE, forward: 1 }, 1.5, s);
  assert.ok(s.position.x < -3, `x=${s.position.x.toFixed(2)}`);
});

test('the car does not fly: holding space is a minor jump, then it comes back down', () => {
  let peak = 0;
  let lowest = 1;
  const s = simulate(IDLE, 1);
  simulate({ ...IDLE, climb: 1 }, 5, s, (st) => {
    peak = Math.max(peak, st.position.y);
    lowest = Math.min(lowest, st.charge);
  });
  assert.ok(peak > REST + 0.8, `peak=${peak.toFixed(2)}`);
  assert.ok(peak < REST + 4, `peak=${peak.toFixed(2)}`);
  assert.ok(s.position.y < REST + 0.4 && s.grounded >= 2, `y=${s.position.y.toFixed(2)}`);
  assert.ok(lowest < 0.9, `jumping should spend thruster charge (min ${lowest.toFixed(2)})`);
});

test('the car does not fly: a kickflip at speed with W held stays a minor jump', () => {
  const s = simulate({ ...IDLE, forward: 1 }, 1.8);
  step(s, { ...IDLE, forward: 1, trick: 'kickflip' }, 1 / 60);
  let peak = 0;
  let landedBy = null;
  simulate({ ...IDLE, forward: 1 }, 3, s, (st) => {
    peak = Math.max(peak, st.position.y);
    if (landedBy === null && st.clock > 2.2 && st.grounded >= 2) landedBy = st.clock;
  });
  assert.ok(peak < REST + 2.5, `peak=${peak.toFixed(2)}`);
  assert.ok(landedBy !== null, 'never came back to the ground');
});

test('the car does not fly: holding a rotation in the air never hovers', () => {
  const s = simulate(IDLE, 1);
  step(s, { ...IDLE, climb: 1 }, 1 / 60);
  let touched = null;
  simulate({ ...IDLE, strafe: -1, forward: 1 }, 4, s, (st) => {
    if (touched === null && st.clock > 1.4 && (st.grounded > 0 || st.scrape > 0)) touched = st.clock - 1;
  });
  assert.ok(touched !== null && touched < 2.5, `touched ground after ${touched}`);
});

test('thrusters perform a kickflip that lands on its wheels', () => {
  const s = simulate(IDLE, 1);
  step(s, { ...IDLE, trick: 'kickflip' }, 1 / 60);
  let rolled = 0;
  simulate(IDLE, 4, s, (st) => {
    if (st.flight) rolled = Math.max(rolled, Math.abs(st.airRot.z));
  });
  assert.ok(rolled > Math.PI * 1.8, `roll=${rolled.toFixed(2)}`);
  assert.ok(upright(s) > 0.95 && s.grounded >= 3, `up=${upright(s).toFixed(2)}`);
  assert.match(s.lastTrick?.name ?? '', /Kickflip/);
});

test('thrusters perform a backflip that lands on its wheels', () => {
  const s = simulate(IDLE, 1);
  step(s, { ...IDLE, trick: 'backflip' }, 1 / 60);
  simulate(IDLE, 5, s);
  assert.ok(upright(s) > 0.95 && s.grounded >= 3, `up=${upright(s).toFixed(2)}`);
  assert.match(s.lastTrick?.name ?? '', /flip/);
});

test('thruster mixers: lateral couple for yaw, bottom differential for roll and pitch', () => {
  const right = mixLateral(1, 0);
  assert.ok(right.LF > 0.9 && right.LR > 0.9 && right.RF < 0.1 && right.RR < 0.1);
  const yawL = mixLateral(0, 1);
  assert.ok(yawL.RF > 0.9 && yawL.LR > 0.9 && yawL.LF < 0.1 && yawL.RR < 0.1);
  const roll = mixBottom(0, 0, 5000);
  assert.ok(roll.FR > roll.FL && roll.RR > roll.RL, JSON.stringify(roll));
  const pitch = mixBottom(0, 8000, 0);
  assert.ok(pitch.FL > pitch.RL, JSON.stringify(pitch));
});

test('a car on its roof rests on the bodywork and R recovers it upright', () => {
  const s = createState();
  s.position.y = 1.4;
  s.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI);
  simulate(IDLE, 3, s);
  assert.ok(s.position.y > 0.4 && s.position.y < 1.0, `y=${s.position.y.toFixed(2)}`);
  resetState(s, true);
  simulate(IDLE, 2, s);
  assert.ok(upright(s) > 0.99 && s.grounded === 4, `up=${upright(s).toFixed(3)}`);
});

test('mesh nose points −Z', () => {
  const car = buildCar();
  const nose = car.group.getObjectByName('nose');
  const tail = car.group.getObjectByName('tail');
  const cue = new THREE.Vector3().subVectors(nose.position, tail.position).setY(0).normalize();
  assert.ok(cue.dot(new THREE.Vector3(0, 0, -1)) > 0.95);
});

test('body shell is closed and wound outward', () => {
  const car = buildCar();
  const { volume, total } = bodyFacesPointOutward(car.body.geometry, car.lower.geometry);
  assert.ok(total > 400, `faces=${total}`);
  assert.ok(volume > 3 && volume < 9, `volume=${volume.toFixed(2)} m³`);
});

// The half loop runs along −Z from its entry at LOOP.z; the top is 2·radius up.
function approachLoop(speed) {
  const s = createState();
  s.position.set(LOOP.x, REST, LOOP.z + 30);
  s.velocity.set(0, 0, -speed);
  return s;
}

test('the half loop: entering at speed carries the car up and over the top', () => {
  const s = approachLoop(29);
  let peak = 0;
  let inverted = false;
  simulate({ ...IDLE, forward: 1 }, 4, s, (st) => {
    peak = Math.max(peak, st.position.y);
    if (st.position.y > LOOP.radius * 1.5 && upright(st) < -0.6) inverted = true;
  });
  assert.ok(peak > LOOP.radius * 2 - 1.2, `peak=${peak.toFixed(2)} of ${LOOP.radius * 2}`);
  assert.ok(inverted, 'never ran inverted across the top');
});

test('the half loop: too slow and the car rolls back down without flying', () => {
  const s = approachLoop(13);
  let peak = 0;
  simulate(IDLE, 8, s, (st) => {
    peak = Math.max(peak, st.position.y);
  });
  assert.ok(peak < LOOP.radius * 1.6, `peak=${peak.toFixed(2)}`);
  assert.ok(s.position.y < REST + 1.5, `y=${s.position.y.toFixed(2)}`);
});

test('after leaving the loop inverted, the thrusters turn the car upright to land', () => {
  const s = approachLoop(29);
  let left = false;
  simulate({ ...IDLE, forward: 1 }, 3, s, (st) => {
    if (st.flight && st.position.y > LOOP.radius) left = true;
  });
  simulate(IDLE, 5, s);
  assert.ok(left, 'the car never left the loop at the top');
  assert.ok(upright(s) > 0.9 && s.grounded >= 3, `up=${upright(s).toFixed(2)} grounded=${s.grounded}`);
});

test('the arena barrier stops the car', () => {
  const wall = OBSTACLES.find((o) => o.id === 'barrier');
  const s = createState();
  // Park 6 m in front of the barrier's middle, facing it, and drive.
  // Box local +Z (its thin axis) is the wall normal.
  const nx = Math.sin(wall.yaw);
  const nz = Math.cos(wall.yaw);
  s.position.set(wall.x + nx * 6, REST, wall.z + nz * 6);
  s.quaternion.setFromAxisAngle(UP, Math.atan2(nx, nz));
  simulate({ ...IDLE, forward: 1 }, 3, s);
  const side = (s.position.x - wall.x) * nx + (s.position.z - wall.z) * nz;
  assert.ok(side > 0, `crossed the barrier: ${side.toFixed(2)}`);
});
