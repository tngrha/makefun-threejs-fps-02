// Short-lived effects: tracers, impact sparks and the bomb's explosion. All
// pools are fixed size and reused, so the hot loop never allocates.
import * as THREE from 'three';

const TRACER_POOL = 12;
const SPARK_POOL = 16;

export function createEffects(scene) {
  const tracers = [];
  for (let i = 0; i < TRACER_POOL; i += 1) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const material = new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0 });
    const line = new THREE.Line(geometry, material);
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerIndex = 0;

  const sparks = [];
  const sparkGeometry = new THREE.SphereGeometry(0.06, 6, 5);
  for (let i = 0; i < SPARK_POOL; i += 1) {
    const material = new THREE.MeshBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0 });
    const mesh = new THREE.Mesh(sparkGeometry, material);
    mesh.visible = false;
    scene.add(mesh);
    sparks.push({ mesh, life: 0 });
  }
  let sparkIndex = 0;

  const boom = new THREE.Mesh(
    new THREE.SphereGeometry(1, 20, 14),
    new THREE.MeshBasicMaterial({ color: 0xff7a2e, transparent: true, opacity: 0, depthWrite: false }),
  );
  boom.visible = false;
  scene.add(boom);
  const boomLight = new THREE.PointLight(0xff8a3a, 0, 18);
  scene.add(boomLight);
  let boomLife = 0;

  return {
    tracer(from, to, colour = '#ffe9a8') {
      const t = tracers[tracerIndex];
      tracerIndex = (tracerIndex + 1) % TRACER_POOL;
      const positions = t.line.geometry.attributes.position.array;
      positions[0] = from.x; positions[1] = from.y; positions[2] = from.z;
      positions[3] = to.x; positions[4] = to.y; positions[5] = to.z;
      t.line.geometry.attributes.position.needsUpdate = true;
      t.line.material.color.set(colour);
      t.line.material.opacity = 0.9;
      t.line.visible = true;
      t.life = 0.07;
    },
    spark(point, colour = '#ffc46b') {
      const s = sparks[sparkIndex];
      sparkIndex = (sparkIndex + 1) % SPARK_POOL;
      s.mesh.position.copy(point);
      s.mesh.material.color.set(colour);
      s.mesh.material.opacity = 1;
      s.mesh.scale.setScalar(1);
      s.mesh.visible = true;
      s.life = 0.22;
    },
    explosion(point) {
      boom.position.copy(point);
      boom.position.y = Math.max(0.5, point.y);
      boom.scale.setScalar(0.4);
      boom.material.opacity = 0.95;
      boom.visible = true;
      boomLight.position.copy(boom.position);
      boomLight.intensity = 60;
      boomLife = 0.8;
    },
    step(dt) {
      for (const t of tracers) {
        if (t.life <= 0) continue;
        t.life -= dt;
        t.line.material.opacity = Math.max(0, t.life / 0.07) * 0.9;
        if (t.life <= 0) t.line.visible = false;
      }
      for (const s of sparks) {
        if (s.life <= 0) continue;
        s.life -= dt;
        s.mesh.material.opacity = Math.max(0, s.life / 0.22);
        s.mesh.scale.setScalar(1 + (0.22 - s.life) * 6);
        if (s.life <= 0) s.mesh.visible = false;
      }
      if (boomLife > 0) {
        boomLife -= dt;
        const k = 1 - Math.max(0, boomLife / 0.8);
        boom.scale.setScalar(0.4 + k * 6.5);
        boom.material.opacity = Math.max(0, boomLife / 0.8) * 0.95;
        boomLight.intensity = Math.max(0, boomLife / 0.8) * 60;
        if (boomLife <= 0) {
          boom.visible = false;
          boomLight.intensity = 0;
        }
      }
    },
  };
}
