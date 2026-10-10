import * as THREE from 'three';
import { createEnvironment } from './environment.js';
import { createTable, createCups } from './table.js';
import { Scoreboard } from './scoreboard.js';
import { Sfx } from './audio.js';
import { Game } from './game.js';
import { FlatControls } from './controls.js';
import { XRControls } from './xr.js';
import { PLAYER_Z, EYE_HEIGHT } from './constants.js';

const $ = (id) => document.getElementById(id);
const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || navigator.maxTouchPoints > 1;

const prefs = (() => {
  try { return JSON.parse(localStorage.getItem('cuppong') || '{}'); } catch { return {}; }
})();
const savePrefs = () => { try { localStorage.setItem('cuppong', JSON.stringify(prefs)); } catch { /* ignore */ } };

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
$('app').appendChild(renderer.domElement);

// Scene
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.02, 1500);
const rig = new THREE.Group();
rig.position.set(0, 0, PLAYER_Z);
rig.add(camera);
scene.add(rig);
camera.position.set(0, EYE_HEIGHT, 0);
camera.rotation.x = -0.2;

createEnvironment(renderer, scene, { lowPower: isMobile });
scene.add(createTable());
const cups = createCups(scene);
const board = new Scoreboard(scene);
const sfx = new Sfx();

// DOM HUD
let toastTimer = 0;
const ui = {
  toast(text, kind = '') {
    const t = $('toast');
    t.textContent = text;
    t.className = `show ${kind}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = ''; }, 1300);
  },
  status({ you, cpu, turn, balls, hint }) {
    $('sYou').textContent = you;
    $('sCpu').textContent = cpu;
    $('turn').textContent = turn;
    $('balls').dataset.n = balls;
    $('hint').textContent = hint;
  },
  gameOver(playerWon) {
    if (playerWon === null) return;
    showMenu(playerWon ? 'You win! 🏆' : 'CPU wins', 'Play again');
  },
};

const game = new Game({ scene, camera, cups, sfx, ui, board });
game.strength = prefs.strength ?? 1;

const controls = new FlatControls(camera, renderer.domElement, {
  onThrow: (speed, side) => game.swipeThrow(speed, side),
  canThrow: () => game.canPlayerThrow() && !renderer.xr.isPresenting && $('menu').hidden,
  onDrag: (x, lift) => game.setHoldDrag(x, lift),
});
const xr = new XRControls(renderer, rig, {
  onGrab: (h) => game.xrGrab(h),
  onRelease: (h) => game.xrRelease(h),
});
game.xr = xr;

renderer.xr.addEventListener('sessionstart', () => {
  game.mode = 'vr';
  document.body.classList.add('in-vr');
});
renderer.xr.addEventListener('sessionend', () => {
  game.mode = 'flat';
  document.body.classList.remove('in-vr');
  camera.position.set(0, EYE_HEIGHT, 0);
  onResize();
  showMenu('Rooftop Cup Pong', 'Resume');
});

// Menu
function showMenu(title, playLabel) {
  $('title').textContent = title;
  $('btnPlay').textContent = playLabel;
  $('menu').hidden = false;
}

let difficulty = prefs.difficulty || 'medium';
const segButtons = document.querySelectorAll('#difficulty button');
const setDifficulty = (d) => {
  difficulty = d;
  segButtons.forEach((b) => b.classList.toggle('on', b.dataset.d === d));
};
segButtons.forEach((b) => b.addEventListener('click', () => {
  setDifficulty(b.dataset.d);
  prefs.difficulty = b.dataset.d;
  savePrefs();
}));
setDifficulty(difficulty);

$('strength').value = game.strength;
$('strength').addEventListener('input', (e) => {
  game.strength = Number(e.target.value);
  prefs.strength = game.strength;
  savePrefs();
});

$('btnPlay').addEventListener('click', async () => {
  sfx.init();
  if (isMobile && !controls.gyroEnabled) await controls.enableGyro();
  $('menu').hidden = true;
  const resume = $('btnPlay').textContent === 'Resume' && game.state !== 'menu' && game.state !== 'over';
  if (!resume || game.difficulty !== difficulty) game.start(difficulty);
  controls.recenter();
});

$('btnVR').addEventListener('click', async () => {
  sfx.init();
  try {
    const session = await navigator.xr.requestSession('immersive-vr', {
      optionalFeatures: ['local-floor', 'bounded-floor'],
    });
    await renderer.xr.setSession(session);
    $('menu').hidden = true;
    game.start(difficulty);
  } catch (err) {
    ui.toast('Could not start VR');
    console.error(err);
  }
});

navigator.xr?.isSessionSupported('immersive-vr').then((ok) => { $('btnVR').hidden = !ok; }).catch(() => {});

$('hintText').textContent = isMobile
  ? 'Swipe up to throw — the faster the swipe, the harder the throw. Move your phone to look around.'
  : 'Drag the mouse upward and release to throw — faster = harder. Arrow keys look around.';
if (isMobile && !window.isSecureContext) {
  $('hintText').textContent += ' (Motion look needs HTTPS.)';
}

$('btnRecenter').addEventListener('click', () => controls.recenter());
$('btnSound').addEventListener('click', () => {
  sfx.muted = !sfx.muted;
  $('btnSound').textContent = sfx.muted ? '🔇' : '🔊';
});
$('btnMenu').addEventListener('click', () => showMenu('Rooftop Cup Pong', 'Resume'));
$('btnRecenter').hidden = !isMobile;

// Resize
function onResize() {
  if (renderer.xr.isPresenting) return;
  camera.aspect = innerWidth / innerHeight;
  camera.fov = camera.aspect < 1 ? 64 : 48;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', onResize);
onResize();

// Loop
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!renderer.xr.isPresenting) controls.update(dt);
  else xr.update();
  game.update(dt);
  renderer.render(scene, camera);
});

window.__game = game; // handy for debugging in the console
