// DUSTLINE boot: a fixed 60 Hz simulation feeding a render at the display's
// rate. One attacker against four defenders on Yard 7, in rounds with money,
// a buy menu and a bomb. ?shot=start|play|plant|end with &seed=N sets up a
// deterministic frame for a capture, renders it twice, then freezes it and
// sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapon, WEAPONS } from './weapon.js';
import { createBots } from './bots.js';
import { createRounds } from './rounds.js';
import { createEffects } from './effects.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = shot ? mulberry32(seed) : Math.random;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.haze), 30, 95);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const audio = createAudio();
const world = createWorld(scene);
const effects = createEffects(scene);
const hud = createHud();
const player = createPlayer(world);
const input = createInput(renderer.domElement, onLockChange);
const weapon = createWeapon(camera, (name) => audio.play(name));
const rounds = createRounds(world, onRoundEvent);
const bots = createBots(scene, world, effects, onBotEvent);
const raycaster = new THREE.Raycaster();
raycaster.far = 90;
const direction = new THREE.Vector3();
const muzzle = new THREE.Vector3();
const hitPoint = new THREE.Vector3();

const body = player.state;
let started = false;
let frozen = false;
let combatOverride = null;
let elapsed = 0;
let accumulator = 0;
let lastTime = performance.now();
let lastFiring = false;
let buyOpen = false;

function syncCamera() {
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
}

function syncHud() {
  const r = rounds.state;
  hud.setHealth(body.health);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve);
  hud.setMoney(r.money);
  hud.setScore(r.scoreYou, r.scoreThem);
  hud.setRound(r.round);
  hud.setTimer(r.timer, r.phase);
  hud.setWeapon(weapon.def().name, r.grenades);
}

function resetRound() {
  player.reset(world.spawns.attacker);
  bots.reset();
  weapon.refill();
  buyOpen = rPhase() === 'buy';
  if (buyOpen) hud.showBuy(rounds.state.money, rounds.state.owned, rounds.state.grenades);
  else hud.hideBuy();
  hud.hideBanner();
  syncHud();
}

function rPhase() {
  return rounds.state.phase;
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    audio.unlock();
    hud.hideOverlay();
    if (rPhase() === 'buy' && !buyOpen) {
      buyOpen = true;
      hud.showBuy(rounds.state.money, rounds.state.owned, rounds.state.grenades);
    }
  } else if (rPhase() !== 'matchEnd') {
    hud.showOverlay(started ? 'paused' : 'start');
  }
}

hud.onPlay(() => {
  if (shot) return;
  if (rPhase() === 'matchEnd') {
    rounds.resetMatch();
    weapon.equip('p9');
    resetRound();
  }
  input.requestLock();
});

hud.onBuy((event) => {
  const row = event.target.closest('.buy-row');
  if (!row || rPhase() !== 'buy') return;
  const index = [...row.parentElement.children].indexOf(row);
  buyItem(['hornet', 'vk47', 'grenade'][index]);
});

