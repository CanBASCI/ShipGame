import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const MAX_SPEED = 2.15;
const OAR_INTERVAL = 0.62;
const WATER_DRAG = 0.4;
const CRUISE_ACCEL = MAX_SPEED * WATER_DRAG;
const BRAKE_DRAG = 2.5;
const TURN_RATE = 0.28;
const TURN_EASE = 2.1;
const BANK = 4.72;
// The canal is a straight run on +Z, so downstream is world yaw 0.
// A bend would return that stretch's heading instead of this constant.
const DOWNSTREAM_YAW = 0;
const YAW_LIMIT = Math.PI / 2;
// Keel of the loaded hull is local y=-0.12. Sit it on the water so the
// open interior stays dry and the outside still meets the surface.
const KEEL_RAISE = 0.124;
// One scale against the model's original beam. Length and height stay 1.
const BEAM_NARROW = 0.75;
// Nudge the hull forward of the follow point. The camera distance and height stay put.
const FRAME_AHEAD = 0.22;
// Small extra dip of the existing blades toward the water. Does not lengthen them.
const BLADE_DROP = 0.07;

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function wrapPi(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function downstreamYaw() {
  return DOWNSTREAM_YAW;
}

function headingFrom(yaw) {
  return wrapPi(yaw - downstreamYaw());
}

function easeToward(current, target, dt) {
  const ease = 1 - Math.exp(-TURN_EASE * dt);
  return current + (target - current) * ease;
}

function loadTex(url, colorSpace) {
  const tex = new THREE.TextureLoader().load(url);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = colorSpace;
  tex.anisotropy = 8;
  return tex;
}

function waterY(x, z, time) {
  return (
    Math.sin(x * 0.72 + z * 0.28 + time * 0.48) * 0.03 +
    Math.sin(x * 1.55 - z * 1.05 + time * 0.72) * 0.014
  );
}

function makeOarPivot(lock, bladeLocal) {
  const pivot = new THREE.Group();
  pivot.position.copy(lock);
  const blade = new THREE.Object3D();
  blade.position.copy(bladeLocal);
  pivot.add(blade);
  pivot.userData.blade = blade;
  return pivot;
}

const LAMP_SCALE = 0.85;
// Stem top on the bow centerline. The mesh origin is the foot.
const LAMP_FOOT_Y = 0.337;
const BOW_LAMP = new THREE.Vector3(0, LAMP_FOOT_Y + 0.0955 * LAMP_SCALE, 1.72);

function makeLantern() {
  const g = new THREE.Group();
  const light = new THREE.PointLight(0xffb45a, 18, 12, 2);
  light.position.copy(BOW_LAMP);
  g.add(light);
  return { group: g, glowMats: [], light, localPos: BOW_LAMP.clone() };
}

export function createBoat() {
  const group = new THREE.Group();
  group.rotation.order = 'YXZ';
  const woodDiff = loadTex('/assets/wood/weathered_planks_diff_1k.jpg', THREE.SRGBColorSpace);
  const woodNor = loadTex('/assets/wood/weathered_planks_nor_gl_1k.jpg', THREE.LinearSRGBColorSpace);
  const woodRough = loadTex('/assets/wood/weathered_planks_rough_1k.jpg', THREE.LinearSRGBColorSpace);
  const plankMaps = { map: woodDiff, normalMap: woodNor, roughnessMap: woodRough };
  const hullMat = new THREE.MeshStandardMaterial({
    ...plankMaps,
    color: 0xffffff,
    emissive: 0xffe6c4,
    emissiveMap: woodDiff,
    emissiveIntensity: 0.42,
    roughness: 0.86,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });
  const body = new THREE.Group();
  body.position.z = FRAME_AHEAD;
  group.add(body);

  // Locks sit on the gunwale of the loaded hull. Blades are markers for splash height.
  const oarL = makeOarPivot(
    new THREE.Vector3(-0.793 * BEAM_NARROW, 0.465, 0.053),
    new THREE.Vector3(-1.113, -0.362, -0.136),
  );
  const oarR = makeOarPivot(
    new THREE.Vector3(0.812 * BEAM_NARROW, 0.475, 0.057),
    new THREE.Vector3(1.144, -0.372, -0.14),
  );
  body.add(oarL, oarR);

  const lantern = makeLantern();
  body.add(lantern.group);
  const lampLoader = new GLTFLoader();
  lampLoader.load('/assets/lantern/Lantern_01_1k.gltf', (gltf) => {
    const model = gltf.scene;
    model.scale.setScalar(LAMP_SCALE);
    model.position.set(BOW_LAMP.x, LAMP_FOOT_Y, BOW_LAMP.z);
    model.traverse((obj) => {
      if (!obj.isMesh || !obj.material) return;
      const glass = obj.name === 'Lantern_01_glass' || obj.material.name === 'Lantern_01_glass';
      if (!glass) return;
      obj.material = obj.material.clone();
      obj.material.emissive = new THREE.Color(0xffb03a);
      obj.material.emissiveIntensity = 2.4;
      lantern.glowMats.push(obj.material);
    });
    lantern.group.add(model);
  });

  const loader = new GLTFLoader();
  loader.load('/assets/boat/rowboat.glb', (gltf) => {
    gltf.scene.traverse((obj) => {
      if (obj.isMesh) obj.material = hullMat;
    });
    const hull = gltf.scene.getObjectByName('Hull');
    const leftOar = gltf.scene.getObjectByName('OarL');
    const rightOar = gltf.scene.getObjectByName('OarR');
    if (hull) {
      hull.scale.set(BEAM_NARROW, 1, 1);
      body.add(hull);
    }
    if (leftOar) oarL.add(leftOar);
    if (rightOar) oarR.add(rightOar);
  });

  const state = {
    x: 0,
    z: 0,
    yaw: 0,
    speed: 0,
    yawRate: 0,
  };
  const cooldown = { left: 0, right: 0 };
  const strokeT = { left: -1, right: -1 };

  let sequenceSide = 'left';
  let sequenceWait = 0;
  let braking = false;

  function beginStroke(side) {
    strokeT[side] = 0;
    cooldown[side] = OAR_INTERVAL;
  }

  function tryStroke(side) {
    if (cooldown[side] > 0) return false;
    beginStroke(side);
    return true;
  }

  function poseOar(pivot, side, time) {
    const sign = side === 'left' ? -1 : 1;
    const t = strokeT[side];
    let sweep = 0;
    let lift = 0;
    if (braking) {
      sweep = 0.12;
      lift = -0.42;
    } else if (t >= 0) {
      const p = t / OAR_INTERVAL;
      if (p < 0.62) {
        const u = p / 0.62;
        const e = u * u * (3 - 2 * u);
        // Reach forward, blade clear of the water.
        sweep = THREE.MathUtils.lerp(0.34, -0.46, e);
        lift = 0.02;
      } else {
        const u = (p - 0.62) / 0.38;
        // Draw back through the water, bow toward stern.
        sweep = THREE.MathUtils.lerp(-0.46, 0.34, u);
        lift = Math.sin(u * Math.PI) * -0.28;
      }
    } else {
      sweep = Math.sin(time * 0.7 + sign) * 0.02;
      lift = Math.sin(time * 0.5) * 0.012;
    }
    pivot.rotation.y = sign * sweep;
    // Brake keeps its own dip. Otherwise the blades sit a little closer to the water.
    pivot.rotation.z = sign * (lift - (braking ? 0 : BLADE_DROP));
  }

  function update(dt, time, input) {
    braking = !!input.brake;
    sequenceWait = Math.max(0, sequenceWait - dt);

    for (const side of ['left', 'right']) {
      cooldown[side] = Math.max(0, cooldown[side] - dt);
      if (strokeT[side] >= 0) {
        strokeT[side] += dt;
        if (strokeT[side] > OAR_INTERVAL) strokeT[side] = -1;
      }
    }

    if (braking) {
      strokeT.left = -1;
      strokeT.right = -1;
    } else if (sequenceWait <= 0) {
      const turnLeft = !!input.turnLeft;
      const turnRight = !!input.turnRight;
      let side = null;
      // +X is the player's left from the camera behind the boat, so the mesh
      // named "right" sits on the left of the screen.
      if (turnLeft && !turnRight) side = 'left';
      else if (turnRight && !turnLeft) side = 'right';
      else if (input.forward) side = sequenceSide;
      if (side) {
        beginStroke(side);
        sequenceWait = OAR_INTERVAL;
        if (input.forward && turnLeft === turnRight) {
          sequenceSide = side === 'left' ? 'right' : 'left';
        }
      }
    }

    if (input.forward && !braking) state.speed += CRUISE_ACCEL * dt;
    const drag = braking ? BRAKE_DRAG : WATER_DRAG;
    state.speed *= Math.exp(-drag * dt);
    state.speed = clamp(state.speed, 0, MAX_SPEED);
    if (state.speed < 0.01 && (braking || !input.forward)) state.speed = 0;

    let turn = 0;
    if (!braking) {
      if (input.turnLeft && !input.turnRight) turn = 1;
      else if (input.turnRight && !input.turnLeft) turn = -1;
    }
    // The window is fixed on downstream, not on wherever the bow is now.
    const heading = headingFrom(state.yaw);
    if (heading >= YAW_LIMIT && turn > 0) turn = 0;
    if (heading <= -YAW_LIMIT && turn < 0) turn = 0;
    state.yawRate = easeToward(state.yawRate, turn * TURN_RATE, dt);

    const step = state.yawRate * dt;
    const next = heading + step;
    if (heading > YAW_LIMIT || heading < -YAW_LIMIT) {
      const edge = heading > 0 ? YAW_LIMIT : -YAW_LIMIT;
      const ease = 1 - Math.exp(-TURN_EASE * dt);
      state.yaw += (edge - heading) * ease;
      state.yawRate = easeToward(state.yawRate, 0, dt);
    } else if (next > YAW_LIMIT || next < -YAW_LIMIT) {
      const edge = next > 0 ? YAW_LIMIT : -YAW_LIMIT;
      state.yaw += edge - heading;
      state.yawRate = easeToward(state.yawRate, 0, dt);
    } else {
      state.yaw += step;
    }
    state.x += Math.sin(state.yaw) * state.speed * dt;
    state.z += Math.cos(state.yaw) * state.speed * dt;

    if (Math.abs(state.x) > BANK) {
      const sign = Math.sign(state.x);
      state.x = sign * BANK;
      const fwdX = Math.sin(state.yaw);
      const fwdZ = Math.cos(state.yaw);
      const vx = fwdX * state.speed;
      const vz = fwdZ * state.speed;
      const outward = vx * sign;
      if (outward > 0) {
        const svx = vx - sign * outward;
        const svz = vz;
        const sp = Math.hypot(svx, svz);
        const forwardness = svx * fwdX + svz * fwdZ;
        state.speed = forwardness > 0 ? sp : 0;
        const kick = -sign * 0.35 * outward;
        const h = headingFrom(state.yaw);
        const pushesPast = (h >= YAW_LIMIT - 0.02 && kick > 0) || (h <= -YAW_LIMIT + 0.02 && kick < 0);
        if (!pushesPast) state.yawRate += kick;
      }
    }

    const yC = waterY(state.x, state.z, time);
    const fwd = 0.85;
    const yF = waterY(state.x + Math.sin(state.yaw) * fwd, state.z + Math.cos(state.yaw) * fwd, time);
    const yB = waterY(state.x - Math.sin(state.yaw) * fwd, state.z - Math.cos(state.yaw) * fwd, time);
    const side = 0.38;
    const rx = Math.cos(state.yaw);
    const rz = -Math.sin(state.yaw);
    const yR = waterY(state.x + rx * side, state.z + rz * side, time);
    const yL = waterY(state.x - rx * side, state.z - rz * side, time);

    group.position.set(state.x, yC + KEEL_RAISE, state.z);
    group.rotation.y = state.yaw;
    group.rotation.x = -(yF - yB) * 0.55 + Math.sin(time * 0.45) * 0.01;
    group.rotation.z = (yR - yL) * 0.7 + Math.sin(time * 0.33 + 1.0) * 0.012;

    poseOar(oarL, 'left', time);
    poseOar(oarR, 'right', time);

    const flicker = 1 + Math.sin(time * 2.3) * 0.03 + Math.sin(time * 5.1) * 0.015;
    lantern.light.intensity = (9 - input.day * 4) * flicker;
    const glow = (2.4 - input.day * 0.8) * flicker;
    for (const mat of lantern.glowMats) mat.emissiveIntensity = glow;
  }

  const lanternWorld = new THREE.Vector3();
  function lanternPosition() {
    group.updateWorldMatrix(true, false);
    return lantern.group.localToWorld(lanternWorld.copy(lantern.localPos));
  }

  const bladeWorld = new THREE.Vector3();
  function bladeHeight(pivot) {
    pivot.userData.blade.getWorldPosition(bladeWorld);
    return bladeWorld.y;
  }

  function reset() {
    state.x = 0;
    state.z = 0;
    state.yaw = 0;
    state.speed = 0;
    state.yawRate = 0;
    strokeT.left = -1;
    strokeT.right = -1;
    cooldown.left = 0;
    cooldown.right = 0;
    sequenceSide = 'left';
    sequenceWait = 0;
    braking = false;
    group.position.set(0, 0, 0);
    group.rotation.set(0, 0, 0);
  }

  return {
    group,
    state,
    tryStroke,
    update,
    reset,
    lanternPosition,
    lanternColor: new THREE.Color(0xffb45a),
    blades() {
      group.updateWorldMatrix(true, true);
      const point = (pivot) => {
        pivot.userData.blade.getWorldPosition(bladeWorld);
        return bladeWorld.clone();
      };
      return {
        left: bladeHeight(oarL),
        right: bladeHeight(oarR),
        leftPoint: point(oarL),
        rightPoint: point(oarR),
        strokeLeft: strokeT.left,
        strokeRight: strokeT.right,
      };
    },
  };
}
