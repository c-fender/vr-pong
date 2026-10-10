// Floating 3D scoreboard so score and prompts are visible inside VR too.
import * as THREE from 'three';
import { TABLE } from './constants.js';

// One board behind each end of the table, facing the player at the other end.
export class Scoreboard {
  constructor(scene, viewer = 'near') {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024; this.canvas.height = 384;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1.2, 0.45),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, toneMapped: false }));
    this.mesh.position.set(0, 1.6, -TABLE.length / 2 - 0.9);
    this.mesh.rotation.x = 0.12;
    const holder = new THREE.Group();
    holder.add(this.mesh);
    if (viewer === 'far') holder.rotation.y = Math.PI;
    scene.add(holder);
    this.key = '';
  }

  update({ leftName, leftScore, rightName, rightScore, line1, line2 }) {
    const key = [leftName, leftScore, rightName, rightScore, line1, line2].join('|');
    if (key === this.key) return;
    this.key = key;
    const c = this.ctx;
    c.clearRect(0, 0, 1024, 384);
    c.fillStyle = 'rgba(12,12,18,0.82)';
    c.beginPath(); c.roundRect(8, 8, 1008, 368, 36); c.fill();
    c.strokeStyle = 'rgba(255,180,90,0.7)'; c.lineWidth = 4; c.stroke();
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = 'bold 44px system-ui, sans-serif';
    c.fillStyle = '#9fd3ff'; c.fillText(leftName.toUpperCase(), 230, 70);
    c.fillStyle = '#ff9a9a'; c.fillText(rightName.toUpperCase(), 794, 70);
    c.font = 'bold 130px system-ui, sans-serif';
    c.fillStyle = '#fff';
    c.fillText(String(leftScore), 230, 170);
    c.fillText(String(rightScore), 794, 170);
    c.font = 'bold 60px system-ui, sans-serif';
    c.fillStyle = 'rgba(255,255,255,0.5)'; c.fillText('–', 512, 170);
    c.font = 'bold 46px system-ui, sans-serif';
    c.fillStyle = '#ffd08a'; c.fillText(line1 || '', 512, 278);
    c.font = '34px system-ui, sans-serif';
    c.fillStyle = 'rgba(255,255,255,0.8)'; c.fillText(line2 || '', 512, 334);
    this.tex.needsUpdate = true;
  }
}