function buyItem(id) {
  if (rounds.buy(id)) {
    audio.play('buy');
    if (id !== 'grenade') weapon.equip(id);
    hud.showBuy(rounds.state.money, rounds.state.owned, rounds.state.grenades);
    syncHud();
  }
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function shoot() {
  const def = weapon.def();
  if (!weapon.takeRound()) return false;
  camera.getWorldDirection(direction);
  const spread = weapon.spread(player.groundSpeed(), body.crouching);
  direction.x += (rng() * 2 - 1) * spread;
  direction.y += (rng() * 2 - 1) * spread;
  direction.z += (rng() * 2 - 1) * spread;
  direction.normalize();
  scene.updateMatrixWorld(true);
  raycaster.set(camera.position, direction);
  muzzle.set(0.24, -0.18, -0.95);
  camera.localToWorld(muzzle);
  const targets = world.shootables.concat(bots.hitMeshes());
  const hits = raycaster.intersectObjects(targets, false);
  const hit = hits[0];
  if (hit) {
    hitPoint.copy(hit.point);
    const bot = hit.object.userData.bot;
    if (bot) {
      const damage = def.damage * (hit.object.userData.part === 'head' ? def.headMult : 1);
      const killed = bots.damage(hit.object, damage);
      hud.hitMarker(killed, shot ? 4000 : 90);
      if (killed) {
        audio.play('kill');
        rounds.onBotKilled(bot);
        hud.feedLine(`You eliminated ${bot.name}  +$300`);
      } else {
        audio.play('hit');
      }
      effects.spark(hitPoint, '#ff5a3c');
    } else {
      effects.spark(hitPoint);
    }
  } else {
    hitPoint.copy(camera.position).addScaledVector(direction, 80);
  }
  effects.tracer(muzzle, hitPoint);
  weapon.pullTrigger();
  player.recoil(def.kick + rng() * 0.004, (rng() * 2 - 1) * 0.004);
  bots.hear(body.position.x, body.position.z, 22);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve);
  return true;
}

function damagePlayer(amount, source) {
  if (!body.alive) return;
  body.health -= amount;
  hud.setHealth(body.health);
  hud.damageFlash();
  audio.play('hurt');
  if (body.health <= 0) {
    body.alive = false;
    rounds.onPlayerKilled();
  }
}

function onBotEvent(type, data) {
  if (type === 'bot-hit-player') {
    damagePlayer(data.damage, 'bot');
  } else if (type === 'defused') {
    rounds.endRound(false, 'The bomb was defused at site ' + rounds.state.bomb.site.name + '.');
  } else if (type === 'bot-killed') {
    rounds.onBotKilled(data.bot);
    hud.feedLine(`Spark grenade eliminated ${data.bot.name}  +$300`);
  }
}

function onRoundEvent(type, data) {
  if (type === 'round-start') {
    hud.hideBanner();
    hud.hideBuy();
    buyOpen = false;
    hud.setRound(rounds.state.round);
  } else if (type === 'buy-phase') {
    resetRound();
  } else if (type === 'round-win') {
    audio.play('win');
    hud.showBanner('ROUND WON', data.reason);
    hud.hideBuy();
    buyOpen = false;
  } else if (type === 'round-lose') {
    audio.play('lose');
    hud.showBanner('ROUND LOST', data.reason);
    hud.hideBuy();
    buyOpen = false;
  } else if (type === 'match-win') {
    hud.showOverlay('matchWin', { you: rounds.state.scoreYou, them: rounds.state.scoreThem });
    if (document.pointerLockElement) document.exitPointerLock();
  } else if (type === 'match-lose') {
    hud.showOverlay('matchLose', { you: rounds.state.scoreYou, them: rounds.state.scoreThem });
    if (document.pointerLockElement) document.exitPointerLock();
  } else if (type === 'planted') {
    audio.play('plant');
    hud.feedLine(`Bomb planted at site ${data.site}`);
  } else if (type === 'bought') {
    // handled in buyItem
  } else if (type === 'player-damaged') {
    damagePlayer(data.damage, data.source);
  }
}

function handlePressed(codes) {
  for (const code of codes) {
    if (rPhase() === 'buy') {
      if (code === 'Digit1') buyItem('hornet');
      else if (code === 'Digit2') buyItem('vk47');
      else if (code === 'Digit3') buyItem('grenade');
      else if (code === 'KeyB') {
        buyOpen = !buyOpen;
        if (buyOpen) hud.showBuy(rounds.state.money, rounds.state.owned, rounds.state.grenades);
        else hud.hideBuy();
      } else if (code === 'Enter') {
        rounds.startRound();
      }
    } else if (rPhase() === 'live') {
      if (code === 'Digit1') weapon.equip('p9');
      else if (code === 'Digit2' && rounds.state.owned.has('hornet')) weapon.equip('hornet');
      else if (code === 'Digit3' && rounds.state.owned.has('vk47')) weapon.equip('vk47');
      else if (code === 'KeyG') {
        camera.getWorldDirection(direction);
        const origin = camera.position.clone();
        if (rounds.throwGrenade(origin, direction, rng)) audio.play('click');
      }
    }
    if (code === 'KeyR') weapon.reload();
  }
}

