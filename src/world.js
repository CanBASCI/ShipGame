import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
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

const puffVertex = /* glsl */ `
  attribute vec3 aColor;
  varying vec3 vColor;
  varying vec2 vUv;
  varying vec3 vWorld;
  uniform float uTime;
  void main() {
    vUv = uv;
    vColor = aColor;
    vec4 centerLocal = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float sc = length(instanceMatrix[0].xyz);
    vec4 centerWorld = modelMatrix * centerLocal;
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    float wob = sin(uTime * 0.32 + centerWorld.x * 0.35 + centerWorld.z * 0.27) * 0.05;
    vec3 world = centerWorld.xyz + (right * position.x + up * position.y) * sc + up * wob;
    vWorld = world;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const puffFragment = /* glsl */ `
  varying vec3 vColor;
  varying vec2 vUv;
  varying vec3 vWorld;
  uniform float uDay;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform sampler2D uAlpha;
  uniform sampler2D uDiff;
  void main() {
    float mask = texture(uAlpha, vUv).r;
    if (mask < 0.22) discard;
    float petal = smoothstep(0.22, 0.9, mask);
    float core = pow(petal, 2.4);
    vec3 warm = vec3(1.0, 0.62, 0.45);
    vec3 col = mix(vColor, mix(vColor, warm, 0.55), uDay * 0.7);
    col *= mix(1.0, 0.62, uDay);
    col *= mix(0.45, 1.0, petal);
    col *= mix(vec3(1.0), texture(uDiff, vUv).rgb, 0.4);
    col += vColor * core * mix(0.42, 0.12, uDay);
    float dist = distance(vWorld, cameraPosition);
    float fog = exp(-uFogDensity * uFogDensity * dist * dist);
    col = mix(uFogColor, col, fog);
    float a = petal * mix(0.55, 0.38, uDay) * fog;
    gl_FragColor = vec4(col, a);
  }
