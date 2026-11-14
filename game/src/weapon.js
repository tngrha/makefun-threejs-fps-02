// The arsenal: four weapons, each with its own numbers, view model and sound.
// The weapon owns its magazine, cooldown, reload and spread; main.js owns the
// ray and the damage. Spread punishes firing on the move and rewards crouching
// and short bursts: a still, crouched shot is a laser, a sprinting spray is not.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  p9: {
    id: 'p9', name: 'P9', kind: 'pistol', price: 0, damage: 22, headMult: 2,
    mag: 12, reserve: 48, auto: false, gap: 0.16, reload: 1.4,
    spreadStill: 0.002, spreadMove: 0.02, kick: 0.008, sound: 'pistol',
  },
  hornet: {
    id: 'hornet', name: 'Hornet-9', kind: 'smg', price: 1500, damage: 18, headMult: 2,
    mag: 30, reserve: 120, auto: true, gap: 0.07, reload: 1.9,
    spreadStill: 0.004, spreadMove: 0.032, kick: 0.006, sound: 'smg',
  },
  vk47: {
    id: 'vk47', name: 'VK-47', kind: 'rifle', price: 2700, damage: 25, headMult: 2,
    mag: 25, reserve: 75, auto: true, gap: 0.098, reload: 2.2,
    spreadStill: 0.0022, spreadMove: 0.028, kick: 0.011, sound: 'rifle',
  },
};

const MOVE_REFERENCE = 5.2;

function buildModel(def) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.shadow), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.rust), roughness: 0.5, metalness: 0.3 });
  const model = new THREE.Group();
  if (def.kind === 'pistol') {
    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.24), body);
    const gripMesh = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.14, 0.08), grip);
    gripMesh.position.set(0, -0.09, 0.07);
    gripMesh.rotation.x = 0.2;
    model.add(slide, gripMesh);
  } else if (def.kind === 'smg') {
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, 0.34), body);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.3), grip);
    barrel.position.set(0, 0.02, -0.3);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.07), accent);
    mag.position.set(0, -0.11, -0.02);
    model.add(receiver, barrel, mag);
  } else {
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.42), body);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.4), grip);
    barrel.position.set(0, 0.025, -0.38);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.22), grip);
    stock.position.set(0, -0.02, 0.3);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.06), accent);
    sight.position.set(0, 0.07, -0.05);
    model.add(receiver, barrel, stock, sight);
  }
  model.scale.setScalar(0.78);
  model.position.set(0.26, -0.24, -0.5);
  return model;
}

export function createWeapon(camera, onSound) {
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.1, 0.1),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.rust), transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.26, -0.22, -1.0);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.rust), 0, 5);
  flashLight.position.set(0.26, -0.2, -0.7);
  camera.add(flashLight);

  let def = WEAPONS.p9;
  let model = buildModel(def);
  camera.add(model);
  const state = {
    weapon: 'p9', mag: def.mag, reserve: def.reserve, cooldown: 0,
    reloadLeft: 0, flash: 0, kick: 0, bloom: 0, grenades: 0,
  };

  function equip(id) {
    if (!WEAPONS[id] || id === state.weapon) return false;
    camera.remove(model);
    def = WEAPONS[id];
    model = buildModel(def);
    camera.add(model);
    state.weapon = id;
    state.mag = def.mag;
    state.reserve = def.reserve;
    state.cooldown = 0;
    state.reloadLeft = 0;
    state.bloom = 0;
    return true;
  }

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    state.bloom = Math.max(0, state.bloom - dt * 0.06);
    model.position.z = -0.5 + state.kick;
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 8;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      model.rotation.x = -0.55 * Math.min(1, (def.reload - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const need = def.mag - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
  }

  return {
    state,
    def() { return def; },
    step,
    equip,
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = def.gap;
      state.flash = 0.06;
      state.kick = 0.055;
      state.bloom = Math.min(0.05, state.bloom + (def.kind === 'rifle' ? 0.006 : 0.004));
      if (onSound) onSound(def.sound);
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    reload() {
      if (state.reloadLeft > 0 || state.mag === def.mag || state.reserve === 0) return;
      state.reloadLeft = def.reload;
      if (onSound) onSound('reload');
    },
    spread(speed, crouching) {
      const move = Math.min(1, speed / MOVE_REFERENCE);
      let spread = def.spreadStill + move * def.spreadMove + state.bloom;
      if (crouching) spread *= 0.65;
      return spread;
    },
    refill() {
      state.mag = def.mag;
      state.reserve = def.reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      state.bloom = 0;
    },
  };
}
