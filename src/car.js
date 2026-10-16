import * as THREE from 'three';
import { BOTTOM, FRONT_AXLE, LATERAL, REAR_AXLE, REST, SUSPENSION, WHEELS, WHEEL_R } from './physics.js';

// Shape measured off the near-orthographic studio side frame (Untitled.mov),
// with widths from the top, front and rear studio stills. A sharp wedge nose,
// fender crests that climb from the light bar to the A-pillars either side of
// a short flat hood, a high 0.95 m beltline under a thin strip of side glass,
// one continuous bronze glass roof between body-colour rails, rear sails
// beside a trapezoid rear window, and a black lower body that grows into a
// wedge toward the tall tail. Nose is −Z. Heights below are metres off the
// ground at rest; the mesh origin is the centre of gravity.

const NOSE = -2.3;
// The body shell ends at TAIL; a body-colour blade carrying the light bar overhangs it to BLADE_Z.
const TAIL = 2.24;
const BLADE_Z = 2.32;
const END = 2.32;
const BLADE_Y = 0.83;
const ARCH_R = 0.42;
const HUB_Y = WHEEL_R;
const FLOOR = 0.17;
const TUNNEL_X = 0.6;

// Monotone cubic (Fritsch–Carlson) through measured points: smooth, no overshoot.
function table(points) {
  const n = points.length;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const d = [];
  for (let i = 0; i < n - 1; i += 1) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i += 1) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i += 1) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return (z) => {
    if (z <= xs[0]) return ys[0];
    if (z >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (z > xs[i + 1]) i += 1;
    const h = xs[i + 1] - xs[i];
    const t = (z - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

// Windshield base: straight across the hood's rear edge, then swept back over
// the fender facets to the A-pillar feet.
const WS_Z = -1.58;
const A_PILLAR_Z = -1.24;

const hoodY = table([[NOSE, 0.555], [-2.0, 0.645], [-1.58, 0.762], [-1.3, 0.79], [1.7, 0.82], [1.9, 0.9], [1.98, 0.956], [TAIL, 0.926], [END, 0.924]]);
const hoodX = table([[NOSE, 0.655], [-1.58, 0.5], [-1.2, 0.49], [1.8, 0.5], [END, 0.56]]);
// In front of the A-pillar the crest is the outer shoulder crease; behind it, it steps in to become the beltline.
const crestX = table([[NOSE, 0.668], [-2.15, 0.83], [-2.0, 0.945], [-1.8, 0.975], [-1.5, 0.982], [-1.35, 0.94], [A_PILLAR_Z, 0.885], [-0.5, 0.872], [0.1, 0.855], [0.6, 0.79], [1.0, 0.7], [1.4, 0.635], [1.8, 0.64], [2.1, 0.8], [END, 0.94]]);
const crestY = table([
  [NOSE, 0.573], [-2.13, 0.657], [-1.99, 0.728], [-1.85, 0.779], [-1.71, 0.818], [-1.57, 0.852],
  [-1.43, 0.88], [A_PILLAR_Z, 0.915], [-0.9, 0.912], [-0.3, 0.915], [0.5, 0.92], [1.1, 0.93],
  [1.6, 0.94], [2.0, 0.945], [END, 0.92],
]);
const shoulderDrop = table([[NOSE, 0.006], [-1.5, 0.01], [A_PILLAR_Z, 0.045], [-0.9, 0.055], [0, 0.05], [0.8, 0.055], [1.5, 0.05], [2.1, 0.03], [END, 0.015]]);
const halfW = table([[NOSE, 0.675], [-2.15, 0.84], [-2.0, 0.965], [-1.8, 0.99], [-1.6, 1.0], [1.9, 1.0], [2.15, 0.99], [END, 0.975]]);
const lowY = table([
  [NOSE, 0.39], [-2.0, 0.37], [-1.8, 0.36], [-1.03, 0.29], [-0.6, 0.296], [-0.05, 0.32], [0.52, 0.34],
  [0.8, 0.375], [1.08, 0.42], [1.22, 0.446], [1.64, 0.55], [2.06, 0.62], [END, 0.7],
]);
const floorY = table([[NOSE, 0.24], [-2.05, 0.19], [-1.8, FLOOR], [1.9, FLOOR], [END, 0.26]]);

function archY(z) {
  let y = 0;
  for (const axle of [FRONT_AXLE, REAR_AXLE]) {
    const dz = z - axle;
    if (Math.abs(dz) <= ARCH_R) y = Math.max(y, HUB_Y + Math.sqrt(ARCH_R * ARCH_R - dz * dz));
  }
  return y;
}

// Right-hand cross-section, top centre round to bottom centre.
// 0 hood centre · 1 hood edge · 2 fender crest / beltline · 3 shoulder · 4 lower crease
// 5 rocker top · 6 rocker foot · 7 wheel-tunnel roof · 8 tunnel foot · 9 floor centre
function hullSection(z) {
  const cx = crestX(z);
  const cy = crestY(z);
  const w = halfW(z);
  const hood = hoodY(z);
  const arch = archY(z);
  const floor = floorY(z);
  const low = lowY(z);
  const foot = Math.max(floor, arch);
  const shoulder = [Math.max(w - 0.012, cx + 0.004), Math.max(cy - shoulderDrop(z), arch)];
  // Points cut by a wheel arch slide up the side plane, so the panel keeps its angle.
  const onSide = (x, y) => {
    if (y >= arch) return [x, y];
    const t = (shoulder[1] - arch) / Math.max(shoulder[1] - y, 1e-4);
    return [shoulder[0] + (x - shoulder[0]) * t, arch];
  };
  return [
    [0, hood],
    [hoodX(z), hood - 0.003],
    [cx, cy],
    shoulder,
    onSide(w, low),
    onSide(w - 0.04, low - 0.03),
    [w - 0.05, foot],
    [TUNNEL_X, foot],
    [TUNNEL_X, floor],
    [0, floor - 0.01],
  ];
}

const HULL_MATERIAL = ['paint', 'paint', 'paint', 'paint', 'black', 'black', 'well', 'well', 'well'];

function hullStations() {
  const zs = [];
  for (let z = NOSE; z <= TAIL + 1e-6; z += 0.05) zs.push(z);
  for (const axle of [FRONT_AXLE, REAR_AXLE]) {
    for (let i = 0; i <= 24; i += 1) zs.push(axle - ARCH_R * Math.cos((i / 24) * Math.PI));
    zs.push(axle - ARCH_R - 0.003, axle + ARCH_R + 0.003);
  }
  zs.push(NOSE + 0.02, TAIL - 0.02);
  zs.sort((a, b) => a - b);
  const out = [];
  for (const z of zs) {
    if (z < NOSE - 1e-6 || z > TAIL + 1e-6) continue;
    if (out.length && z - out[out.length - 1] < 0.0015) continue;
    out.push(Math.min(TAIL, Math.max(NOSE, z)));
  }
  out[out.length - 1] = TAIL;
  return out;
}

function toLocal(yGround) {
  return yGround - REST;
}

// Buckets collect flat triangle soups per material.
function makeBuckets() {
  const b = {};
  for (const id of ['paint', 'black', 'glass', 'trim', 'chrome', 'well']) b[id] = { pos: [], nor: [] };
  return b;
}

function pushTri(bucket, a, b, c, na, nb, nc) {
  const ab = new THREE.Vector3().subVectors(b, a);
  const ac = new THREE.Vector3().subVectors(c, a);
  if (ab.cross(ac).lengthSq() < 1e-12) return;
  for (const [p, n] of [[a, na], [b, nb], [c, nc]]) {
    bucket.pos.push(p.x, p.y, p.z);
    bucket.nor.push(n.x, n.y, n.z);
  }
}

const SMOOTH = Math.cos(THREE.MathUtils.degToRad(26));

// Loft right-hand sections (arrays of Vector3) along the car and mirror them.
// Normals are smooth along the car and hard across each strip, so every
// strip reads as a crisp panel with a soft gradient.
function loft(buckets, sections, materialOf) {
  const count = sections[0].length;
  for (let i = 0; i < count - 1; i += 1) {
    for (const side of [1, -1]) {
      const pts = sections.map((sec) => [sec[i], sec[i + 1]].map((p) => new THREE.Vector3(p.x * side, p.y, p.z)));
      const normals = [];
      for (let s = 0; s < pts.length - 1; s += 1) {
        const [A, B] = pts[s];
        const [D, C] = pts[s + 1];
        const n = new THREE.Vector3().subVectors(C, A).cross(new THREE.Vector3().subVectors(B, D));
        if (side < 0) n.negate();
        normals.push(n.lengthSq() > 1e-12 ? n.normalize() : null);
      }
      for (let s = 0; s < normals.length; s += 1) {
        const n = normals[s];
        if (!n) continue;
        const prev = normals[s - 1];
        const next = normals[s + 1];
        const n0 = prev && prev.dot(n) > SMOOTH ? prev.clone().add(n).normalize() : n;
        const n1 = next && next.dot(n) > SMOOTH ? next.clone().add(n).normalize() : n;
        const [A, B] = pts[s];
        const [D, C] = pts[s + 1];
        const bucket = buckets[materialOf(i, (A.z + D.z) / 2)];
        if (side > 0) {
          pushTri(bucket, A, D, B, n0, n1, n0);
          pushTri(bucket, B, D, C, n0, n1, n1);
        } else {
          pushTri(bucket, A, B, D, n0, n0, n1);
          pushTri(bucket, B, C, D, n0, n1, n1);
        }
      }
    }
  }
}

// Split a convex-or-not polygon by an axis-aligned line, keeping one side.
function clip(poly, axis, value, keepAbove) {
  const out = [];
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ina = keepAbove ? a[axis] >= value : a[axis] <= value;
    const inb = keepAbove ? b[axis] >= value : b[axis] <= value;
    if (ina) out.push(a);
    if (ina !== inb) {
      const t = (value - a[axis]) / (b[axis] - a[axis]);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

function capPolygon(bucket, poly, z, facing) {
  if (poly.length < 3) return;
  const clean = [];
  for (const p of poly) {
    const last = clean[clean.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-5) clean.push(p);
  }
  if (clean.length > 2 && Math.hypot(clean[0][0] - clean.at(-1)[0], clean[0][1] - clean.at(-1)[1]) < 1e-5) clean.pop();
  if (clean.length < 3) return;
  const contour = clean.map(([x, y]) => new THREE.Vector2(x, y));
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  const n = new THREE.Vector3(0, 0, facing);
  for (const [i, j, k] of tris) {
    const a = new THREE.Vector3(clean[i][0], toLocal(clean[i][1]), z);
    const b = new THREE.Vector3(clean[j][0], toLocal(clean[j][1]), z);
    const c = new THREE.Vector3(clean[k][0], toLocal(clean[k][1]), z);
    const face = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    if (face.z * facing < 0) pushTri(bucket, a, c, b, n, n, n);
    else pushTri(bucket, a, b, c, n, n, n);
  }
}

// Extrude a section polygon (x, ground y) along z from z0 to z1, with an end cap at z1.
function extrudeCap(bucket, poly, z0, z1) {
  const n = poly.length;
  for (let i = 0; i < n; i += 1) {
    const [xa, ya] = poly[i];
    const [xb, yb] = poly[(i + 1) % n];
    const a0 = new THREE.Vector3(xa, toLocal(ya), z0);
    const b0 = new THREE.Vector3(xb, toLocal(yb), z0);
    const a1 = new THREE.Vector3(xa, toLocal(ya), z1);
    const b1 = new THREE.Vector3(xb, toLocal(yb), z1);
    const nrm = new THREE.Vector3().subVectors(b0, a0).cross(new THREE.Vector3(0, 0, 1)).normalize();
    if (nrm.lengthSq() < 0.5) continue;
    // Outward for a counter-clockwise polygon seen from +z; flip otherwise.
    const out = nrm.dot(new THREE.Vector3(xa + xb, toLocal(ya + yb) - toLocal(1.7), 0)) < 0 ? nrm.negate() : nrm;
    const face = new THREE.Vector3().subVectors(b0, a0).cross(new THREE.Vector3().subVectors(a1, a0));
    if (face.dot(out) > 0) {
      pushTri(bucket, a0, b0, a1, out, out, out);
      pushTri(bucket, b0, b1, a1, out, out, out);
    } else {
      pushTri(bucket, a0, a1, b0, out, out, out);
      pushTri(bucket, b0, a1, b1, out, out, out);
    }
  }
  capPolygon(bucket, poly, z1, 1);
}

function sectionOutline(z) {
  const right = hullSection(z);
  const left = right.slice().reverse().map(([x, y]) => [-x, y]);
  return [...right, ...left];
}

function buildHull(buckets) {
  const zs = hullStations();
  const sections = zs.map((z) => hullSection(z).map(([x, y]) => new THREE.Vector3(x, toLocal(y), z)));
  loft(buckets, sections, (strip) => HULL_MATERIAL[strip]);

  // Nose: a thin body-colour lip over the light bar, a glossy black band and
  // an open intake under it, body-colour corner faces either side.
  const nose = sectionOutline(NOSE);
  const barY = 0.538;
  capPolygon(buckets.paint, clip(nose, 1, barY, true), NOSE, -1);
  const below = clip(nose, 1, barY, false);
  capPolygon(buckets.glass, clip(below, 1, 0.45, true), NOSE, -1);
  capPolygon(buckets.black, clip(below, 1, 0.45, false), NOSE, -1);

  // Tail: the black rear face sits recessed under a body-colour blade that
  // carries the light bar and overhangs it.
  const tail = sectionOutline(TAIL);
  capPolygon(buckets.black, clip(tail, 1, BLADE_Y, false), TAIL, 1);
  const blade = clip(tail, 1, BLADE_Y, true).map(([x, y]) => [x * 1.012, y]);
  extrudeCap(buckets.paint, blade, TAIL, BLADE_Z);
}

// Canopy rings. g0 centre line, gh hood corner track, g1 roof crease (the rail
// top seen in side view), g2 beltline on the hull crest. wb is how far up the
// side the window bottom sits: 0 at the belt, 1 = no side glass (the sails).
// The first ring is buried a hair under the hood so the glass emerges cleanly.
const RINGS = [
  { base: true, g0: [0, 0, WS_Z], gh: [0.5, 0, WS_Z + 0.02], g1: [0.878, 0, A_PILLAR_Z], g2: [0.878, 0, A_PILLAR_Z], wb: 0 },
  { g0: [0, 0.93, -1.15], gh: [0.5, 0.937, -1.1], g1: [0.8, 0.988, -0.97], wb: 0 },
  { g0: [0, 1.04, -0.8], gh: [0.45, 1.05, -0.78], g1: [0.71, 1.067, -0.72], wb: 0 },
  { g0: [0, 1.13, -0.45], gh: [0.4, 1.135, -0.45], g1: [0.62, 1.143, -0.44], wb: 0 },
  { g0: [0, 1.198, -0.12], gh: [0.36, 1.2, -0.12], g1: [0.56, 1.2, -0.14], wb: 0 },
  { g0: [0, 1.225, 0.27], gh: [0.34, 1.224, 0.27], g1: [0.53, 1.215, 0.27], wb: 0 },
  { g0: [0, 1.214, 0.55], gh: [0.32, 1.213, 0.55], g1: [0.51, 1.205, 0.55], wb: 0 },
  { g0: [0, 1.172, 0.83], gh: [0.3, 1.171, 0.83], g1: [0.49, 1.165, 0.83], wb: 0.45 },
  { g0: [0, 1.116, 1.11], gh: [0.28, 1.115, 1.11], g1: [0.44, 1.11, 1.11], wb: 1 },
  { g0: [0, 1.064, 1.4], gh: [0.25, 1.063, 1.4], g1: [0.39, 1.06, 1.4], wb: 1 },
  { g0: [0, 1.013, 1.68], gh: [0.22, 1.012, 1.68], g1: [0.345, 1.01, 1.68], wb: 1 },
  { g0: [0, 0.963, 1.98], gh: [0.19, 0.963, 1.98], g1: [0.3, 0.961, 1.98], wb: 1 },
];

function beltAt(z) {
  return [crestX(z) - 0.004, crestY(z) - 0.006, z];
}

// Height of the hull's top surface (hood, facet, crest) at (x, z).
function hullTop(x, z) {
  const sec = hullSection(z);
  for (let i = 0; i < 3; i += 1) {
    const [x0, y0] = sec[i];
    const [x1, y1] = sec[i + 1];
    if (x <= x1 || i === 2) return y0 + ((y1 - y0) * (x - x0)) / Math.max(x1 - x0, 1e-4);
  }
  return sec[0][1];
}

function canopyFrame() {
  const tracks = [[], [], [], []];
  for (const ring of RINGS) {
    // The windshield's base ring sits exactly on the hull, so the glass edge is crisp.
    if (ring.base) for (const key of ['g0', 'gh', 'g1', 'g2']) ring[key][1] = hullTop(ring[key][0], ring[key][2]) + 0.002;
    tracks[0].push(new THREE.Vector3(...ring.g0));
    tracks[1].push(new THREE.Vector3(...ring.gh));
    tracks[2].push(new THREE.Vector3(...ring.g1));
    tracks[3].push(new THREE.Vector3(...(ring.g2 ?? beltAt(ring.g1[2]))));
  }
  const curves = tracks.map((pts) => new THREE.CatmullRomCurve3(pts, false, 'centripetal'));
  return (t) => {
    const [g0, gh, g1, g2] = curves.map((c) => c.getPoint(t));
    // Belt points follow the hull crest exactly so the glass sits on the shoulder.
    if (t > 0 && g2.z > A_PILLAR_Z + 0.2) {
      const [x, y] = beltAt(g2.z);
      g2.x = x;
      g2.y = y;
    }
    g1.y = Math.max(g1.y, g2.y);
    const f = t * (RINGS.length - 1);
    const k = Math.min(RINGS.length - 2, Math.floor(f));
    const wb = THREE.MathUtils.lerp(RINGS[k].wb, RINGS[k + 1].wb, f - k);
    const rail = g1.clone().lerp(g2, Math.min(0.2, 0.032 / Math.max(g1.distanceTo(g2), 1e-3)));
    const sill = g2.clone().lerp(rail, wb);
    return [g0, gh, g1, rail, sill, g2];
  };
}

function buildCanopy(buckets) {
  const frame = canopyFrame();
  const steps = 96;
  const sections = [];
  for (let s = 0; s <= steps; s += 1) {
    sections.push(frame(s / steps).map((p) => new THREE.Vector3(p.x, toLocal(p.y), p.z)));
  }
  loft(buckets, sections, (strip) => ['glass', 'glass', 'paint', 'glass', 'paint'][strip]);
  return frame;
}

// Thin ribbons a hair off the surface: panel cuts and glass frame bars.
// points are right-hand; the ribbon is mirrored to the left and its width runs along z.
function ribbon(bucket, points, width = 0.004, lift = 0.0025) {
  const zAxis = new THREE.Vector3(0, 0, 1);
  for (const side of [1, -1]) {
    const pts = points.map((p) => new THREE.Vector3(p.x * side, p.y, p.z));
    for (let i = 0; i < pts.length - 1; i += 1) {
      const a = pts[i];
      const b = pts[i + 1];
      const dir = new THREE.Vector3().subVectors(b, a).normalize();
      const n = new THREE.Vector3().crossVectors(dir, zAxis).normalize();
      if (n.dot(new THREE.Vector3(a.x + b.x, a.y + b.y + 0.4, 0)) < 0) n.negate();
      const o = n.clone().multiplyScalar(lift);
      const q = [
        a.clone().add(o).setZ(a.z - width), a.clone().add(o).setZ(a.z + width),
        b.clone().add(o).setZ(b.z + width), b.clone().add(o).setZ(b.z - width),
      ];
      const face = new THREE.Vector3().subVectors(q[1], q[0]).cross(new THREE.Vector3().subVectors(q[2], q[0]));
      if (face.dot(n) > 0) {
        pushTri(bucket, q[0], q[1], q[2], n, n, n);
        pushTri(bucket, q[0], q[2], q[3], n, n, n);
      } else {
        pushTri(bucket, q[0], q[2], q[1], n, n, n);
        pushTri(bucket, q[0], q[3], q[2], n, n, n);
      }
    }
  }
}

function sideSeam(buckets, zTop, zBottom) {
  const pts = [];
  for (let i = 0; i <= 14; i += 1) {
    const t = i / 14;
    const z = THREE.MathUtils.lerp(zTop, zBottom, t);
    const sec = hullSection(z);
    const a = sec[3];
    const b = sec[4];
    pts.push(new THREE.Vector3(a[0] + (b[0] - a[0]) * t, toLocal(a[1] + (b[1] - a[1]) * t), z));
  }
  ribbon(buckets.trim, pts, 0.0035);
}

function hoodSeam(buckets, z) {
  const sec = hullSection(z);
  const pts = [];
  for (let i = 0; i <= 6; i += 1) {
    const x = (sec[1][0] * i) / 6;
    pts.push(new THREE.Vector3(x, toLocal(sec[0][1] + ((sec[1][1] - sec[0][1]) * i) / 6), z));
  }
  ribbon(buckets.trim, pts, 0.003);
}

// Body-colour frame bars across the glass roof and the B-pillar in the side glass.
function canopyDetails(buckets, frame) {
  const findT = (z, index) => {
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 30; k += 1) {
      const mid = (lo + hi) / 2;
      if (frame(mid)[index].z < z) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  const local = (p) => new THREE.Vector3(p.x, toLocal(p.y), p.z);
  for (const z of [-0.3, 0.52]) {
    const [g0, gh, g1] = frame(findT(z, 0)).map(local);
    ribbon(buckets.trim, [g0, gh, g1], 0.005, 0.002);
  }
  const [, , , rail, sill] = frame(findT(0.5, 3)).map(local);
  const low = sill.clone().lerp(rail, 0.02);
  ribbon(buckets.trim, [rail, low], 0.006, 0.003);
}

function bucketGeometry(bucket) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(bucket.pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(bucket.nor, 3));
  geo.computeBoundingSphere();
  return geo;
}

function plateMaterial() {
  if (typeof document === 'undefined') {
    return new THREE.MeshStandardMaterial({ color: 0xd9d9d6, roughness: 0.5 });
  }
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 160;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#d6d6d2';
  ctx.fillRect(0, 0, 512, 160);
  ctx.strokeStyle = '#9d9d98';
  ctx.lineWidth = 8;
  ctx.strokeRect(10, 10, 492, 140);
  ctx.fillStyle = '#8e8e8a';
  ctx.font = '600 96px "IBM Plex Sans", "Avenir Next", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('RDSTR', 256, 86);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, metalness: 0.1 });
}

const RIM_R = 0.31;

function tireGeometry(width) {
  const r = WHEEL_R;
  const rim = RIM_R - 0.004;
  const hw = width / 2;
  const pts = [
    [rim, -hw + 0.01], [rim + 0.016, -hw], [r - 0.03, -hw + 0.002], [r - 0.008, -hw + 0.016],
    [r, -hw + 0.05], [r + 0.002, 0], [r, hw - 0.05], [r - 0.008, hw - 0.016], [r - 0.03, hw - 0.002],
    [rim + 0.016, hw], [rim, hw - 0.01],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const geo = new THREE.LatheGeometry(pts, 80);
  geo.rotateZ(Math.PI / 2);
  return geo;
}

// Six thin black blades, swept a few degrees, on a light satin aero disc.
function spokeGeometry() {
  const shape = new THREE.Shape();
  const sweep = 0.035;
  shape.moveTo(0.05, -0.024);
  shape.quadraticCurveTo(0.18, -0.02 + sweep * 0.4, RIM_R - 0.012, -0.011 + sweep);
  shape.lineTo(RIM_R - 0.012, 0.011 + sweep);
  shape.quadraticCurveTo(0.18, 0.02 + sweep * 0.4, 0.05, 0.024);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.016, bevelEnabled: true, bevelSize: 0.003, bevelThickness: 0.004, bevelSegments: 2, curveSegments: 8 });
  geo.rotateY(Math.PI / 2);
  return geo;
}

function makeWheel(mats, width) {
  const group = new THREE.Group();
  const spin = new THREE.Group();
  group.add(spin);
  const hw = width / 2;
  const tire = new THREE.Mesh(tireGeometry(width), mats.rubber);
  spin.add(tire);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(RIM_R - 0.004, RIM_R - 0.004, width - 0.02, 48, 1, true), mats.rimDark);
  barrel.rotation.z = Math.PI / 2;
  spin.add(barrel);

  const face = new THREE.Mesh(new THREE.CircleGeometry(RIM_R - 0.014, 72), mats.rimFace);
  face.rotation.y = Math.PI / 2;
  face.position.x = hw - 0.028;
  spin.add(face);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(RIM_R - 0.008, 0.009, 8, 80), mats.rimDark);
  lip.rotation.y = Math.PI / 2;
  lip.position.x = hw - 0.024;
  spin.add(lip);
  const spokeGeo = spokeGeometry();
  for (let i = 0; i < 6; i += 1) {
    const mesh = new THREE.Mesh(spokeGeo, mats.blade);
    mesh.rotation.x = (i / 6) * Math.PI * 2;
    mesh.position.x = hw - 0.03;
    spin.add(mesh);
  }
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.03, 36), mats.blade);
  cap.rotation.z = Math.PI / 2;
  cap.position.x = hw - 0.02;
  spin.add(cap);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.02, 40), mats.rimDark);
  disc.rotation.z = Math.PI / 2;
  disc.position.x = -0.02;
  spin.add(disc);
  for (const mesh of [tire, face]) mesh.castShadow = true;
  return { group, spin };
}