function step(dt) {
  elapsed += dt;
  const keys = input.state.keys;
  player.step(dt, keys);
  weapon.step(dt);
  effects.step(dt);
  bots.step(dt, elapsed, body, rounds.state.bomb, rng, combatOverride !== null ? combatOverride : rPhase() === 'live');
  rounds.step(dt, body, keys, bots, effects, audio, rng);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    player.look(look.x, look.y);
    const firing = input.state.firing;
    const def = weapon.def();
    const wantShot = firing && (def.auto || !lastFiring);
    if (wantShot && rPhase() === 'live' && body.alive && weapon.ready()) shoot();
    lastFiring = firing;
    handlePressed(input.takePressed());
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
    // Live HUD readouts, every frame.
    const r = rounds.state;
    hud.setTimer(r.timer, r.phase);
    hud.setCrosshairGap(6 + weapon.spread(player.groundSpeed(), body.crouching) * 900 + player.groundSpeed() * 0.8);
    if (r.plantProgress > 0) hud.setPlant(r.plantProgress / 3.5, 'PLANTING…');
    else if (r.bomb.planted && !r.bomb.exploded) hud.setPlant(1 - r.bomb.fuse / 40, `BOMB — ${Math.ceil(r.bomb.fuse)}s`);
    else {
      const defusing = bots.bots.find((b) => b.alive && (b.defuseProgress || 0) > 0);
      if (defusing) hud.setPlant(defusing.defuseProgress / 5, 'DEFUSE IN PROGRESS');
      else hud.setPlant(0);
    }
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function runShot(name) {
  hud.hideOverlay();
  hud.hideBuy();
  buyOpen = false;
  combatOverride = false;
  if (name === 'start') {
    body.position.set(0, 0, 11);
    body.yaw = 0;
    body.pitch = 0;
    settle(20);
    hud.showOverlay('start');
    syncCamera();
  } else if (name === 'play') {
    rounds.startRound();
    body.position.set(0, 0, 5);
    settle(10);
    const bot = bots.bots[0];
    bot.position.set(0, 0, -2);
    bot.yaw = Math.PI;
    bot.parts.group.rotation.y = bot.yaw;
    settle(6);
    aimAt(new THREE.Vector3(0, 1.3, -2));
    shoot();
    settle(2);
    syncHud();
  } else if (name === 'plant') {
    rounds.startRound();
    body.position.set(-11, 0, -5);
    settle(10);
    const bot = bots.bots[1];
    bot.position.set(-14, 0, -7.5);
    bot.yaw = Math.atan2(-(-12.5 - -14), -(-5.5 - -7.5));
    bot.parts.group.rotation.y = bot.yaw;
    const site = world.sites[0];
    body.position.set(site.x + 2.5, 0, site.z + 3.5);
    aimAt(new THREE.Vector3(site.x, 0.3, site.z));
    rounds.state.plantProgress = 1.75;
    hud.setPlant(0.5, 'PLANTING…');
    settle(6);
    syncHud();
  } else if (name === 'end') {
    rounds.state.scoreYou = 1;
    rounds.state.scoreThem = 0;
    for (const bot of bots.bots) {
      bot.alive = false;
      bot.fall = 1;
      bot.parts.group.rotation.x = -1.45;
      bot.parts.group.position.y = -0.08;
    }
    body.position.set(2, 0, -3);
    settle(10);
    aimAt(new THREE.Vector3(-4, 1.0, -9));
    hud.showBanner('ROUND WON', 'The yard is clear — site A holds.');
    syncHud();
  }
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

resetRound();
syncCamera();
if (shot) runShot(shot);
else requestAnimationFrame(frame);
