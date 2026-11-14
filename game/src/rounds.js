// The match: rounds, money, the buy menu, the bomb, and the grenade. The
// player attacks alone against four defenders. A round is won by eliminating
// the defence, or by planting the bomb and letting it go off; it is lost when
// the player dies, the clock runs out with no plant, or the defence defuses.
// First to 5 rounds takes the match (at most 9 rounds).
import * as THREE from 'three';
import { WEAPONS } from './weapon.js';

const ROUND_TIME = 100;
const BUY_TIME = 12;
const ROUND_END_TIME = 4;
const PLANT_TIME = 3.5;
const FUSE_TIME = 40;
const DEFUSE_TIME = 5;
const WIN_ROUNDS = 5;
const MAX_ROUNDS = 9;
const GRENADE_PRICE = 300;
const GRENADE_MAX_DAMAGE = 90;
const GRENADE_RADIUS = 6;

export function createRounds(world, onEvent) {
  const state = {
    phase: 'buy', // buy | live | roundEnd | matchEnd
    round: 1,
    scoreYou: 0,
    scoreThem: 0,
    money: 800,
    timer: BUY_TIME,
    owned: new Set(['p9']),
    grenades: 0,
    plantProgress: 0,
    bomb: { planted: false, site: null, fuse: 0, exploded: false, defuseProgress: 0 },
    banner: null,
  };
  const grenades = [];
  const tmp = new THREE.Vector3();

  function siteAt(x, z) {
    for (const site of world.sites) {
      if (Math.hypot(x - site.x, z - site.z) <= site.radius) return site;
    }
    return null;
  }

  function endRound(youWon, reason) {
    if (state.phase !== 'live') return;
    state.phase = 'roundEnd';
    state.timer = ROUND_END_TIME;
    if (youWon) {
      state.scoreYou += 1;
      state.money += 2200;
    } else {
      state.scoreThem += 1;
      state.money += 1400;
    }
    state.banner = { text: youWon ? 'ROUND WON' : 'ROUND LOST', sub: reason };
    if (onEvent) onEvent(youWon ? 'round-win' : 'round-lose', { reason });
  }

  function endMatch() {
    state.phase = 'matchEnd';
    if (onEvent) onEvent(state.scoreYou > state.scoreThem ? 'match-win' : 'match-lose', {});
  }

  function startRound() {
    state.phase = 'live';
    state.timer = ROUND_TIME;
    state.plantProgress = 0;
    state.bomb = { planted: false, site: null, fuse: 0, exploded: false, defuseProgress: 0 };
    if (onEvent) onEvent('round-start', { round: state.round });
  }

  function nextRound() {
    if (state.scoreYou >= WIN_ROUNDS || state.scoreThem >= WIN_ROUNDS || state.round >= MAX_ROUNDS) {
      endMatch();
      return;
    }
    state.round += 1;
    state.phase = 'buy';
    state.timer = BUY_TIME;
    state.banner = null;
    if (onEvent) onEvent('buy-phase', { round: state.round });
  }

  function buy(id) {
    if (state.phase !== 'buy') return false;
    if (id === 'grenade') {
      if (state.grenades >= 1 || state.money < GRENADE_PRICE) return false;
      state.money -= GRENADE_PRICE;
      state.grenades = 1;
      if (onEvent) onEvent('bought', { id });
      return true;
    }
    const def = WEAPONS[id];
    if (!def || state.owned.has(id) || state.money < def.price) return false;
    state.money -= def.price;
    state.owned.add(id);
    if (onEvent) onEvent('bought', { id });
    return true;
  }

  function throwGrenade(origin, direction, rng) {
    if (state.grenades <= 0) return false;
    state.grenades -= 1;
    const vel = direction.clone().multiplyScalar(16);
    vel.y += 3.5;
    grenades.push({ pos: origin.clone(), vel, fuse: 1.2 });
    if (onEvent) onEvent('thrown', {});
    return true;
  }

  function explodeGrenade(g, bots, player, fx, audio) {
    if (fx) fx.explosion(g.pos);
    if (audio) audio.play('explosion');
    for (const bot of bots.bots) {
      if (!bot.alive) continue;
      const dist = Math.hypot(bot.position.x - g.pos.x, bot.position.z - g.pos.z);
      if (dist > GRENADE_RADIUS) continue;
      const damage = Math.round(GRENADE_MAX_DAMAGE * (1 - dist / GRENADE_RADIUS) + 20);
      if (bots.damage(bot.parts.torso, damage) && onEvent) onEvent('bot-killed', { bot, by: 'grenade' });
    }
    if (player.alive) {
      const dist = Math.hypot(player.position.x - g.pos.x, player.position.z - g.pos.z);
      if (dist < 4) {
        const damage = Math.round(40 * (1 - dist / 4));
        if (onEvent) onEvent('player-damaged', { damage, source: 'grenade' });
      }
    }
  }

  function step(dt, player, keys, bots, fx, audio, rng) {
    // Grenades fly even between rounds, so they resolve before the phase.
    for (let i = grenades.length - 1; i >= 0; i -= 1) {
      const g = grenades[i];
      g.fuse -= dt;
      g.vel.y -= 20 * dt;
      const next = tmp.copy(g.pos).addScaledVector(g.vel, dt);
      let bounced = false;
      if (world.overlaps(next.x, g.pos.y, g.pos.z, 0.12, 0.24, 0)) { g.vel.x *= -0.45; bounced = true; }
      else g.pos.x = next.x;
      if (world.overlaps(g.pos.x, g.pos.y, next.z, 0.12, 0.24, 0)) { g.vel.z *= -0.45; bounced = true; }
      else g.pos.z = next.z;
      if (next.y < 0.12) {
        g.pos.y = 0.12;
        g.vel.y = Math.abs(g.vel.y) * 0.45;
        bounced = true;
      } else {
        g.pos.y = next.y;
      }
      if (bounced) { g.vel.x *= 0.8; g.vel.z *= 0.8; }
      if (g.fuse <= 0) {
        grenades.splice(i, 1);
        explodeGrenade(g, bots, player, fx, audio);
      }
    }

    if (state.phase === 'buy') {
      state.timer -= dt;
      if (state.timer <= 0) startRound();
      return;
    }
    if (state.phase === 'roundEnd') {
      state.timer -= dt;
      if (state.timer <= 0) nextRound();
      return;
    }
    if (state.phase !== 'live') return;

    state.timer -= dt;
    if (state.timer <= 0 && !state.bomb.planted) {
      endRound(false, 'Time expired — the bomb never went down.');
      return;
    }

    // Planting: hold E inside a site, standing mostly still.
    if (!state.bomb.planted && player.alive && keys.has('KeyE')) {
      const site = siteAt(player.position.x, player.position.z);
      const speed = Math.hypot(player.velocity.x, player.velocity.z);
      if (site && speed < 1.5) {
        state.plantProgress += dt;
        if (state.plantProgress >= PLANT_TIME) {
          state.bomb = { planted: true, site, fuse: FUSE_TIME, exploded: false, defuseProgress: 0 };
          state.plantProgress = 0;
          state.money += 300;
          if (onEvent) onEvent('planted', { site: site.name });
        }
      } else {
        state.plantProgress = Math.max(0, state.plantProgress - dt * 2);
      }
    } else {
      state.plantProgress = Math.max(0, state.plantProgress - dt * 2);
    }

    if (state.bomb.planted && !state.bomb.exploded) {
      state.bomb.fuse -= dt;
      const secondsLeft = Math.ceil(state.bomb.fuse);
      if (secondsLeft !== state.bomb.lastBeep) {
        state.bomb.lastBeep = secondsLeft;
        if (audio) audio.play('beep');
      }
      if (state.bomb.fuse <= 0) {
        state.bomb.exploded = true;
        if (fx) fx.explosion(new THREE.Vector3(state.bomb.site.x, 0.6, state.bomb.site.z));
        if (audio) audio.play('explosion');
        endRound(true, 'The bomb went off at site ' + state.bomb.site.name + '.');
      }
    }
  }

  function resetMatch() {
    state.phase = 'buy';
    state.round = 1;
    state.scoreYou = 0;
    state.scoreThem = 0;
    state.money = 800;
    state.timer = BUY_TIME;
    state.owned = new Set(['p9']);
    state.grenades = 0;
    state.plantProgress = 0;
    state.bomb = { planted: false, site: null, fuse: 0, exploded: false, defuseProgress: 0 };
    state.banner = null;
    grenades.length = 0;
    if (onEvent) onEvent('buy-phase', { round: 1 });
  }

  function onBotKilled(bot) {
    state.money += 300;
    if (onEvent) onEvent('kill-reward', { bot });
  }

  function onPlayerKilled() {
    endRound(false, 'You were eliminated.');
  }

  return {
    state,
    step,
    buy,
    throwGrenade,
    endRound,
    endMatch,
    startRound,
    nextRound,
    resetMatch,
    onBotKilled,
    onPlayerKilled,
    siteAt,
    aliveBots(bots) {
      return bots.aliveCount();
    },
  };
}