const plumeVertex = /* glsl */ `
  varying float vT;
  varying vec3 vN;
  varying vec3 vView;
  void main() {
    vT = uv.y;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const plumeFragment = /* glsl */ `
  uniform float uAmount;
  uniform float uTime;
  uniform vec3 uColor;
  varying float vT;
  varying vec3 vN;
  varying vec3 vView;
  void main() {
    float rim = pow(abs(dot(normalize(vN), normalize(vView))), 1.6);
    float along = pow(clamp(1.0 - vT, 0.0, 1.0), 1.4);
    float flicker = 0.85 + 0.15 * sin(uTime * 61.0 + vT * 24.0);
    float a = clamp(rim * along * uAmount * flicker, 0.0, 1.0);
    gl_FragColor = vec4(uColor * a * 1.3, a);
  }
`;

function makePlume(exhaust) {
  const group = new THREE.Group();
  const geo = new THREE.CylinderGeometry(0.16, 0.04, 1, 20, 1, true);
  geo.translate(0, 0.5, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uAmount: { value: 0 }, uTime: { value: 0 }, uColor: { value: new THREE.Color(0xe9f2ff) } },
    vertexShader: plumeVertex,
    fragmentShader: plumeFragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const core = new THREE.Mesh(geo, mat);
  const haze = new THREE.Mesh(geo, mat.clone());
  haze.material.uniforms = {
    uAmount: { value: 0 },
    uTime: mat.uniforms.uTime,
    uColor: { value: new THREE.Color(0xb8c8dd) },
  };
  haze.scale.set(2.4, 1.3, 2.4);
  group.add(core, haze);
  group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), exhaust.clone().normalize());
  group.userData.core = core;
  group.userData.haze = haze;
  group.visible = false;
  group.renderOrder = 10;
  return group;
}

function nozzleMesh(exhaust, radius, mats) {
  const group = new THREE.Group();
  const bell = new THREE.LatheGeometry(
    [[radius * 0.55, 0.0], [radius * 0.62, 0.025], [radius * 0.85, 0.055], [radius, 0.075], [radius * 1.08, 0.08]].map(
      ([x, y]) => new THREE.Vector2(x, y),
    ),
    32,
  );
  const mesh = new THREE.Mesh(bell, mats.nozzle);
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xcfe0ff, transparent: true, opacity: 0 });
  const glow = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.6, 24), glowMat);
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.012;
  group.add(mesh, glow);
  group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), exhaust.clone().normalize());
  group.userData.glow = glow;
  return group;
}

function makeMaterials({ attitude, envMap }) {
  const env = (m, i) => {
    if (envMap) {
      m.envMap = envMap;
      m.envMapIntensity = i;
    }
    return m;
  };
  if (attitude) {
    const flat = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0, flatShading: false });
    return {
      paint: flat(0xe8e8e6),
      black: flat(0x2a2a2a),
      glass: flat(0x1c1c1c),
      trim: flat(0x3a3a3a),
      chrome: flat(0xbdbdbd),
      rubber: flat(0x151515),
      rimFace: flat(0xb0b0b0),
      rimDark: flat(0x2a2a2a),
      blade: flat(0x181818),
      nozzle: flat(0x222222),
      brass: flat(0x8a7350),
      well: flat(0x111111),
    };
  }
  return {
    paint: env(new THREE.MeshPhysicalMaterial({
      color: 0xc6c6c4,
      metalness: 0.05,
      roughness: 0.42,
      clearcoat: 0.55,
      clearcoatRoughness: 0.12,
      sheen: 0.2,
      sheenColor: new THREE.Color(0xffffff),
      sheenRoughness: 0.6,
    }), 0.8),
    black: env(new THREE.MeshPhysicalMaterial({ color: 0x0d0d0f, metalness: 0.1, roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.2 }), 0.7),
    glass: env(new THREE.MeshPhysicalMaterial({
      color: 0x1f150e,
      metalness: 0.2,
      roughness: 0.14,
      clearcoat: 0.4,
      clearcoatRoughness: 0.12,
      specularIntensity: 0.35,
      specularColor: new THREE.Color(0xffd9bb),
    }), 0.45),
    trim: new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.6, metalness: 0.1 }),
    chrome: env(new THREE.MeshStandardMaterial({ color: 0xc9ccd0, metalness: 1, roughness: 0.18 }), 1),
    rubber: env(new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.88, metalness: 0 }), 0.35),
    rimFace: env(new THREE.MeshStandardMaterial({ color: 0xdcdee1, metalness: 0.15, roughness: 0.42, emissive: 0x1c1d20 }), 1.6),
    rimDark: env(new THREE.MeshStandardMaterial({ color: 0x1b1c1f, metalness: 0.6, roughness: 0.45 }), 0.6),
    blade: env(new THREE.MeshPhysicalMaterial({ color: 0x0a0a0b, metalness: 0.2, roughness: 0.45, clearcoat: 0.3, clearcoatRoughness: 0.3 }), 0.5),
    nozzle: env(new THREE.MeshStandardMaterial({ color: 0x3a3632, metalness: 0.95, roughness: 0.32, side: THREE.DoubleSide }), 0.8),
    brass: env(new THREE.MeshStandardMaterial({ color: 0xb8925a, metalness: 1, roughness: 0.3 }), 1.1),
    well: env(new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.92, metalness: 0 }), 0.2),
  };
}

function emissive(color, intensity) {
  const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity) });
  return m;
}

function strip(mat, a, b, thickness, depth = 0.008) {
  const len = a.distanceTo(b);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(len, thickness, depth), mat);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.rotation.z = Math.atan2(b.y - a.y, b.x - a.x);
  return mesh;
}

function sideAt(z, h, out = 0.003) {
  const sec = hullSection(z);
  const a = sec[3];
  const b = sec[4];
  const t = THREE.MathUtils.clamp((a[1] - h) / Math.max(a[1] - b[1], 1e-3), 0, 1);
  return new THREE.Vector3(a[0] + (b[0] - a[0]) * t + out, toLocal(h), z);
}

function buildLights(group, mats, attitude) {
  const front = emissive(0xf2f6ff, attitude ? 0.9 : 4.5);
  const rear = emissive(0xff0614, attitude ? 0.8 : 3.4);
  const amber = emissive(0xff7a1a, attitude ? 0.6 : 2.4);

  // Full-width bar along the hood's leading edge, with lamp slivers up the chamfered corners.
  const barY = toLocal(0.541);
  group.add(strip(front, new THREE.Vector3(-0.665, barY, NOSE - 0.004), new THREE.Vector3(0.665, barY, NOSE - 0.004), 0.009));
  for (const side of [-1, 1]) {
    const a = sideAt(-2.285, 0.548, 0.004);
    const b = sideAt(-2.2, 0.585, 0.004);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.009, a.distanceTo(b) * 1.0), front);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    lamp.position.set(side * mid.x, mid.y, mid.z);
    lamp.lookAt(side * b.x, b.y, b.z);
    group.add(lamp);
  }

  // Slim markers at the rear edge of the front fenders and the rear corners.
  const red = emissive(0xff0614, attitude ? 0.6 : 2.0);
  for (const side of [-1, 1]) {
    for (const [z0, z1, h0, h1, mat] of [[-1.1, -0.9, 0.735, 0.715, amber], [2.06, 2.17, 0.61, 0.6, red]]) {
      const a = sideAt(z0, h0, 0.004);
      const b = sideAt(z1, h1, 0.004);
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.011, a.distanceTo(b)), mat);
      m.position.set(side * (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      m.rotation.x = Math.atan2(-(b.y - a.y), b.z - a.z);
      group.add(m);
      if (mat === amber) {
        // The marker sits in a dark slot at the fender's trailing edge.
        const slot = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.03, a.distanceTo(b) + 0.08), mats.trim);
        slot.position.copy(m.position).setX(m.position.x - side * 0.0015);
        slot.rotation.copy(m.rotation);
        group.add(slot);
      }
    }
  }

  // Full-width tail bar in a black shadow band just under the deck edge.
  const tailY = toLocal(0.884);
  const band = strip(mats.trim, new THREE.Vector3(-0.97, tailY, BLADE_Z + 0.002), new THREE.Vector3(0.97, tailY, BLADE_Z + 0.002), 0.034, 0.004);
  group.add(band);
  group.add(strip(rear, new THREE.Vector3(-0.95, tailY, BLADE_Z + 0.005), new THREE.Vector3(0.95, tailY, BLADE_Z + 0.005), 0.01));
  return { front, rear };
}

export function buildCar({ attitude = false, envMap = null } = {}) {
  const group = new THREE.Group();
  const mats = makeMaterials({ attitude, envMap });

  const buckets = makeBuckets();
  buildHull(buckets);
  const frame = buildCanopy(buckets);
  sideSeam(buckets, -0.86, -0.75);
  sideSeam(buckets, 0.54, 0.32);
  sideSeam(buckets, 1.99, 2.22);
  hoodSeam(buckets, -1.78);
  canopyDetails(buckets, frame);

  const meshes = {};
  for (const [id, bucket] of Object.entries(buckets)) {
    if (!bucket.pos.length) continue;
    const mesh = new THREE.Mesh(bucketGeometry(bucket), mats[id]);
    mesh.castShadow = !attitude;
    mesh.receiveShadow = !attitude;
    mesh.name = id;
    group.add(mesh);
    meshes[id] = mesh;
  }

  if (attitude) {
    const lineMat = new THREE.LineBasicMaterial({ color: 0x050505, transparent: true, opacity: 0.85 });
    for (const id of ['paint', 'glass', 'black']) {
      const edges = new THREE.EdgesGeometry(meshes[id].geometry, 24);
      group.add(new THREE.LineSegments(edges, lineMat));
    }
  }

  const lights = buildLights(group, mats, attitude);

  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.09), plateMaterial());
  plate.position.set(0, toLocal(0.7), TAIL + 0.006);
  group.add(plate);

  // Four brass nozzles across the black rear.
  for (const x of [-0.4, -0.135, 0.135, 0.4]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.038, 0.011, 10, 28), mats.brass);
    ring.position.set(x, toLocal(0.48), TAIL + 0.012);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.04, 24, 1, true), mats.brass);
    tube.rotation.x = Math.PI / 2;
    tube.position.set(x, toLocal(0.48), TAIL - 0.008);
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.036, 24), mats.trim);
    hole.position.set(x, toLocal(0.48), TAIL - 0.02);
    group.add(ring, tube, hole);
  }
  // Diffuser fins under the nozzles.
  for (const x of [-0.6, -0.3, 0, 0.3, 0.6]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.16, 0.18), mats.black);
    fin.position.set(x, toLocal(0.33), TAIL - 0.02);
    group.add(fin);
  }

  // Front splitter blade: proud of the nose and wrapped round the chamfered corners.
  const plan = [[-0.62, -2.4], [0.62, -2.4], [0.99, -2.0], [0.94, -1.9], [0.62, -2.24], [-0.62, -2.24], [-0.94, -1.9], [-0.99, -2.0]];
  const splitShape = new THREE.Shape(plan.map(([x, z]) => new THREE.Vector2(x, z)));
  const splitGeo = new THREE.ExtrudeGeometry(splitShape, { depth: 0.024, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.004, bevelSegments: 1 });
  splitGeo.rotateX(Math.PI / 2);
  const splitter = new THREE.Mesh(splitGeo, mats.black);
  splitter.position.set(0, toLocal(0.262), 0);
  group.add(splitter);

  const wheels = [];
  for (const spec of WHEELS) {
    const width = spec.front ? 0.265 : 0.295;
    const wheel = makeWheel(mats, width);
    if (spec.x < 0) wheel.group.scale.x = -1;
    wheel.group.position.set(spec.x, toLocal(HUB_Y), spec.z);
    wheel.group.userData.restY = toLocal(HUB_Y);
    group.add(wheel.group);
    wheels.push(wheel);
  }

  const plumes = { bottom: {}, lateral: {} };
  const nozzles = { bottom: {}, lateral: {} };
  const down = new THREE.Vector3(0, -1, 0);
  for (const spec of BOTTOM) {
    const plume = makePlume(down);
    const nozzle = nozzleMesh(down, 0.07, mats);
    plume.position.set(spec.x, spec.y, spec.z);
    nozzle.position.set(spec.x, spec.y + 0.085, spec.z);
    group.add(plume, nozzle);
    plumes.bottom[spec.id] = plume;
    nozzles.bottom[spec.id] = nozzle;
  }
  for (const spec of LATERAL) {
    const exhaust = new THREE.Vector3(spec.exhaustX, 0, 0);
    const plume = makePlume(exhaust);
    const nozzle = nozzleMesh(exhaust, 0.045, mats);
    plume.position.set(spec.x + spec.exhaustX * 0.005, spec.y, spec.z);
    nozzle.position.set(spec.x - spec.exhaustX * 0.085, spec.y, spec.z);
    group.add(plume, nozzle);
    plumes.lateral[spec.id] = plume;
    nozzles.lateral[spec.id] = nozzle;
  }

  const noseMark = new THREE.Object3D();
  noseMark.name = 'nose';
  noseMark.position.set(0, toLocal(0.54), NOSE);
  const tailMark = new THREE.Object3D();
  tailMark.name = 'tail';
  tailMark.position.set(0, toLocal(0.6), BLADE_Z);
  group.add(noseMark, tailMark);

  if (attitude) group.scale.setScalar(0.2);
  return {
    group,
    wheels,
    plumes,
    nozzles,
    lights,
    body: meshes.paint,
    lower: meshes.black,
    glass: meshes.glass,
    time: 0,
  };
}

// Signed volume of the closed body shell (paint + black). Positive when every
// face winds outward; a flipped strip or cap subtracts from it.
export function bodyFacesPointOutward(...geometries) {
  let volume = 0;
  let total = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (const geometry of geometries) {
    const pos = geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i += 3) {
      a.fromBufferAttribute(pos, i);
      b.fromBufferAttribute(pos, i + 1);
      c.fromBufferAttribute(pos, i + 2);
      volume += a.dot(new THREE.Vector3().crossVectors(b, c)) / 6;
      total += 1;
    }
  }
  return { volume, total };
}

export function updateCar(car, state, dt) {
  car.time += dt;
  for (let i = 0; i < car.wheels.length; i += 1) {
    const wheel = car.wheels[i];
    const ws = state.wheels[i];
    const spec = WHEELS[i];
    wheel.group.position.y = spec.y - (SUSPENSION.length - ws.compression);
    wheel.group.rotation.y = ws.steer;
    wheel.spin.rotation.x = -ws.spin;
  }


  const banks = [
    [car.plumes.bottom, car.nozzles.bottom, state.bottom, 1.4],
    [car.plumes.lateral, car.nozzles.lateral, state.lateral, 0.95],
  ];
  for (const [plumes, nozzles, amounts, lengthScale] of banks) {
    for (const id of Object.keys(plumes)) {
      const amount = amounts[id];
      const plume = plumes[id];
      const shown = amount > 0.03;
      plume.visible = shown;
      if (shown) {
        const length = 0.15 + amount * lengthScale;
        plume.scale.set(0.7 + amount * 0.6, length, 0.7 + amount * 0.6);
        plume.userData.core.material.uniforms.uAmount.value = Math.min(1, amount * 1.2);
        plume.userData.haze.material.uniforms.uAmount.value = amount * 0.3;
        plume.userData.core.material.uniforms.uTime.value = car.time;
      }
      nozzles[id].userData.glow.material.opacity = Math.min(1, amount * 1.5);
    }
  }
}
