// Round flow for Yard 7: buy, live, round end, match end. One attacker
// against four defenders, first to 5 rounds (at most 9 played). Money pays
// for kills, plants and round results; the buy menu spends it on guns and a
// grenade. The bomb is planted by standing still inside a site, ticks down
// a 40 s fuse, and can be defused by a defender who reaches it in time.
// Grenades thrown in a round keep flying until their fuse runs out, even
// across the round boundary.
import * as THREE from 'three';

const PRICES = { hornet: 1500, vk47: 2700, grenade: 300 };
const WIN_SCORE = 5;
const MAX_ROUNDS = 9;
const BUY_SECONDS = 12;
const LIVE_SECONDS = 100;
const END_SECONDS = 4;
const PLANT_SECONDS = 3.5;
const FUSE_SECONDS = 40;
const SHELL_FUSE = 1.2;
const SHELL_SPEED = 16;
const SHELL_LIFT = 3.5;
const GRAVITY = 20;
const KILL_REWARD = 300;
const PLANT_REWARD = 300;
const WIN_REWARD = 2200;
const LOSS_REWARD = 1400;
const START_MONEY = 800;

const ROUND_END_COPY = {
  eliminated: ['The yard is clear.', 'Every defender is down.'],
  bomb: ['The bomb did the work.', 'Site destroyed — the yard is yours.'],
  time: ['Out of time.', 'The clock ran out with no plant.'],
  defused: ['The bomb was defused.', 'A defender cut the wires in time.'],
  killed: ['You went down.', 'The defence held the yard.'],
};

function freshBomb() {
  return { planted: false, site: null, fuse: FUSE_SECONDS, exploded: false, defuseProgress: 0, lastBeep: FUSE_SECONDS };
}

function positionOf(player) {
  if (!player) return null;
  if (player.state && player.state.position) return player.state.position;
  return player.position || null;
}

