// Defenders of Yard 7: four bots that patrol lanes, hold the sites, hear
// gunfire, and converge on a planted bomb. Each bot is a small state machine
// — route, investigate, engage, defuse — stepped at the game's fixed 60 Hz.
// Vision is a range + cone + segment check; fire comes in short bursts whose
// accuracy falls off with distance, crouching and target speed.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const NAMES = ['Rook', 'Vex', 'Moss', 'Ivy'];
const COATS = [PALETTE.rust, PALETTE.teal, PALETTE.sand, PALETTE.muted];
const EYE_HEIGHT = 1.55;
const SIGHT_RANGE = 30;
const HALF_ANGLE_COS = Math.cos((51 * Math.PI) / 180);
const WALK_SPEED = 3.2;
const STRAFE_SPEED = 2.0;
const BOT_RADIUS = 0.34;
const BOT_HEIGHT = 1.7;
const FALL_TIME = 0.4;
const DEFUSE_SECONDS = 5;

// Shortest signed turn from `from` to `to`, in (-PI, PI].
function turnDelta(from, to) {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

function buildFigure(coat) {
  const group = new THREE.Group();
  const coatMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(coat), roughness: 0.85, metalness: 0.02 });
  const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.7, metalness: 0.1 });
  const skinMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.shadow), roughness: 0.9, metalness: 0.0 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.75, 0.36), coatMat);
  torso.position.set(0, 1.05, 0);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.32, 0.32), skinMat);
  head.position.set(0, 1.6, 0);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.05), darkMat);
  visor.position.set(0, 1.62, -0.17);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.72), darkMat);
  gun.position.set(0.2, 1.28, -0.32);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.68, 0.24), darkMat);
  legL.position.set(-0.16, 0.34, 0);
  const legR = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.68, 0.24), darkMat);
  legR.position.set(0.16, 0.34, 0);
  group.add(torso, head, visor, gun, legL, legR);
  group.traverse((mesh) => { mesh.castShadow = true; });
  return { group, torso, head, gun, legL, legR };
}

