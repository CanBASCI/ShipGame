import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

// Same three lanes as the Arcade boat. +X is the player's left.
const LANES = [-3.4, 0, 3.4];
const SPAWN_AHEAD = 84;
const FIRST_AHEAD = 22;
const DROP_BEHIND = 16;
const ROW_GAP = 18;
const ROW_JITTER = 10;
const TARGET_HEIGHT = 1.75;
// Hull is about 3.6 m long. A clear lane is 3.4 m away, so this box
// catches the lane the boat is in and misses the open one.
const HIT_X = 1.25;
const HIT_AHEAD = 2.15;
const HIT_BEHIND = 1.25;
// Beyond this distance a ghost keeps the heading it spawned with.
// Inside it, the yaw ease-in onto the bow lantern is slow at first and
// fast near the end, finished by LOOK_DONE, still short of the boat.
const LOOK_FROM = 20;
const LOOK_DONE = 8;
// Same lantern mesh as the boat. It hangs under the ghost's hand.
// Normal-mode bamboo orange from LANTERN_PALETTE.
const HAND_LAMP_SCALE = 0.85;
const HAND_LAMP_COLOR = 0xff7a2a;
// The red the daughter lantern used before it turned orange. Blood's lamp only.
const BLOOD_LAMP_COLOR = 0xff3d6e;
// Opening glass strength, and how strongly that lamp lights the ghost.
const HAND_LAMP_EMISSIVE = 4;
const HAND_LAMP_BODY = 0.2;
// How strongly the cloak spot lights ghost_blood. There is no lantern mesh.
const BLOOD_LAMP_BODY = 0.05;
const GHOST_LAMPS = 16;
const ghostLamp = {
  uPos: { value: Array.from({ length: GHOST_LAMPS }, () => new THREE.Vector3(0, -40, 0)) },
  uCount: { value: 0 },
  uColor: { value: new THREE.Color(HAND_LAMP_COLOR) },
  uStrength: { value: HAND_LAMP_BODY },
};
// Same falloff as the orange lamp, but only ghost_blood's materials read it.
const bloodLamp = {
  uPos: { value: Array.from({ length: GHOST_LAMPS }, () => new THREE.Vector3(0, -40, 0)) },
  uCount: { value: 0 },
  uColor: { value: new THREE.Color(BLOOD_LAMP_COLOR) },
  uStrength: { value: BLOOD_LAMP_BODY },
};
let handPower = HAND_LAMP_EMISSIVE;
// The slide is triggered at 20 m, then plays out in two seconds. It does not
// stretch across the whole approach. Arcade cruise is 6.9 m/s, so the ghost
// is still ahead of the boat when the lane change finishes.
const SLIDE_FROM = 20;
const SLIDE_SECONDS = 2;
// Lantern_01 stands on its foot. Drop the foot by this so the cap meets the
// hand and the body hangs below it, instead of rising off the knuckles.
const HAND_LAMP_MESH_HEIGHT = 0.29425;
const HAND_LAMP_HANG = HAND_LAMP_MESH_HEIGHT * HAND_LAMP_SCALE;
// Slide the cap from the palm socket toward the fingertips, still under the hand.
const HAND_LAMP_REACH = 0.04;
const SLIDE_LEAN = Math.PI / 4;

// Two seconds, split in half. The first second speeds up from the spawn lane
// to the midpoint. The second second slows into the destination. Lean rises
// with the speedup and falls with the slowdown, with zero slope at both ends.
function slideMove(elapsed) {
  const t = Math.min(1, Math.max(0, elapsed / SLIDE_SECONDS));
  const smooth = (u) => u * u * (3 - 2 * u);
  if (t <= 0.5) {
    const u = t * 2;
    const accel = u * u;
    return { progress: 0.5 * accel, lean: smooth(u), done: false };
  }
  const u = (t - 0.5) * 2;
  const decel = 1 - (1 - u) * (1 - u);
  return { progress: 0.5 + 0.5 * decel, lean: smooth(1 - u), done: t >= 1 };
}
const lampUp = new THREE.Vector3(0, 1, 0);
const yawAxis = new THREE.Vector3(0, 1, 0);
const leanAxis = new THREE.Vector3(0, 0, 1);
const yawQuat = new THREE.Quaternion();
const leanQuat = new THREE.Quaternion();
const axisProbe = new THREE.Vector3();
const palmWorld = new THREE.Vector3();
const fingerWorld = new THREE.Vector3();
const fingerStep = new THREE.Vector3();
const bonePos = new THREE.Vector3();
const parentQuat = new THREE.Quaternion();
const uprightQuat = new THREE.Quaternion();

