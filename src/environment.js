// Golden-hour rooftop: sky, sun, city skyline, deck, string lights.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { deckTexture, concreteTexture, glowTexture, tableTexture, rng } from './textures.js';

const ROOF = 16;

export function createEnvironment(renderer, scene, { lowPower = false } = {}) {
  const sunDir = new THREE.Vector3().setFromSphericalCoords(
    1, THREE.MathUtils.degToRad(81), THREE.MathUtils.degToRad(206));

  // Sky + image-based lighting from the same sky.
  const skyParams = { turbidity: 6, rayleigh: 2.4, mieCoefficient: 0.006, mieDirectionalG: 0.86 };
  const makeSky = (scale) => {
    const sky = new Sky();
    sky.scale.setScalar(scale);
    const u = sky.material.uniforms;
    for (const k in skyParams) u[k].value = skyParams[k];
    u.sunPosition.value.copy(sunDir);
    return sky;
  };
  scene.add(makeSky(4000));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(makeSky(50));
  scene.environment = pmrem.fromScene(envScene, 0.02).texture;
  scene.environmentIntensity = 0.75;
  pmrem.dispose();

  const fogColor = new THREE.Color(0xc79a86);
  scene.fog = new THREE.Fog(fogColor, 80, 650);

  // Lights.
  scene.add(new THREE.HemisphereLight(0xb9c8ff, 0x6b5240, 0.55));
  const sun = new THREE.DirectionalLight(0xffc08a, 3.2);
  sun.position.copy(sunDir).multiplyScalar(14).add(new THREE.Vector3(0, 0.8, 0));
  sun.target.position.set(0, 0.8, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(lowPower ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 1, far: 30 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  // Roof deck.
  const deck = deckTexture();
  deck.repeat.set(ROOF / 0.84, ROOF / 0.84);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOF, ROOF),
    new THREE.MeshStandardMaterial({ map: deck, roughness: 0.88, bumpMap: deck, bumpScale: 1.5 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Parapet walls.
  const concrete = concreteTexture();
  const wallMat = new THREE.MeshStandardMaterial({ map: concrete, color: 0xd8d0c4, roughness: 0.95 });
  const capMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.8, roughness: 0.4 });
  for (let i = 0; i < 4; i++) {
    const g = new THREE.Group();
    const wall = new THREE.Mesh(new THREE.BoxGeometry(ROOF + 0.6, 1.05, 0.3), wallMat);
    wall.position.y = 0.525;
    wall.receiveShadow = true;
    const cap = new THREE.Mesh(new THREE.BoxGeometry(ROOF + 0.7, 0.05, 0.4), capMat);
    cap.position.y = 1.07;
    g.add(wall, cap);
    g.rotation.y = i * Math.PI / 2;
    g.position.set(Math.sin(i * Math.PI / 2) * (ROOF / 2 + 0.15), 0, Math.cos(i * Math.PI / 2) * (ROOF / 2 + 0.15));
    scene.add(g);
  }

  scene.add(createCity(sunDir, fogColor));
  scene.add(createStringLights(lowPower));
  scene.add(createProps(wallMat));

  return { sun };
}

function buildingMaterial(sunDir, fogColor) {
  return new THREE.ShaderMaterial({
    uniforms: {
      sunDir: { value: sunDir },
      sunColor: { value: new THREE.Color(0xffa060) },
      fogColor: { value: fogColor },
      fogNear: { value: 60 },
      fogFar: { value: 700 },
    },
    vertexShader: /* glsl */`
      varying vec3 vWorld;
      varying vec3 vNormal;
      flat varying float vSeed;
      void main() {
        mat4 m = modelMatrix;
        #ifdef USE_INSTANCING
          m = modelMatrix * instanceMatrix;
          vSeed = floor(fract(sin(dot(floor(instanceMatrix[3].xz), vec2(12.9898, 78.233))) * 43758.5453) * 97.0);
        #else
          vSeed = 0.37;
        #endif
        vec4 wp = m * vec4(position, 1.0);
        vWorld = wp.xyz;
        vNormal = normalize(mat3(m) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 sunDir, sunColor, fogColor;
      uniform float fogNear, fogFar;
      varying vec3 vWorld;
      varying vec3 vNormal;
      flat varying float vSeed;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vec3 n = normalize(vNormal);
        vec3 base = vec3(0.11, 0.115, 0.13) * (0.6 + 0.9 * hash(vec2(vSeed, 3.1)));
        float ndl = max(dot(n, sunDir), 0.0);
        vec3 col;
        if (abs(n.y) > 0.5) {
          col = base * 0.7;
        } else {
          float u = abs(n.x) > 0.5 ? vWorld.z : vWorld.x;
          vec2 g = vec2(u / 3.0, vWorld.y / 3.6);
          vec2 cell = floor(g), f = fract(g);
          float win = step(0.2, f.x) * step(f.x, 0.8) * step(0.28, f.y) * step(f.y, 0.86);
          float lit = step(0.6, hash(cell + vec2(vSeed * 3.0, vSeed)));
          vec3 warm = mix(vec3(1.0, 0.68, 0.36), vec3(0.8, 0.88, 1.0), step(0.82, hash(cell.yx + vec2(vSeed, 7.0))));
          vec3 glass = vec3(0.05, 0.065, 0.09) + sunColor * ndl * 0.25;
          vec3 wcol = mix(glass, warm * (0.9 + 1.2 * hash(cell + 3.3)), lit);
          vec3 wall = base + sunColor * ndl * base * 2.2;
          col = mix(wall, wcol, win);
          // Fade the window pattern to its average where it would alias.
          float aa = clamp(1.0 - 1.5 * max(length(fwidth(g)), 0.0), 0.0, 1.0);
          vec3 avg = mix(wall, mix(glass, warm * 1.4, 0.4), 0.35);
          col = mix(avg, col, aa);
        }
        float fogF = smoothstep(fogNear, fogFar, length(vWorld - cameraPosition));
        col = mix(col, fogColor, fogF);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

function createCity(sunDir, fogColor) {
  const group = new THREE.Group();
  const r = rng(42);
  const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const mat = buildingMaterial(sunDir, fogColor);
  const BASE = -90;
  const items = [];
  const block = 34;
  for (let gx = -11; gx <= 11; gx++) {
    for (let gz = -11; gz <= 11; gz++) {
      const cx = gx * block, cz = gz * block;
      const d = Math.hypot(cx, cz);
      if (d < 60 || d > 400) continue;
      const w = 14 + r() * 16, dpt = 14 + r() * 16;
      // Keep nearby roofs low so the skyline and sunset stay visible.
      const tall = r() < 0.1 && d > 160 ? 40 + r() * 90 : r() * 26;
      const top = (d < 110 ? -28 : -22) + tall;
      items.push({ x: cx + (r() - 0.5) * 8, z: cz + (r() - 0.5) * 8, w, d: dpt, h: top - BASE });
    }
  }
  // Our own building under the roof, and a neighbour with a water tower.
  items.push({ x: 0, z: 0, w: ROOF + 0.6, d: ROOF + 0.6, h: -0.02 - BASE });
  items.push({ x: -26, z: -30, w: 18, d: 20, h: 3 - BASE });

  const mesh = new THREE.InstancedMesh(geo, mat, items.length);
  const m = new THREE.Matrix4();
  items.forEach((b, i) => {
    m.compose(new THREE.Vector3(b.x, BASE, b.z), new THREE.Quaternion(), new THREE.Vector3(b.w, b.h, b.d));
    mesh.setMatrixAt(i, m);
  });
  mesh.frustumCulled = false;
  group.add(mesh);

  // Ground far below (mostly hidden by fog).
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshBasicMaterial({ color: 0x1a1612 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = BASE;
  group.add(ground);

  group.add(createWaterTower(-26, 3, -30));
  return group;
}

function createWaterTower(x, y, z) {
  const g = new THREE.Group();
  const woodTex = tableTexture();
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a32, map: woodTex, roughness: 0.9 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, metalness: 0.7, roughness: 0.5 });
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.5, 5, 24), wood);
  tank.position.y = 6.5;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.7, 1.6, 24), metal);
  roof.position.y = 9.8;
  g.add(tank, roof);
  for (let i = 0; i < 4; i++) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 4, 6), metal);
    const a = i * Math.PI / 2 + Math.PI / 4;
    leg.position.set(Math.cos(a) * 1.8, 2, Math.sin(a) * 1.8);
    g.add(leg);
  }
  for (let i = 0; i < 3; i++) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(2.48, 0.04, 6, 32), metal);
    band.rotation.x = Math.PI / 2;
    band.position.y = 4.8 + i * 1.7;
    g.add(band);
  }
  g.position.set(x, y, z);
  return g;
}

function sagCurve(a, b, sag) {
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const p = a.clone().lerp(b, t);
    p.y -= sag * 4 * t * (1 - t);
    pts.push(p);
  }
  return new THREE.CatmullRomCurve3(pts);
}

function createStringLights(lowPower) {
  const g = new THREE.Group();
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2b2b2e, metalness: 0.6, roughness: 0.5 });
  const H = 2.9;
  const poles = [[-1.9, -2.7], [1.9, -2.7], [1.9, 2.9], [-1.9, 2.9]].map(([x, z]) => new THREE.Vector3(x, H, z));
  for (const p of poles) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, H, 10), poleMat);
    pole.position.set(p.x, H / 2, p.z);
    pole.castShadow = true;
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, 0.12, 16), poleMat);
    foot.position.set(p.x, 0.06, p.z);
    g.add(pole, foot);
  }
  const strands = [[0, 1], [1, 2], [2, 3], [3, 0], [0, 2], [1, 3]];
  const wireMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
  const bulbs = [];
  for (const [i, j] of strands) {
    const curve = sagCurve(poles[i], poles[j], 0.45);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.004, 4), wireMat));
    const n = Math.floor(curve.getLength() / 0.38);
    for (let k = 1; k < n; k++) bulbs.push(curve.getPointAt(k / n).add(new THREE.Vector3(0, -0.05, 0)));
  }
  const bulbMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.028, 12, 8),
    new THREE.MeshStandardMaterial({ color: 0xffe2b0, emissive: 0xffb45c, emissiveIntensity: 5 }),
    bulbs.length);
  const m = new THREE.Matrix4();
  bulbs.forEach((p, i) => { m.makeTranslation(p.x, p.y, p.z); bulbMesh.setMatrixAt(i, m); });
  g.add(bulbMesh);

  const glowMat = new THREE.SpriteMaterial({
    map: glowTexture(), color: 0xffc070, blending: THREE.AdditiveBlending,
    depthWrite: false, transparent: true, opacity: 0.55,
  });
  for (const p of bulbs) {
    const s = new THREE.Sprite(glowMat);
    s.position.copy(p);
    s.scale.setScalar(0.32);
    g.add(s);
  }

  const positions = lowPower ? [[0, 2.3, 0]] : [[0, 2.3, -0.8], [0, 2.3, 0.8]];
  for (const [x, y, z] of positions) {
    const l = new THREE.PointLight(0xffb066, lowPower ? 5 : 3.2, 0, 2);
    l.position.set(x, y, z);
    g.add(l);
  }
  return g;
}

function createProps(wallMat) {
  const g = new THREE.Group();
  // HVAC unit.
  const hvac = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.1, 1.3),
    new THREE.MeshStandardMaterial({ color: 0x8d9296, metalness: 0.6, roughness: 0.5 }));
  body.position.y = 0.55;
  body.castShadow = body.receiveShadow = true;
  const fan = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.06, 24),
    new THREE.MeshStandardMaterial({ color: 0x2a2c2e, metalness: 0.7, roughness: 0.5 }));
  fan.position.set(0.35, 1.13, 0);
  hvac.add(body, fan);
  hvac.position.set(5.6, 0, 3.6);
  hvac.rotation.y = 0.3;
  g.add(hvac);

  // Cooler next to the player.
  const cooler = new THREE.Group();
  const cBody = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.38, 0.4),
    new THREE.MeshPhysicalMaterial({ color: 0x1f5fbf, roughness: 0.35, clearcoat: 0.6 }));
  cBody.position.y = 0.19;
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.07, 0.42),
    new THREE.MeshPhysicalMaterial({ color: 0xf2f2f2, roughness: 0.4, clearcoat: 0.4 }));
  lid.position.y = 0.415;
  cBody.castShadow = lid.castShadow = true;
  cooler.add(cBody, lid);
  cooler.position.set(0.95, 0, 1.9);
  cooler.rotation.y = -0.4;
  g.add(cooler);

  // Low concrete planters with shrubs along the edge.
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f6b2a, roughness: 0.9, flatShading: true });
  const r = rng(5);
  for (const [x, z] of [[-6.5, -6.8], [-3.5, -6.8], [6.8, 3], [6.8, 6], [-6.8, 4]]) {
    const pl = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 0.6), wallMat);
    pl.position.set(x, 0.25, z);
    pl.castShadow = true;
    g.add(pl);
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22 + r() * 0.12, 1), leafMat);
      b.position.set(x - 0.45 + i * 0.3, 0.6 + r() * 0.1, z + (r() - 0.5) * 0.15);
      b.castShadow = true;
      g.add(b);
    }
  }
  return g;
}
