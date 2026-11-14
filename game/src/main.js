// DUSTLINE — main wiring for Yard 7. Owns the renderer, the camera, the
// hitscan shooting, the keyboard, and the glue between the player, the
// weapon, the bots, the rounds and the HUD. The simulation runs on a fixed
// 60 Hz accumulator while rendering stays at display rate.
//
// Deterministic shot mode: ?shot=start|play|plant|end&seed=N replays a fixed
// setup with a seeded RNG, combat off, renders twice, then sets
// window.__shotReady and freezes, so screenshots are reproducible.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld } from './world.js';
import { createPlayer } from './player.js';
import { createWeapon, WEAPONS } from './weapon.js';
import { createHud } from './hud.js';
import { createInput } from './input.js';
import { createEffects } from './effects.js';
import { createAudio } from './audio.js';
import { createBots } from './bots.js';
import { createRounds } from './rounds.js';

const STEP = 1 / 60;
const SHOT_HEAR_RADIUS = 22;
const BUY_IDS = ['hornet', 'vk47', 'grenade'];

// mulberry32: a small seeded RNG so shot captures replay identically.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const params = new URLSearchParams(window.location.search);
const shotName = params.get('shot');
const shotMode = shotName === 'start' || shotName === 'play' || shotName === 'plant' || shotName === 'end';
const shotSeed = Number.parseInt(params.get('seed') || '1', 10) || 1;
const shotRng = shotMode ? mulberry32(shotSeed) : null;
const random = () => (shotMode ? shotRng() : Math.random());

// --- renderer, scene, camera -------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(PALETTE.haze, 30, 95);

const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
camera.rotation.order = 'YXZ';
scene.add(camera);

const raycaster = new THREE.Raycaster();
raycaster.far = 90;

const world = createWorld(scene);
const player = createPlayer(world);
const fx = createEffects(scene);
const audio = createAudio();
const bots = createBots(scene, world, fx, handleEvent);
const rounds = createRounds(world, handleEvent);
const weapon = createWeapon(camera, (name) => audio.play(name));
const hud = createHud();
const input = createInput(renderer.domElement, onLockChange);

let now = 0;
let started = false;
let buyVisible = false;
let matchWon = false;
let frozen = false;

function updateCamera() {
  const p = player.state;
  camera.position.set(p.position.x, p.position.y + p.eye, p.position.z);
  camera.rotation.y = p.yaw;
  camera.rotation.x = p.pitch;
}

function showBuyMenu() {
  if (rounds.state.phase !== 'buy') return;
  hud.showBuy(rounds.state.money, rounds.state.owned, rounds.state.grenades);
  buyVisible = true;
}

function hideBuyMenu() {
  hud.hideBuy();
  buyVisible = false;
}

function hurtPlayer(damage, source) {
  const p = player.state;
  if (!p.alive || damage <= 0) return;
  p.health -= damage;
  hud.damageFlash();
  audio.play('hurt');
  if (p.health <= 0) {
    p.health = 0;
    p.alive = false;
    rounds.onPlayerKilled();
  }
}

// --- the one event router: bots and rounds both report here ------------------
function handleEvent(type, data) {
  switch (type) {
    case 'round-start':
      hideBuyMenu();
      hud.hideBanner();
      break;
    case 'buy-phase':
      if (input.state.locked) showBuyMenu();
      break;
    case 'round-win':
      hud.showBanner('ROUND WON', rounds.state.banner ? rounds.state.banner.sub : '');
      hideBuyMenu();
      audio.play('win');
      break;
    case 'round-lose':
      hud.showBanner('ROUND LOST', rounds.state.banner ? rounds.state.banner.sub : '');
      hideBuyMenu();
      audio.play('lose');
      break;
    case 'match-win':
      matchWon = true;
      hud.showOverlay('matchWin', { you: data.you, them: data.them });
      if (document.exitPointerLock) document.exitPointerLock();
      break;
    case 'match-lose':
      matchWon = false;
      hud.showOverlay('matchLose', { you: data.you, them: data.them });
      if (document.exitPointerLock) document.exitPointerLock();
      break;
    case 'planted':
      hud.feedLine(`Bomb planted at site ${data.site.name} — +$300`);
      break;
    case 'bought':
      audio.play('buy');
      if (data.id !== 'grenade') weapon.equip(data.id);
      showBuyMenu();
      break;
    case 'thrown':
      break;
    case 'bot-killed':
      rounds.onBotKilled(data.bot, data.by);
      break;
    case 'kill-reward':
      hud.feedLine(`${data.bot.name} eliminated — +$300`);
      audio.play('kill');
      break;
    case 'player-damaged':
      hurtPlayer(data.damage, data.source);
      break;
    case 'bot-hit-player':
      hurtPlayer(data.damage, 'bot');
      break;
    case 'defused':
      rounds.endRound(false, 'defused');
      break;
    default:
      break;
  }
}

