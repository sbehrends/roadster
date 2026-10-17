import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeInput, stickToAxes } from './controls.js';
import { fitFov } from './camera.js';

const NONE = { forward: 0, steer: 0, strafe: 0, climb: 0, trick: null, reset: false };

test('joystick: pushing up drives forward, pulling down brakes', () => {
  assert.equal(stickToAxes(0, -60, 60).forward, 1);
  assert.equal(stickToAxes(0, 60, 60).forward, -1);
});

test('joystick: left steers left (+1) and right steers right (−1), like A and D', () => {
  assert.equal(stickToAxes(-60, 0, 60).steer, 1);
  assert.equal(stickToAxes(60, 0, 60).steer, -1);
});

test('joystick: a small wobble near the centre does nothing', () => {
  assert.deepEqual(stickToAxes(4, -5, 60), { forward: 0, steer: 0 });
});

test('joystick: pushing past the rim stays at full deflection', () => {
  const a = stickToAxes(0, -400, 60);
  assert.equal(a.forward, 1);
  const d = stickToAxes(300, -300, 60);
  assert.ok(Math.abs(d.steer) <= 1 && Math.abs(d.forward) <= 1);
  assert.ok(Math.hypot(d.steer, d.forward) <= 1.0001);
});

test('joystick: half deflection gives a partial, analog value', () => {
  const a = stickToAxes(0, -35, 60);
  assert.ok(a.forward > 0.3 && a.forward < 0.8, `forward=${a.forward}`);
});

test('touch and keyboard combine, clamped to full deflection', () => {
  const m = mergeInput({ ...NONE, forward: 1, steer: 1 }, { ...NONE, forward: 0.6, steer: -0.4, climb: 1 });
  assert.equal(m.forward, 1);
  assert.ok(Math.abs(m.steer - 0.6) < 1e-9);
  assert.equal(m.climb, 1);
});

test('a touch button can fire a trick or a reset', () => {
  assert.equal(mergeInput(NONE, { ...NONE, trick: 'kickflip' }).trick, 'kickflip');
  assert.equal(mergeInput(NONE, { ...NONE, reset: true }).reset, true);
  assert.equal(mergeInput({ ...NONE, trick: 'backflip' }, NONE).trick, 'backflip');
});

test('portrait screens widen the lens so the road ahead stays in view', () => {
  const portrait = fitFov(36, 390 / 844, 44);
  const hfov = (2 * Math.atan(Math.tan((portrait * Math.PI) / 360) * (390 / 844)) * 180) / Math.PI;
  assert.ok(hfov >= 43.9, `horizontal fov ${hfov.toFixed(1)}`);
  assert.ok(portrait < 110, `vertical fov ${portrait.toFixed(1)}`);
});

test('landscape screens keep the chosen lens', () => {
  assert.equal(fitFov(36, 1440 / 860, 44), 36);
  assert.equal(fitFov(36, 4 / 3, 44), 36);
});
