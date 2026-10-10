// Procedural canvas textures, so the game needs no image downloads.
import * as THREE from 'three';

export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function toTexture(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function grain(ctx, x, y, w, h, r, { lines, color, vertical }) {
  for (let i = 0; i < lines; i++) {
    const off = r() * (vertical ? w : h);
    const amp = 2 + r() * 8, freq = 0.002 + r() * 0.01, ph = r() * 6.28;
    ctx.strokeStyle = `rgba(${color},${0.04 + r() * 0.2})`;
    ctx.lineWidth = 0.5 + r() * 2.5;
    ctx.beginPath();
    const len = vertical ? h : w;
    for (let s = 0; s <= len; s += 12) {
      const d = off + Math.sin(s * freq + ph) * amp + Math.sin(s * freq * 3.1) * amp * 0.3;
      if (vertical) ctx.lineTo(x + d, y + s); else ctx.lineTo(x + s, y + d);
    }
    ctx.stroke();
  }
}

// Varnished maple tabletop with painted border, center line and logo.
export function tableTexture() {
  const [c, ctx] = makeCanvas(512, 2048);
  const r = rng(7);
  ctx.fillStyle = '#c99a62';
  ctx.fillRect(0, 0, 512, 2048);
  grain(ctx, 0, 0, 512, 2048, r, { lines: 260, color: '110,62,28', vertical: true });
  grain(ctx, 0, 0, 512, 2048, r, { lines: 80, color: '235,190,130', vertical: true });

  ctx.strokeStyle = 'rgba(250,248,240,0.92)';
  ctx.lineWidth = 10;
  ctx.strokeRect(18, 18, 512 - 36, 2048 - 36);
  ctx.fillStyle = 'rgba(250,248,240,0.92)';
  ctx.fillRect(18, 1024 - 4, 512 - 36, 8);

  ctx.save();
  ctx.translate(256, 1024);
  ctx.fillStyle = 'rgba(20,20,24,0.85)';
  ctx.beginPath(); ctx.arc(0, 0, 120, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(250,248,240,0.95)';
  ctx.lineWidth = 8;
  ctx.beginPath(); ctx.arc(0, 0, 108, 0, Math.PI * 2); ctx.stroke();
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = '#e8203a';
  ctx.font = 'bold 64px Impact, "Arial Black", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('PONG', 0, 4);
  ctx.restore();

  const map = toTexture(c);
  map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
  return map;
}

// Weathered wooden roof-deck planks.
export function deckTexture() {
  const [c, ctx] = makeCanvas(1024, 1024);
  const r = rng(3);
  const planks = 6, pw = 1024 / planks;
  for (let i = 0; i < planks; i++) {
    const y = i * pw;
    let x = -r() * 600;
    while (x < 1024) {
      const len = 500 + r() * 500;
      const t = 0.75 + r() * 0.3;
      ctx.fillStyle = `rgb(${Math.round(128 * t)},${Math.round(92 * t)},${Math.round(64 * t)})`;
      ctx.fillRect(x, y, len, pw);
      ctx.save();
      ctx.beginPath(); ctx.rect(x, y, len, pw); ctx.clip();
      grain(ctx, x, y, len, pw, r, { lines: 30, color: '50,30,18', vertical: false });
      grain(ctx, x, y, len, pw, r, { lines: 10, color: '200,170,130', vertical: false });
      ctx.restore();
      ctx.fillStyle = 'rgba(20,12,8,0.85)';
      ctx.fillRect(x + len - 2, y, 3, pw);
      x += len;
    }
    ctx.fillStyle = 'rgba(15,10,6,0.95)';
    ctx.fillRect(0, y, 1024, 5);
  }
  return toTexture(c);
}

export function concreteTexture() {
  const [c, ctx] = makeCanvas(512, 512);
  const img = ctx.createImageData(512, 512);
  const r = rng(11);
  for (let i = 0; i < 512 * 512; i++) {
    const n = 150 + (r() - 0.5) * 40;
    img.data[i * 4] = n; img.data[i * 4 + 1] = n - 4; img.data[i * 4 + 2] = n - 10; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = `rgba(${r() < 0.5 ? '60,55,50' : '200,195,185'},${r() * 0.08})`;
    ctx.beginPath(); ctx.arc(r() * 512, r() * 512, 10 + r() * 60, 0, Math.PI * 2); ctx.fill();
  }
  return toTexture(c);
}

export function glowTexture() {
  const [c, ctx] = makeCanvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.15, 'rgba(255,220,160,0.8)');
  g.addColorStop(0.4, 'rgba(255,170,80,0.18)');
  g.addColorStop(1, 'rgba(255,150,60,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
