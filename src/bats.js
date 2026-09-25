import * as THREE from 'three';

const FRAMES = 5;
const COUNT = 5;

const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();

export function createBats(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const slots = [];
  for (let i = 0; i < COUNT; i++) {
    const map = new THREE.Texture();
    map.colorSpace = THREE.SRGBColorSpace;
    map.magFilter = THREE.NearestFilter;
    map.minFilter = THREE.NearestFilter;
    map.wrapS = THREE.ClampToEdgeWrapping;
    map.wrapT = THREE.ClampToEdgeWrapping;
    map.generateMipmaps = false;
    map.repeat.set(1 / FRAMES, 1);
    const material = new THREE.SpriteMaterial({
      map,
      color: 0x000000,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.visible = false;
    sprite.center.set(0.5, 0.5);
    sprite.scale.set(2.1, 2.1, 1);
    group.add(sprite);
    slots.push({
      sprite,
      map,
      active: false,
      t0: 0,
      sign: 1,
      out: true,
      row: 0,
      lift: 0,
      fwd: 0,
      phase: Math.random() * FRAMES,
    });
  }

  new THREE.TextureLoader().load('/assets/bats/bat.png', (loaded) => {
    for (const slot of slots) {
      slot.map.image = loaded.image;
      slot.map.needsUpdate = true;
    }
  });

  let nextAt = 8;

  function spawn(time) {
    if (slots.some((slot) => slot.active)) return false;
    const sign = Math.random() < 0.5 ? 1 : -1;
    const out = Math.random() < 0.5;
    for (let i = 0; i < COUNT; i++) {
      const slot = slots[i];
      slot.active = true;
      slot.t0 = time;
      slot.sign = sign;
      slot.out = out;
      slot.row = (i - 2) * 1.25 + (Math.random() - 0.5) * 0.4;
      slot.lift = (Math.random() - 0.5) * 0.4;
      slot.fwd = (Math.random() - 0.5) * 0.7;
      slot.sprite.visible = false;
    }
    return true;
  }

  function update(camera, time, tune) {
    const flight = Math.max(1, tune.flight);
    const gap = Math.max(1, tune.gap);
    if (time >= nextAt && spawn(time)) nextAt = time + gap;

    camera.updateMatrixWorld();
    camera.getWorldDirection(_forward);
    _right.setFromMatrixColumn(camera.matrixWorld, 0);
    _up.setFromMatrixColumn(camera.matrixWorld, 1);
    const dist = 40;
    const halfH = dist * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
    const halfW = halfH * camera.aspect;
    const inside = halfW * 0.78;
    const outside = halfW * 1.38;

    for (const slot of slots) {
      if (!slot.active) continue;
      const u = (time - slot.t0) / flight;
      if (u < 0 || u >= 1) {
        if (u >= 1) slot.active = false;
        slot.sprite.visible = false;
        continue;
      }
      const from = slot.out ? inside : outside;
      const to = slot.out ? outside : inside;
      const lat = from + (to - from) * u;
      slot.sprite.position.copy(camera.position);
      slot.sprite.position.addScaledVector(_forward, dist + slot.fwd);
      slot.sprite.position.addScaledVector(_up, halfH * 0.36 + slot.lift);
      slot.sprite.position.addScaledVector(_right, slot.sign * lat + slot.row);
      const movingRight = slot.sign * (slot.out ? 1 : -1) > 0;
      slot.sprite.scale.x = movingRight ? -2.1 : 2.1;
      slot.sprite.scale.y = 2.1;
      const frame = Math.floor(time * 7 + slot.phase) % FRAMES;
      slot.map.offset.x = frame / FRAMES;
      slot.sprite.visible = true;
    }
  }

  return { update };
}
