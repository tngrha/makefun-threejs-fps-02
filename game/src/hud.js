// The DOM HUD: crosshair, hit marker, health, ammo, money, timer, score,
// kill feed, buy menu, plant progress and the overlays. It never touches the
// simulation; main.js pushes numbers in and reads the play and buy callbacks.
import { WEAPONS } from './weapon.js';

const COPY = {
  start: {
    title: 'DUSTLINE',
    copy: 'Yard 7, high noon. You attack alone against four defenders. Plant the bomb at A or B, or clear the yard. Click to play.',
    action: 'Click to play',
  },
  paused: {
    title: 'DUSTLINE',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  matchWin: {
    title: 'Yard 7 is yours',
    copy: 'The defence could not hold. Match won.',
    action: 'Play again',
  },
  matchLose: {
    title: 'The defence held',
    copy: 'Yard 7 stays theirs this time. Match lost.',
    action: 'Try again',
  },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const crosshair = $('crosshair');
  const hitmarker = $('hitmarker');
  const healthFill = $('health-fill');
  const healthNum = $('health-num');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const ammo = $('ammo');
  const money = $('money');
  const timer = $('timer');
  const scoreYou = $('score-you');
  const scoreThem = $('score-them');
  const roundNum = $('round-num');
  const weaponName = $('weapon-name');
  const grenades = $('grenades');
  const feed = $('feed');
  const banner = $('banner');
  const bannerText = $('banner-text');
  const bannerSub = $('banner-sub');
  const buy = $('buy');
  const buyList = $('buy-list');
  const plant = $('plant');
  const plantBar = $('plant-fill');
  const plantLabel = $('plant-label');
  const damage = $('damage');
  let hitTimer = 0;
  let lastMag = -1;
  let lastReserve = -1;
  let damageTimer = 0;

  return {
    setHealth(value) {
      const v = Math.max(0, Math.round(value));
      healthFill.style.width = `${v}%`;
      healthNum.textContent = String(v);
      healthFill.classList.toggle('low', v <= 30);
    },
    setAmmo(mag, reserve) {
      if (mag === lastMag && reserve === lastReserve) return;
      lastMag = mag;
      lastReserve = reserve;
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = `/ ${reserve}`;
      ammo.classList.toggle('empty', mag === 0);
    },
    setMoney(value) {
      money.textContent = `$${value}`;
    },
    setTimer(seconds, phase) {
      const s = Math.max(0, Math.ceil(seconds));
      timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      timer.classList.toggle('live', phase === 'live');
    },
    setScore(you, them) {
      scoreYou.textContent = String(you);
      scoreThem.textContent = String(them);
    },
    setRound(n) {
      roundNum.textContent = `ROUND ${n} / 9`;
    },
    setWeapon(name, grenadeCount) {
      weaponName.textContent = name;
      grenades.textContent = grenadeCount > 0 ? `◉ ${grenadeCount} SPARK` : '';
    },
    setCrosshairGap(px) {
      crosshair.style.setProperty('--gap', `${px.toFixed(1)}px`);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    feedLine(text) {
      const line = document.createElement('div');
      line.className = 'feed-line';
      line.textContent = text;
      feed.prepend(line);
      while (feed.children.length > 4) feed.removeChild(feed.lastChild);
      setTimeout(() => line.classList.add('fade'), 3500);
    },
    showBanner(text, sub) {
      bannerText.textContent = text;
      bannerSub.textContent = sub || '';
      banner.hidden = false;
    },
    hideBanner() {
      banner.hidden = true;
    },
    showBuy(moneyValue, owned, grenadeCount) {
      buyList.innerHTML = '';
      const items = [
        { key: '1', id: 'hornet', name: 'Hornet-9 SMG', price: WEAPONS.hornet.price, desc: 'Fast, close. 30 rounds, 900 rpm.' },
        { key: '2', id: 'vk47', name: 'VK-47 Rifle', price: WEAPONS.vk47.price, desc: 'The yard standard. 25 rounds, hits hard.' },
        { key: '3', id: 'grenade', name: 'Spark Grenade', price: 300, desc: 'Throw with G. Clears a corner.' },
      ];
      for (const item of items) {
        const row = document.createElement('div');
        row.className = 'buy-row';
        const have = item.id === 'grenade' ? grenadeCount > 0 : owned.has(item.id);
        row.innerHTML = `<span class="buy-key">${item.key}</span><span class="buy-name">${item.name}</span><span class="buy-desc">${item.desc}</span><span class="buy-price">${have ? 'OWNED' : '$' + item.price}</span>`;
        if (!have && moneyValue < item.price) row.classList.add('poor');
        buyList.appendChild(row);
      }
      buy.hidden = false;
    },
    hideBuy() {
      buy.hidden = true;
    },
    setPlant(progress, label) {
      if (progress <= 0 && !label) {
        plant.hidden = true;
        return;
      }
      plant.hidden = false;
      plantBar.style.width = `${Math.round(progress * 100)}%`;
      plantLabel.textContent = label;
    },
    damageFlash() {
      damage.classList.add('on');
      clearTimeout(damageTimer);
      damageTimer = setTimeout(() => damage.classList.remove('on'), 180);
    },
    showOverlay(mode, data) {
      const text = COPY[mode];
      title.textContent = text.title;
      copy.textContent = mode === 'matchWin' || mode === 'matchLose'
        ? `${text.copy} Final score ${data.you} — ${data.them}.`
        : text.copy;
      play.textContent = text.action;
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
    onBuy(handler) {
      buy.addEventListener('click', handler);
    },
  };
}
