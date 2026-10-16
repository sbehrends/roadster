import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LOOP, OBSTACLES } from './world.js';

// The night arena from the stunt-show reference: dark concrete with painted
// lines, a white half loop with red LED edges hung from a steel truss tower,
// a low barrier with a red LED strip and a string of white lamps, and a few
// floodlights glaring through haze. Geometry follows world.js exactly.

const R = LOOP.radius;
const HW = LOOP.halfWidth;

// World position on the loop: u along −Z from the entry, v up, w across.
function loopPoint(u, v, w) {
  return new THREE.Vector3(LOOP.x + w, v, LOOP.z - u);
}

function arcPoint(phi, inset = 0) {
  const r = R + inset;
  return [r * Math.sin(phi), R - r * Math.cos(phi)];
}

// The track path in (u, v): apron, arc, inverted run-out.
function trackPath(inset = 0, steps = 96) {
  const pts = [];
  pts.push([-7, 0.025 + Math.max(inset, 0) * 0.1]);
  for (let i = 0; i <= steps; i += 1) pts.push(arcPoint((i / steps) * Math.PI, inset));
  pts.push([-LOOP.top, 2 * R + inset]);
  return pts;
}

function trackGeometry() {
  const inner = trackPath(0);
  const outer = trackPath(0.35);
  const pos = [];
  const nor = [];
  const uv = [];
  const quad = (a, b, c, d, n) => {
    for (const p of [a, b, c, a, c, d]) {
      pos.push(p.x, p.y, p.z);
      nor.push(n.x, n.y, n.z);
    }
  };
  let len = 0;
  for (let i = 0; i < inner.length - 1; i += 1) {
    const [u0, v0] = inner[i];
    const [u1, v1] = inner[i + 1];
    const seg = Math.hypot(u1 - u0, v1 - v0);
    // Running surface faces the inside of the curve: the tangent turned +90° in (u, v).
    const du = (u1 - u0) / seg;
    const dv = (v1 - v0) / seg;
    const normal = new THREE.Vector3(0, du, dv);
    quad(loopPoint(u0, v0, -HW), loopPoint(u0, v0, HW), loopPoint(u1, v1, HW), loopPoint(u1, v1, -HW), normal);
    for (let k = 0; k < 6; k += 1) uv.push(0, (len + seg * [0, 0, 1, 0, 1, 1][k]) / 4);
    len += seg;
    // Back of the shell.
    const [ou0, ov0] = outer[i];
    const [ou1, ov1] = outer[i + 1];
    const back = normal.clone().negate();
    quad(loopPoint(ou0, ov0, HW), loopPoint(ou0, ov0, -HW), loopPoint(ou1, ov1, -HW), loopPoint(ou1, ov1, HW), back);
    for (let k = 0; k < 6; k += 1) uv.push(0, 0);
    // Side faces.
    for (const w of [-HW, HW]) {
      const side = new THREE.Vector3(Math.sign(w), 0, 0);
      quad(loopPoint(u0, v0, w), loopPoint(ou0, ov0, w), loopPoint(ou1, ov1, w), loopPoint(u1, v1, w), side);
      for (let k = 0; k < 6; k += 1) uv.push(0, 0);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return geo;
}

function tube(points, radius, mat) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0);
  return new THREE.Mesh(new THREE.TubeGeometry(curve, points.length * 2, radius, 6, false), mat);
}

function bar(a, b, r) {
  const g = new THREE.BoxGeometry(r, a.distanceTo(b), r);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3().subVectors(b, a).normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
  return g;
}

// A square lattice column from y0 to y1 centred on (x, z).
function trussColumn(x, z, size, y0, y1, parts) {
  const h = size / 2;
  const corners = [[-h, -h], [h, -h], [h, h], [-h, h]];
  for (const [cx, cz] of corners) parts.push(bar(new THREE.Vector3(x + cx, y0, z + cz), new THREE.Vector3(x + cx, y1, z + cz), 0.08));
  const stepY = 1.6;
  for (let y = y0; y < y1 - 0.01; y += stepY) {
    const y2 = Math.min(y + stepY, y1);
    for (let i = 0; i < 4; i += 1) {
      const [ax, az] = corners[i];
      const [bx, bz] = corners[(i + 1) % 4];
      parts.push(bar(new THREE.Vector3(x + ax, y2, z + az), new THREE.Vector3(x + bx, y2, z + bz), 0.05));
      parts.push(bar(new THREE.Vector3(x + ax, y, z + az), new THREE.Vector3(x + bx, y2, z + bz), 0.04));
    }
  }
}

