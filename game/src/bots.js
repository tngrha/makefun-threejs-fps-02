// The defenders: four bots that hold the sites, walk routes, react to sight
// and sound, and converge to defuse a planted bomb. Each bot is a small state
// machine — route, investigate, engage, defuse — stepped at the same fixed
// 60 Hz as the player, with perception checks staggered so the work stays flat.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const NAMES = ['Rook', 'Vex', 'Moss', 'Ivy'];
const HEALTH = 100;
const SPEED = 3.2;
const ENGAGE_SPEED = 2.1;
const SIGHT_RANGE = 30;
const SIGHT_HALF_ANGLE = 0.9; // ~51 degrees either side
const HEAR_RADIUS = 22;
const BURST_ROUNDS = 3;

function buildBotMesh(index) {
  const team = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.teal), roughness: 0.7, metalness: 0.05 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.6, metalness: 0.1 });
  const visor = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.rust), roughness: 0.4, metalness: 0.2 });
  const group = new THREE.Group();
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.72, 0.18), dark);
  legL.position.set(-0.11, 0.36, 0);
  const legR = legL.clone();
  legR.position.x = 0.11;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.72, 0.3), team);
  torso.position.y = 1.08;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), dark);
  head.position.y = 1.62;
  const visorMesh = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.07, 0.05), visor);
  visorMesh.position.set(0, 1.64, -0.14);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.5), dark);
  gun.position.set(0.24, 1.15, -0.3);
  group.add(legL, legR, torso, head, visorMesh, gun);
  group.traverse((mesh) => {
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  return { group, torso, head, gun, legL, legR };
}

export function createBots(scene, world, fx, onEvent) {
  const bots = [];
  const tmp = new THREE.Vector3();
  const toPlayer = new THREE.Vector3();
  const eye = new THREE.Vector3();

  for (let i = 0; i < 4; i += 1) {
    const parts = buildBotMesh(i);
    const spawn = world.spawns.defenders[i];
    parts.group.position.set(spawn.x, 0, spawn.z);
    scene.add(parts.group);
    const bot = {
      index: i,
      name: NAMES[i],
      parts,
      position: parts.group.position,
      yaw: 0,
      health: HEALTH,
      alive: true,
      state: 'route',
      route: world.routes[i],
      routeIndex: 1,
      holdUntil: 0,
      lastSeen: new THREE.Vector3(),
      seenAt: -10,
      investigateAt: new THREE.Vector3(),
      fireAt: 0,
      burstLeft: 0,
      losTimer: i * 0.05,
      hasLos: false,
      strafeDir: 1,
      strafeUntil: 0,
      fall: 0,
      walkPhase: i * 1.3,
    };
    parts.torso.userData.bot = bot;
    parts.torso.userData.part = 'torso';
    parts.head.userData.bot = bot;
    parts.head.userData.part = 'head';
    bots.push(bot);
  }

  function aimBotAt(bot, x, z) {
    bot.yaw = Math.atan2(-(x - bot.position.x), -(z - bot.position.z));
  }

  function moveToward(bot, x, z, dt, speed) {
    const dx = x - bot.position.x;
    const dz = z - bot.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.05) return true;
    const stepX = (dx / dist) * speed * dt;
    const stepZ = (dz / dist) * speed * dt;
    const nextX = bot.position.x + stepX;
    if (!world.overlaps(nextX, bot.position.y, bot.position.z, 0.34, 1.72, 0.04)) bot.position.x = nextX;
    const nextZ = bot.position.z + stepZ;
    if (!world.overlaps(bot.position.x, bot.position.y, nextZ, 0.34, 1.72, 0.04)) bot.position.z = nextZ;
    aimBotAt(bot, x, z);
    bot.walkPhase += dt * 9;
    bot.parts.legL.rotation.x = Math.sin(bot.walkPhase) * 0.5;
    bot.parts.legR.rotation.x = -Math.sin(bot.walkPhase) * 0.5;
    return Math.hypot(x - bot.position.x, z - bot.position.z) < 0.6;
  }

  function perceive(bot, player, now) {
    bot.losTimer -= 1 / 60;
    if (bot.losTimer > 0) return;
    bot.losTimer = 0.2 + bot.index * 0.03;
    bot.hasLos = false;
    if (!player.alive) return;
    toPlayer.set(player.position.x - bot.position.x, 0, player.position.z - bot.position.z);
    const dist = toPlayer.length();
    if (dist > SIGHT_RANGE) return;
    const forward = new THREE.Vector3(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
    if (forward.dot(toPlayer.clone().normalize()) < Math.cos(SIGHT_HALF_ANGLE)) return;
    eye.set(bot.position.x, 1.55, bot.position.z);
    const chest = new THREE.Vector3(player.position.x, player.position.y + 1.2, player.position.z);
    if (world.segmentBlocked(eye.x, eye.y, eye.z, chest.x, chest.y, chest.z)) return;
    bot.hasLos = true;
    bot.lastSeen.copy(player.position);
    bot.seenAt = now;
  }

  function fireAtPlayer(bot, player, now, rng) {
    if (now < bot.fireAt) return;
    bot.fireAt = now + 0.45 + rng() * 0.35;
    bot.burstLeft = BURST_ROUNDS;
    bot.strafeDir = rng() > 0.5 ? 1 : -1;
    bot.strafeUntil = now + 0.5 + rng() * 0.5;
  }

  function resolveBurst(bot, player, now, rng) {
    if (bot.burstLeft <= 0) return;
    bot.burstLeft -= 1;
    if (!player.alive) return;
    const dist = Math.hypot(player.position.x - bot.position.x, player.position.z - bot.position.z);
    let chance = 0.55 - (dist / SIGHT_RANGE) * 0.4;
    if (player.crouching) chance -= 0.08;
    const playerSpeed = Math.hypot(player.velocity.x, player.velocity.z);
    if (playerSpeed > 3) chance -= 0.1;
    const muzzle = new THREE.Vector3(bot.position.x + 0.24, 1.35, bot.position.z);
    if (rng() < Math.max(0.06, chance)) {
      const damage = 12 + Math.floor(rng() * 9);
      const chest = new THREE.Vector3(player.position.x, player.position.y + 1.1, player.position.z);
      if (fx) fx.tracer(muzzle, chest, '#ffd27a');
      if (onEvent) onEvent('bot-hit-player', { bot, damage });
    } else {
      const miss = new THREE.Vector3(
        player.position.x + (rng() * 2 - 1) * 1.2,
        player.position.y + 0.6 + rng() * 1.2,
        player.position.z + (rng() * 2 - 1) * 1.2,
      );
      if (fx) fx.tracer(muzzle, miss, '#ffd27a');
    }
    if (fx) fx.shotSound && fx.shotSound();
  }

  function step(dt, now, player, bomb, rng, combat = true) {
    for (const bot of bots) {
      if (!bot.alive) {
        bot.fall = Math.min(1, bot.fall + dt / 0.4);
        bot.parts.group.rotation.x = -bot.fall * 1.45;
        bot.parts.group.position.y = -bot.fall * 0.08;
        continue;
      }
      // Outside a live round the defence only walks its routes: nobody shoots
      // the attacker during the buy phase.
      if (combat) perceive(bot, player, now);
      const seenRecently = combat && now - bot.seenAt < 1.2 && bot.hasLos;

      // A planted bomb pulls the defence to the site.
      if (bomb && bomb.planted && !bomb.exploded) {
        const site = bomb.site;
        const dSite = Math.hypot(site.x - bot.position.x, site.z - bot.position.z);
        if (seenRecently) {
          bot.state = 'engage';
        } else if (dSite < 1.4) {
          bot.state = 'defuse';
        } else {
          bot.state = 'defuse';
          moveToward(bot, site.x, site.z, dt, SPEED);
        }
        if (bot.state === 'defuse' && dSite < 1.4) {
          aimBotAt(bot, site.x, site.z);
          bot.defuseProgress = (bot.defuseProgress || 0) + dt;
          if (bot.defuseProgress >= 5 && onEvent) {
            bot.defuseProgress = 0;
            onEvent('defused', { bot });
          }
        } else {
          bot.defuseProgress = 0;
        }
        if (bot.state === 'engage') {
          fireAtPlayer(bot, player, now, rng);
          resolveBurst(bot, player, now, rng);
        }
        bot.parts.group.rotation.y = bot.yaw;
        continue;
      }

      if (seenRecently) {
        bot.state = 'engage';
        // Strafe while engaging so a bot is never a still target.
        const strafe = bot.strafeDir * ENGAGE_SPEED;
        const sideX = Math.cos(bot.yaw) * strafe * dt;
        const sideZ = -Math.sin(bot.yaw) * strafe * dt;
        const nx = bot.position.x + sideX;
        if (!world.overlaps(nx, bot.position.y, bot.position.z, 0.34, 1.72, 0.04)) bot.position.x = nx;
        const nz = bot.position.z + sideZ;
        if (!world.overlaps(bot.position.x, bot.position.y, nz, 0.34, 1.72, 0.04)) bot.position.z = nz;
        if (now > bot.strafeUntil) {
          bot.strafeDir *= -1;
          bot.strafeUntil = now + 0.5 + rng() * 0.7;
        }
        aimBotAt(bot, player.position.x, player.position.z);
        fireAtPlayer(bot, player, now, rng);
        resolveBurst(bot, player, now, rng);
      } else if (bot.state === 'investigate') {
        const arrived = moveToward(bot, bot.investigateAt.x, bot.investigateAt.z, dt, SPEED);
        if (arrived) {
          bot.holdUntil = now + 2;
          bot.state = 'route';
        }
      } else {
        bot.state = 'route';
        const node = world.waypoints[bot.route[bot.routeIndex]];
        const arrived = moveToward(bot, node.x, node.z, dt, SPEED);
        if (arrived) {
          bot.routeIndex += 1;
          if (bot.routeIndex >= bot.route.length) bot.routeIndex = 0;
        }
      }
      bot.parts.group.rotation.y = bot.yaw;
    }
  }

  function hear(x, z, radius) {
    for (const bot of bots) {
      if (!bot.alive) continue;
      if (Math.hypot(x - bot.position.x, z - bot.position.z) > radius) continue;
      if (bot.state === 'engage') continue;
      bot.investigateAt.set(x, 0, z);
      bot.state = 'investigate';
    }
  }

  function damage(mesh, amount) {
    const bot = mesh.userData.bot;
    if (!bot || !bot.alive) return false;
    bot.health -= amount;
    if (bot.health > 0) return false;
    bot.alive = false;
    bot.fall = 0;
    // A teammate going down is heard: nearby defenders leave their routes
    // and move to check where it happened, instead of walking on unaware.
    hear(bot.position.x, bot.position.z, 18);
    return true;
  }

  function reset() {
    for (const bot of bots) {
      const spawn = world.spawns.defenders[bot.index];
      bot.position.set(spawn.x, 0, spawn.z);
      bot.yaw = 0;
      bot.health = HEALTH;
      bot.alive = true;
      bot.state = 'route';
      bot.routeIndex = 1;
      bot.fall = 0;
      bot.defuseProgress = 0;
      bot.parts.group.rotation.set(0, 0, 0);
      bot.parts.group.position.set(spawn.x, 0, spawn.z);
    }
  }

  function aliveCount() {
    return bots.filter((b) => b.alive).length;
  }

  function hitMeshes() {
    const meshes = [];
    for (const bot of bots) {
      if (!bot.alive) continue;
      meshes.push(bot.parts.torso, bot.parts.head);
    }
    return meshes;
  }

  return { bots, step, hear, damage, reset, aliveCount, hitMeshes };
}
