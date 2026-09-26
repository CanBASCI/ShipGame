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
// Arcade keeps the hull inside the canal. +X is the player's left.
// Side lanes sit in toward the water edges. The middle lane stays on center.
const ARCADE_CRUISE = 1.15 * 3;
const LANE_OFFSET = 3.4;
const LANES = [-LANE_OFFSET, 0, LANE_OFFSET];
// Same slide as before the bow swing. The yaw and heel play inside that crossing.
const LANE_EASE = 7;
const ARCADE_YAW_PEAK = 0.36;
const ARCADE_HEEL = 0.3;
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

function makeLantern(foot, bright) {
  const g = new THREE.Group();
  const localPos = foot.clone();
  localPos.y += 0.0955 * LAMP_SCALE;
  const light = new THREE.PointLight(0xffb45a, 10.125 * bright, 12, 2);
  light.position.copy(localPos);
  g.add(light);
  return { group: g, glowMats: [], light, localPos, foot: foot.clone(), bright };
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
  const mevcutHull = new THREE.Group();
  mevcutHull.visible = false;
  body.add(mevcutHull);

  // Locks sit on the gunwale of the loaded hull. Blades are markers for splash height.
  const oarL = makeOarPivot(
    new THREE.Vector3(-0.793 * BEAM_NARROW, 0.465, 0.053),
    new THREE.Vector3(-1.113, -0.362, -0.136),
  );
  const oarR = makeOarPivot(
    new THREE.Vector3(0.812 * BEAM_NARROW, 0.475, 0.057),
    new THREE.Vector3(1.144, -0.372, -0.14),
  );
  oarL.visible = false;
  oarR.visible = false;
  body.add(oarL, oarR);

  const lantern = makeLantern(new THREE.Vector3(0, 0.63, 1.7), 1);
  body.add(lantern.group);
  // Rear quarters of the Donnichols gunwale. Same lamp, 75% as bright, no forward beam.
  const sternLamps = [
    makeLantern(new THREE.Vector3(-0.45, 0.525, -1.69), 0.75),
    makeLantern(new THREE.Vector3(0.45, 0.525, -1.69), 0.75),
  ];
  for (const lamp of sternLamps) body.add(lamp.group);
  // Forward beam only. Thin at the bow, wider ahead. Off unless moving forward.
  const headlight = new THREE.SpotLight(0xffe2b8, 0, 52, 0.5, 0.55, 2);
  headlight.position.set(0, 0.72, 1.9);
  headlight.target.position.set(0, 0.2, 18);
  group.add(headlight);
  group.add(headlight.target);
  const lampLoader = new GLTFLoader();
  lampLoader.load('/assets/lantern/Lantern_01_1k.gltf', (gltf) => {
    for (const lamp of [lantern, ...sternLamps]) {
      const model = gltf.scene.clone(true);
      model.scale.setScalar(LAMP_SCALE);
      model.position.copy(lamp.foot);
      model.traverse((obj) => {
        if (!obj.isMesh || !obj.material) return;
        const glass = obj.name === 'Lantern_01_glass' || obj.material.name === 'Lantern_01_glass';
        if (!glass) return;
        obj.material = obj.material.clone();
        obj.material.emissive = new THREE.Color(0xffb03a);
        obj.material.emissiveIntensity = 1.35;
        lamp.glowMats.push(obj.material);
      });
      if (lamp === lantern) lampModel = model;
      lamp.group.add(model);
    }
    placeLantern();
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
      mevcutHull.add(hull);
    }
    if (leftOar) oarL.add(leftOar);
    if (rightOar) oarR.add(rightOar);
  });

  // Donnichols hull: same 3.6m length as the mikeask boat, beam narrowed to the
  // same width, keel on the same waterline, bow toward +Z.
  const DONN_LENGTH = 304.771 - (-298.787);
  const DONN_SCALE = 3.6 / DONN_LENGTH;
  const DONN_BEAM = (0.826356053352356 * BEAM_NARROW) / 117.945;
  const DONN_KEEL = 0.04;
  const DONN_CENTER_Z = 2.992;
  const donnRoot = new THREE.Group();
  donnRoot.scale.set(DONN_BEAM, DONN_SCALE, DONN_SCALE);
  donnRoot.position.set(0, -DONN_KEEL * DONN_SCALE - 0.12, -DONN_CENTER_Z * DONN_SCALE);
  body.add(donnRoot);
  const donnOarL = makeOarPivot(new THREE.Vector3(-0.568, 0.55, 0.161), new THREE.Vector3(-1.7, 0, 0));
  const donnOarR = makeOarPivot(new THREE.Vector3(0.568, 0.55, 0.161), new THREE.Vector3(1.7, 0, 0));
  body.add(donnOarL, donnOarR);

  let hullName = 'donnichols';
  let lampModel = null;
  const lampFeet = {
    mevcut: new THREE.Vector3(0, LAMP_FOOT_Y, 1.72),
    donnichols: new THREE.Vector3(0, 0.63, 1.7),
  };

  function placeLantern() {
    const foot = lampFeet[hullName];
    const lift = 0.0955 * LAMP_SCALE;
    lantern.localPos.set(foot.x, foot.y + lift, foot.z);
    lantern.light.position.copy(lantern.localPos);
    if (lampModel) lampModel.position.set(foot.x, foot.y, foot.z);
  }

  function mountDonnOar(oarNode, pivot, side) {
    let src = null;
    oarNode.traverse((obj) => {
      if (obj.isMesh) src = obj;
    });
    if (!src) return false;
    oarNode.visible = false;
    src.updateWorldMatrix(true, false);
    const toBody = new THREE.Matrix4().copy(body.matrixWorld).invert().multiply(src.matrixWorld);
    const geo = src.geometry.clone();
    geo.applyMatrix4(toBody);
    const handle = new THREE.Vector3(0, -0.629308819770813, 0).applyMatrix4(toBody);
    const tip = new THREE.Vector3(0, 3.308061361312866, 0).applyMatrix4(toBody);
    const widePt = new THREE.Vector3(0.16, 2.9, 0).applyMatrix4(toBody);
    const lock = handle.clone().lerp(tip, 0.26);
    geo.translate(-lock.x, -lock.y, -lock.z);
    const shaft = tip.clone().sub(lock).normalize();
    const out = new THREE.Vector3(side === 'left' ? -1 : 1, 0, 0);
    const align = new THREE.Quaternion().setFromUnitVectors(shaft, out);
    geo.applyQuaternion(align);
    const wide = widePt.sub(lock).applyQuaternion(align);
    const roll = new THREE.Quaternion().setFromAxisAngle(
      out,
      -Math.atan2(wide.dot(new THREE.Vector3(0, 1, 0)), wide.dot(new THREE.Vector3(0, 0, 1))),
    );
    geo.applyQuaternion(roll);
    const bladeTip = tip.clone().sub(lock).applyQuaternion(align).applyQuaternion(roll);
    pivot.userData.blade.position.copy(bladeTip);
    const oarMesh = new THREE.Mesh(geo, src.material);
    pivot.add(oarMesh);
    return true;
  }

  new GLTFLoader().load('/assets/boat/donnichols/scene.gltf', (gltf) => {
    donnRoot.add(gltf.scene);
    body.updateWorldMatrix(true, true);
    const oar1 = gltf.scene.getObjectByName('Oar1');
    const oar2 = gltf.scene.getObjectByName('Oar2');
    const pivoted = oar1 && oar2 && mountDonnOar(oar1, donnOarL, 'left') && mountDonnOar(oar2, donnOarR, 'right');
    if (!pivoted) {
      if (oar1) oar1.visible = false;
      if (oar2) oar2.visible = false;
    }
    donnRoot.visible = hullName === 'donnichols';
  });

  function setHull(name) {
    hullName = name === 'donnichols' ? 'donnichols' : 'mevcut';
    const donn = hullName === 'donnichols';
    mevcutHull.visible = !donn;
    oarL.visible = !donn;
    oarR.visible = !donn;
    donnRoot.visible = donn;
    donnOarL.visible = donn;
    donnOarR.visible = donn;
    for (const lamp of sternLamps) {
      lamp.group.visible = donn;
      lamp.light.visible = donn;
    }
    placeLantern();
  }

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
  let arcadeLane = 1;
  let arcadeLaneArmed = false;
  let prevArcadeLeft = false;
  let prevArcadeRight = false;
  let arcadeAim = -1;
  let arcadeFrom = 0;
  let arcadeTo = 0;
  let arcadeHeel = 0;

  function nearestArcadeLane(x) {
    let best = 1;
    let bestD = Infinity;
    for (let i = 0; i < LANES.length; i += 1) {
      const d = Math.abs(x - LANES[i]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  function settleOnWater(time, input, headOn) {
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
    poseOar(donnOarL, 'left', time);
    poseOar(donnOarR, 'right', time);

    const flicker = 1 + Math.sin(time * 2.3) * 0.03 + Math.sin(time * 5.1) * 0.015;
    const level = (5.0625 - input.day * 2.25) * flicker;
    lantern.light.intensity = level * lantern.bright;
    for (const lamp of sternLamps) lamp.light.intensity = lamp.light.visible ? level * lamp.bright : 0;
    headlight.intensity = headOn ? 42 : 0;
    const glow = (1.35 - input.day * 0.45) * flicker;
    for (const mat of lantern.glowMats) mat.emissiveIntensity = glow * lantern.bright;
    for (const lamp of sternLamps) {
      for (const mat of lamp.glowMats) mat.emissiveIntensity = lamp.light.visible ? glow * lamp.bright : 0;
    }
  }

  function updateArcade(dt, time, input) {
    braking = false;
    sequenceWait = Math.max(0, sequenceWait - dt);
    if (!arcadeLaneArmed) {
      arcadeLane = nearestArcadeLane(state.x);
      prevArcadeLeft = !!input.turnLeft;
      prevArcadeRight = !!input.turnRight;
      arcadeLaneArmed = true;
      state.yawRate = 0;
    }
    const left = !!input.turnLeft;
    const right = !!input.turnRight;
    if (left && !prevArcadeLeft && !right) arcadeLane = Math.min(LANES.length - 1, arcadeLane + 1);
    else if (right && !prevArcadeRight && !left) arcadeLane = Math.max(0, arcadeLane - 1);
    prevArcadeLeft = left;
    prevArcadeRight = right;

    for (const side of ['left', 'right']) {
      cooldown[side] = Math.max(0, cooldown[side] - dt);
      if (strokeT[side] >= 0) {
        strokeT[side] += dt;
        if (strokeT[side] > OAR_INTERVAL) strokeT[side] = -1;
      }
    }

    const settle = 1 - Math.exp(-1.6 * dt);
    state.speed += (ARCADE_CRUISE - state.speed) * settle;
    if (state.speed < 0) state.speed = 0;

    if (arcadeLane !== arcadeAim) {
      arcadeFrom = state.x;
      arcadeTo = LANES[arcadeLane];
      arcadeAim = arcadeLane;
    }

    const ease = 1 - Math.exp(-LANE_EASE * dt);
    state.x += (arcadeTo - state.x) * ease;
    state.z += state.speed * dt;
    const span = arcadeTo - arcadeFrom;
    const p = Math.abs(span) < 0.04 ? 1 : clamp((state.x - arcadeFrom) / span, 0, 1);
    const dir = Math.sign(span) || 0;
    const yawTarget = dir * ARCADE_YAW_PEAK * Math.sin(Math.PI * p);
    // Lean away from the lane while crossing, then roll back to flat.
    const heelTarget = dir * ARCADE_HEEL * Math.sin(p * Math.PI * 2);
    const pose = 1 - Math.exp(-40 * dt);
    state.yaw += (yawTarget - state.yaw) * pose;
    arcadeHeel += (heelTarget - arcadeHeel) * pose;
    state.yawRate = 0;
    settleOnWater(time, input, true);
    group.rotation.z += arcadeHeel;
  }

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
        // Draw back through the water, bow toward stern. The extra angle
        // puts the blade tip under the surface without lengthening the oar.
        sweep = THREE.MathUtils.lerp(-0.46, 0.34, u);
        lift = Math.sin(u * Math.PI) * -0.42;
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
    if (input.arcade) {
      updateArcade(dt, time, input);
      return;
    }
    arcadeLaneArmed = false;
    arcadeAim = -1;
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

    settleOnWater(time, input, !!input.forward);
  }

  const lanternWorld = new THREE.Vector3();
  function lanternPosition() {
    group.updateWorldMatrix(true, false);
    return lantern.group.localToWorld(lanternWorld.copy(lantern.localPos));
  }

  function lanternLights() {
    group.updateWorldMatrix(true, true);
    const lights = [lantern, ...sternLamps].filter((lamp) => lamp.light.visible);
    return lights.map((lamp) => ({
      pos: lamp.group.localToWorld(new THREE.Vector3().copy(lamp.localPos)),
      bright: lamp.bright,
    }));
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
    arcadeLane = 1;
    arcadeLaneArmed = false;
    prevArcadeLeft = false;
    prevArcadeRight = false;
    arcadeAim = -1;
    arcadeFrom = 0;
    arcadeTo = 0;
    arcadeHeel = 0;
    group.position.set(0, 0, 0);
    group.rotation.set(0, 0, 0);
  }

  return {
    group,
    state,
    tryStroke,
    update,
    reset,
    setHull,
    lanternPosition,
    lanternLights,
    lanternColor: new THREE.Color(0xffb45a),
    headlight,
    blades() {
      group.updateWorldMatrix(true, true);
      const leftPivot = hullName === 'donnichols' ? donnOarL : oarL;
      const rightPivot = hullName === 'donnichols' ? donnOarR : oarR;
      const point = (pivot) => {
        pivot.userData.blade.getWorldPosition(bladeWorld);
        return bladeWorld.clone();
      };
      return {
        left: bladeHeight(leftPivot),
        right: bladeHeight(rightPivot),
        leftPoint: point(leftPivot),
        rightPoint: point(rightPivot),
        strokeLeft: strokeT.left,
        strokeRight: strokeT.right,
      };
    },
  };
}