// face: this type uses the daughter's slow look-at. Blood does not.
// Add another entry here when a new obstacle model arrives.
const TYPES = [
  { id: 'ghost_daughter', url: '/assets/obstacles/ghost_daughter/scene.gltf', face: true },
  { id: 'ghost_blood', url: '/assets/obstacles/ghost_blood/scene.gltf', face: false },
  // fitAcross is the widest horizontal side, so the rock stays in one lane.
  { id: 'rock', url: '/assets/obstacles/rock/scene.gltf', face: false, fitAcross: 1.8 },
];

// Shared bow-flashlight term. The real SpotLight is too weak at approach
// range under physical decay, and these materials arrive fully metallic,
// so the cone is added in the obstacle shader only.
const beam = {
  uHeadPos: { value: new THREE.Vector3() },
  uHeadDir: { value: new THREE.Vector3(0, 0, 1) },
  uHead: { value: 0 },
  uHeadSpread: { value: 0.15 },
};

function waterY(x, z, time) {
  return (
    Math.sin(x * 0.72 + z * 0.28 + time * 0.48) * 0.03 +
    Math.sin(x * 1.55 - z * 1.05 + time * 0.72) * 0.014
  );
}

function wrapAngle(rad) {
  return Math.atan2(Math.sin(rad), Math.cos(rad));
}

function chooseLanes(rng) {
  const lanes = [0, 1, 2];
  for (let i = lanes.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const swap = lanes[i];
    lanes[i] = lanes[j];
    lanes[j] = swap;
  }
  const count = rng() < 0.5 ? 1 : 2;
  return lanes.slice(0, count);
}

function pickType(rng) {
  return TYPES[Math.floor(rng() * TYPES.length)];
}

