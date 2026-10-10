import * as THREE from 'three';
import { createEnvironment } from './environment.js';
import { createTable, createCups } from './table.js';
import { Scoreboard } from './scoreboard.js';
import { Sfx } from './audio.js';
import { Game } from './game.js';
import { FlatControls } from './controls.js';
import { XRControls } from './xr.js';
import { hostRoom, joinRoom, normalizeCode } from './net.js';
import { PLAYER_Z, EYE_HEIGHT, VIEW_PITCH } from './constants.js';

const $ = (id) => document.getElementById(id);
const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || navigator.maxTouchPoints > 1;
const inArtifact = !!window.claude?.use;

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

// Scene. The rig is where the player stands; it moves to the far end when
// playing from that side.
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.02, 1500);
const rig = new THREE.Group();
rig.position.set(0, 0, PLAYER_Z);
rig.add(camera);
scene.add(rig);
camera.position.set(0, EYE_HEIGHT, 0);
camera.rotation.x = VIEW_PITCH;

createEnvironment(renderer, scene, { lowPower: isMobile });
scene.add(createTable());
const cups = createCups(scene);
const boards = { near: new Scoreboard(scene, 'near'), far: new Scoreboard(scene, 'far') };
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
  status({ leftName, leftScore, rightName, rightScore, turn, balls, hint }) {
    $('nLeft').textContent = leftName;
    $('sLeft').textContent = leftScore;
    $('nRight').textContent = rightName;
    $('sRight').textContent = rightScore;
    $('turn').textContent = turn;
    $('balls').dataset.n = balls;
    $('hint').textContent = hint || $('hint').dataset.note || '';
  },
  gameOver(text) {
    if (text) setTimeout(() => showMenu(text, 'over'), 1200);
  },
};

const game = new Game({ scene, camera, cups, sfx, ui, boards });
game.strength = prefs.strength ?? 1;

const controls = new FlatControls(camera, renderer.domElement, {
  onThrow: (speed, side) => game.swipeThrow(speed, side),
  canThrow: () => game.canPlayerThrow() && !renderer.xr.isPresenting && $('menu').hidden,
  canLook: () => !renderer.xr.isPresenting && $('menu').hidden,
  onDrag: (x, lift) => game.setHoldDrag(x, lift),
});
const xr = new XRControls(renderer, rig, {
  onGrab: (h) => game.xrGrab(h),
  onRelease: (h) => game.xrRelease(h),
});
game.xr = xr;

// Moving between table ends (pass & play hands the view to the next player).
const ease = (t) => t * t * (3 - 2 * t);
let rigAnim = null;
const rigPose = (side) => ({ z: side === 'far' ? -PLAYER_Z : PLAYER_Z, yaw: side === 'far' ? Math.PI : 0 });
game.onViewChange = (side, instant) => {
  const to = rigPose(side);
  if (instant || renderer.xr.isPresenting) {
    rigAnim = null;
    rig.position.set(0, 0, to.z);
    rig.rotation.y = to.yaw;
    controls.recenter();
  } else {
    rigAnim = { from: { z: rig.position.z, yaw: rig.rotation.y }, to, t: 0 };
  }
};
function updateRig(dt) {
  if (!rigAnim) return;
  rigAnim.t = Math.min(1, rigAnim.t + dt / 1.3);
  const k = ease(rigAnim.t);
  const { from, to } = rigAnim;
  rig.position.set(0, Math.sin(Math.PI * k) * 0.6, from.z + (to.z - from.z) * k);
  rig.rotation.y = from.yaw + (to.yaw - from.yaw) * k;
  if (rigAnim.t >= 1) { rigAnim = null; controls.recenter(); }
}

renderer.xr.addEventListener('sessionstart', () => {
  game.mode = 'vr';
  document.body.classList.add('in-vr');
});
renderer.xr.addEventListener('sessionend', () => {
  game.mode = 'flat';
  document.body.classList.remove('in-vr');
  camera.position.set(0, EYE_HEIGHT, 0);
  onResize();
  showMenu('Rooftop Cup Pong', 'pause');
});

// ---- Menu -------------------------------------------------------------------

let menuReason = 'start'; // 'start' | 'pause' | 'over'
let selectedMode = ['cpu', 'pass', 'online'].includes(prefs.mode) ? prefs.mode : 'cpu';
let difficulty = prefs.difficulty || 'medium';
let xrSupported = false;
let link = null;
let hosting = null;

const MODE_NOTES = {
  cpu: 'Play the computer.',
  pass: 'Two players, one phone. Hand it over between turns.',
  online: inArtifact
    ? 'Your friend opens this same page, then enters your room code.'
    : 'Create a room, then send your friend the code or invite link.',
};

