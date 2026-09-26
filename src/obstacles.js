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

// face: this type yaws toward the bow lantern. Later types omit it and stay frozen.
// Add another entry here when a new obstacle model arrives.
const TYPES = [
  { id: 'ghost_daughter', url: '/assets/obstacles/ghost_daughter/scene.gltf', face: true },
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
  mat.metalness = 0;
  mat.roughness = 0.62;
  mat.envMapIntensity = 0;
  mat.depthWrite = true;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uHeadPos = beam.uHeadPos;
    shader.uniforms.uHeadDir = beam.uHeadDir;
    shader.uniforms.uHead = beam.uHead;
    shader.uniforms.uHeadSpread = beam.uHeadSpread;
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
        #include <opaque_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => 'obstacle-bow-beam';
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

export function createObstacles(scene) {
  const loader = new GLTFLoader();
  const templates = new Map();
  const alive = [];
  let arcadeOn = false;
  let nextZ = null;
  let rng = Math.random;

  for (const type of TYPES) {
    loader.load(
      type.url,
      (gltf) => {
        const root = gltf.scene;
        root.updateWorldMatrix(true, true);
        const box = new THREE.Box3().setFromObject(root);
        const height = Math.max(0.001, box.max.y - box.min.y);
        tuneObject(root);
        templates.set(type.id, {
          scene: root,
          scale: TARGET_HEIGHT / height,
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
    const type = pickType(rng);
    const template = templates.get(type.id);
    if (!template) return false;
    const lanes = chooseLanes(rng);
    for (const lane of lanes) {
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
      if (template.clips.length) {
        mixer = new THREE.AnimationMixer(model);
        for (const clip of template.clips) {
          const action = mixer.clipAction(clip);
          action.setLoop(THREE.LoopRepeat, Infinity);
          action.play();
        }
      }
      const spawnYaw = rng() * Math.PI * 2;
      group.rotation.y = spawnYaw;
      alive.push({
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
      });
    }
    return true;
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
        if (overlaps(boatPos, item)) hit = true;
      }
      return hit;
    },
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
      return {
        count: alive.length,
        packed,
        rows: list,
        clips: alive.filter((item) => item.mixer).length,
        animTime: first && first.mixer ? first.mixer.time : 0,
        faceYaw: first ? first.faceYaw : 0,
        placed: alive.map((item) => ({
          lane: item.lane,
          x: item.group.position.x,
          z: item.z,
          yaw: item.group.rotation.y,
          spawnYaw: item.spawnYaw,
          type: item.type,
        })),
      };
    },
  };
}