function tuneMaterial(mat, blood) {
  if (!mat || !mat.isMaterial || mat.userData.bowLit) return;
  mat.userData.bowLit = true;
  // Ghost materials omit metalness and arrive fully metal, which stays black.
  // A rock that already has a rough factor keeps its own surface.
  if (mat.metalness > 0.5) {
    mat.metalness = 0;
    mat.roughness = 0.62;
  }
  mat.envMapIntensity = 0;
  mat.depthWrite = true;
  const bloodDecls = blood
    ? `
        uniform vec3 uBloodLampPos[${GHOST_LAMPS}];
        uniform float uBloodLampN;
        uniform vec3 uBloodLampColor;
        uniform float uBloodLamp;`
    : '';
  const bloodLoop = blood
    ? `
        for (int j = 0; j < ${GHOST_LAMPS}; j++) {
          float liveB = step(float(j) + 0.5, uBloodLampN);
          vec3 toBlood = vBowWorld - uBloodLampPos[j];
          float distB = length(toBlood);
          float windowB = clamp(1.0 - distB * 0.59, 0.0, 1.0);
          windowB *= windowB;
          float attB = windowB / max(distB * distB, 0.045);
          outgoingLight += diffuseColor.rgb * uBloodLampColor * attB * uBloodLamp * liveB;
        }`
    : '';
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uHeadPos = beam.uHeadPos;
    shader.uniforms.uHeadDir = beam.uHeadDir;
    shader.uniforms.uHead = beam.uHead;
    shader.uniforms.uHeadSpread = beam.uHeadSpread;
    shader.uniforms.uGhostLampPos = ghostLamp.uPos;
    shader.uniforms.uGhostLampN = ghostLamp.uCount;
    shader.uniforms.uGhostLampColor = ghostLamp.uColor;
    shader.uniforms.uGhostLamp = ghostLamp.uStrength;
    if (blood) {
      shader.uniforms.uBloodLampPos = bloodLamp.uPos;
      shader.uniforms.uBloodLampN = bloodLamp.uCount;
      shader.uniforms.uBloodLampColor = bloodLamp.uColor;
      shader.uniforms.uBloodLamp = bloodLamp.uStrength;
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBowWorld;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vBowWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uHeadPos;
        uniform vec3 uHeadDir;
        uniform float uHead;
        uniform float uHeadSpread;
        uniform vec3 uGhostLampPos[${GHOST_LAMPS}];
        uniform float uGhostLampN;
        uniform vec3 uGhostLampColor;
        uniform float uGhostLamp;
        ${bloodDecls}
        varying vec3 vBowWorld;`,
      )
      .replace(
        '#include <opaque_fragment>',
        `vec3 toHead = vBowWorld - uHeadPos;
        float headAhead = dot(toHead, uHeadDir);
        vec3 headSide = toHead - uHeadDir * headAhead;
        float headRadius = 0.12 + max(headAhead, 0.0) * uHeadSpread;
        float headCone = exp(-pow(length(headSide) / max(headRadius, 0.08), 2.0));
        headCone *= step(0.0, headAhead);
        float headFall = 1.0 / (1.0 + headAhead * headAhead * 0.0032);
        outgoingLight += diffuseColor.rgb * vec3(1.0, 0.82, 0.55) * headCone * headFall * uHead * 2.6;
        for (int i = 0; i < ${GHOST_LAMPS}; i++) {
          float live = step(float(i) + 0.5, uGhostLampN);
          vec3 toLamp = vBowWorld - uGhostLampPos[i];
          float distL = length(toLamp);
          float windowL = clamp(1.0 - distL * 0.59, 0.0, 1.0);
          windowL *= windowL;
          float attL = windowL / max(distL * distL, 0.045);
          outgoingLight += diffuseColor.rgb * uGhostLampColor * attL * uGhostLamp * live;
        }
        ${bloodLoop}
        #include <opaque_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => (blood ? 'obstacle-bow-beam-ghostlamp-blood' : 'obstacle-bow-beam-ghostlamp');
  mat.needsUpdate = true;
}

// Heading of the face in the model's own XZ plane, measured from +Z toward +X.
// ghost_daughter's jaw and eyes sit on +X. A Sketchfab camera sits in front of
// ghost_blood, so that view direction is the face when there is no jaw bone.
function faceHeading(root) {
  const head = root.getObjectByName('head_jnt_82');
  const jaw = root.getObjectByName('jaw_jnt_85');
  if (head && jaw) {
    const headPos = new THREE.Vector3();
    const jawPos = new THREE.Vector3();
    head.getWorldPosition(headPos);
    jaw.getWorldPosition(jawPos);
    return Math.atan2(jawPos.x - headPos.x, jawPos.z - headPos.z);
  }
  const cam = root.getObjectByName('Camera');
  if (!cam) return 0;
  const camPos = new THREE.Vector3();
  const center = new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3());
  cam.getWorldPosition(camPos);
  return Math.atan2(camPos.x - center.x, camPos.z - center.z);
}

function tuneObject(root, blood) {
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) tuneMaterial(mat, blood);
  });
}

function lampTint(item) {
  const tint = { light: HAND_LAMP_COLOR, glass: 0, intensity: ghostLamp.uStrength.value, emissive: 0 };
  if (!item || !item.lamp) return tint;
  item.lamp.traverse((obj) => {
    if (!obj.isMesh || !obj.material || Array.isArray(obj.material)) return;
    const glass = obj.name === 'Lantern_01_glass' || obj.material.name === 'Lantern_01_glass';
    if (glass && obj.material.emissive) {
      tint.glass = obj.material.emissive.getHex();
      tint.emissive = obj.material.emissiveIntensity;
    }
  });
  return tint;
}

