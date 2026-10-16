import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { HorizontalBlurShader } from 'three/addons/shaders/HorizontalBlurShader.js';
import { VerticalBlurShader } from 'three/addons/shaders/VerticalBlurShader.js';

// Look: the car render on a Tesla screen. A dark, soft studio; one big overhead
// softbox and long strip lights that draw clean highlight lines down the body;
// a glossy floor whose reflection blurs and fades out within a few metres;
// a soft contact shadow; a faint radial glow behind the car.

const BG = new THREE.Color(0x07080a);

function studioTexture(renderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020203);
  const panel = (w, h, color, intensity, pos, look = [0, 0.6, 0]) => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }),
    );
    mesh.position.set(...pos);
    mesh.lookAt(...look);
    scene.add(mesh);
  };
  // Overhead softbox, slightly warm: the main top light, like a photo studio.
  panel(6, 10, 0xfff6ee, 1.5, [0, 7, 0], [0, 0, 0]);
  // A big soft key high and to the front-left, for the hood-to-flank gradient.
  panel(6, 4, 0xfffaf4, 1.2, [-2, 6.5, -4.5], [0, 0.5, 0]);
  // Thin side strips at shoulder height: clean lines along the doors.
  panel(16, 0.35, 0xf0f4ff, 0.9, [7, 2.1, 0], [0, 2.1, 0]);
  panel(16, 0.35, 0xf0f4ff, 0.7, [-7, 2.4, 0], [0, 2.4, 0]);
  // Faint front and rear kickers so glossy black faces stay dark.
  panel(6, 1.2, 0xffffff, 0.35, [0, 2.6, -8]);
  panel(6, 1.2, 0xffffff, 0.3, [0, 2.6, 8]);
  // Low warm bounce from the floor.
  panel(14, 2, 0x5a4a40, 0.22, [0, -1.5, 0], [0, 0, 0]);
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(12, 12, 8, 48, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x0c0d10, side: THREE.BackSide }),
  );
  wall.position.y = 2;
  scene.add(wall);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, 0.035);
  pmrem.dispose();
  return target.texture;
}

function backgroundTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const lin = ctx.createLinearGradient(0, 0, 0, 512);
  lin.addColorStop(0, '#020203');
  lin.addColorStop(0.55, '#08090b');
  lin.addColorStop(0.64, '#0b0c0f');
  lin.addColorStop(1, '#040405');
  ctx.fillStyle = lin;
  ctx.fillRect(0, 0, 1024, 512);
  const glow = ctx.createRadialGradient(512, 300, 10, 512, 300, 520);
  glow.addColorStop(0, 'rgba(60, 64, 74, 0.14)');
  glow.addColorStop(0.5, 'rgba(40, 42, 50, 0.06)');
  glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 1024, 512);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Light grey cyclorama, like the reference video. Used to compare silhouettes.
function lightBackgroundTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const lin = ctx.createLinearGradient(0, 0, 0, 512);
  lin.addColorStop(0, '#4a4b4e');
  lin.addColorStop(0.55, '#76777a');
  lin.addColorStop(0.62, '#9a9a9b');
  lin.addColorStop(1, '#c9c7c5');
  ctx.fillStyle = lin;
  ctx.fillRect(0, 0, 1024, 512);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function poolTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(256, 256, 10, 256, 256, 256);
  // A stage spot: a bright plateau with a soft rim.
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.42, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.62, 'rgba(255,255,255,0.28)');
  g.addColorStop(0.82, 'rgba(255,255,255,0.05)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Dark poured concrete: fine grain, soft blotches, a few hairline cracks.
function concreteTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#6e6e6e';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 260; i += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 10 + Math.random() * 60;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const shade = Math.random() < 0.5 ? '0,0,0' : '255,255,255';
    g.addColorStop(0, `rgba(${shade},${0.015 + Math.random() * 0.03})`);
    g.addColorStop(1, `rgba(${shade},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 26;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i += 1) {
    ctx.beginPath();
    let x = Math.random() * size;
    let y = Math.random() * size;
    ctx.moveTo(x, y);
    for (let k = 0; k < 8; k += 1) {
      x += (Math.random() - 0.5) * 60;
      y += (Math.random() - 0.5) * 60;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(110, 110);
  tex.anisotropy = 8;
  return tex;
}

// Blurred, fading floor reflection on top of the dark floor.
const ReflectShader = {
  name: 'SoftReflector',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    uCenter: { value: new THREE.Vector2() },
    uStrength: { value: 0.16 },
    uTexel: { value: new THREE.Vector2(1 / 1024, 1 / 1024) },
  },
  vertexShader: /* glsl */ `
    varying vec3 vLocal;
    varying vec3 vWorld;
    #include <common>
    #include <logdepthbuf_pars_vertex>
    void main() {
      // Projected per fragment: vertices behind the camera break per-vertex projection.
      vLocal = position;
      vec4 world = modelMatrix * vec4(position, 1.0);
      vWorld = world.xyz;
      gl_Position = projectionMatrix * viewMatrix * world;
      #include <logdepthbuf_vertex>
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    uniform vec2 uCenter;
    uniform float uStrength;
    uniform vec2 uTexel;
    uniform mat4 textureMatrix;
    varying vec3 vLocal;
    varying vec3 vWorld;
    #include <logdepthbuf_pars_fragment>
    void main() {
      #include <logdepthbuf_fragment>
      vec4 proj = textureMatrix * vec4(vLocal, 1.0);
      if (proj.w <= 0.0) discard;
      vec2 uv = proj.xy / proj.w;
      vec3 sum = vec3(0.0);
      float total = 0.0;
      for (int x = -2; x <= 2; x++) {
        for (int y = -2; y <= 2; y++) {
          float w = exp(-float(x * x + y * y) / 4.0);
          sum += texture2D(tDiffuse, uv + vec2(float(x), float(y)) * uTexel * 2.2).rgb * w;
          total += w;
        }
      }
      vec3 base = sum / total;
      base = base / (1.0 + base * 0.9);
      float d = length(vWorld.xz - uCenter);
      float fade = 1.0 - smoothstep(1.5, 9.0, d);
      gl_FragColor = vec4(base * color, fade * uStrength);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
};

// Soft contact shadow, after three.js' webgl_shadow_contact example: render the
// car's depth from below into a texture, blur it, lay it on the floor.
function createContactShadow(size = 9, res = 512) {
  const group = new THREE.Group();
  const rt = new THREE.WebGLRenderTarget(res, res);
  rt.texture.generateMipmaps = false;
  const rtBlur = new THREE.WebGLRenderTarget(res, res);
  rtBlur.texture.generateMipmaps = false;
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size).rotateX(Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: rt.texture, opacity: 0.92, transparent: true, depthWrite: false }),
  );
  plane.renderOrder = 1;
  plane.scale.y = -1;
  plane.position.y = 0.003;
  group.add(plane);
  const blurPlane = new THREE.Mesh(new THREE.PlaneGeometry(size, size));
  blurPlane.visible = false;
  group.add(blurPlane);
  const camera = new THREE.OrthographicCamera(-size / 2, size / 2, size / 2, -size / 2, 0, 3.5);
  camera.rotation.x = Math.PI / 2;
  group.add(camera);
  const depthMaterial = new THREE.MeshDepthMaterial();
  depthMaterial.userData.darkness = { value: 1.25 };
  depthMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.darkness = depthMaterial.userData.darkness;
    shader.fragmentShader = `uniform float darkness;\n${shader.fragmentShader.replace(
      'gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );',
      'gl_FragColor = vec4( vec3( 0.0 ), ( 1.0 - fragCoordZ ) * darkness );',
    )}`;
  };
  depthMaterial.depthTest = false;
  depthMaterial.depthWrite = false;
  const hBlur = new THREE.ShaderMaterial(HorizontalBlurShader);
  hBlur.depthTest = false;
  const vBlur = new THREE.ShaderMaterial(VerticalBlurShader);
  vBlur.depthTest = false;

  function blur(renderer, amount) {
    blurPlane.visible = true;
    blurPlane.material = hBlur;
    hBlur.uniforms.tDiffuse.value = rt.texture;
    hBlur.uniforms.h.value = amount / 256;
    renderer.setRenderTarget(rtBlur);
    renderer.render(blurPlane, camera);
    blurPlane.material = vBlur;
    vBlur.uniforms.tDiffuse.value = rtBlur.texture;
    vBlur.uniforms.v.value = amount / 256;
    renderer.setRenderTarget(rt);
    renderer.render(blurPlane, camera);
    blurPlane.visible = false;
  }

  function render(renderer, scene, hide) {
    const states = hide.map((o) => o.visible);
    for (const o of hide) o.visible = false;
    plane.visible = false;
    const bg = scene.background;
    const fog = scene.fog;
    scene.background = null;
    scene.fog = null;
    scene.overrideMaterial = depthMaterial;
    const clear = renderer.getClearAlpha();
    renderer.setClearAlpha(0);
    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(scene, camera);
    scene.overrideMaterial = null;
    blur(renderer, 1.1);
    blur(renderer, 0.45);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearAlpha(clear);
    scene.background = bg;
    scene.fog = fog;
    plane.visible = true;
    hide.forEach((o, i) => {
      o.visible = states[i];
    });
  }

  return { group, plane, render };
}

