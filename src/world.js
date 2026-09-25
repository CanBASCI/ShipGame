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
          // The photo stays the surface color. Night shows it only in lantern light.
          tuneTreeMaterial(mat, bark);
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
  const bambooGlow = { value: 1 };
  const bambooReflect = { value: 1 };
  const treeLight = { value: 1 };

  function applyTreeLight(mat) {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTreeLight = treeLight;
      shader.fragmentShader = `uniform float uTreeLight;\n${shader.fragmentShader}`;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        'outgoingLight *= uTreeLight;\n#include <opaque_fragment>',
      );
    };
    mat.customProgramCacheKey = () => 'sakura-tree-light';
  }

  function tuneTreeMaterial(mat, bark) {
    mat.metalness = 0;
    // The photo is the lit surface only. It does not glow on its own,
    // so at night the texture appears where a lantern reaches.
    mat.color.set(0xffffff);
    mat.emissive.set(0x000000);
    mat.emissiveMap = null;
    mat.emissiveIntensity = 0;
    mat.userData.bark = bark;
    if (bark) {
      mat.roughness = 0.88;
    } else {
      mat.alphaTest = 0.4;
      mat.transparent = false;
      mat.depthWrite = true;
      mat.side = THREE.DoubleSide;
      mat.roughness = 0.82;
      if (mat.map) {
        mat.map.anisotropy = 8;
        mat.map.colorSpace = THREE.SRGBColorSpace;
      }
    }
    mat.needsUpdate = true;
  }

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

  // Extra size, chosen once from the tree's place on the bank. It does not
  // draw from the placement rng, so spacing and lean stay where they are.
  // The factor is against the size before this enlargement, not stacked on it.
  function treeGrowth(index, side, x, z) {
    let h = (index * 374761393 + (side < 0 ? 11 : 97) + Math.round(x * 100) * 668265263 + Math.round(z * 100) * 1442695041) | 0;
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
    h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
    h = (h ^ (h >>> 16)) >>> 0;
    return 2.4 + (h % 10001) / 10000 * 0.3;
  }

  function addTree(parent, x, z, side, rng, index) {
    const place = (fromQueue) => {
      if (fromQueue && !parent.parent) return;
      // Keep consuming the old palette roll so bank spacing stays put.
      blossomHex(side, rng, index, false);
      const variant = sakuraVariants[Math.floor(rng() * sakuraVariants.length)];
      const tree = variant.clone(true);
      // Each variant is already about 5.4m with its roots at y=0.
      const scale = (side < 0 ? 0.78 + rng() * 0.36 : 0.62 + rng() * 0.28) * treeGrowth(index, side, x, z);
      tree.traverse((obj) => {
        if (!obj.isMesh || !obj.material) return;
        const mat = obj.material.clone();
        mat.userData.dispose = true;
        applyTreeLight(mat);
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
      // Roots stay at y=0, so a larger scale still meets the bank.
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
        mat.emissiveIntensity = hero ? 1.096875 : distant ? 0.56953125 : 0.8015625;
        mat.side = THREE.DoubleSide;
        mat.userData.dispose = true;
        mat.userData.role = 'paper';
        obj.material = mat;
        mats.push(mat);
      });
      // Post, arm, and head share this root, so one scale shrinks the whole lantern.
      // The head stays at the higher hang. The shaft is stretched from the ground
      // up to that hang, so the post still meets the lamp.
      const s = (hero ? 1.28 : distant ? 0.62 : 0.88) * 0.75;
      const headLift = 1.05;
      const postTop = 2.35;
      const postScaleY = (postTop + headLift) / postTop;
      model.scale.setScalar(s);
      model.traverse((obj) => {
        if (obj.parent !== model) return;
        if (obj.name === 'Post') {
          obj.scale.y = postScaleY;
          obj.position.y = (postTop * 0.5) * postScaleY;
          return;
        }
        if (/^Node_/.test(obj.name)) {
          obj.position.y *= postScaleY;
          return;
        }
        obj.position.y += headLift;
      });
      // The arm reaches local +X. Turn it toward the canal.
      model.rotation.y = spec.side > 0 ? Math.PI : 0;
      const px = spec.x != null ? spec.x : spec.side * 6.35;
      model.position.set(px, 0, spec.z);
      parent.add(model);
      const head = new THREE.Vector3(
        px - spec.side * 0.72 * s,
        (1.72 + headLift) * s,
        index * CHUNK + spec.z,
      );
      lanterns.push({
        chunk: index,
        pos: head,
        base: color,
        gain: hero ? 1.0125 : distant ? 0.56953125 : 0.7171875,
        tight: hero ? 0.72 : 0.88,
        distance: hero ? 26 : distant ? 11 : 16,
        intensity: hero ? 12.375 : distant ? 4.5 : 7.3125,
        mats,
        emNight: hero ? 1.18125 : distant ? 0.6328125 : 0.8859375,
        emDay: 0.2953125,
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
    mist.addToChunk(root);

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
  for (let i = 0; i < 10; i++) {
    const light = new THREE.PointLight(0xfff1d0, 0, 14, 2);
    scene.add(light);
    lightPool.push(light);
  }

  const sky = createSky();
  scene.add(sky.mesh);
  const mist = createMist();

  function update(boatPos, time, day, yaw = 0) {
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

    const ranked = lanternsAhead(boatPos, yaw, 10);
    const reachOf = new Map();
    for (const item of ranked) {
      reachOf.set(item.L, lanternReach(Math.sqrt(item.d)));
    }

    for (const L of lanterns) {
      tmp.copy(L.base).lerp(warm, day * 0.25);
      const em = THREE.MathUtils.lerp(L.emNight, L.emDay, day);
      const reach = reachOf.get(L) ?? 1;
      for (const m of L.mats) {
        if (m.userData.role !== 'paper') continue;
        m.color.copy(tmp);
        m.emissive.copy(tmp);
        m.emissiveIntensity = em * bambooGlow.value * reach;
      }
    }

    for (let i = 0; i < lightPool.length; i++) {
      const item = ranked[i];
      const light = lightPool[i];
      if (!item) {
        light.intensity = 0;
        continue;
      }
      const reach = reachOf.get(item.L);
      tmp.copy(item.L.base).lerp(warm, day * 0.4);
      light.color.copy(tmp);
      light.position.copy(item.L.pos);
      light.distance = item.L.distance;
      light.intensity = item.L.intensity * THREE.MathUtils.lerp(1, 0.38, day) * bambooGlow.value * reach;
    }

    sky.mesh.position.copy(boatPos);
    sky.mesh.position.y = 0;
    sky.uniforms.uDay.value = day;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    // Fog stays in the world. The bow lantern and the moon are what light it.
    const bowAhead = 1.94;
    mist.uniforms.uBoat.value.copy(boatPos);
    mist.uniforms.uYaw.value = yaw;
    mist.uniforms.uDay.value = day;
    mist.uniforms.uTime.value = time;
    mist.uniforms.uFwd.value.set(fx, 0, fz);
    mist.uniforms.uBow.value.set(boatPos.x + fx * bowAhead, boatPos.y + 0.5, boatPos.z + fz * bowAhead);
    mist.uniforms.uMoon.value.set(0, 9.2, boatPos.z + 30);
  }

  function lanternsAhead(boatPos, yaw, count) {
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const ahead = [];
    for (const L of lanterns) {
      const dx = L.pos.x - boatPos.x;
      const dz = L.pos.z - boatPos.z;
      if (dx * fx + dz * fz <= 0) continue;
      ahead.push({ L, d: dx * dx + dz * dz });
    }
    ahead.sort((a, b) => a.d - b.d);
    if (ahead.length > count) ahead.length = count;
    return ahead;
  }

  // Lanterns within 12m of the boat stay at full strength. Past that, each
  // further 8m is one small step down. The scale never reaches zero.
  function lanternReach(dist) {
    if (dist <= 12) return 1;
    const steps = 1 + Math.floor((dist - 12) / 8);
    return Math.max(0.42, Math.pow(0.9, steps));
  }

  function reflections(boatPos, into, yaw = 0) {
    const lanternsNear = lanternsAhead(boatPos, yaw, Number.POSITIVE_INFINITY);
    for (const item of lanternsNear) {
      const reach = lanternReach(Math.sqrt(item.d));
      tmp.copy(item.L.base).lerp(warm, dayUniform.value * 0.4);
      into.push({
        pos: item.L.pos,
        color: tmp.clone(),
        gain: item.L.gain * bambooReflect.value * reach,
        tight: item.L.tight,
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
    setTune(next) {
      bambooGlow.value = next.bamboo;
      bambooReflect.value = next.water;
      treeLight.value = next.tree;
      mist.uniforms.uFogOn.value = next.fog ? 1 : 0;
    },
  };
}

function createSky() {
  const starTex = new THREE.TextureLoader().load('/assets/stars/star.png');
  starTex.colorSpace = THREE.SRGBColorSpace;
  starTex.magFilter = THREE.LinearFilter;
  starTex.minFilter = THREE.LinearMipmapLinearFilter;
  starTex.wrapS = THREE.ClampToEdgeWrapping;
  starTex.wrapT = THREE.ClampToEdgeWrapping;
  starTex.generateMipmaps = true;
  const uniforms = {
    uDay: { value: 0 },
    uStar: { value: starTex },
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
      uniform sampler2D uStar;
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
        // Stamp Kenney's soft star into sparse sky cells. The sprite is
        // transparent at the corners, so a cell never reads as a hard quad.
        float scale = 90.0;
        vec3 id = floor(dir * scale);
        float pick = hash13(id);
        float on = smoothstep(0.992, 0.997, pick);
        vec3 nrm = normalize((id + 0.5) / scale);
        vec3 upv = abs(nrm.y) > 0.92 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
        vec3 tangent = normalize(cross(upv, nrm));
        vec3 bitangent = cross(nrm, tangent);
        vec2 uv = vec2(dot(dir - nrm, tangent), dot(dir - nrm, bitangent)) * scale + 0.5;
        float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
        vec4 stamp = texture2D(uStar, clamp(uv, 0.0, 1.0));
        float sky = smoothstep(0.05, 0.25, h) * (1.0 - uDay);
        col += stamp.rgb * stamp.a * on * inside * sky * 1.6;
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
  const maps = ['/assets/fog/mist-a.png', '/assets/fog/mist-b.png', '/assets/fog/mist-c.png'].map((url) => {
    const tex = new THREE.TextureLoader().load(url);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    return tex;
  });
  const uniforms = {
    uDay: { value: 0 },
    uTime: { value: 0 },
    uBoat: { value: new THREE.Vector3() },
    uYaw: { value: 0 },
    uBow: { value: new THREE.Vector3(0, 0.5, 1.94) },
    uFwd: { value: new THREE.Vector3(0, 0, 1) },
    uMoon: { value: new THREE.Vector3(0, 9.2, 30) },
    uFogOn: { value: 1 },
  };
  const vertexShader = /* glsl */ `
    varying vec2 vUv;
    varying vec3 vWorld;
    uniform float uTime;
    void main() {
      vec4 world = modelMatrix * vec4(position, 1.0);
      float phase = world.x * 0.11 + world.z * 0.07;
      world.x += sin(uTime * 0.12 + phase) * 1.15;
      world.z += cos(uTime * 0.08 + phase) * 0.7;
      vWorld = world.xyz;
      vUv = uv;
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `;
  const fragmentShader = /* glsl */ `
    varying vec2 vUv;
    varying vec3 vWorld;
    uniform float uDay;
    uniform vec3 uBoat;
    uniform float uYaw;
    uniform vec3 uBow;
    uniform vec3 uFwd;
    uniform vec3 uMoon;
    uniform float uFogOn;
    uniform sampler2D uMap;
    void main() {
      vec2 uv = vUv * vec2(0.62, 0.7) + vec2(0.19, 0.14);
      float puff = texture2D(uMap, uv).a;
      float puffB = texture2D(uMap, uv * 0.82 + vec2(0.06, 0.04)).a;
      float cover = pow(clamp(max(puff, puffB * 0.9) * 3.3, 0.0, 1.0), 0.7);
      float edge = smoothstep(0.0, 0.38, vUv.x) * smoothstep(1.0, 0.62, vUv.x);
      edge *= smoothstep(0.0, 0.3, vUv.y) * smoothstep(1.0, 0.7, vUv.y);
      cover *= edge;
      float along = (vWorld.x - uBoat.x) * sin(uYaw) + (vWorld.z - uBoat.z) * cos(uYaw);
      float dist = smoothstep(32.0, 78.0, along);
      vec3 toBow = vWorld - uBow;
      float bowDist = max(length(toBow), 0.001);
      float facing = dot(toBow / bowDist, normalize(uFwd));
      float beam = pow(clamp(facing, 0.0, 1.0), 1.7) * exp(-bowDist * 0.022);
      vec3 toMoon = normalize(uMoon - vec3(0.0, 1.2, uBoat.z));
      float moon = clamp(toMoon.y * 0.85 + 0.15, 0.0, 1.0) * (0.42 + 0.58 * clamp(vWorld.y / 9.0, 0.0, 1.0));
      float night = 1.0 - uDay;
      float lit = clamp(moon * 0.55 + beam * 1.15, 0.0, 1.0);
      float a = cover * dist * lit * uFogOn * mix(1.0, 0.4, uDay);
      if (a < 0.004) discard;
      vec3 moonCol = vec3(0.46, 0.5, 0.62);
      vec3 bowCol = vec3(0.92, 0.5, 0.18);
      vec3 col = (moonCol * moon * 0.55 + bowCol * beam * 1.15) / max(lit, 0.001);
      col *= night + uDay * 0.85;
      gl_FragColor = vec4(col, a);
    }
  `;
  const materials = maps.map((map) => new THREE.ShaderMaterial({
    uniforms: {
      uDay: uniforms.uDay,
      uTime: uniforms.uTime,
      uBoat: uniforms.uBoat,
      uYaw: uniforms.uYaw,
      uBow: uniforms.uBow,
      uFwd: uniforms.uFwd,
      uMoon: uniforms.uMoon,
      uFogOn: uniforms.uFogOn,
      uMap: { value: map },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader,
    fragmentShader,
  }));
  const geo = new THREE.PlaneGeometry(42, 16);
  function addToChunk(root) {
    const depths = [6, 20, 34];
    const across = [-18, 0, 18];
    const turns = [-0.14, 0.12];
    let n = 0;
    for (const z of depths) {
      for (const x of across) {
        for (const turn of turns) {
          const mesh = new THREE.Mesh(geo, materials[n % materials.length]);
          mesh.position.set(x, 6.4, z);
          mesh.rotation.y = turn;
          mesh.renderOrder = 2;
          mesh.frustumCulled = false;
          root.add(mesh);
          n += 1;
        }
      }
    }
  }
  return { uniforms, addToChunk };
}