`;

function cylinderBetween(a, b, r0, r1) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  if (len < 0.05) return null;
  const geo = new THREE.CylinderGeometry(Math.max(0.02, r1), Math.max(0.03, r0), len, 7);
  geo.translate(0, len / 2, 0);
  const quat = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    dir.multiplyScalar(1 / len),
  );
  geo.applyQuaternion(quat);
  geo.translate(a.x, a.y, a.z);
  return geo;
}

function bezier(a, b, c, t, target) {
  const u = 1 - t;
  target.set(
    u * u * a.x + 2 * u * t * b.x + t * t * c.x,
    u * u * a.y + 2 * u * t * b.y + t * t * c.y,
    u * u * a.z + 2 * u * t * b.z + t * t * c.z,
  );
  return target;
}

export function createWorld(scene) {
  const puffGeoBase = new THREE.PlaneGeometry(1, 1);
  const sphereGeo = new THREE.SphereGeometry(1, 6, 5);
  const dayUniform = { value: 0 };
  const fogColor = new THREE.Color(0x0c0612);
  const fogDensity = { value: 0.034 };

  const blossomFallback = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  blossomFallback.needsUpdate = true;
  blossomFallback.colorSpace = THREE.NoColorSpace;
  const blossomAlpha = new THREE.TextureLoader().load(
    '/assets/blossoms/flower_heliophila_alpha_1k.png',
    (tex) => {
      tex.colorSpace = THREE.NoColorSpace;
      tex.needsUpdate = true;
      puffMat.uniforms.uAlpha.value = tex;
    },
  );
  blossomAlpha.colorSpace = THREE.NoColorSpace;
  const blossomDiff = new THREE.TextureLoader().load('/assets/blossoms/flower_heliophila_diff_1k.jpg');
  blossomDiff.colorSpace = THREE.SRGBColorSpace;

  const puffMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uDay: dayUniform,
      uFogColor: { value: fogColor },
      uFogDensity: fogDensity,
      uAlpha: { value: blossomFallback },
      uDiff: { value: blossomDiff },
    },
    vertexShader: puffVertex,
    fragmentShader: puffFragment,
    transparent: true,
    depthWrite: false,
  });

  const sphereMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  sphereMat.userData.shader = null;
    sphereMat.onBeforeCompile = (shader) => {
    shader.uniforms.uDay = dayUniform;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
       uniform float uDay;`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
       vec3 warm = vec3(1.0, 0.62, 0.42);
       diffuseColor.rgb = mix(diffuseColor.rgb, mix(diffuseColor.rgb, warm, 0.55), uDay * 0.75);
       diffuseColor.rgb *= mix(1.15, 0.82, uDay);
      `,
    );
    sphereMat.userData.shader = shader;
  };

  const trunkMat = new THREE.MeshBasicMaterial({ color: 0x040208 });
  const quayMat = new THREE.MeshStandardMaterial({ color: 0x141216, roughness: 0.96, metalness: 0 });
  const lipMat = new THREE.MeshStandardMaterial({ color: 0x2a2428, roughness: 0.84, metalness: 0.02 });
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x0b090c, roughness: 1, metalness: 0 });
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x1a1214, roughness: 0.7, metalness: 0.2 });

  const lanternBodyGeo = new THREE.CylinderGeometry(0.11, 0.12, 0.3, 8, 1, true);
  const lanternCapGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.045, 8);
  const lanternPostGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.34, 4);
  const lanternCoreGeo = new THREE.SphereGeometry(0.055, 8, 6);
  const poleGeo = new THREE.CylinderGeometry(0.04, 0.055, 1, 6);
  const armGeo = new THREE.CylinderGeometry(0.018, 0.018, 1, 4);

  const chunks = new Map();
  const lanterns = [];
  const masses = [];
  let lanternTemplate = null;
  const lanternQueue = [];
  new GLTFLoader().load(
    '/assets/lantern/Lantern_01_1k.gltf',
    (gltf) => {
      lanternTemplate = gltf.scene;
      const jobs = lanternQueue.splice(0, lanternQueue.length);
      for (const job of jobs) job(lanternTemplate);
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

  function addTree(x, z, side, rng, index, puffs, spheres, woods) {
    const height = 6.4 + rng() * 2.6;
    const reach = 12.2 + rng() * 2.8;
    const base = new THREE.Vector3(x, 0.05, z);
    const mid = new THREE.Vector3(x - side * 0.55, height * 0.62, z + (rng() - 0.5) * 0.5);
    const crown = new THREE.Vector3(
      x - side * reach * 0.42,
      height * (1.12 + rng() * 0.08),
      z + (rng() - 0.5) * 0.8,
    );
    const tip = new THREE.Vector3(
      x - side * reach,
      height * (0.62 + rng() * 0.12),
      z + (rng() - 0.5) * 1.4,
    );
    const ctrl = crown.clone();

    const trunk = cylinderBetween(base, mid, 0.34 + rng() * 0.08, 0.16);
    const limb = cylinderBetween(mid, crown, 0.12, 0.06);
    const reacher = cylinderBetween(crown, tip, 0.07, 0.028);
    if (trunk) woods.push(trunk);
    if (limb) woods.push(limb);
    if (reacher) woods.push(reacher);
    const lowTip = new THREE.Vector3(
      x - side * (reach * 0.92),
      height * 0.42,
      z + (rng() - 0.5) * 2.2,
    );
    const low = cylinderBetween(mid, lowTip, 0.055, 0.02);
    if (low) woods.push(low);
    if (rng() > 0.25) {
      const twigTip = tip.clone().add(new THREE.Vector3((rng() - 0.5) * 1.6, -0.7, (rng() - 0.5) * 2.4));
      const twig = cylinderBetween(crown.clone().lerp(tip, 0.35), twigTip, 0.04, 0.015);
      if (twig) woods.push(twig);
    }

    const puffN = 96;
    const sphereN = 42;
    const pt = new THREE.Vector3();

    function pushBlossom(list, pos, scale, hot) {
      const col = blossomHex(side, rng, index, hot);
      list.push({ pos: pos.clone(), scale, color: col });
    }

    for (let i = 0; i < puffN; i++) {
      const roll = rng();
      if (roll < 0.62) {
        bezier(mid, ctrl, tip, Math.pow(rng(), 0.55), pt);
        pt.x += (rng() - 0.5) * 2.2;
        pt.y += (rng() - 0.55) * 1.5;
        pt.z += (rng() - 0.5) * 2.0;
      } else if (roll < 0.84) {
        pt.copy(tip).lerp(lowTip, rng() * 0.65);
        pt.x += (rng() - 0.5) * 1.8;
        pt.y += (rng() - 0.4) * 1.3;
        pt.z += (rng() - 0.5) * 1.6;
      } else {
        pt.copy(base).lerp(mid, 0.4 + rng() * 0.55);
        pt.x -= side * rng() * 1.6;
        pt.y += rng() * 1.4;
        pt.z += (rng() - 0.5) * 1.1;
      }
      const scale = rng() > 0.78 ? 0.9 + rng() * 1.35 : 0.14 + Math.pow(rng(), 0.65) * 0.72;
      pushBlossom(puffs, pt, scale, scale < 0.32 && rng() > 0.45);
    }

    for (let i = 0; i < sphereN; i++) {
      bezier(mid, ctrl, tip, 0.25 + rng() * 0.75, pt);
      pt.x += (rng() - 0.5) * 2.4;
      pt.y += (rng() - 0.5) * 1.5;
      pt.z += (rng() - 0.5) * 1.8;
      const hot = rng() > 0.4;
      pushBlossom(spheres, pt, 0.028 + rng() * 0.05, hot);
    }

    const bias = (Math.sin(index * 0.65 + (side < 0 ? 0 : 1.7)) + 1) * 0.5;
    const massColor = hueShift(
      new THREE.Color(side < 0 ? (bias > 0.5 ? 0x49d6ff : 0xc43cff) : bias > 0.5 ? 0xffa033 : 0xff2f86),
      index * 0.045,
    );
    const massPos = crown.clone().lerp(tip, 0.55);
    massPos.y -= 0.35;
    massPos.z += index * CHUNK;
    masses.push({
      chunk: index,
      pos: massPos,
      base: massColor.clone(),
      gain: 1.15,
      tight: 0.46,
    });
  }

  function makeInstances(baseGeo, material, list, useColorAttr) {
    const geo = baseGeo.clone();
    const mesh = new THREE.InstancedMesh(geo, material, list.length);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    if (useColorAttr) {
      const arr = new Float32Array(list.length * 3);
      for (let i = 0; i < list.length; i++) {
        color.copy(list[i].color);
        arr[i * 3] = color.r;
        arr[i * 3 + 1] = color.g;
        arr[i * 3 + 2] = color.b;
      }
      geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(arr, 3));
    }
    for (let i = 0; i < list.length; i++) {
      dummy.position.copy(list[i].pos);
      dummy.scale.setScalar(list[i].scale);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      if (!useColorAttr) mesh.setColorAt(i, color.copy(list[i].color));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.userData.uniqueGeo = true;
    return mesh;
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
    const g = new THREE.Group();
    const hero = spec.scale > 1.8;
    const distant = spec.scale < 0.7;
    const poleH = hero ? 3.25 : 2.05 + spec.scale * 0.7;
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.scale.y = poleH;
    pole.position.y = poleH / 2;
    const hang = -spec.side * (hero ? 1.25 : 0.62);
    const arm = new THREE.Mesh(armGeo, poleMat);
    arm.rotation.z = Math.PI / 2;
    arm.scale.y = Math.abs(hang) + 0.16;
    arm.position.set(hang * 0.5, poleH, 0);

    const housing = new THREE.Group();
    housing.position.set(hang, poleH - 0.08, 0);
    housing.scale.setScalar(hero ? spec.scale * 0.62 : Math.max(0.7, spec.scale));

    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const post = new THREE.Mesh(lanternPostGeo, poleMat);
        post.position.set(sx * 0.105, 0, sz * 0.105);
        housing.add(post);
      }
    }
    const capTop = new THREE.Mesh(lanternCapGeo, poleMat);
    capTop.position.y = 0.17;
    const capBot = new THREE.Mesh(lanternCapGeo, poleMat);
    capBot.position.y = -0.17;
    housing.add(capTop, capBot);

    const glowMat = new THREE.MeshStandardMaterial({
      color: spec.color,
      emissive: spec.color,
      emissiveIntensity: hero ? 2.8 : 3.6,
      roughness: 0.06,
      metalness: 0.04,
      transparent: true,
      opacity: hero ? 0.5 : 0.62,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const glass = new THREE.Mesh(lanternBodyGeo, glowMat);
    housing.add(glass);

    const coreColor = new THREE.Color(spec.color).lerp(new THREE.Color(0xfff4dc), hero ? 0.28 : 0.12);
    const coreMat = new THREE.MeshStandardMaterial({
      color: coreColor,
      emissive: coreColor,
      emissiveIntensity: distant ? 14 : hero ? 9 : 11,
      roughness: 0.2,
    });
    const core = new THREE.Mesh(lanternCoreGeo, coreMat);
    core.scale.setScalar(distant ? 0.7 : 1.15);
    housing.add(core);

    g.add(pole, arm, housing);
    const px = spec.x != null ? spec.x : spec.side * 6.45;
    g.position.set(px, 0, spec.z);
    parent.add(g);

    const headY = poleH - 0.08;
    const world = new THREE.Vector3(px + hang, headY, index * CHUNK + spec.z);
    const record = {
      chunk: index,
      pos: world,
      base: new THREE.Color(spec.color),
      gain: hero ? 2.4 : distant ? 1.35 : 1.7,
      tight: hero ? 0.72 : 0.88,
      distance: hero ? 26 : distant ? 11 : 16,
      intensity: hero ? 22 : distant ? 8 : 13,
      mats: [glowMat, coreMat],
      emNight: hero ? 3.1 : distant ? 6.2 : 4.4,
      emDay: 1.35,
      coreNight: distant ? 16 : hero ? 10 : 12,
    };
    lanterns.push(record);

    const placeModel = (template) => {
      if (!lanterns.includes(record)) return;
      const model = template.clone(true);
      const color = new THREE.Color(spec.color);
      model.traverse((obj) => {
        if (!obj.isMesh || !obj.material) return;
        if (obj.material.name !== 'Lantern_01_glass' && obj.name !== 'Lantern_01_glass') return;
        const mat = new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: hero ? 2.8 : 3.6,
          transparent: true,
          opacity: 0.7,
          roughness: 0.16,
          metalness: 0,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        mat.userData.dispose = true;
        obj.material = mat;
        record.mats.unshift(mat);
      });
      const targetH = hero ? 1.05 : 0.46 + spec.scale * 0.28;
      model.scale.setScalar(targetH / 0.294);
      model.position.set(0, -targetH, 0);
      const hook = new THREE.Group();
      hook.position.set(hang, poleH - 0.02, 0);
      hook.add(model);
      g.attach(core);
      g.add(hook);
      housing.visible = false;
    };
    if (lanternTemplate) placeModel(lanternTemplate);
    else lanternQueue.push(placeModel);
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

    const puffs = [];
    const spheres = [];
    const woods = [];
    for (const side of [-1, 1]) {
      const n = 5;
      for (let i = 0; i < n; i++) {
        const z = (i + 0.08 + rng() * 0.35) * (CHUNK / n);
        const x = side * (6.7 + rng() * 1.15);
        addTree(x, z, side, rng, index, puffs, spheres, woods);
      }
    }

    for (let i = 0; i < 380; i++) {
      const side = rng() < 0.5 ? -1 : 1;
      const z = rng() * CHUNK;
      const overhead = rng() > 0.42;
      const x = overhead ? (rng() - 0.5) * 12.4 : side * (2.8 + rng() * 4.6);
      const span = 1 - Math.min(1, Math.abs(x) / 6.4);
      const y = overhead ? 2.6 + span * 4.6 + rng() * 1.5 : 1.15 + rng() * 4.4;
      const scale = rng() > 0.76 ? 0.75 + rng() * 1.25 : 0.14 + rng() * 0.55;
      const hot = scale < 0.28 && rng() > 0.5;
      puffs.push({
        pos: new THREE.Vector3(x, y, z),
        scale,
        color: blossomHex(side, rng, index, hot),
      });
      if (rng() > 0.62) {
        const speck = blossomHex(x < 0 ? -1 : 1, rng, index, true);
        spheres.push({
          pos: new THREE.Vector3(x + (rng() - 0.5) * 0.35, y + (rng() - 0.5) * 0.25, z + (rng() - 0.5) * 0.35),
          scale: 0.02 + rng() * 0.045,
          color: speck,
        });
      }
    }

    if (woods.length) {
      const merged = mergeGeometries(woods, false);
      woods.forEach((g) => g.dispose());
      const trunks = new THREE.Mesh(merged, trunkMat);
      trunks.userData.uniqueGeo = true;
      root.add(trunks);
    }

    const puffMesh = makeInstances(puffGeoBase, puffMat, puffs, true);
    puffMesh.renderOrder = 2;
    const sphereMesh = makeInstances(sphereGeo, sphereMat, spheres, false);
    root.add(puffMesh, sphereMesh);

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
    puffMat.uniforms.uTime.value = time;
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
      tmp.copy(L.base).lerp(warm, day * 0.4);
      const em = THREE.MathUtils.lerp(L.emNight, L.emDay, day);
      const coreEm = THREE.MathUtils.lerp(L.coreNight || em * 2.2, L.emDay * 1.4, day);
      const coreTint = tmp.clone().lerp(warm, 0.35);
      for (let i = 0; i < L.mats.length; i++) {
        const m = L.mats[i];
        const isCore = i === L.mats.length - 1;
        m.color.copy(isCore ? coreTint : tmp);
        m.emissive.copy(isCore ? coreTint : tmp);
        m.emissiveIntensity = isCore ? coreEm : em;
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