function gameRunning() { return !['menu', 'over'].includes(game.state); }

function showMenu(title, reason) {
  menuReason = reason;
  $('title').textContent = title;
  renderMenu();
  $('menu').hidden = false;
}

function renderMenu() {
  document.querySelectorAll('#mode button').forEach((b) => b.classList.toggle('on', b.dataset.m === selectedMode));
  document.querySelectorAll('#difficulty button').forEach((b) => b.classList.toggle('on', b.dataset.d === difficulty));
  $('modeNote').textContent = MODE_NOTES[selectedMode];
  $('rowDifficulty').hidden = selectedMode !== 'cpu';
  const online = selectedMode === 'online';
  $('online').hidden = !online;
  $('onlineIdle').hidden = !!(link || hosting);
  $('onlineHosting').hidden = !hosting || !!link;

  const sameGame = game.play === selectedMode && (selectedMode !== 'cpu' || game.difficulty === difficulty);
  let label = 'Play';
  if (online) {
    if (!link) label = null;
    else if (game.state === 'over') label = 'Rematch';
    else label = 'Resume';
  } else if (menuReason === 'pause' && gameRunning() && sameGame) label = 'Resume';
  else if (menuReason === 'over' && sameGame) label = 'Play again';
  $('btnPlay').hidden = label === null;
  if (label) $('btnPlay').textContent = label;
  $('btnVR').hidden = !xrSupported || (online && !link);
  $('btnVR').textContent = gameRunning() && menuReason === 'pause' ? 'Resume in VR' : 'Play in VR';
}

function setNetStatus(text) { $('netStatus').textContent = text; }

function dropOnline() {
  link?.close();
  hosting?.cancel();
  link = null;
  hosting = null;
  game.net = null;
}

function startLocal() {
  if (link || hosting) dropOnline();
  game.start({ play: selectedMode, difficulty });
}

function startOnline(localSide) {
  $('menu').hidden = true;
  game.start({ play: 'online', localSide });
}

function onNetMessage(msg) {
  if (msg.t === 'start') { setNetStatus(''); startOnline('far'); }
  else if (msg.t === 'rematch') {
    if (game.state === 'over' || game.state === 'menu') startOnline(game.localSide);
  } else game.onNet(msg);
}

function onNetClose() {
  if (!link && !hosting) return;
  dropOnline();
  ui.toast('Your friend left', 'dim');
  setNetStatus('Your friend left the game.');
  if (game.play === 'online') { game.state = 'menu'; showMenu('Rooftop Cup Pong', 'start'); }
  else renderMenu();
}

let gyroChecked = false;
async function prepareDevice() {
  sfx.init();
  if (!isMobile || controls.gyroEnabled) return;
  const granted = await controls.enableGyro();
  if (gyroChecked) return;
  gyroChecked = true;
  // Tell the player if the phone isn't sending motion data, and how to look instead.
  setTimeout(() => {
    if (controls.gyroActive) return;
    const why = !granted ? 'Motion access was declined.'
      : !window.isSecureContext ? 'Motion look needs an https:// address.'
      : inArtifact ? 'Motion look is blocked on this page.'
      : 'This browser isn\'t sending motion data.';
    ui.toast('Drag the top of the screen to look', 'dim');
    $('hint').dataset.note = `${why} Drag the top of the screen to look around.`;
  }, 2500);
}

document.querySelectorAll('#mode button').forEach((b) => b.addEventListener('click', () => {
  selectedMode = b.dataset.m;
  prefs.mode = selectedMode;
  savePrefs();
  renderMenu();
}));

document.querySelectorAll('#difficulty button').forEach((b) => b.addEventListener('click', () => {
  difficulty = b.dataset.d;
  prefs.difficulty = difficulty;
  savePrefs();
  renderMenu();
}));

$('strength').value = game.strength;
$('strength').addEventListener('input', (e) => {
  game.strength = Number(e.target.value);
  prefs.strength = game.strength;
  savePrefs();
});

$('btnPlay').addEventListener('click', async () => {
  await prepareDevice();
  const label = $('btnPlay').textContent;
  $('menu').hidden = true;
  if (selectedMode === 'online') {
    if (label === 'Rematch') { link?.send({ t: 'rematch' }); startOnline(game.localSide); }
  } else if (label !== 'Resume') {
    startLocal();
  }
  controls.recenter();
});

