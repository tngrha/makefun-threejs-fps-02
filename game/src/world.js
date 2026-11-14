// Yard 7: a desert freight yard, 40 x 28 m, built from boxes. Every box is a
// collider for the player and the bots, and a surface a bullet stops on. Two
// lanes (A-long west, B-long east), a mid connector, and two bomb sites: A, the
// crate yard, and B, the warehouse containers. All geometry is plain boxes.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'rust' || name === 'teal' ? 0.6 : 0.92,
      metalness: 0.03,
    });
  }

  const colliders = [];
  const shootables = [];

  function box(width, height, depth, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    const bounds = new THREE.Box3().setFromObject(mesh);
    if (collide) colliders.push(bounds);
    shootables.push(mesh);
    return { mesh, bounds };
  }

  function flat(width, depth, x, z, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, 0.06, depth), materials[material]);
    mesh.position.set(x, 0.03, z);
    mesh.receiveShadow = true;
    group.add(mesh);
    shootables.push(mesh);
    return mesh;
  }

  // Floor and perimeter walls, 5 m high, open to the sky.
  box(40.4, 0.4, 28.4, 0, -0.2, 0, 'dirt');
  box(0.4, 5, 28.4, -20.2, 2.5, 0, 'shadow');
  box(0.4, 5, 28.4, 20.2, 2.5, 0, 'shadow');
  box(40.4, 5, 0.4, 0, 2.5, -14.2, 'shadow');
  box(40.4, 5, 0.4, 0, 2.5, 14.2, 'shadow');

  // Site A, the crate yard (west-north). A rust container backs the site.
  box(6.2, 2.6, 2.6, -17.5, 1.3, -11.5, 'rust');
  box(1.2, 1.1, 1.2, -13.2, 0.55, -7.4, 'sand');
  box(1.2, 1.1, 1.2, -12.0, 0.55, -8.6, 'sand');
  box(1.2, 1.1, 1.2, -12.0, 1.65, -8.6, 'sand');
  box(2.2, 1.1, 1.2, -16.8, 0.55, -6.4, 'dirt');
  flat(7, 7, -15, -9, 'rust');

  // Site B, the warehouse containers (east-north). A teal container backs the site.
  box(6.2, 2.6, 2.6, 17.5, 1.3, -11.5, 'teal');
  box(1.2, 1.1, 1.2, 13.2, 0.55, -7.4, 'sand');
  box(1.2, 1.1, 1.2, 12.0, 0.55, -8.6, 'sand');
  box(1.2, 1.1, 1.2, 12.0, 1.65, -8.6, 'sand');
  box(2.2, 1.1, 1.2, 16.8, 0.55, -6.4, 'dirt');
  flat(7, 7, 15, -9, 'teal');

  // Mid connector: two pillars and a low platform you can jump onto.
  box(1.2, 3.4, 1.2, -3, 1.7, -2, 'shadow');
  box(1.2, 3.4, 1.2, 3, 1.7, -2, 'shadow');
  box(6, 0.5, 3, 0, 0.25, 1.5, 'dirt');
  box(1.2, 1.1, 1.2, -6.5, 0.55, 3.5, 'sand');
  box(1.2, 1.1, 1.2, 6.5, 0.55, 3.5, 'sand');

  // A-long cover (west lane) and B-long cover (east lane).
  box(1.2, 1.1, 1.2, -17, 0.55, 4, 'sand');
  box(2.4, 1.1, 1.2, -17, 0.55, -4, 'dirt');
  box(1.2, 1.1, 1.2, 17, 0.55, 4, 'sand');
  box(2.4, 1.1, 1.2, 17, 0.55, -4, 'dirt');

  // South cover near the attacker spawn: two crates to crouch behind.
  box(2.4, 1.1, 1.2, -4, 0.55, 8, 'dirt');
  box(2.4, 1.1, 1.2, 4, 0.55, 8, 'dirt');

  // Lamp poles, visual only except for their posts.
  box(0.18, 6, 0.18, -10, 3, -6, 'ink');
  box(0.18, 6, 0.18, 10, 3, -6, 'ink');
  const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffe9b0') });
  for (const x of [-10, 10]) {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), lampMat);
    lamp.position.set(x, 6.1, -6);
    group.add(lamp);
  }

  // Light: a hot sun from the south-east, a cool sky fill, and a sand haze.
  const sky = new THREE.HemisphereLight(new THREE.Color(PALETTE.sky), new THREE.Color(PALETTE.dirt), 1.2);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffe2b0'), 3.2);
  sun.position.set(14, 20, 12);
  sun.target.position.set(0, 0, -3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -26;
  sun.shadow.camera.right = 26;
  sun.shadow.camera.top = 26;
  sun.shadow.camera.bottom = -26;
  sun.shadow.camera.far = 60;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color(PALETTE.sky), 0.5);
  fill.position.set(-10, 12, -12);
  scene.add(fill);

  // Waypoints the bots walk: a small graph over the yard.
  const waypoints = [
    { x: 0, z: -11 }, // 0 defender spawn
    { x: -17, z: -8 }, // 1 A-long top
    { x: -17, z: 2 }, // 2 A-long mid
    { x: -15, z: -4 }, // 3 A entry
    { x: -15, z: -9 }, // 4 site A
    { x: 17, z: -8 }, // 5 B-long top
    { x: 17, z: 2 }, // 6 B-long mid
    { x: 15, z: -4 }, // 7 B entry
    { x: 15, z: -9 }, // 8 site B
    { x: 0, z: -2 }, // 9 mid
    { x: 0, z: 4 }, // 10 mid hold
    { x: 0, z: 11 }, // 11 attacker spawn
    { x: -12, z: -6 }, // 12 A hold
    { x: 12, z: -6 }, // 13 B hold
    { x: -8, z: -2 }, // 14 A mid
    { x: 8, z: -2 }, // 15 B mid
  ];
  const routes = [
    [0, 1, 3, 12], // A anchor: holds the A overwatch
    [0, 5, 7, 13], // B anchor: holds the B overwatch
    [0, 9, 10, 9, 14, 9, 15, 9], // mid rover: loops the connector
    [0, 2, 1, 3, 12, 3, 9, 15, 6, 7, 13], // flex: roams both lanes
  ];

  const sites = [
    { name: 'A', x: -15, z: -9, radius: 3.5, colour: 'rust' },
    { name: 'B', x: 15, z: -9, radius: 3.5, colour: 'teal' },
  ];
  const spawns = {
    attacker: { x: 0, z: 11, yaw: 0 },
    defenders: [
      { x: -3, z: -11, yaw: 0 },
      { x: 3, z: -11, yaw: 0 },
      { x: -8, z: -11, yaw: 0 },
      { x: 8, z: -11, yaw: 0 },
    ],
  };

  // AABB probe shared by the player and the bots: does a standing box at
  // (x, y, z) with the given radius and height overlap any collider?
  const probe = new THREE.Box3();
  function overlaps(x, y, z, radius, height, lift) {
    probe.min.set(x - radius, y + lift, z - radius);
    probe.max.set(x + radius, y + height - lift, z + radius);
    for (const collider of colliders) if (probe.intersectsBox(collider)) return collider;
    return null;
  }

  // Segment vs every collider, slab test: true when the line between two
  // points is blocked. Used for bot line-of-sight, a few times a second.
  function segmentBlocked(ax, ay, az, bx, by, bz) {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    for (const c of colliders) {
      let tmin = 0;
      let tmax = 1;
      let blocked = true;
      const mins = [c.min.x - ax, c.min.y - ay, c.min.z - az];
      const maxs = [c.max.x - ax, c.max.y - ay, c.max.z - az];
      const ds = [dx, dy, dz];
      for (let i = 0; i < 3; i += 1) {
        if (Math.abs(ds[i]) < 1e-9) {
          if (mins[i] > 0 || maxs[i] < 0) { blocked = false; break; }
        } else {
          let t1 = mins[i] / ds[i];
          let t2 = maxs[i] / ds[i];
          if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
          if (t1 > tmin) tmin = t1;
          if (t2 < tmax) tmax = t2;
          if (tmin > tmax) { blocked = false; break; }
        }
      }
      if (blocked) return true;
    }
    return false;
  }

  return { colliders, shootables, group, waypoints, routes, sites, spawns, overlaps, segmentBlocked };
}