export function createRounds(world, onEvent) {
  const state = {
    phase: 'buy',
    round: 1,
    scoreYou: 0,
    scoreThem: 0,
    money: START_MONEY,
    timer: BUY_SECONDS,
    owned: new Set(['p9']),
    grenades: 0,
    plantProgress: 0,
    bomb: freshBomb(),
    banner: null,
  };
  const shells = [];
  let lastBots = null;

  function openBuyPhase() {
    state.phase = 'buy';
    state.timer = BUY_SECONDS;
    state.plantProgress = 0;
    state.bomb = freshBomb();
    state.banner = null;
    onEvent('buy-phase', { round: state.round });
  }

  function startRound() {
    if (state.phase !== 'buy') return false;
    state.phase = 'live';
    state.timer = LIVE_SECONDS;
    state.plantProgress = 0;
    state.bomb = freshBomb();
    state.banner = null;
    onEvent('round-start', { round: state.round });
    return true;
  }

  function nextRound() {
    state.round += 1;
    openBuyPhase();
  }

  function resetMatch() {
    state.round = 1;
    state.scoreYou = 0;
    state.scoreThem = 0;
    state.money = START_MONEY;
    state.owned = new Set(['p9']);
    state.grenades = 0;
    shells.length = 0;
    openBuyPhase();
  }

  function matchOver() {
    return state.scoreYou >= WIN_SCORE || state.scoreThem >= WIN_SCORE || state.round >= MAX_ROUNDS;
  }

  function endMatch() {
    state.phase = 'matchEnd';
    state.timer = 0;
    state.banner = null;
    if (state.scoreYou > state.scoreThem) onEvent('match-win', { you: state.scoreYou, them: state.scoreThem });
    else onEvent('match-lose', { you: state.scoreYou, them: state.scoreThem });
  }

  function endRound(win, reason) {
    if (state.phase !== 'live') return;
    state.phase = 'roundEnd';
    state.timer = END_SECONDS;
    state.plantProgress = 0;
    const copy = ROUND_END_COPY[reason] || ROUND_END_COPY.eliminated;
    if (win) {
      state.scoreYou += 1;
      state.money += WIN_REWARD;
      state.banner = { text: 'ROUND WON', sub: copy[1] };
      onEvent('round-win', { reason });
    } else {
      state.scoreThem += 1;
      state.money += LOSS_REWARD;
      state.banner = { text: 'ROUND LOST', sub: copy[1] };
      onEvent('round-lose', { reason });
    }
  }

  function buy(id) {
    if (state.phase !== 'buy') return false;
    const price = PRICES[id];
    if (price === undefined) return false;
    if (id === 'grenade') {
      if (state.grenades >= 1 || state.money < price) return false;
      state.money -= price;
      state.grenades = 1;
    } else {
      if (state.owned.has(id) || state.money < price) return false;
      state.money -= price;
      state.owned.add(id);
    }
    onEvent('bought', { id });
    return true;
  }

  function throwGrenade(origin, direction) {
    if (state.phase !== 'live' || state.grenades <= 0) return false;
    state.grenades -= 1;
    const velocity = direction.clone().multiplyScalar(SHELL_SPEED);
    velocity.y += SHELL_LIFT;
    shells.push({ position: origin.clone(), velocity, fuse: SHELL_FUSE });
    onEvent('thrown', {});
    return true;
  }

  function siteAt(pos) {
    if (!pos) return null;
    for (const site of world.sites) {
      if (Math.hypot(site.x - pos.x, site.z - pos.z) <= site.radius) return site;
    }
    return null;
  }

  function explodeShell(shell, player, bots, fx, audio) {
    const at = shell.position.clone();
    fx.explosion(at);
    audio.play('explosion');
    if (bots) {
      for (const bot of bots.bots) {
        if (!bot.alive) continue;
        const d = Math.hypot(bot.position.x - at.x, bot.position.z - at.z);
        if (d >= 6) continue;
        const damage = Math.round(20 + 90 * (1 - d / 6));
        bots.damage(bot.parts.torso, damage);
      }
    }
    const pos = positionOf(player);
    if (pos) {
      const d = Math.hypot(pos.x - at.x, pos.z - at.z);
      if (d < 4) {
        const damage = Math.round(40 * (1 - d / 4));
        if (damage > 0) onEvent('player-damaged', { damage, source: 'grenade' });
      }
    }
  }

  function stepShells(dt, player, bots, fx, audio) {
    for (let i = shells.length - 1; i >= 0; i -= 1) {
      const shell = shells[i];
      shell.fuse -= dt;
      shell.velocity.y -= GRAVITY * dt;
      // Move one axis at a time so a wall bounce only kills that component.
      const nx = shell.position.x + shell.velocity.x * dt;
      if (!world.overlaps(nx, shell.position.y, shell.position.z, 0.1, 0.2, 0)) shell.position.x = nx;
      else shell.velocity.x = -shell.velocity.x * 0.45;
      const nz = shell.position.z + shell.velocity.z * dt;
      if (!world.overlaps(shell.position.x, shell.position.y, nz, 0.1, 0.2, 0)) shell.position.z = nz;
      else shell.velocity.z = -shell.velocity.z * 0.45;
      const ny = shell.position.y + shell.velocity.y * dt;
      if (ny < 0.12) {
        shell.position.y = 0.12;
        shell.velocity.y = -shell.velocity.y * 0.45;
        shell.velocity.x *= 0.8;
        shell.velocity.z *= 0.8;
        if (Math.abs(shell.velocity.y) < 0.6) shell.velocity.y = 0;
      } else if (!world.overlaps(shell.position.x, ny, shell.position.z, 0.1, 0.2, 0)) {
        shell.position.y = ny;
      } else {
        shell.velocity.y = -shell.velocity.y * 0.45;
      }
      if (shell.fuse <= 0) {
        shells.splice(i, 1);
        explodeShell(shell, player, bots, fx, audio);
      }
    }
  }

  function step(dt, player, keys, bots, fx, audio, rng) {
    lastBots = bots;
    stepShells(dt, player, bots, fx, audio);

    // Mirror the closest defender's defuse effort for the HUD bar.
    if (state.bomb.planted && bots) {
      let best = 0;
      for (const bot of bots.bots) if (bot.alive) best = Math.max(best, bot.defuseProgress || 0);
      state.bomb.defuseProgress = best;
    }

    if (state.phase === 'buy') {
      state.timer -= dt;
      if (state.timer <= 0) startRound();
      return;
    }

    if (state.phase === 'roundEnd') {
      state.timer -= dt;
      if (state.timer <= 0) {
        if (matchOver()) endMatch();
        else nextRound();
      }
      return;
    }

    if (state.phase !== 'live') return;

    state.timer -= dt;
    const pos = positionOf(player);
    const speed = player && typeof player.groundSpeed === 'function' ? player.groundSpeed() : 0;

    // Planting: hold E, standing nearly still, inside a site.
    if (!state.bomb.planted && pos && keys && keys.has('KeyE') && speed < 1.5) {
      const site = siteAt(pos);
      if (site) {
        state.plantProgress += dt / PLANT_SECONDS;
        if (state.plantProgress >= 1) {
          state.plantProgress = 1;
          state.bomb.planted = true;
          state.bomb.site = site;
          state.bomb.fuse = FUSE_SECONDS;
          state.bomb.lastBeep = FUSE_SECONDS;
          state.money += PLANT_REWARD;
          audio.play('plant');
          onEvent('planted', { site });
        }
      }
    }

    // The planted bomb ticks down, beeping each second until it blows.
    if (state.bomb.planted && !state.bomb.exploded) {
      state.bomb.fuse -= dt;
      const whole = Math.ceil(state.bomb.fuse);
      if (whole < state.bomb.lastBeep) {
        state.bomb.lastBeep = whole;
        audio.play('beep');
      }
      if (state.bomb.fuse <= 0) {
        state.bomb.exploded = true;
        const site = state.bomb.site;
        fx.explosion(new THREE.Vector3(site.x, 0.5, site.z));
        audio.play('explosion');
        endRound(true, 'bomb');
        return;
      }
    }

    if (bots && bots.aliveCount() === 0) {
      endRound(true, 'eliminated');
      return;
    }
    if (state.timer <= 0 && !state.bomb.planted) {
      endRound(false, 'time');
    }
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
    onBotKilled(bot, by) {
      if (state.phase !== 'live') return;
      state.money += KILL_REWARD;
      onEvent('kill-reward', { bot, by });
    },
    onPlayerKilled() {
      if (state.phase === 'live') endRound(false, 'killed');
    },
    siteAt,
    aliveBots() {
      return lastBots ? lastBots.aliveCount() : 0;
    },
  };
}