function onLockChange(locked) {
  if (shotMode) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
    audio.unlock();
    if (rounds.state.phase === 'buy') showBuyMenu();
  } else {
    hideBuyMenu();
    if (rounds.state.phase === 'matchEnd') {
      hud.showOverlay(matchWon ? 'matchWin' : 'matchLose', { you: rounds.state.scoreYou, them: rounds.state.scoreThem });
    } else {
      hud.showOverlay(started ? 'paused' : 'start');
    }
  }
}

hud.onPlay(() => {
  audio.unlock();
  input.requestLock();
});

hud.onBuy((event) => {
  const row = event.target.closest('.buy-row');
  if (!row) return;
  const rows = [...document.querySelectorAll('#buy-list .buy-row')];
  const index = rows.indexOf(row);
  if (index >= 0 && index < BUY_IDS.length && rounds.state.phase === 'buy') {
    rounds.buy(BUY_IDS[index]);
  }
});

// --- shooting ----------------------------------------------------------------
function fireWeapon() {
  const def = weapon.def();
  if (!weapon.takeRound()) {
    weapon.reload();
    return;
  }
  weapon.pullTrigger();
  player.recoil(def.kick, (random() - 0.5) * 0.004);

  camera.updateMatrixWorld();
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const spread = weapon.spread(player.groundSpeed(), player.state.crouching);
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  dir.addScaledVector(right, (random() * 2 - 1) * spread);
  dir.addScaledVector(up, (random() * 2 - 1) * spread);
  dir.normalize();

  const muzzle = camera.position.clone().addScaledVector(dir, 0.5);
  muzzle.y -= 0.12;
  raycaster.set(camera.position, dir);
  const targets = [...bots.hitMeshes, ...world.shootables];
  const hits = raycaster.intersectObjects(targets, false);
  if (hits.length > 0) {
    const hit = hits[0];
    const info = hit.object.userData || {};
    if (info.bot) {
      const head = info.part === 'head';
      const damage = Math.round(def.damage * (head ? def.headMult : 1));
      const killed = bots.damage(hit.object, damage);
      hud.hitMarker(killed);
      audio.play(killed ? 'kill' : 'hit');
    }
    fx.tracer(muzzle, hit.point);
    fx.spark(hit.point);
  } else {
    fx.tracer(muzzle, camera.position.clone().addScaledVector(dir, 90));
  }
  bots.hear(player.state.position.x, player.state.position.z, SHOT_HEAR_RADIUS);
}

function throwGrenade() {
  if (rounds.state.phase !== 'live' || rounds.state.grenades <= 0) return;
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  rounds.throwGrenade(camera.position, dir);
}

// --- keys --------------------------------------------------------------------
function handlePressed() {
  const pressed = input.takePressed();
  if (pressed.length === 0) return;
  const phase = rounds.state.phase;
  for (const code of pressed) {
    if (code === 'KeyR') {
      weapon.reload();
      continue;
    }
    if (phase === 'buy') {
      if (code === 'Digit1') rounds.buy('hornet');
      else if (code === 'Digit2') rounds.buy('vk47');
      else if (code === 'Digit3') rounds.buy('grenade');
      else if (code === 'KeyB') {
        if (buyVisible) hideBuyMenu();
        else showBuyMenu();
      } else if (code === 'Enter') rounds.startRound();
    } else if (phase === 'live') {
      if (code === 'Digit1') weapon.equip('p9');
      else if (code === 'Digit2' && rounds.state.owned.has('hornet')) weapon.equip('hornet');
      else if (code === 'Digit3' && rounds.state.owned.has('vk47')) weapon.equip('vk47');
      else if (code === 'KeyG') throwGrenade();
    }
  }
}

// --- HUD ---------------------------------------------------------------------
function syncHud() {
  const b = rounds.state.bomb;
  hud.setHealth(player.state.health);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve);
  hud.setMoney(rounds.state.money);
  hud.setTimer(rounds.state.timer, rounds.state.phase);
  hud.setScore(rounds.state.scoreYou, rounds.state.scoreThem);
  hud.setRound(rounds.state.round);
  hud.setWeapon(weapon.def().name, rounds.state.grenades);
  const gap = 6 + weapon.spread(player.groundSpeed(), player.state.crouching) * 900;
  hud.setCrosshairGap(Math.min(40, gap));
  if (rounds.state.phase === 'live' && !b.planted && rounds.state.plantProgress > 0) {
    hud.setPlant(rounds.state.plantProgress, 'PLANTING…');
  } else if (b.planted && !b.exploded) {
    hud.setPlant(Math.max(0, b.fuse / 40), `BOMB — ${Math.max(0, Math.ceil(b.fuse))}s`);
  } else if (b.defuseProgress > 0 && b.defuseProgress < 1) {
    hud.setPlant(b.defuseProgress, 'DEFUSE IN PROGRESS');
  } else {
    hud.setPlant(0);
  }
}