// A horizontal lattice beam between two points, square section.
function trussBeam(a, b, size, parts) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  dir.normalize();
  const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
  if (side.lengthSq() < 0.5) side.set(1, 0, 0);
  const upv = new THREE.Vector3().crossVectors(side, dir).normalize();
  const h = size / 2;
  const offs = [[-h, -h], [h, -h], [h, h], [-h, h]].map(([s, u]) => side.clone().multiplyScalar(s).addScaledVector(upv, u));
  for (const o of offs) parts.push(bar(a.clone().add(o), b.clone().add(o), 0.07));
  const n = Math.max(1, Math.round(len / 1.6));
  for (let k = 0; k < n; k += 1) {
    const p0 = a.clone().addScaledVector(dir, (len * k) / n);
    const p1 = a.clone().addScaledVector(dir, (len * (k + 1)) / n);
    for (let i = 0; i < 4; i += 1) {
      parts.push(bar(p1.clone().add(offs[i]), p1.clone().add(offs[(i + 1) % 4]), 0.045));
      parts.push(bar(p0.clone().add(offs[i]), p1.clone().add(offs[(i + 1) % 4]), 0.035));
    }
  }
}

function glareTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.08, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.25, 'rgba(210,225,255,0.25)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 6; i += 1) {
    g.save();
    g.translate(128, 128);
    g.rotate((i / 6) * Math.PI + 0.3);
    const ray = g.createLinearGradient(-128, 0, 128, 0);
    ray.addColorStop(0, 'rgba(255,255,255,0)');
    ray.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    ray.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = ray;
    g.fillRect(-128, -1.2, 256, 2.4);
    g.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function radialTexture(stops) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  for (const [t, a] of stops) grad.addColorStop(t, `rgba(255,255,255,${a})`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const beamVertex = /* glsl */ `
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

const beamFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uStrength;
  varying float vT;
  varying vec3 vN;
  varying vec3 vView;
  void main() {
    float rim = pow(abs(dot(normalize(vN), normalize(vView))), 2.0);
    float along = pow(clamp(vT, 0.0, 1.0), 1.5);
    float a = rim * along * uStrength;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

// A haze cone from a floodlight toward its target.
function beam(from, to, radius, strength) {
  const len = from.distanceTo(to);
  const geo = new THREE.CylinderGeometry(0.4, radius, len, 32, 1, true);
  geo.translate(0, -len / 2, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0xdfe8ff) }, uStrength: { value: strength } },
    vertexShader: beamVertex,
    fragmentShader: beamFragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(from);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), new THREE.Vector3().subVectors(to, from).normalize());
  mesh.renderOrder = 5;
  return mesh;
}

function emissive(color, k) {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k) });
}

function line(group, mat, a, b, width = 0.12) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, len), mat);
  mesh.rotation.x = -Math.PI / 2;
  // The plane's long axis is local +Y; after lying flat it points along (−sinθ, −cosθ).
  mesh.rotation.z = Math.atan2(-(b[0] - a[0]), -(b[1] - a[1]));
  mesh.position.set((a[0] + b[0]) / 2, 0.006, (a[1] + b[1]) / 2);
  group.add(mesh);
}

export function buildArena(scene) {
  const group = new THREE.Group();
  const lights = [];

  // Painted lines: the approach lane into the loop, a long X across the floor,
  // and curved guide lines beside the loop.
  const paint = new THREE.MeshStandardMaterial({ color: 0xb8b8b4, roughness: 0.85, emissive: 0x2a2a2a });
  for (const x of [-HW - 0.4, HW + 0.4]) line(group, paint, [LOOP.x + x, 40], [LOOP.x + x, LOOP.z + 7]);
  line(group, paint, [-95, -15], [70, -125]);
  line(group, paint, [-95, -125], [70, -15]);
  line(group, paint, [-150, -30], [150, -30], 0.1);
  for (let i = 0; i < 18; i += 1) {
    const z = 30 - i * 9;
    line(group, paint, [LOOP.x + 11, z], [LOOP.x + 11, z - 3.5], 0.1);
  }
  const curvePts = [];
  for (let i = 0; i <= 40; i += 1) {
    const a = (i / 40) * Math.PI * 0.6;
    curvePts.push([LOOP.x + 14 + Math.cos(a) * 24 - 24, LOOP.z + 18 + Math.sin(a) * 30]);
  }
  for (let i = 0; i < curvePts.length - 1; i += 1) line(group, paint, curvePts[i], curvePts[i + 1], 0.12);

  // Half loop.
  const trackMat = new THREE.MeshStandardMaterial({ color: 0xe2e2df, roughness: 0.75, metalness: 0, emissive: 0x6a6a68, side: THREE.DoubleSide });
  const track = new THREE.Mesh(trackGeometry(), trackMat);
  group.add(track);
  const red = emissive(0xff2a12, 6);
  const white = emissive(0xffffff, 3.5);
  for (const w of [-HW - 0.03, HW + 0.03]) {
    const pts = trackPath(0.05, 64).map(([u, v]) => loopPoint(u, v, w));
    group.add(tube(pts, 0.07, red));
  }
  // Lamp string along the apron edge, like the reference.
  const lampGeo = new THREE.SphereGeometry(0.07, 8, 6);
  for (let i = 0; i < 9; i += 1) {
    for (const w of [-HW - 0.25, HW + 0.25]) {
      const lamp = new THREE.Mesh(lampGeo, white);
      lamp.position.copy(loopPoint(-7 + i * 0.9, 0.06, w));
      group.add(lamp);
    }
  }

  // Steel truss: a tower behind the vertical wall and a gantry along the top.
  const tower = OBSTACLES.find((o) => o.id === 'tower');
  const parts = [];
  for (const w of [-HW - 0.7, HW + 0.7]) trussColumn(LOOP.x + w, tower.z, 1.1, 0, tower.y1, parts);
  trussColumn(LOOP.x, tower.z - 0.2, 1.1, 0, tower.y1, parts);
  for (const w of [-HW - 0.7, HW + 0.7]) {
    trussBeam(loopPoint(-LOOP.top - 0.5, 2 * R + 1.2, w), loopPoint(R + 1.7, 2 * R + 1.2, w), 0.8, parts);
  }
  trussBeam(loopPoint(R + 1.7, tower.y1 - 0.4, -HW - 0.7), loopPoint(R + 1.7, tower.y1 - 0.4, HW + 0.7), 0.8, parts);
  trussBeam(loopPoint(-LOOP.top - 0.5, 2 * R + 1.2, -HW - 0.7), loopPoint(-LOOP.top - 0.5, 2 * R + 1.2, HW + 0.7), 0.8, parts);
  const steel = new THREE.MeshStandardMaterial({ color: 0x8d9298, metalness: 0.75, roughness: 0.42, emissive: 0x0d0e10 });
  group.add(new THREE.Mesh(mergeGeometries(parts), steel));
  // Red LED along the top gantry and a lit base frame.
  group.add(tube([loopPoint(-LOOP.top - 0.5, 2 * R + 0.75, HW + 0.7), loopPoint(R + 1.7, 2 * R + 0.75, HW + 0.7)], 0.05, red));
  group.add(tube([loopPoint(R + 0.4, 0.05, -HW - 1.6), loopPoint(R + 3.2, 0.05, -HW - 1.6), loopPoint(R + 3.2, 0.05, HW + 1.6), loopPoint(R + 0.4, 0.05, HW + 1.6)], 0.05, red));

  // Low barrier with a red LED top and a string of white lamps.
  const barrier = OBSTACLES.find((o) => o.id === 'barrier');
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(barrier.hx * 2, barrier.y1, barrier.hz * 2),
    new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.6 }),
  );
  wall.position.set(barrier.x, barrier.y1 / 2, barrier.z);
  wall.rotation.y = barrier.yaw;
  group.add(wall);
  const ledTop = new THREE.Mesh(new THREE.BoxGeometry(barrier.hx * 2, 0.1, 0.14), emissive(0xff2a12, 9));
  ledTop.position.set(0, barrier.y1 / 2 + 0.03, barrier.hz);
  wall.add(ledTop);
  for (let i = 0; i <= 24; i += 1) {
    const lamp = new THREE.Mesh(lampGeo, white);
    lamp.position.set(-barrier.hx + (i / 24) * barrier.hx * 2, barrier.y1 / 2 + 0.45, -barrier.hz);
    wall.add(lamp);
  }
  // Glow the LED spills onto the floor.
  const spill = new THREE.Mesh(
    new THREE.PlaneGeometry(barrier.hx * 2, 6),
    new THREE.MeshBasicMaterial({ map: radialTexture([[0, 0.6], [1, 0]]), color: 0xff3010, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  spill.rotation.x = -Math.PI / 2;
  spill.position.set(0, -barrier.y1 / 2 + 0.008, barrier.hz + 2.5);
  spill.scale.y = 1;
  wall.add(spill);

  // Floodlights: glare sprite, haze beam, real spot light and a floor pool.
  const glare = glareTexture();
  const poolTex = radialTexture([[0, 0.55], [0.5, 0.2], [1, 0]]);
  const floods = [
    { at: [-62, 13, -100], to: [-20, 0, -110] },
    { at: [-26, 15, -170], to: [-6, 0, -140] },
    { at: [40, 18, -200], to: [6, 6, -158] },
  ];
  for (const f of floods) {
    const at = new THREE.Vector3(...f.at);
    const to = new THREE.Vector3(...f.to);
    const head = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 0.5), emissive(0xffffff, 6));
    head.position.copy(at);
    head.lookAt(to);
    group.add(head);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, at.y, 8), steel);
    pole.position.set(at.x, at.y / 2, at.z);
    group.add(pole);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glare, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    sprite.scale.setScalar(9);
    sprite.position.copy(at);
    sprite.renderOrder = 6;
    group.add(sprite);
    group.add(beam(at, to, 7, 0.32));
    const spot = new THREE.SpotLight(0xe8eeff, 3800, 140, 0.34, 0.8, 1.5);
    spot.position.copy(at);
    spot.target.position.copy(to);
    group.add(spot, spot.target);
    lights.push(spot);
    const pool = new THREE.Mesh(
      new THREE.PlaneGeometry(26, 26),
      new THREE.MeshBasicMaterial({ map: poolTex, color: 0x30343c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(to.x, 0.007, to.z);
    group.add(pool);
  }

  scene.add(group);
  return { group, lights, track };
}