export function createBots(scene, world, fx, onEvent) {
  const bots = [];
  const hitMeshes = [];

  for (let i = 0; i < 4; i += 1) {
    const parts = buildFigure(COATS[i]);
    scene.add(parts.group);
    const bot = {
      index: i,
      name: NAMES[i],
      parts,
      position: parts.group.position,
      yaw: 0,
      health: 100,
      alive: true,
      state: 'route',
      route: world.routes[i],
      routeIndex: 0,
      holdUntil: 0,
      lastSeen: null,
      seenAt: -100,
      investigateAt: null,
      fireAt: 0,
      nextShotAt: 0,
      burstLeft: 0,
      losTimer: Math.random() * 0.2,
      hasLos: false,
      strafeDir: 1,
      strafeUntil: 0,
      fall: 0,
      walkPhase: Math.random() * Math.PI * 2,
      defuseProgress: 0,
    };
    parts.torso.userData = { bot, part: 'torso' };
    parts.head.userData = { bot, part: 'head' };
    hitMeshes.push(parts.torso, parts.head);
    bots.push(bot);
  }

  function faceToward(bot, targetYaw, dt) {
    bot.yaw += turnDelta(bot.yaw, targetYaw) * Math.min(1, dt * 8);
    bot.parts.group.rotation.y = bot.yaw;
  }

  // Walk toward (tx, tz) at `speed`, sliding along colliders axis by axis.
  // Returns true once the bot is within 0.15 m of the target.
  function walkTo(bot, tx, tz, dt, speed) {
    const dx = tx - bot.position.x;
    const dz = tz - bot.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.15) return true;
    const stepLen = Math.min(dist, speed * dt);
    const nx = bot.position.x + (dx / dist) * stepLen;
    const nz = bot.position.z + (dz / dist) * stepLen;
    if (!world.overlaps(nx, 0, bot.position.z, BOT_RADIUS, BOT_HEIGHT, 0.04)) bot.position.x = nx;
    if (!world.overlaps(bot.position.x, 0, nz, BOT_RADIUS, BOT_HEIGHT, 0.04)) bot.position.z = nz;
    faceToward(bot, Math.atan2(-dx, -dz), dt);
    bot.walkPhase += dt * speed * 2.4;
    const swing = Math.sin(bot.walkPhase) * 0.45;
    bot.parts.legL.rotation.x = swing;
    bot.parts.legR.rotation.x = -swing;
    return Math.hypot(tx - bot.position.x, tz - bot.position.z) < 0.15;
  }

  function lookAtPlayer(bot, playerPos, dt) {
    faceToward(bot, Math.atan2(-(playerPos.x - bot.position.x), -(playerPos.z - bot.position.z)), dt);
  }

  function fireOnce(bot, playerPos, rng, combat) {
    if (!combat) return;
    const muzzle = new THREE.Vector3(
      bot.position.x - Math.sin(bot.yaw) * 0.55,
      bot.position.y + 1.32,
      bot.position.z - Math.cos(bot.yaw) * 0.55,
    );
    const chest = new THREE.Vector3(playerPos.x, playerPos.y + 1.15, playerPos.z);
    const dist = muzzle.distanceTo(chest);
    let chance = Math.max(0.08, Math.min(0.62, 0.62 - dist * 0.012));
    // A crouched target is harder to hit than a standing one, and a sprinting
    // target harder still; the caller passes the player's live speed along.
    if (playerPos.crouching) chance *= 0.75;
    if (playerPos.speed > 4) chance *= 0.7;
    else if (playerPos.speed > 2) chance *= 0.85;
    if (rng() < chance) {
      const damage = Math.round(12 + rng() * 8);
      fx.tracer(muzzle, chest, '#ffd27a');
      onEvent('bot-hit-player', { bot, damage });
    } else {
      const miss = chest.clone();
      miss.x += (rng() - 0.5) * 2.2;
      miss.y += (rng() - 0.5) * 1.4;
      miss.z += (rng() - 0.5) * 2.2;
      fx.tracer(muzzle, miss, '#ffd27a');
    }
  }

  function stepBot(bot, dt, now, playerPos, bomb, rng, combat) {
    if (!bot.alive) {
      if (bot.fall < 1) {
        bot.fall = Math.min(1, bot.fall + dt / FALL_TIME);
        bot.parts.group.rotation.x = -1.45 * bot.fall;
        bot.parts.group.position.y = -0.08 * bot.fall;
      }
      return;
    }

    // --- perception, refreshed a few times a second ---
    bot.losTimer -= dt;
    if (bot.losTimer <= 0) {
      bot.losTimer = 0.25 + rng() * 0.1;
      bot.hasLos = false;
      if (playerPos.alive) {
        const dx = playerPos.x - bot.position.x;
        const dz = playerPos.z - bot.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist <= SIGHT_RANGE && dist > 0.01) {
          const fxDir = -Math.sin(bot.yaw);
          const fzDir = -Math.cos(bot.yaw);
          const facing = (dx * fxDir + dz * fzDir) / dist;
          const chestY = playerPos.y + Math.min(1.2, (playerPos.eye || 1.6) * 0.75);
          const blocked = world.segmentBlocked(bot.position.x, EYE_HEIGHT, bot.position.z, playerPos.x, chestY, playerPos.z);
          if (facing > HALF_ANGLE_COS && !blocked) {
            bot.hasLos = true;
            bot.lastSeen = { x: playerPos.x, z: playerPos.z };
            bot.seenAt = now;
            if (combat) bot.state = 'engage';
          }
        }
      }
    }

    // --- a planted bomb outranks everything, even a firefight: defenders
    // converge on the site, and one that reaches it starts defusing. A bot
    // that was engaging the attacker breaks off instead of duelling while
    // the fuse runs down, which is what lost rounds before this change. ---
    if (bomb && bomb.planted && bomb.site && bot.state !== 'defuse') {
      const siteDist = Math.hypot(bomb.site.x - bot.position.x, bomb.site.z - bot.position.z);
      bot.investigateAt = { x: bomb.site.x, z: bomb.site.z };
      bot.state = siteDist < 2 ? 'defuse' : 'investigate';
      bot.burstLeft = 0;
    }

    if (bot.state === 'engage') {
      if (!bot.hasLos && now - bot.seenAt > 1.2) {
        bot.state = 'investigate';
        bot.investigateAt = bot.lastSeen ? { ...bot.lastSeen } : { x: 0, z: -2 };
        bot.burstLeft = 0;
      } else {
        lookAtPlayer(bot, playerPos, dt);
        // Strafe sideways while shooting, flipping direction regularly.
        if (now >= bot.strafeUntil) {
          bot.strafeDir = rng() < 0.5 ? -1 : 1;
          bot.strafeUntil = now + 0.7 + rng() * 0.9;
        }
        const px = -Math.sin(bot.yaw);
        const pz = -Math.cos(bot.yaw);
        const sideX = -pz * bot.strafeDir;
        const sideZ = px * bot.strafeDir;
        const nx = bot.position.x + sideX * STRAFE_SPEED * dt;
        const nz = bot.position.z + sideZ * STRAFE_SPEED * dt;
        if (!world.overlaps(nx, 0, bot.position.z, BOT_RADIUS, BOT_HEIGHT, 0.04)) bot.position.x = nx;
        if (!world.overlaps(bot.position.x, 0, nz, BOT_RADIUS, BOT_HEIGHT, 0.04)) bot.position.z = nz;
        bot.walkPhase += dt * STRAFE_SPEED * 2.4;
        const swing = Math.sin(bot.walkPhase) * 0.35;
        bot.parts.legL.rotation.x = swing;
        bot.parts.legR.rotation.x = -swing;
        // Burst fire: three shots, then a pause before the next burst.
        if (combat && bot.hasLos) {
          if (bot.burstLeft > 0) {
            if (now >= bot.nextShotAt) {
              fireOnce(bot, playerPos, rng, combat);
              bot.burstLeft -= 1;
              bot.nextShotAt = now + 0.12;
              if (bot.burstLeft === 0) bot.fireAt = now + 0.45 + rng() * 0.35;
            }
          } else if (now >= bot.fireAt) {
            bot.burstLeft = 3;
            bot.nextShotAt = now;
          }
        }
      }
      return;
    }

    if (bot.state === 'defuse') {
      if (!bomb || !bomb.planted || !bomb.site) {
        bot.state = 'route';
        bot.defuseProgress = 0;
        return;
      }
      const site = bomb.site;
      const dist = Math.hypot(site.x - bot.position.x, site.z - bot.position.z);
      if (dist >= 2) {
        bot.state = 'investigate';
        bot.investigateAt = { x: site.x, z: site.z };
        return;
      }
      faceToward(bot, Math.atan2(-(site.x - bot.position.x), -(site.z - bot.position.z)), dt);
      bot.defuseProgress += dt / DEFUSE_SECONDS;
      if (bot.defuseProgress >= 1) {
        bot.defuseProgress = 1;
        onEvent('defused', { bot });
      }
      return;
    }

    if (bot.state === 'investigate') {
      const target = bot.investigateAt || { x: 0, z: -2 };
      const arrived = walkTo(bot, target.x, target.z, dt, WALK_SPEED);
      if (arrived) {
        if (bomb && bomb.planted && bomb.site
          && Math.hypot(bomb.site.x - bot.position.x, bomb.site.z - bot.position.z) < 2) {
          bot.state = 'defuse';
          return;
        }
        if (bot.holdUntil === 0) bot.holdUntil = now + 1.2 + rng() * 1.6;
        if (now >= bot.holdUntil) {
          bot.holdUntil = 0;
          bot.investigateAt = null;
          bot.state = 'route';
        } else {
          // Scan the area while deciding where to go next.
          bot.yaw += dt * 1.4;
          bot.parts.group.rotation.y = bot.yaw;
        }
      }
      return;
    }

    // Route: walk the assigned waypoint loop, pausing briefly at each stop.
    if (now < bot.holdUntil) return;
    const wp = world.waypoints[bot.route[bot.routeIndex]];
    if (!wp) {
      bot.routeIndex = 0;
      return;
    }
    const arrived = walkTo(bot, wp.x, wp.z, dt, WALK_SPEED);
    if (arrived) {
      bot.routeIndex = (bot.routeIndex + 1) % bot.route.length;
      bot.holdUntil = now + 1 + rng() * 2;
    }
  }

  return {
    bots,
    step(dt, now, player, bomb, rng, combat) {
      const ps = player && player.state ? player.state : player;
      const playerPos = {
        x: ps.position.x,
        y: ps.position.y,
        z: ps.position.z,
        eye: ps.eye,
        alive: ps.alive,
        crouching: ps.crouching,
        speed: player && typeof player.groundSpeed === 'function' ? player.groundSpeed() : 0,
      };
      for (const bot of bots) stepBot(bot, dt, now, playerPos, bomb, rng, combat);
    },
    hear(x, z, radius) {
      for (const bot of bots) {
        if (!bot.alive || bot.state === 'defuse') continue;
        if (Math.hypot(x - bot.position.x, z - bot.position.z) <= radius) {
          bot.investigateAt = { x, z };
          bot.state = 'investigate';
          bot.holdUntil = 0;
          bot.burstLeft = 0;
        }
      }
    },
    damage(mesh, amount) {
      const info = mesh && mesh.userData ? mesh.userData : null;
      const bot = info ? info.bot : null;
      if (!bot || !bot.alive) return false;
      bot.health -= amount;
      if (bot.health > 0) return false;
      bot.health = 0;
      bot.alive = false;
      bot.fall = 0;
      bot.defuseProgress = 0;
      bot.burstLeft = 0;
      onEvent('bot-killed', { bot, by: 'player' });
      // Teammates nearby come to check on the fallen defender.
      for (const other of bots) {
        if (other === bot || !other.alive || other.state === 'defuse') continue;
        if (Math.hypot(bot.position.x - other.position.x, bot.position.z - other.position.z) <= 18) {
          other.investigateAt = { x: bot.position.x, z: bot.position.z };
          other.state = 'investigate';
          other.holdUntil = 0;
        }
      }
      return true;
    },
    reset() {
      for (let i = 0; i < bots.length; i += 1) {
        const bot = bots[i];
        const spawn = world.spawns.defenders[i];
        bot.position.set(spawn.x, 0, spawn.z);
        bot.yaw = spawn.yaw;
        bot.parts.group.rotation.set(0, spawn.yaw, 0);
        bot.health = 100;
        bot.alive = true;
        bot.state = 'route';
        bot.routeIndex = 0;
        bot.holdUntil = 0;
        bot.lastSeen = null;
        bot.seenAt = -100;
        bot.investigateAt = null;
        bot.fireAt = 0;
        bot.nextShotAt = 0;
        bot.burstLeft = 0;
        bot.hasLos = false;
        bot.strafeDir = 1;
        bot.strafeUntil = 0;
        bot.fall = 0;
        bot.walkPhase = 0;
        bot.defuseProgress = 0;
        bot.parts.legL.rotation.x = 0;
        bot.parts.legR.rotation.x = 0;
      }
    },
    aliveCount() {
      let n = 0;
      for (const bot of bots) if (bot.alive) n += 1;
      return n;
    },
    hitMeshes,
  };
}
