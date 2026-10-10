// Beer-pong table and party cups.
import * as THREE from 'three';
import { TABLE, CUP, BALL_R } from './constants.js';
import { tableTexture } from './textures.js';
import { formationPositions } from './rack.js';

export function createTable() {
  const g = new THREE.Group();
  const map = tableTexture();
  const topMat = new THREE.MeshPhysicalMaterial({
    map, roughness: 0.42, clearcoat: 0.8, clearcoatRoughness: 0.18, bumpMap: map, bumpScale: 0.4,
  });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x1b1b1d, metalness: 0.85, roughness: 0.35 });
  const underMat = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.9 });
  const top = new THREE.Mesh(
    new THREE.BoxGeometry(TABLE.width, TABLE.thickness, TABLE.length),
    [trimMat, trimMat, topMat, underMat, trimMat, trimMat]);
  top.position.y = TABLE.height - TABLE.thickness / 2;
  top.castShadow = top.receiveShadow = true;
  g.add(top);

  const legMat = new THREE.MeshStandardMaterial({ color: 0x9ea3a8, metalness: 1, roughness: 0.3 });
  const legH = TABLE.height - TABLE.thickness;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, legH, 12), legMat);
      leg.position.set(sx * (TABLE.width / 2 - 0.05), legH / 2, sz * (TABLE.length / 2 - 0.12));
      leg.castShadow = true;
      g.add(leg);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, TABLE.width - 0.1, 8), legMat);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, 0.18, sx * (TABLE.length / 2 - 0.12));
    g.add(bar);
  }
  const spine = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, TABLE.length - 0.24, 8), legMat);
  spine.rotation.x = Math.PI / 2;
  spine.position.y = 0.18;
  g.add(spine);
  return g;
}

// Solo-cup profile with the characteristic rings.
function outerRadius(h) {
  let r = CUP.bottomR + (CUP.topR - CUP.bottomR) * (h / CUP.height);
  for (const ring of [0.03, 0.055, 0.082]) r += 0.0009 * Math.exp(-(((h - ring) / 0.0018) ** 2));
  return r;
}

let cupParts = null;
function getCupParts() {
  if (cupParts) return cupParts;
  const top = CUP.height - CUP.rimR;
  const outer = [new THREE.Vector2(0, 0.0005), new THREE.Vector2(CUP.bottomR - 0.004, 0), new THREE.Vector2(CUP.bottomR, 0.003)];
  for (let i = 1; i <= 60; i++) {
    const h = 0.003 + (top - 0.003) * (i / 60);
    outer.push(new THREE.Vector2(outerRadius(h), h));
  }
  const inner = [];
  for (let i = 0; i <= 30; i++) {
    const h = top - (top - 0.006) * (i / 30);
    inner.push(new THREE.Vector2(CUP.bottomR - 0.0015 + (CUP.topR - CUP.bottomR) * (h / CUP.height), h));
  }
  inner.push(new THREE.Vector2(0, 0.006));

  const red = new THREE.MeshPhysicalMaterial({
    color: 0xc4122f, roughness: 0.32, clearcoat: 0.55, clearcoatRoughness: 0.25, side: THREE.DoubleSide,
  });
  const white = new THREE.MeshStandardMaterial({ color: 0xf1efea, roughness: 0.45, side: THREE.DoubleSide });
  const liquid = new THREE.MeshStandardMaterial({
    color: 0xb8660f, roughness: 0.18, metalness: 0, transparent: true, opacity: 0.93, envMapIntensity: 0.35,
  });
  cupParts = {
    outerGeo: new THREE.LatheGeometry(outer, 40),
    innerGeo: new THREE.LatheGeometry(inner, 40).rotateY(Math.PI / 40),
    rimGeo: new THREE.TorusGeometry(CUP.topR, CUP.rimR, 8, 40).rotateX(Math.PI / 2).translate(0, CUP.height - CUP.rimR * 0.5, 0),
    liquidGeo: new THREE.CircleGeometry(CUP.bottomR + (CUP.topR - CUP.bottomR) * (CUP.liquidH / CUP.height) - 0.0016, 40)
      .rotateX(-Math.PI / 2).translate(0, CUP.liquidH, 0),
    red, white, liquid,
  };
  return cupParts;
}

function createCupMesh() {
  const p = getCupParts();
  const g = new THREE.Group();
  const outer = new THREE.Mesh(p.outerGeo, p.red);
  outer.castShadow = outer.receiveShadow = true;
  const inner = new THREE.Mesh(p.innerGeo, p.white);
  inner.receiveShadow = true;
  const rim = new THREE.Mesh(p.rimGeo, p.red);
  rim.castShadow = true;
  const liquid = new THREE.Mesh(p.liquidGeo, p.liquid);
  g.add(outer, inner, rim, liquid);
  return g;
}

export function createCups(scene) {
  const cups = [];
  for (const side of ['far', 'near']) {
    formationPositions(10, side).forEach((pos, i) => {
      const mesh = createCupMesh();
      scene.add(mesh);
      cups.push({ id: `${side}${i}`, side, x: pos.x, z: pos.z, active: true, mesh, removing: null, move: null });
    });
  }
  return cups;
}

export function createBallMesh() {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_R, 32, 16),
    new THREE.MeshPhysicalMaterial({ color: 0xfbfaf6, roughness: 0.38, clearcoat: 0.35, clearcoatRoughness: 0.4 }));
  m.castShadow = true;
  return m;
}
