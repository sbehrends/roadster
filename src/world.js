import * as THREE from 'three';

// The arena the car drives in: an endless floor at y = 0, a half loop, and a
// few solid boxes (the loop's truss tower and a low LED barrier). Pure maths,
// shared by the physics and the meshes in arena.js.
//
// The half loop runs along −Z. Its entry (the bottom of the arc) is at LOOP.z.
// The arc rises from the floor to vertical at LOOP.radius ahead of the entry,
// then curls over to run inverted, back toward the entry, at 2·radius height,
// where a short flat ceiling (LOOP.top long) carries it out.

export const LOOP = { x: 0, z: -150, radius: 11, halfWidth: 3.4, top: 5 };

// The car's overhangs may dip this far into the loop face before the bodywork collides;
// on a concave arc the nose and tail sit lower than the wheels.
const LOOP_SKIN = 0.15;

// Boxes: centre (x, z), floor-to-top y0..y1, half extents along local X / Z, yaw about +Y.
// pad thickens the collision volume beyond the visual one, so a fast car cannot
// push through a slim wall before the contact springs stop it.
export const OBSTACLES = [
  { id: 'tower', x: LOOP.x, z: LOOP.z - LOOP.radius - 1.7, y0: 0, y1: LOOP.radius * 2 + 2.5, hx: LOOP.halfWidth + 1.4, hz: 1.4, yaw: 0 },
  { id: 'barrier', x: -30, z: -110, y0: 0, y1: 0.45, hx: 22, hz: 0.12, pad: 0.6, yaw: 0.55 },
];

const _p = new THREE.Vector3();

function loopLocal(point, target) {
  // u: distance along the loop's forward axis (−Z), v: height, w: across (+X).
  return target.set(LOOP.z - point.z, point.y, point.x - LOOP.x);
}

// Cast a ray against every surface. Returns the hit distance (Infinity for a
// miss) and writes the surface normal into hit.normal.
export function castGround(origin, dir, maxT, hit) {
  let best = Infinity;
  if (dir.y < -1e-4) {
    const t = -origin.y / dir.y;
    if (t >= 0 && t < maxT) {
      best = t;
      hit.normal.set(0, 1, 0);
    }
  }

  const o = loopLocal(origin, _p);
  const du = -dir.z;
  const dv = dir.y;
  const dw = dir.x;
  const R = LOOP.radius;

  // Inside face of the arc: a cylinder about the axis (u = 0, v = R), seen from inside.
  const cu = o.x;
  const cv = o.y - R;
  const a = du * du + dv * dv;
  if (a > 1e-8) {
    const b = 2 * (du * cu + dv * cv);
    const c = cu * cu + cv * cv - R * R;
    if (c < 0) {
      const t = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
      if (t >= 0 && t < Math.min(best, maxT)) {
        const hu = o.x + du * t;
        const hv = o.y + dv * t;
        const hw = o.z + dw * t;
        const phi = Math.atan2(hu, R - hv);
        if (phi >= 0 && phi <= Math.PI && Math.abs(hw) <= LOOP.halfWidth) {
          best = t;
          const nu = -hu / R;
          const nv = (R - hv) / R;
          hit.normal.set(0, nv, -nu);
        }
      }
    }
  }

  // The short inverted run-out at the top, facing down.
  if (dv > 1e-4) {
    const t = (2 * R - o.y) / dv;
    if (t >= 0 && t < Math.min(best, maxT)) {
      const hu = o.x + du * t;
      const hw = o.z + dw * t;
      if (hu <= 0 && hu >= -LOOP.top && Math.abs(hw) <= LOOP.halfWidth) {
        best = t;
        hit.normal.set(0, -1, 0);
      }
    }
  }
  return best;
}

// How deep a point sits inside any solid, with the push-out normal.
export function penetration(point, out) {
  let depth = 0;
  if (point.y < 0) {
    depth = -point.y;
    out.normal.set(0, 1, 0);
  }

  const o = loopLocal(point, _p);
  const R = LOOP.radius;
  if (Math.abs(o.z) <= LOOP.halfWidth) {
    const cu = o.x;
    const cv = o.y - R;
    const dist = Math.hypot(cu, cv);
    const phi = Math.atan2(o.x, R - o.y);
    if (phi >= 0.05 && phi <= Math.PI && dist > R + LOOP_SKIN && dist < R + 0.8) {
      const d = dist - R - LOOP_SKIN;
      if (d > depth) {
        depth = d;
        out.normal.set(0, -cv / dist, cu / dist);
      }
    }
    if (o.x <= 0 && o.x >= -LOOP.top && o.y > 2 * R + LOOP_SKIN && o.y < 2 * R + 0.8) {
      const d = o.y - 2 * R - LOOP_SKIN;
      if (d > depth) {
        depth = d;
        out.normal.set(0, -1, 0);
      }
    }
  }

  for (const box of OBSTACLES) {
    if (point.y < box.y0 || point.y > box.y1) continue;
    const c = Math.cos(box.yaw);
    const s = Math.sin(box.yaw);
    const dx = point.x - box.x;
    const dz = point.z - box.z;
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    const pad = box.pad ?? 0;
    const px = box.hx + pad - Math.abs(lx);
    const pz = box.hz + pad - Math.abs(lz);
    const py = box.y1 - point.y;
    if (px <= 0 || pz <= 0) continue;
    const d = Math.min(px, pz, py);
    if (d <= depth) continue;
    depth = d;
    if (d === py) out.normal.set(0, 1, 0);
    else if (d === px) out.normal.set(Math.sign(lx) * c, 0, -Math.sign(lx) * s);
    else out.normal.set(Math.sign(lz) * s, 0, Math.sign(lz) * c);
  }
  return depth;
}
