import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const CHUNK = 42;
const KEEP_BEHIND = 1;
const KEEP_AHEAD = 3;

const LEFT_COLORS = [0xc43cff, 0x2ee7ff, 0x8a3cff, 0xe85cff, 0x49d6ff];
const RIGHT_COLORS = [0xff2f86, 0xffa033, 0xff4b9a, 0xffd27a, 0xff3d6e];
const LANTERN_PALETTE = [0xffc15a, 0xff4fa3, 0xb44bff, 0x3ee0ff, 0xff7a2a, 0xf4f0ff, 0xffe08a, 0xff2f86];

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hueShift(color, amount, out) {
  const c = out || new THREE.Color();
  c.copy(color);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL((hsl.h + amount + 1) % 1, hsl.s, Math.min(0.72, hsl.l));
  return c;
}

export function createWorld(scene) {
  const dayUniform = { value: 0 };
  const fogColor = new THREE.Color(0x0c0612);
  const fogDensity = { value: 0.034 };

  const quayMat = new THREE.MeshStandardMaterial({ color: 0x141216, roughness: 0.96, metalness: 0 });
  const lipMat = new THREE.MeshStandardMaterial({ color: 0x2a2428, roughness: 0.84, metalness: 0.02 });
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x0b090c, roughness: 1, metalness: 0 });

  const chunks = new Map();
  const lanterns = [];
  const masses = [];
  let sakuraVariants = null;
  let lanternTemplate = null;
  const treeQueue = [];
  const lanternQueue = [];
  const loader = new GLTFLoader();
  loader.load(
    '/assets/trees/sakura.glb',
    (gltf) => {
      const found = [];
      gltf.scene.traverse((obj) => {
        if (/^Sakura[ABC]$/.test(obj.name)) found.push(obj);
      });
      found.sort((a, b) => a.name.localeCompare(b.name));
      for (const node of found) {
        node.removeFromParent();
        node.traverse((obj) => {
          if (!obj.isMesh || !obj.material) return;
          const bark = /bark/i.test(obj.material.name);
          const mat = obj.material.clone();
          mat.name = obj.material.name;
          mat.metalness = 0;
          if (bark) {
            mat.color.set(0xffffff);
            mat.emissive.set(0xfff0dd);
            mat.emissiveMap = mat.map;
            mat.emissiveIntensity = 0.7;
            mat.roughness = 0.88;
          } else {
            // Black albedo so canal lights cannot paint the crown a flat hue.
            // The blossom photo is the emissive map and stays visible at night.
            mat.color.set(0x000000);
            mat.emissiveMap = mat.map;
            mat.emissive.set(0xffffff);
            mat.emissiveIntensity = 1.15;
            mat.alphaTest = 0.4;
            mat.transparent = false;
            mat.depthWrite = true;
            mat.side = THREE.DoubleSide;
            mat.roughness = 1;
            if (mat.map) {
              mat.map.anisotropy = 8;
              mat.map.colorSpace = THREE.SRGBColorSpace;
            }
          }
          mat.userData.bark = bark;
          obj.material = mat;
        });
      }
      sakuraVariants = found;
      const jobs = treeQueue.splice(0, treeQueue.length);
      for (const job of jobs) job();
    },
    undefined,
    (err) => console.error(err),
  );
  loader.load(
    '/assets/lantern/bamboo_lantern.glb',
    (gltf) => {
      lanternTemplate = gltf.scene;
      const jobs = lanternQueue.splice(0, lanternQueue.length);
      for (const job of jobs) job();
    },
    undefined,
    (err) => console.error(err),
  );
  const tmp = new THREE.Color();
  const warm = new THREE.Color(0xffb36a);

  function blossomHex(side, rng, index, hot) {
    const shift = index * 0.045 + (rng() - 0.5) * 0.04;
    const pick = rng();
    let hex;
    if (side < 0) {
      if (pick < 0.44) hex = 0x2ee7ff;
      else if (pick < 0.8) hex = 0xc43cff;
      else hex = LEFT_COLORS[Math.floor(rng() * LEFT_COLORS.length)];
    } else if (pick < 0.4) hex = 0xffa033;
    else if (pick < 0.8) hex = 0xff2f86;
    else hex = RIGHT_COLORS[Math.floor(rng() * RIGHT_COLORS.length)];
    const col = hueShift(new THREE.Color(hex), shift);
    col.multiplyScalar(hot ? 3.1 : 0.95);
    return col;
  }

  function addTree(parent, x, z, side, rng, index) {
    const place = (fromQueue) => {
      if (fromQueue && !parent.parent) return;
      // Keep consuming the old palette roll so bank spacing stays put.
      blossomHex(side, rng, index, false);
      const variant = sakuraVariants[Math.floor(rng() * sakuraVariants.length)];
      const tree = variant.clone(true);
      // Each variant is already about 5.4m with its roots at y=0.
      const scale = side < 0 ? 0.78 + rng() * 0.36 : 0.62 + rng() * 0.28;
      // A slight cool shift on the left bank and a slight warm shift on the right.
      // Both stay near white so the petal and leaf photo is what you see.
      const warmth = side < 0 ? 0xf3f6ff : 0xfff4ea;
      tree.traverse((obj) => {
        if (!obj.isMesh || !obj.material) return;
        const mat = obj.material.clone();
        mat.userData.dispose = true;
        if (!mat.userData.bark) {
          mat.color.set(0x000000);
          mat.emissive.set(warmth);
          mat.emissiveMap = mat.map;
          mat.emissiveIntensity = 1.15;
        }
        obj.material = mat;
      });
      tree.position.set(x, 0, z);
      // Yaw aims the crown. A small local tilt leans the trunk toward the
      // canal without laying it down. Left and right ranges stay different.
      const yawSpan = side < 0 ? 1.2 : 0.72;
      const yaw = (side > 0 ? 0 : Math.PI) + (rng() - 0.5) * yawSpan;
      tree.rotation.set(0, yaw, 0);
      const lean = (side < 0 ? 0.05 : 0.08) + rng() * (side < 0 ? 0.1 : 0.14);
      tree.rotateZ(lean);
      tree.rotateX((rng() - 0.5) * (side < 0 ? 0.1 : 0.06));
      // The file stores the fit-to-5.4m scale on the tree root. Multiply it.
      tree.scale.multiplyScalar(scale);
      parent.add(tree);
      masses.push({
        chunk: index,
        pos: new THREE.Vector3(x - side * scale * 1.1, scale * 4.4, index * CHUNK + z),
        base: new THREE.Color(side < 0 ? 0xf0c4d4 : 0xf3c8b4),
        gain: 0.85,
        tight: 0.42,
      });
    };
    if (sakuraVariants) place(false);
    else treeQueue.push(() => place(true));
  }

  function lanternPlan(index, rng) {
    if (index === 0) {
      return [
        { side: 1, x: 6.15, z: 4.35, scale: 2.7, color: 0xff3ea5, glass: true },
        { side: -1, x: -6.35, z: 6.4, scale: 1.2, color: 0xffc15a, glass: true },
        { side: -1, z: 16.5, scale: 0.72, color: 0xb14bff, glass: true },
        { side: 1, z: 19.5, scale: 0.62, color: 0x35d7ff, glass: true },
        { side: -1, z: 27, scale: 0.5, color: 0xff7a2e, glass: true },
        { side: 1, z: 31, scale: 0.46, color: 0xf4f0ff, glass: true },
        { side: 1, z: 37.5, scale: 0.4, color: 0xd06bff, glass: true },
        { side: -1, z: 39, scale: 0.38, color: 0xffe7a8, glass: true },
      ];
    }
    const list = [];
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const z = (i + 0.22 + rng() * 0.4) * (CHUNK / 3);
        const color = LANTERN_PALETTE[(Math.abs(index) * 3 + i * 2 + (side < 0 ? 0 : 4)) % LANTERN_PALETTE.length];
        list.push({
          side,
          z,
          scale: 0.42 + rng() * 0.45,
          color,
          glass: true,
        });
      }
    }
    return list;
  }

  function addLantern(parent, index, spec) {
    const place = (fromQueue) => {
      if (fromQueue && !parent.parent) return;
      const hero = spec.scale > 1.8;
      const distant = spec.scale < 0.7;
      const model = lanternTemplate.clone(true);
      const color = new THREE.Color(spec.color);
      const mats = [];
      model.traverse((obj) => {
        if (!obj.isMesh || !obj.material) return;
        const matName = obj.material.name || '';
        const shade = matName === 'Paper' || obj.name.startsWith('Paper');
        if (!shade) return;
        const mat = obj.material.clone();
        mat.color.copy(color);
        mat.emissive.copy(color);
        mat.emissiveIntensity = hero ? 2.6 : distant ? 1.35 : 1.9;
        mat.side = THREE.DoubleSide;
        mat.userData.dispose = true;
        mat.userData.role = 'paper';
        obj.material = mat;
        mats.push(mat);
      });
      const s = hero ? 1.28 : distant ? 0.62 : 0.88;
      model.scale.setScalar(s);
      // The arm reaches local +X. Turn it toward the canal.
      model.rotation.y = spec.side > 0 ? Math.PI : 0;
      const px = spec.x != null ? spec.x : spec.side * 6.35;
      model.position.set(px, 0, spec.z);
      parent.add(model);
      const head = new THREE.Vector3(
        px - spec.side * 0.72 * s,
        1.72 * s,
        index * CHUNK + spec.z,
      );
      lanterns.push({
        chunk: index,
        pos: head,
        base: color,
        gain: hero ? 2.4 : distant ? 1.35 : 1.7,
        tight: hero ? 0.72 : 0.88,
        distance: hero ? 26 : distant ? 11 : 16,
        intensity: hero ? 22 : distant ? 8 : 13,
        mats,
        emNight: hero ? 2.8 : distant ? 1.5 : 2.1,
        emDay: 0.7,
      });
    };
    if (lanternTemplate) place(false);
    else lanternQueue.push(() => place(true));
  }

  function buildChunk(index) {
    const rng = mulberry32(index * 10007 + 91);
    const root = new THREE.Group();
    root.position.z = index * CHUNK;

    const quayGeo = new THREE.BoxGeometry(0.9, 0.46, CHUNK);
    const quayL = new THREE.Mesh(quayGeo, quayMat);
    quayL.position.set(-6.45, 0.1, CHUNK / 2);
    const quayR = new THREE.Mesh(quayGeo, quayMat);
    quayR.position.set(6.45, 0.1, CHUNK / 2);
    const lipGeo = new THREE.BoxGeometry(0.18, 0.06, CHUNK);
    const lipL = new THREE.Mesh(lipGeo, lipMat);
    lipL.position.set(-6.05, 0.32, CHUNK / 2);
    const lipR = new THREE.Mesh(lipGeo, lipMat);
    lipR.position.set(6.05, 0.32, CHUNK / 2);
    const groundGeo = new THREE.BoxGeometry(18, 0.5, CHUNK);
    const groundL = new THREE.Mesh(groundGeo, groundMat);
    groundL.position.set(-16.2, -0.08, CHUNK / 2);
    const groundR = new THREE.Mesh(groundGeo, groundMat);
    groundR.position.set(16.2, -0.08, CHUNK / 2);
    quayL.userData.uniqueGeo = true;
    lipL.userData.uniqueGeo = true;
    groundL.userData.uniqueGeo = true;
    quayR.geometry = quayGeo.clone();
    lipR.geometry = lipGeo.clone();
    groundR.geometry = groundGeo.clone();
    quayR.userData.uniqueGeo = true;
    lipR.userData.uniqueGeo = true;
    groundR.userData.uniqueGeo = true;
    root.add(quayL, quayR, lipL, lipR, groundL, groundR);

    // Independent walks. The left bank is looser and set back; the right is denser
    // and closer to the quay, so the two rows never line up.
    const banks = [
      { side: -1, z: 0.6 + rng() * 4.2, gap: 6.4, jitter: 4.6, inset: 7.55, spread: 1.85 },
      { side: 1, z: 2.4 + rng() * 1.8, gap: 4.1, jitter: 2.7, inset: 7.15, spread: 0.95 },
    ];
    for (const bank of banks) {
      let z = bank.z;
      while (z < CHUNK - 1.1) {
        const x = bank.side * (bank.inset + rng() * bank.spread);
        addTree(root, x, z, bank.side, rng, index);
        z += bank.gap + rng() * bank.jitter;
      }
    }

    for (const spec of lanternPlan(index, rng)) addLantern(root, index, spec);

    scene.add(root);
    chunks.set(index, root);
  }

  function releaseChunk(index) {
    const root = chunks.get(index);
    if (!root) return;
    root.traverse((obj) => {
      if (obj.userData.uniqueGeo && obj.geometry) obj.geometry.dispose();
      if (obj.material && obj.material.userData && obj.material.userData.dispose) obj.material.dispose();
    });
    for (let i = lanterns.length - 1; i >= 0; i--) {
      if (lanterns[i].chunk === index) {
        for (const m of lanterns[i].mats) m.dispose();
        lanterns.splice(i, 1);
      }
    }
    for (let i = masses.length - 1; i >= 0; i--) {
      if (masses[i].chunk === index) masses.splice(i, 1);
    }
    scene.remove(root);
    chunks.delete(index);
  }

  const lightPool = [];
  for (let i = 0; i < 8; i++) {
    const light = new THREE.PointLight(0xfff1d0, 0, 14, 2);
    scene.add(light);
    lightPool.push(light);
  }

  const sky = createSky();
  scene.add(sky.mesh);
  const mist = createMist();
  for (const m of mist.meshes) scene.add(m);

  function update(boatPos, time, day) {
    dayUniform.value = day;
    fogDensity.value = THREE.MathUtils.lerp(0.02, 0.015, day);

    const center = Math.floor(boatPos.z / CHUNK);
    const need = new Set();
    for (let i = center - KEEP_BEHIND; i <= center + KEEP_AHEAD; i++) need.add(i);
    for (const index of chunks.keys()) {
      if (!need.has(index)) releaseChunk(index);
    }
    for (const index of need) {
      if (!chunks.has(index)) buildChunk(index);
    }

    for (const L of lanterns) {
      tmp.copy(L.base).lerp(warm, day * 0.25);
      const em = THREE.MathUtils.lerp(L.emNight, L.emDay, day);
      for (const m of L.mats) {
        if (m.userData.role !== 'paper') continue;
        m.color.copy(tmp);
        m.emissive.copy(tmp);
        m.emissiveIntensity = em;
      }
    }

    const ranked = lanterns
      .map((L) => ({ L, d: L.pos.distanceToSquared(boatPos) }))
      .sort((a, b) => a.d - b.d);
    for (let i = 0; i < lightPool.length; i++) {
      const item = ranked[i];
      const light = lightPool[i];
      if (!item) {
        light.intensity = 0;
        continue;
      }
      tmp.copy(item.L.base).lerp(warm, day * 0.4);
      light.color.copy(tmp);
      light.position.copy(item.L.pos);
      light.distance = item.L.distance;
      light.intensity = item.L.intensity * THREE.MathUtils.lerp(1, 0.38, day);
    }

    sky.mesh.position.copy(boatPos);
    sky.mesh.position.y = 0;
    sky.uniforms.uDay.value = day;
    for (const mesh of mist.meshes) {
      mesh.position.z = boatPos.z + 78;
    }
    mist.uniforms.uDay.value = day;
    mist.uniforms.uFogDensity.value = fogDensity.value;
  }

  function reflections(boatPos, into) {
    const lanternsNear = lanterns
      .map((L) => ({ L, d: L.pos.distanceToSquared(boatPos) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 8);
    const massesNear = masses
      .map((M) => ({ M, d: M.pos.distanceToSquared(boatPos) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 7);
    for (const item of lanternsNear) {
      if (into.length >= 15) break;
      tmp.copy(item.L.base).lerp(warm, dayUniform.value * 0.4);
      into.push({
        pos: item.L.pos,
        color: tmp.clone(),
        gain: item.L.gain,
        tight: item.L.tight,
      });
    }
    for (const item of massesNear) {
      if (into.length >= 15) break;
      tmp.copy(item.M.base).lerp(warm, dayUniform.value * 0.35);
      into.push({
        pos: item.M.pos,
        color: tmp.clone(),
        gain: item.M.gain,
        tight: item.M.tight,
      });
    }
    return into;
  }

  return {
    update,
    reflections,
    fogColor,
    fogDensity,
    dayUniform,
    sky,
    mist,
  };
}

function createSky() {
  const uniforms = {
    uDay: { value: 0 },
    uZenithN: { value: new THREE.Color(0x05010c) },
    uHorizonN: { value: new THREE.Color(0x140a1c) },
    uZenithD: { value: new THREE.Color(0x4a5568) },
    uHorizonD: { value: new THREE.Color(0xb09a8c) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vDir = world.xyz - cameraPosition;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      uniform float uDay;
      uniform vec3 uZenithN;
      uniform vec3 uHorizonN;
      uniform vec3 uZenithD;
      uniform vec3 uHorizonD;
      float hash13(vec3 p) {
        p = fract(p * 0.1031);
        p += dot(p, p.yzx + 33.33);
        return fract((p.x + p.y) * p.z);
      }
      void main() {
        vec3 dir = normalize(vDir);
        float h = dir.y;
        vec3 zenith = mix(uZenithN, uZenithD, uDay);
        vec3 horizon = mix(uHorizonN, uHorizonD, uDay);
        float g = smoothstep(-0.02, 0.48, h);
        vec3 col = mix(horizon, zenith, g);
        float cell = hash13(floor(dir * 220.0));
        float star = smoothstep(0.9975, 0.9992, cell);
        star *= smoothstep(0.05, 0.25, h);
        col += vec3(0.75, 0.8, 1.0) * star * (1.0 - uDay) * 2.4;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(220, 24, 16), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return { mesh, uniforms };
}

function createMist() {
  const uniforms = {
    uDay: { value: 0 },
    uColor: { value: new THREE.Color(0x1a1024) },
    uFogDensity: { value: 0.034 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vWorld;
      uniform float uDay;
      uniform vec3 uColor;
      void main() {
        float d = distance(vWorld.xz, cameraPosition.xz);
        float dist = smoothstep(16.0, 88.0, d);
        float low = smoothstep(1.6, 0.02, vWorld.y);
        float a = dist * mix(0.18, 1.0, low) * 0.48 * (1.0 - uDay * 0.4);
        vec3 col = mix(uColor, vec3(0.42, 0.34, 0.32), uDay);
        gl_FragColor = vec4(col, a);
      }
    `,
  });
  const meshes = [];
  for (const y of [0.08, 0.28, 0.55, 0.95, 1.55]) {
    const geo = new THREE.PlaneGeometry(24, 150, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.y = y;
    mesh.renderOrder = 4;
    mesh.frustumCulled = false;
    meshes.push(mesh);
  }
  return { meshes, uniforms };
}