// --- fixed-step simulation ----------------------------------------------------
function fixedStep(dt) {
  now += dt;
  const look = input.takeLook();
  if (look.x !== 0 || look.y !== 0) player.look(look.x, look.y);
  player.step(dt, input.state.keys);
  weapon.step(dt);
  if (!shotMode && input.state.firing && input.state.locked
    && rounds.state.phase === 'live' && player.state.alive && weapon.ready()) {
    fireWeapon();
  }
  rounds.step(dt, player, input.state.keys, bots, fx, audio, random);
  bots.step(dt, now, player, rounds.state.bomb, random, !shotMode);
  fx.step(dt);
  updateCamera();
}

let lastTime = performance.now();
let accumulator = 0;

function animate(time) {
  if (frozen) return;
  requestAnimationFrame(animate);
  const frameDt = Math.min(0.1, (time - lastTime) / 1000);
  lastTime = time;
  handlePressed();
  if (input.state.locked) {
    accumulator += frameDt;
    let steps = 0;
    while (accumulator >= STEP && steps < 5) {
      fixedStep(STEP);
      accumulator -= STEP;
      steps += 1;
    }
    if (steps === 5) accumulator = 0;
  }
  updateCamera();
  syncHud();
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- deterministic shot captures ----------------------------------------------
function aimCameraAt(tx, ty, tz) {
  const p = player.state;
  const dx = tx - p.position.x;
  const dy = ty - (p.position.y + p.eye);
  const dz = tz - p.position.z;
  p.yaw = Math.atan2(-dx, -dz);
  p.pitch = Math.max(-1.45, Math.min(1.45, Math.atan2(dy, Math.hypot(dx, dz))));
  updateCamera();
}

function settle(n) {
  for (let i = 0; i < n; i += 1) fixedStep(STEP);
}

function freshSetup() {
  rounds.resetMatch();
  bots.reset();
  player.reset(world.spawns.attacker);
  updateCamera();
}

function runShot() {
  hud.hideOverlay();
  hud.hideBuy();
  if (shotName === 'start') {
    freshSetup();
    player.state.position.set(0, 0, 11);
    player.state.yaw = 0;
    player.state.pitch = 0;
    settle(20);
    hud.showOverlay('start');
    syncHud();
  } else if (shotName === 'play') {
    freshSetup();
    rounds.startRound();
    player.state.position.set(0, 0, 5);
    settle(10);
    const first = bots.bots[0];
    first.position.set(0, 0, -2);
    first.yaw = Math.PI;
    first.parts.group.rotation.y = Math.PI;
    settle(6);
    aimCameraAt(0, 1.3, -2);
    fireWeapon();
    settle(2);
    syncHud();
  } else if (shotName === 'plant') {
    freshSetup();
    rounds.startRound();
    player.state.position.set(-11, 0, -5);
    settle(10);
    const site = world.sites[0];
    const second = bots.bots[1];
    second.position.set(-14, 0, -7.5);
    second.yaw = Math.atan2(-(-12.5 + 14), -(-5.5 + 7.5));
    second.parts.group.rotation.y = second.yaw;
    player.state.position.set(site.x + 2.5, 0, site.z + 3.5);
    aimCameraAt(site.x, 0.3, site.z);
    rounds.state.plantProgress = 1.75;
    hud.setPlant(0.5, 'PLANTING…');
    settle(6);
    syncHud();
  } else if (shotName === 'end') {
    freshSetup();
    rounds.state.scoreYou = 1;
    rounds.state.scoreThem = 0;
    for (const bot of bots.bots) {
      bot.alive = false;
      bot.health = 0;
      bot.fall = 1;
      bot.parts.group.rotation.x = -1.45;
      bot.parts.group.position.y = -0.08;
    }
    player.state.position.set(2, 0, -3);
    settle(10);
    aimCameraAt(-4, 1.0, -9);
    hud.showBanner('ROUND WON', 'The yard is clear — site A holds.');
    syncHud();
  }
  updateCamera();
  renderer.render(scene, camera);
  renderer.render(scene, camera);
  window.__shotReady = true;
  frozen = true;
}

// --- boot ----------------------------------------------------------------------
rounds.resetMatch();
bots.reset();
player.reset(world.spawns.attacker);
updateCamera();
hud.showOverlay('start');
syncHud();

if (shotMode) runShot();
else requestAnimationFrame(animate);