$('btnHost').addEventListener('click', async () => {
  await prepareDevice();
  setNetStatus('Creating a room…');
  $('btnHost').disabled = true;
  try {
    hosting = await hostRoom({
      onConnect: (l) => {
        link = l;
        game.net = l;
        hosting = null;
        setNetStatus('');
        l.send({ t: 'start' });
        startOnline('near');
        controls.recenter();
      },
      onMessage: onNetMessage,
      onClose: onNetClose,
    });
    $('roomCode').textContent = hosting.code;
    setNetStatus('Waiting for your friend to join…');
  } catch (err) {
    setNetStatus(err.message);
  }
  $('btnHost').disabled = false;
  renderMenu();
});

$('btnJoin').addEventListener('click', async () => {
  const code = normalizeCode($('joinCode').value);
  if (code.length !== 5) { setNetStatus('Enter the 5-character room code.'); return; }
  await prepareDevice();
  setNetStatus(`Joining ${code}…`);
  $('btnJoin').disabled = true;
  try {
    link = await joinRoom(code, { onMessage: onNetMessage, onClose: onNetClose });
    game.net = link;
    setNetStatus('Connected. Starting…');
  } catch (err) {
    setNetStatus(err.message);
  }
  $('btnJoin').disabled = false;
  renderMenu();
});

$('joinCode').addEventListener('input', (e) => { e.target.value = normalizeCode(e.target.value); });
$('joinCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnJoin').click(); });

$('btnCopy').addEventListener('click', () => {
  const code = $('roomCode').textContent;
  const text = inArtifact
    ? `Play Rooftop Cup Pong with me. Open the game, tap Online, and enter room code ${code}.`
    : `${location.origin}${location.pathname}?join=${code}`;
  const done = () => setNetStatus('Invite copied. Waiting for your friend to join…');
  const fallback = () => {
    const r = document.createRange();
    r.selectNodeContents($('roomCode'));
    getSelection().removeAllRanges();
    getSelection().addRange(r);
    setNetStatus('Copy the highlighted code and send it to your friend.');
  };
  try { navigator.clipboard.writeText(text).then(done, fallback); } catch { fallback(); }
});

$('btnVR').addEventListener('click', async () => {
  sfx.init();
  const resume = gameRunning() && menuReason === 'pause';
  try {
    const session = await navigator.xr.requestSession('immersive-vr', {
      optionalFeatures: ['local-floor', 'bounded-floor'],
    });
    await renderer.xr.setSession(session);
    $('menu').hidden = true;
    if (!resume && selectedMode !== 'online') startLocal();
  } catch (err) {
    ui.toast('Could not start VR');
    console.error(err);
  }
});

navigator.xr?.isSessionSupported('immersive-vr').then((ok) => { xrSupported = ok; renderMenu(); }).catch(() => {});

$('hintText').textContent = isMobile
  ? 'Swipe up from the bottom to throw. The faster the swipe, the harder the throw. Tilt and turn your phone to look around, or drag the top of the screen. Works upright or sideways.'
  : 'Drag the mouse upward from the lower screen to throw. Faster means harder. Drag the top of the screen, right-drag, or use the arrow keys to look around.';
if (isMobile && !window.isSecureContext) $('hintText').textContent += ' Motion look needs HTTPS.';

$('btnRecenter').addEventListener('click', () => controls.recenter());
$('btnSound').addEventListener('click', () => {
  sfx.muted = !sfx.muted;
  $('btnSound').textContent = sfx.muted ? '🔇' : '🔊';
});
$('btnMenu').addEventListener('click', () => showMenu('Rooftop Cup Pong', gameRunning() ? 'pause' : 'start'));
$('btnRecenter').hidden = !isMobile;

// Invite links: ?join=CODE (regular hosting) or #join-CODE.
const inviteCode = new URLSearchParams(location.search).get('join') || (location.hash.match(/^#join-([A-Za-z0-9]{5})$/) || [])[1];
if (inviteCode) {
  selectedMode = 'online';
  $('joinCode').value = normalizeCode(inviteCode);
  setNetStatus('Tap Join to play your friend.');
}
renderMenu();

// Resize: portrait is the default layout; landscape gets a wider, tighter view.
function onResize() {
  if (renderer.xr.isPresenting) return;
  camera.aspect = innerWidth / innerHeight;
  camera.fov = camera.aspect < 1 ? 58 : 46;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', onResize);
screen.orientation?.addEventListener?.('change', () => setTimeout(onResize, 150));
onResize();

// Loop
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  updateRig(dt);
  if (!renderer.xr.isPresenting) controls.update(dt);
  else xr.update();
  game.update(dt);
  renderer.render(scene, camera);
});

window.__game = game; // handy for debugging in the console
