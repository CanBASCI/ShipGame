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
// Darkest red already in the right-bank lantern set (RIGHT_COLORS).
const HAND_LAMP_SCALE = 0.85;
const HAND_LAMP_COLOR = 0xff3d6e;
// Opening glass strength, and how strongly that lamp lights the ghost.
const HAND_LAMP_EMISSIVE = 4;
const HAND_LAMP_BODY = 0.2;
const GHOST_LAMPS = 16;
const ghostLamp = {
  uPos: { value: Array.from({ length: GHOST_LAMPS }, () => new THREE.Vector3(0, -40, 0)) },
  uCount: { value: 0 },
  uColor: { value: new THREE.Color(HAND_LAMP_COLOR) },
  uStrength: { value: HAND_LAMP_BODY },
};
let handPower = HAND_LAMP_EMISSIVE;
// Lantern_01 stands on its foot. Drop the foot by this so the cap meets the
// hand and the body hangs below it, instead of rising off the knuckles.
const HAND_LAMP_MESH_HEIGHT = 0.29425;
const HAND_LAMP_HANG = HAND_LAMP_MESH_HEIGHT * HAND_LAMP_SCALE;
// Slide the cap from the palm socket toward the fingertips, still under the hand.
const HAND_LAMP_REACH = 0.04;
const lampUp = new THREE.Vector3(0, 1, 0);
const palmWorld = new THREE.Vector3();
const fingerWorld = new THREE.Vector3();
const fingerStep = new THREE.Vector3();
const bonePos = new THREE.Vector3();
const parentQuat = new THREE.Quaternion();
const uprightQuat = new THREE.Quaternion();

// face: this type yaws toward the bow lantern. Later types omit it and stay frozen.
// Add another entry here when a new obstacle model arrives.
const TYPES = [
  { id: 'ghost_daughter', url: '/assets/obstacles/ghost_daughter/scene.gltf', face: true },
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

function tuneMaterial(mat) {
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
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uHeadPos = beam.uHeadPos;
    shader.uniforms.uHeadDir = beam.uHeadDir;
    shader.uniforms.uHead = beam.uHead;
    shader.uniforms.uHeadSpread = beam.uHeadSpread;
    shader.uniforms.uGhostLampPos = ghostLamp.uPos;
    shader.uniforms.uGhostLampN = ghostLamp.uCount;
    shader.uniforms.uGhostLampColor = ghostLamp.uColor;
    shader.uniforms.uGhostLamp = ghostLamp.uStrength;
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
        #include <opaque_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => 'obstacle-bow-beam-ghostlamp';
  mat.needsUpdate = true;
}

// Heading of the face in the model's own XZ plane, measured from +Z toward +X.
// ghost_daughter's jaw and eyes sit on +X, so this is about a right angle.
function faceHeading(root) {
  const head = root.getObjectByName('head_jnt_82');
  const jaw = root.getObjectByName('jaw_jnt_85');
  if (!head || !jaw) return Math.PI / 2;
  const headPos = new THREE.Vector3();
  const jawPos = new THREE.Vector3();
  head.getWorldPosition(headPos);
  jaw.getWorldPosition(jawPos);
  return Math.atan2(jawPos.x - headPos.x, jawPos.z - headPos.z);
}

function tuneObject(root) {
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) tuneMaterial(mat);
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

function tintHandLamp(root) {
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const glass = obj.name === 'Lantern_01_glass' || obj.material.name === 'Lantern_01_glass';
    if (!glass) return;
    obj.material = obj.material.clone();
    obj.material.color = new THREE.Color(HAND_LAMP_COLOR);
    obj.material.emissive = new THREE.Color(HAND_LAMP_COLOR);
    obj.material.emissiveIntensity = handPower;
    obj.material.depthWrite = true;
  });
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

  function publishGhostLamps() {
    let n = 0;
    for (const item of alive) {
      if (!item.lamp || n >= GHOST_LAMPS) continue;
      item.lamp.updateWorldMatrix(true, true);
      const spot = ghostLamp.uPos.value[n];
      item.lamp.getWorldPosition(spot);
      spot.y += 0.081;
      n += 1;
    }
    ghostLamp.uCount.value = n;
  }

  function setHandTune(power, strength) {
    handPower = Number.isFinite(power) ? power : handPower;
    ghostLamp.uStrength.value = Number.isFinite(strength) ? strength : ghostLamp.uStrength.value;
    if (!handLamp) return;
    handLamp.traverse((obj) => {
      if (!obj.isMesh || !obj.material || Array.isArray(obj.material)) return;
      const glass = obj.name === 'Lantern_01_glass' || obj.material.name === 'Lantern_01_glass';
      if (glass) obj.material.emissiveIntensity = handPower;
    });
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
        tuneObject(root);
        templates.set(type.id, {
          scene: root,
          scale: type.fitAcross ? type.fitAcross / across : TARGET_HEIGHT / height,
          foot: box.min.y,
          clips: gltf.animations || [],
          faceYaw: faceHeading(root),
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
        type: type.id,
        lamp: null,
      };
      alive.push(item);
      if (type.id === 'ghost_daughter') attachHandLamp(item);
      spawned += 1;
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
    const dx = Math.abs(boatPos.x - LANES[item.lane]);
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
        // The clip moves bones only. Lane position and yaw stay on the parent.
        item.model.position.set(0, item.foot, 0);
        item.model.rotation.set(0, 0, 0);
        item.group.position.set(LANES[item.lane], waterY(LANES[item.lane], item.z, time), item.z);
        if (item.face && bow) {
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
      const tint = lampTint(alive.find((item) => item.lamp));
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
        lampUpY: alive.reduce((min, item) => (item.lamp ? Math.min(min, lampUpY(item)) : min), 1),
        lampHang: alive.reduce((min, item) => (item.lamp ? Math.min(min, lampHang(item)) : min), 1),
        lampReach: alive.reduce((max, item) => (item.lamp ? Math.max(max, item.lampReach || 0) : max), 0),
        placed: alive.map((item) => ({
          lane: item.lane,
          x: item.group.position.x,
          z: item.z,
          yaw: item.group.rotation.y,
          spawnYaw: item.spawnYaw,
          faceYaw: item.faceYaw,
          face: item.face,
          hasLamp: !!item.lamp,
          type: item.type,
        })),
      };
    },
  };
}