// The prop socket follows the arm. Hang the lamp straight down from that
// hand point, and cancel the arm tilt so it stays vertical in the world.
function seatHandLamp(item) {
  const parent = item.lamp && item.lamp.parent;
  if (!parent) return;
  parent.updateWorldMatrix(true, false);
  parent.getWorldPosition(palmWorld);
  const tip = item.finger;
  if (tip) {
    tip.updateWorldMatrix(true, false);
    tip.getWorldPosition(fingerWorld);
    fingerStep.subVectors(fingerWorld, palmWorld);
    fingerStep.y = 0;
    const reach = fingerStep.length();
    item.lampReach = reach > 1e-4 ? Math.min(HAND_LAMP_REACH, reach) : 0;
    if (item.lampReach > 0) palmWorld.addScaledVector(fingerStep, item.lampReach / reach);
  }
  palmWorld.y -= HAND_LAMP_HANG;
  parent.worldToLocal(palmWorld);
  item.lamp.position.copy(palmWorld);
  parent.getWorldQuaternion(parentQuat);
  uprightQuat.setFromAxisAngle(lampUp, item.group.rotation.y);
  item.lamp.quaternion.copy(parentQuat).invert().multiply(uprightQuat);
}

function lampUpY(item) {
  if (!item.lamp) return 1;
  item.lamp.updateWorldMatrix(true, false);
  item.lamp.getWorldQuaternion(parentQuat);
  bonePos.set(0, 1, 0).applyQuaternion(parentQuat);
  return bonePos.y;
}

function lampHang(item) {
  if (!item.lamp || !item.lamp.parent) return 0;
  item.lamp.parent.getWorldPosition(palmWorld);
  item.lamp.getWorldPosition(bonePos);
  return palmWorld.y - bonePos.y;
}

function paintLampGlass(root, color, power) {
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material || Array.isArray(obj.material)) return;
    const glass = obj.name === 'Lantern_01_glass' || obj.material.name === 'Lantern_01_glass';
    if (!glass) return;
    obj.material = obj.material.clone();
    obj.material.color = new THREE.Color(color);
    obj.material.emissive = new THREE.Color(color);
    obj.material.emissiveIntensity = power;
    obj.material.depthWrite = true;
  });
}

function tintHandLamp(root) {
  paintLampGlass(root, HAND_LAMP_COLOR, handPower);
}

