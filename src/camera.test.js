import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAMERAS, createRig, cycleRig, dragRig, resetRig, rigOffset, settleRig, zoomRig } from './camera.js';

test('a second camera sits further away than the chase camera', () => {
  const rig = createRig();
  const near = rigOffset(rig, 0);
  const far = rigOffset({ ...rig, mode: 1 }, 0);
  assert.ok(CAMERAS.length >= 2);
  assert.ok(Math.hypot(far.back, far.up) > Math.hypot(near.back, near.up) * 1.8, JSON.stringify({ near, far }));
});

test('C cycles through the cameras and wraps around', () => {
  const rig = createRig();
  const seen = [rig.mode];
  for (let i = 0; i < CAMERAS.length; i += 1) seen.push(cycleRig(rig) && rig.mode);
  assert.equal(seen.at(-1), seen[0]);
  assert.equal(new Set(seen).size, CAMERAS.length);
});

test('dragging orbits sideways and tilts the camera up, within limits', () => {
  const rig = createRig();
  const before = rigOffset(rig, 0);
  const orbit = rig.orbit;
  dragRig(rig, 100, 0);
  assert.notEqual(rig.orbit, orbit);
  dragRig(rig, 0, 120);
  const raised = rigOffset(rig, 0);
  assert.ok(raised.up > before.up, `up ${before.up} → ${raised.up}`);
  dragRig(rig, 0, 100000);
  const top = rigOffset(rig, 0);
  assert.ok(top.back > 0.2, 'never goes straight overhead');
  dragRig(rig, 0, -100000);
  assert.ok(rigOffset(rig, 0).up > 0, 'never goes under the floor');
});

test('the wheel zooms in and out, within limits', () => {
  const rig = createRig();
  const base = Math.hypot(...Object.values(rigOffset(rig, 0)).slice(0, 2));
  zoomRig(rig, 400);
  const out = rigOffset(rig, 0);
  assert.ok(Math.hypot(out.back, out.up) > base);
  zoomRig(rig, -100000);
  const closest = rigOffset(rig, 0);
  assert.ok(Math.hypot(closest.back, closest.up) > base * 0.5);
  zoomRig(rig, 100000);
  const furthest = rigOffset(rig, 0);
  assert.ok(Math.hypot(furthest.back, furthest.up) < base * 2.5);
});

test('V resets the view behind the car', () => {
  const rig = createRig();
  dragRig(rig, 300, 200);
  zoomRig(rig, 500);
  resetRig(rig);
  assert.deepEqual([rig.orbit, rig.tilt, rig.zoom], [0, 0, 1]);
});

test('after a while without dragging, driving swings the view back behind the car', () => {
  const rig = createRig();
  dragRig(rig, 400, 150);
  for (let i = 0; i < 60 * 6; i += 1) settleRig(rig, 1 / 60, 20, false);
  assert.ok(Math.abs(rig.orbit) < 0.05 && Math.abs(rig.tilt) < 0.05, `orbit=${rig.orbit} tilt=${rig.tilt}`);
});

test('a parked car keeps the view where the user left it', () => {
  const rig = createRig();
  dragRig(rig, 400, 0);
  const orbit = rig.orbit;
  for (let i = 0; i < 60 * 6; i += 1) settleRig(rig, 1 / 60, 0, false);
  assert.equal(rig.orbit, orbit);
});
