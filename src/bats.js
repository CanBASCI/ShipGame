import * as THREE from 'three';

const FRAMES = 5;
const POOL = 3;

export function createBats(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const slots = [];
  for (let i = 0; i < POOL; i++) {
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
      color: 0xffffff,
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
      dur: 1,
      side0: 0,
      side1: 0,
      along0: 0,
      along1: 0,
      y0: 6,
      y1: 6,
      origin: new THREE.Vector3(),
      yaw: 0,
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

  function spawn(time, boatPos, yaw) {
    const free = slots.filter((slot) => !slot.active);
    if (free.length < 2) return;
    const count = Math.min(free.length, 2 + (Math.random() < 0.5 ? 0 : 1));
    const ahead = 52 + Math.random() * 16;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const origin = new THREE.Vector3(boatPos.x + fx * ahead, 0, boatPos.z + fz * ahead);
    const cross = Math.random() < 0.6;
    const dir = Math.random() < 0.5 ? 1 : -1;
    const duration = 8 + Math.random() * 3;
    for (let i = 0; i < count; i++) {
      const slot = free[i];
      slot.active = true;
      slot.t0 = time + i * 0.55;
      slot.dur = duration;
      slot.yaw = yaw;
      slot.origin.copy(origin);
      const y = 5.2 + Math.random() * 2.4;
      slot.y0 = y;
      slot.y1 = y + (Math.random() - 0.5) * 1.1;
      if (cross) {
        slot.side0 = dir * -(9 + Math.random() * 2.5);
        slot.side1 = -dir * (9 + Math.random() * 2.5);
        slot.along0 = (Math.random() - 0.5) * 3 + i * 1.6;
        slot.along1 = slot.along0 + (Math.random() - 0.5) * 5;
      } else {
        slot.side0 = (Math.random() - 0.5) * 4;
        slot.side1 = slot.side0 + (Math.random() - 0.5) * 2;
        slot.along0 = -3;
        slot.along1 = 14 + Math.random() * 4;
      }
      slot.sprite.visible = false;
    }
  }

  function update(boatPos, time, yaw) {
    if (time >= nextAt) {
      spawn(time, boatPos, yaw);
      nextAt = time + 20 + Math.random() * 12;
    }
    for (const slot of slots) {
      if (!slot.active) continue;
      const u = (time - slot.t0) / slot.dur;
      if (u < 0 || u >= 1) {
        if (u >= 1) slot.active = false;
        slot.sprite.visible = false;
        continue;
      }
      const side = slot.side0 + (slot.side1 - slot.side0) * u;
      const along = slot.along0 + (slot.along1 - slot.along0) * u;
      const y = slot.y0 + (slot.y1 - slot.y0) * u + Math.sin(u * Math.PI) * 0.4;
      const fx = Math.sin(slot.yaw);
      const fz = Math.cos(slot.yaw);
      slot.sprite.position.set(
        slot.origin.x + fx * along + -fz * side,
        y,
        slot.origin.z + fz * along + fx * side,
      );
      const face = slot.side1 >= slot.side0 ? 1 : -1;
      slot.sprite.scale.x = 2.1 * face;
      slot.sprite.scale.y = 2.1;
      const frame = Math.floor(time * 7 + slot.phase) % FRAMES;
      slot.map.offset.x = frame / FRAMES;
      slot.sprite.visible = true;
    }
  }

  return { update };
}