export function createObstacles(scene) {
  const loader = new GLTFLoader();
  const templates = new Map();
  const alive = [];
  const handScale = new THREE.Vector3();
  let handLamp = null;
  let arcadeOn = false;
  let nextZ = null;
  let rng = Math.random;

  function attachHandLamp(item) {
    if (!handLamp || item.type !== 'ghost_daughter' || item.lamp) return;
    const hand = item.model.getObjectByName('r_arm_prop_env_37')
      || item.model.getObjectByName('r_arm_wrist_jnt_17');
    if (!hand) return;
    item.group.updateWorldMatrix(true, true);
    hand.getWorldScale(handScale);
    const holder = new THREE.Group();
    holder.add(handLamp.clone(true));
    holder.scale.setScalar(HAND_LAMP_SCALE / Math.max(Math.abs(handScale.x), 1e-4));
    hand.add(holder);
    item.lamp = holder;
    item.finger = item.model.getObjectByName('r_arm_fingerMiddleD_jnt_28')
      || item.model.getObjectByName('r_arm_fingerIndexD_jnt_24');
    item.lampWorld = holder.scale.x * Math.abs(handScale.x);
    seatHandLamp(item);
  }

  function cloakBox(item) {
    item.group.updateWorldMatrix(true, true);
    const inv = item.group.matrixWorld.clone().invert();
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    item.model.traverse((obj) => {
      if (!obj.isMesh || !obj.geometry || !obj.geometry.attributes.position) return;
      const pos = obj.geometry.attributes.position;
      for (let i = 0; i < pos.count; i += 1) {
        v.fromBufferAttribute(pos, i).applyMatrix4(obj.matrixWorld).applyMatrix4(inv);
        box.expandByPoint(v);
      }
    });
    return box;
  }

  function placeBloodGlow(item) {
    if (item.type !== 'ghost_blood' || item.glowLocal) return;
    const box = cloakBox(item);
    const size = box.getSize(new THREE.Vector3());
    if (size.y < 0.2) return;
    // Same interior point the cloak lantern used, without a mesh or a light object.
    const fit = Math.min(
      HAND_LAMP_SCALE,
      (size.y * 0.34) / HAND_LAMP_MESH_HEIGHT,
      (Math.min(size.x, size.z) * 0.42) / 0.16,
    );
    const hang = HAND_LAMP_MESH_HEIGHT * Math.max(0.2, fit);
    const mid = box.getCenter(new THREE.Vector3());
    const face = new THREE.Vector3(Math.sin(item.faceYaw), 0, Math.cos(item.faceYaw));
    mid.addScaledVector(face, Math.min(size.x, size.z) * 0.12);
    mid.y = box.min.y + size.y * 0.46 - hang * 0.5;
    const padX = Math.min(0.06, size.x * 0.15);
    const padZ = Math.min(0.06, size.z * 0.15);
    mid.x = Math.min(box.max.x - padX, Math.max(box.min.x + padX, mid.x));
    mid.z = Math.min(box.max.z - padZ, Math.max(box.min.z + padZ, mid.z));
    mid.y = Math.min(box.max.y - hang - 0.02, Math.max(box.min.y + 0.02, mid.y));
    item.glowLocal = mid;
  }

  function publishGhostLamps() {
    let orange = 0;
    let red = 0;
    for (const item of alive) {
      if (item.type === 'ghost_blood') {
        if (!item.glowLocal || red >= GHOST_LAMPS) continue;
        const spot = bloodLamp.uPos.value[red];
        item.group.updateWorldMatrix(true, true);
        spot.copy(item.glowLocal);
        item.group.localToWorld(spot);
        // Same glass-height offset the cloak lantern's reflection used.
        spot.y += 0.081;
        red += 1;
        continue;
      }
      if (!item.lamp || orange >= GHOST_LAMPS) continue;
      item.lamp.updateWorldMatrix(true, true);
      const spot = ghostLamp.uPos.value[orange];
      item.lamp.getWorldPosition(spot);
      // World metres up into the glass. The holder's local scale cancels the
      // bone scale, so this must not be multiplied by that local scale.
      spot.y += 0.081;
      orange += 1;
    }
    ghostLamp.uCount.value = orange;
    bloodLamp.uCount.value = red;
  }

  function setGlassPower(root, power) {
    if (!root) return;
    root.traverse((obj) => {
      if (!obj.isMesh || !obj.material || Array.isArray(obj.material)) return;
      const glass = obj.name === 'Lantern_01_glass' || obj.material.name === 'Lantern_01_glass';
      if (glass) obj.material.emissiveIntensity = power;
    });
  }

  function setHandTune(power, strength, nextBloodLit) {
    handPower = Number.isFinite(power) ? power : handPower;
    if (Number.isFinite(strength)) ghostLamp.uStrength.value = strength;
    if (Number.isFinite(nextBloodLit)) bloodLamp.uStrength.value = nextBloodLit;
    setGlassPower(handLamp, handPower);
  }

  loader.load('/assets/lantern/Lantern_01_1k.gltf', (gltf) => {
    handLamp = gltf.scene;
    tintHandLamp(handLamp);
    for (const item of alive) attachHandLamp(item);
  });

  for (const type of TYPES) {
    loader.load(
      type.url,
      (gltf) => {
        const root = gltf.scene;
        root.updateWorldMatrix(true, true);
        const box = new THREE.Box3().setFromObject(root);
        const size = box.getSize(new THREE.Vector3());
        const height = Math.max(0.001, size.y);
        const across = Math.max(size.x, size.z, 0.001);
        tuneObject(root, type.id === 'ghost_blood');
        const scale = type.fitAcross ? type.fitAcross / across : TARGET_HEIGHT / height;
        templates.set(type.id, {
          scene: root,
          scale,
          foot: box.min.y,
          clips: gltf.animations || [],
          faceYaw: faceHeading(root),
          worldHeight: height * scale,
          worldAcross: across * scale,
        });
      },
      undefined,
      (err) => console.error(err),
    );
  }

  function drop(item) {
    if (item.mixer) {
      item.mixer.stopAllAction();
      item.mixer.uncacheRoot(item.model);
    }
    scene.remove(item.group);
  }

  function clear() {
    for (const item of alive) drop(item);
    alive.length = 0;
    nextZ = null;
  }

  function spawnRow(z) {
    const lanes = chooseLanes(rng);
    const made = [];
    let spawned = 0;
    for (const lane of lanes) {
      const type = pickType(rng);
      const template = templates.get(type.id);
      if (!template) continue;
      const group = new THREE.Group();
      const model = cloneSkeleton(template.scene);
      model.scale.setScalar(template.scale);
      model.position.y = -template.foot * template.scale;
      model.traverse((obj) => {
        obj.frustumCulled = false;
      });
      group.add(model);
      group.position.set(LANES[lane], 0, z);
      scene.add(group);
      let mixer = null;
      if (template.clips.length && type.face) {
        mixer = new THREE.AnimationMixer(model);
        for (const clip of template.clips) {
          const action = mixer.clipAction(clip);
          action.setLoop(THREE.LoopRepeat, Infinity);
          action.play();
        }
      }
      const spawnYaw = rng() * Math.PI * 2;
      group.rotation.y = spawnYaw;
      const item = {
        group,
        model,
        mixer,
        lane,
        z,
        foot: -template.foot * template.scale,
        face: !!type.face,
        faceYaw: template.faceYaw,
        spawnYaw,
        worldHeight: template.worldHeight,
        worldAcross: template.worldAcross,
        type: type.id,
        lamp: null,
      };
      alive.push(item);
      made.push(item);
      spawned += 1;
    }
    const occupied = new Set(made.map((item) => item.lane));
    for (const item of made) {
      if (item.type !== 'ghost_blood') continue;
      // About half stay in the lane they spawned in. The roll is fixed for that ghost.
      if (rng() >= 0.5) {
        item.slideLane = item.lane;
        continue;
      }
      const open = [];
      for (let i = 0; i < LANES.length; i += 1) {
        if (occupied.has(i)) continue;
        const blocked = alive.some((other) => other !== item
          && other.lane === i
          && Math.abs(other.z - item.z) < SLIDE_FROM);
        if (!blocked) open.push(i);
      }
      if (!open.length) item.slideLane = item.lane;
      else {
        item.slideLane = open[Math.floor(rng() * open.length)];
        occupied.add(item.slideLane);
      }
    }
    for (const item of made) {
      if (item.type === 'ghost_daughter') attachHandLamp(item);
      if (item.type === 'ghost_blood') placeBloodGlow(item);
    }
    return spawned > 0;
  }

  function fill(boatZ) {
    if (!arcadeOn || templates.size < TYPES.length) return;
    if (nextZ == null) nextZ = boatZ + FIRST_AHEAD;
    let guard = 0;
    while (nextZ < boatZ + SPAWN_AHEAD && guard < 16) {
      if (!spawnRow(nextZ)) break;
      nextZ += ROW_GAP + rng() * ROW_JITTER;
      guard += 1;
    }
  }

  function overlaps(boatPos, item) {
    const dx = Math.abs(boatPos.x - item.group.position.x);
    const dz = item.z - boatPos.z;
    return dx < HIT_X && dz < HIT_AHEAD && dz > -HIT_BEHIND;
  }

  return {
    setArcade(on) {
      arcadeOn = !!on;
      clear();
    },
    setBeam(pos, dir, amount, spread) {
      beam.uHeadPos.value.copy(pos);
      beam.uHeadDir.value.copy(dir);
      beam.uHead.value = amount;
      beam.uHeadSpread.value = spread;
    },
    update(boatPos, time, dt, bow) {
      if (!arcadeOn) {
        if (alive.length) clear();
        ghostLamp.uCount.value = 0;
        bloodLamp.uCount.value = 0;
        return false;
      }
      fill(boatPos.z);
      const step = Math.min(0.05, Math.max(0, dt || 0));
      let hit = false;
      for (let i = alive.length - 1; i >= 0; i -= 1) {
        const item = alive[i];
        if (item.z < boatPos.z - DROP_BEHIND) {
          drop(item);
          alive.splice(i, 1);
          continue;
        }
        if (item.mixer) item.mixer.update(step);
        // The clip moves bones only. Yaw stays on the parent. About half of the
        // blood ghosts slide sideways over the last 20 m; the rest keep their lane.
        item.model.position.set(0, item.foot, 0);
        item.model.rotation.set(0, 0, 0);
        const alongNow = item.z - boatPos.z;
        let x = LANES[item.lane];
        const willSlide = item.type === 'ghost_blood'
          && item.slideLane != null
          && item.slideLane !== item.lane;
        if (willSlide && alongNow < SLIDE_FROM && item.slideElapsed == null) item.slideElapsed = 0;
        if (item.slideElapsed != null && item.slideElapsed < SLIDE_SECONDS) {
          item.slideElapsed = Math.min(SLIDE_SECONDS, item.slideElapsed + step);
        }
        const move = item.slideElapsed != null ? slideMove(item.slideElapsed) : null;
        if (move && move.progress > 0) {
          x += (LANES[item.slideLane] - x) * move.progress;
        }
        item.group.position.set(x, waterY(x, item.z, time), item.z);
        if (item.type === 'ghost_blood') {
          // Stayers keep the heading they spawned with and stay upright.
          // A slider faces the empty lane at 20 m. Over the next 2 seconds it
          // leans as it speeds up, stands up as it slows in, then tracks the bow.
          let yaw = item.spawnYaw;
          let lean = 0;
          if (willSlide && item.slideElapsed != null) {
            const arrived = item.slideElapsed >= SLIDE_SECONDS;
            if (arrived && bow) {
              const dx = bow.x - item.group.position.x;
              const dz = bow.z - item.group.position.z;
              if (dx * dx + dz * dz > 1e-6) yaw = Math.atan2(dx, dz) - item.faceYaw;
            } else if (!arrived) {
              const dir = Math.sign(LANES[item.slideLane] - LANES[item.lane]) || 1;
              yaw = dir * (Math.PI / 2) - item.faceYaw;
              lean = -dir * SLIDE_LEAN * move.lean;
            }
          }
          yawQuat.setFromAxisAngle(yawAxis, yaw);
          leanQuat.setFromAxisAngle(leanAxis, lean);
          item.group.quaternion.copy(leanQuat).multiply(yawQuat);
        } else if (item.face && bow) {
          const along = item.z - boatPos.z;
          const dx = bow.x - item.group.position.x;
          const dz = bow.z - item.group.position.z;
          let yaw = item.spawnYaw;
          if (along < LOOK_FROM && dx * dx + dz * dz > 1e-6) {
            const target = Math.atan2(dx, dz) - item.faceYaw;
            if (along <= LOOK_DONE) yaw = target;
            else {
              const t = (LOOK_FROM - along) / (LOOK_FROM - LOOK_DONE);
              const s = t * t;
              yaw = item.spawnYaw + wrapAngle(target - item.spawnYaw) * s;
            }
          }
          item.group.rotation.y = yaw;
        }
        if (item.lamp) seatHandLamp(item);
        if (overlaps(boatPos, item)) hit = true;
      }
      publishGhostLamps();
      return hit;
    },
    setHandTune,
    sample() {
      const rows = new Map();
      for (const item of alive) {
        const key = item.z.toFixed(2);
        if (!rows.has(key)) rows.set(key, []);
        rows.get(key).push(item.lane);
      }
      let packed = 0;
      const list = [];
      for (const [z, lanes] of rows) {
        if (lanes.length >= 3) packed += 1;
        list.push({ z: Number(z), lanes: lanes.slice().sort() });
      }
      const first = alive[0];
      const tint = lampTint(alive.find((item) => item.type === 'ghost_daughter' && item.lamp));
      return {
        count: alive.length,
        packed,
        rows: list,
        clips: alive.filter((item) => item.mixer).length,
        animTime: first && first.mixer ? first.mixer.time : 0,
        faceYaw: first ? first.faceYaw : 0,
        handLamps: alive.filter((item) => item.lamp).length,
        ghosts: alive.filter((item) => item.type === 'ghost_daughter').length,
        rocks: alive.filter((item) => item.type === 'rock').length,
        lampWorld: (alive.find((item) => item.lamp) || {}).lampWorld || 0,
        lampColor: tint.light,
        lampGlass: tint.glass,
        lampIntensity: tint.intensity,
        lampEmissive: tint.emissive,
        ghostLamps: ghostLamp.uCount.value,
        ghostStrength: ghostLamp.uStrength.value,
        bloodStrength: bloodLamp.uStrength.value,
        daughterLampNear: alive.filter((item) => item.type === 'ghost_daughter' && item.lamp).every((item) => {
          item.lamp.getWorldPosition(bonePos);
          return bonePos.distanceTo(item.group.position) < 2.2;
        }),
        lampUpY: alive.reduce((min, item) => (item.lamp ? Math.min(min, lampUpY(item)) : min), 1),
        lampHang: alive.reduce((min, item) => (item.lamp && item.type === 'ghost_daughter' ? Math.min(min, lampHang(item)) : min), 1),
        lampReach: alive.reduce((max, item) => (item.lamp && item.type === 'ghost_daughter' ? Math.max(max, item.lampReach || 0) : max), 0),
        bloodLamps: bloodLamp.uCount.value,
        bloodColor: bloodLamp.uColor.value.getHex(),
        bloodMeshes: alive.filter((item) => item.type === 'ghost_blood').reduce((n, item) => {
          item.group.traverse((obj) => {
            if (obj.isMesh && /lantern/i.test(`${obj.name} ${obj.material && obj.material.name || ''}`)) n += 1;
          });
          return n;
        }, 0),
        bloodInCloak: alive.filter((item) => item.type === 'ghost_blood' && item.glowLocal).every((item) => {
          const cloak = cloakBox(item);
          item.group.updateWorldMatrix(true, true);
          bonePos.copy(item.glowLocal);
          item.group.localToWorld(bonePos);
          bonePos.y += 0.081;
          const dist = bonePos.distanceTo(item.group.position);
          item.group.worldToLocal(bonePos);
          return cloak.containsPoint(item.glowLocal) && cloak.containsPoint(bonePos) && dist < 1.6;
        }),
        placed: alive.map((item) => ({
          lane: item.lane,
          x: item.group.position.x,
          z: item.z,
          yaw: item.group.rotation.y,
          spawnYaw: item.spawnYaw,
          faceYaw: item.faceYaw,
          face: item.face,
          hasLamp: !!item.lamp,
          slideLane: item.slideLane == null ? item.lane : item.slideLane,
          slideElapsed: item.slideElapsed == null ? null : item.slideElapsed,
          tilt: (() => {
            axisProbe.set(0, 1, 0).applyQuaternion(item.group.quaternion);
            return Math.atan2(axisProbe.x, axisProbe.y);
          })(),
          heading: (() => {
            axisProbe.set(Math.sin(item.faceYaw), 0, Math.cos(item.faceYaw)).applyQuaternion(item.group.quaternion);
            return Math.atan2(axisProbe.x, axisProbe.z);
          })(),
          type: item.type,
          clip: !!item.mixer,
          worldHeight: item.worldHeight,
          worldAcross: item.worldAcross,
        })),
      };
    },
  };
}