export function createEnvironment(renderer) {
  const scene = new THREE.Scene();
  scene.background = backgroundTexture();
  scene.fog = new THREE.FogExp2(BG, 0.011);
  const envMap = studioTexture(renderer);
  scene.environment = envMap;
  scene.environmentIntensity = 0.75;

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(260, 72),
    new THREE.MeshStandardMaterial({ map: concreteTexture(), color: 0x6a6c70, roughness: 0.93, metalness: 0, envMapIntensity: 0.12 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const reflector = new Reflector(new THREE.CircleGeometry(14, 64), {
    color: 0xb4b8c0,
    textureWidth: 1024,
    textureHeight: 1024,
    clipBias: 0.003,
    shader: ReflectShader,
  });
  reflector.material.transparent = true;
  reflector.material.depthWrite = false;
  reflector.rotation.x = -Math.PI / 2;
  reflector.position.y = 0.002;
  reflector.renderOrder = 0;
  scene.add(reflector);


  const pool = new THREE.Mesh(
    new THREE.PlaneGeometry(15, 15),
    new THREE.MeshBasicMaterial({
      map: poolTexture(),
      color: new THREE.Color(0x56575c),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.006;
  scene.add(pool);

  const shadow = createContactShadow();
  scene.add(shadow.group);

  const hemi = new THREE.HemisphereLight(0xd9dde6, 0x0a0a0c, 0.05);
  scene.add(hemi);

  // Big overhead softbox as a real area light: broad soft highlights on the body
  // and a light pool on the floor, with no hot point-light glints.
  RectAreaLightUniformsLib.init();
  const key = new THREE.RectAreaLight(0xfff7ef, 2.2, 4, 7);
  key.position.set(0, 6, 0);
  key.lookAt(0, 0, 0);
  scene.add(key);

  const rim = new THREE.DirectionalLight(0xcfdcff, 1.1);
  scene.add(rim, rim.target);

  const fill = new THREE.DirectionalLight(0xf2f4ff, 0.25);
  scene.add(fill, fill.target);

  const env = { scene, envMap, reflector, pool, shadow, ground, key, rim, fill };
  env.dark = { background: scene.background, fog: scene.fog.color.clone(), ground: ground.material.color.clone() };
  env.light = { background: lightBackgroundTexture(), fog: new THREE.Color(0x9a9a9b), ground: new THREE.Color(0x8e8c8a) };
  return env;
}

export function setStudio(env, mode) {
  const look = mode === 'light' ? env.light : env.dark;
  env.scene.background = look.background;
  env.scene.fog.color.copy(look.fog);
  env.scene.fog.density = mode === 'light' ? 0 : 0.011;
  env.ground.material.color.copy(look.ground);
  env.pool.visible = mode !== 'light';
  env.reflector.visible = mode !== 'light';
}

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export function updateEnvironment(env, position, quaternion, camera) {
  for (const o of [env.reflector, env.pool]) {
    o.position.x = position.x;
    o.position.z = position.z;
  }
  env.reflector.material.uniforms.uCenter.value.set(position.x, position.z);
  env.shadow.group.position.set(position.x, 0, position.z);

  _fwd.set(0, 0, -1).applyQuaternion(quaternion);
  _fwd.y = 0;
  if (_fwd.lengthSq() < 1e-6) _fwd.set(0, 0, -1);
  _fwd.normalize();
  _right.crossVectors(_fwd, _up);

  // The softbox runs along the car, so its long highlight follows the body lines.
  env.key.position.set(position.x, position.y + 5.5, position.z);
  env.key.lookAt(position.x, position.y - 1, position.z);
  env.key.rotateZ(Math.atan2(_fwd.x, _fwd.z));
  env.rim.position.copy(position).addScaledVector(_fwd, 8).add(new THREE.Vector3(0, 3, 0));
  env.rim.target.position.copy(position);
  if (camera) {
    env.fill.position.copy(camera.position).add(new THREE.Vector3(0, 2, 0));
    env.fill.target.position.copy(position);
  }
  env.rim.target.updateMatrixWorld();
  env.fill.target.updateMatrixWorld();
}
