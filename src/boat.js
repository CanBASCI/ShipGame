import * as THREE from 'three';

const MAX_SPEED = 2.15;
const OAR_INTERVAL = 0.62;
const WATER_DRAG = 0.4;
const CRUISE_ACCEL = MAX_SPEED * WATER_DRAG;
const BRAKE_DRAG = 2.5;
const TURN_RATE = 0.28;
const TURN_EASE = 2.1;
const BANK = 4.72;

const WOOD = [0xc49262, 0x8d582f, 0xb67a48, 0x6e4428, 0x9a643c, 0x7a4e30];

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

function halfBeam(t) {
  const transom = 1 - smoothstep(0.0, 0.16, t);
  const body = Math.sin(Math.PI * Math.pow(t, 0.72));
  const pinch = Math.pow(1 - t, 0.45);
  return 0.46 * transom + 0.62 * body * (0.22 + 0.78 * pinch);
}

function section(v, hb) {
  const y = -0.14 + Math.pow(v, 0.58) * 0.52;
  const x = hb * Math.pow(Math.sin(v * Math.PI * 0.5), 0.7);
  return { x, y };
}

function loadTex(url, colorSpace) {
  const tex = new THREE.TextureLoader().load(url);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = colorSpace;
  tex.anisotropy = 8;
  return tex;
}

function bandGeometry(v0, v1, band) {
  const U = 24;
  const positions = [];
  const uvs = [];
  const colors = [];
  const indices = [];

  function addStrip(side) {
    const base = positions.length / 3;
    for (let i = 0; i <= U; i++) {
      const t = i / U;
      const z = -1.68 + t * 3.42;
      const hb = halfBeam(t);
      for (const v of [v0, v1]) {
        const s = section(v, hb);
        const vn = (v - v0) / Math.max(0.0001, v1 - v0);
        const seam = vn < 0.1 || vn > 0.88 ? 0.34 : 1;
        const weather = 0.84 + 0.16 * Math.sin(t * 22 + v * 9);
        const c = seam * weather;
        positions.push(side * s.x, s.y, z);
        uvs.push(t * 2.6, (band + 0.08 + vn * 0.72) / 7);
        colors.push(c, c * 0.94, c * 0.82);
      }
    }
    for (let i = 0; i < U; i++) {
      const a = base + i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      if (side > 0) indices.push(a, c, b, b, c, d);
      else indices.push(a, b, c, b, d, c);
    }
  }

  addStrip(1);
  addStrip(-1);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function transomGeometry() {
  const V = 7;
  const t = 0.015;
  const z = -1.68 + t * 3.42;
  const hb = halfBeam(t);
  const positions = [];
  const indices = [];
  for (let i = 0; i <= V; i++) {
    const s = section(i / V, hb);
    positions.push(-s.x, s.y, z, s.x, s.y, z);
  }
  for (let i = 0; i < V; i++) {
    const a = i * 2;
    indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function waterY(x, z, time) {
  return (
    Math.sin(x * 0.72 + z * 0.28 + time * 0.48) * 0.03 +
    Math.sin(x * 1.55 - z * 1.05 + time * 0.72) * 0.014
  );
}

function makeOar(side) {
  const black = new THREE.MeshBasicMaterial({ color: 0x050308 });
  const pivot = new THREE.Group();
  const prominent = side > 0;
  const len = prominent ? 2.28 : 2.05;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.026, len, 5), black);
  shaft.rotation.z = Math.PI / 2;
  shaft.position.set(side * len * 0.46, prominent ? -0.2 : -0.14, -0.16);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(prominent ? 0.64 : 0.5, 0.026, 0.2), black);
  blade.position.set(side * (len * 0.9), prominent ? -0.52 : -0.42, -0.22);
  blade.rotation.y = side * -0.22;
  blade.rotation.z = side * (prominent ? -0.42 : -0.28);
  pivot.add(shaft, blade);
  pivot.position.set(side * 0.46, 0.36, -0.02);
  pivot.userData.blade = blade;
  return pivot;
}

function makeRower(black) {
  const g = new THREE.Group();
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.42, 0.82, 10), black);
  skirt.position.set(0, 0.5, -0.1);
  skirt.scale.z = 0.7;
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.18, 0.38, 8), black);
  torso.position.set(0, 1.02, 0.0);
  torso.rotation.x = -0.12;
  const shoulders = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.09, 0.16), black);
  shoulders.position.set(0, 1.16, 0.0);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.095, 10, 8), black);
  head.scale.set(1, 1.02, 0.9);
  head.position.set(0, 1.32, 0.02);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.145, 0.04, 12), black);
  cap.position.set(0, 1.42, 0.02);
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.012, 14), black);
  brim.position.set(0, 1.395, 0.03);
  const armGeo = new THREE.CylinderGeometry(0.04, 0.035, 0.42, 5);
  const armL = new THREE.Mesh(armGeo, black);
  armL.position.set(-0.3, 1.05, 0.1);
  armL.rotation.z = 0.85;
  armL.rotation.x = 0.55;
  const armR = new THREE.Mesh(armGeo, black);
  armR.position.set(0.3, 1.05, 0.1);
  armR.rotation.z = -0.85;
  armR.rotation.x = 0.55;
  g.add(skirt, torso, shoulders, head, cap, brim, armL, armR);
  return g;
}

function makeLantern(woodMat) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.028, 0.92, 6), woodMat);
  pole.position.set(0.42, 0.78, 0.55);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.28, 5), woodMat);
  arm.rotation.z = Math.PI / 2;
  arm.position.set(0.5, 1.22, 0.62);
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x2a2118,
    roughness: 0.6,
    metalness: 0.15,
  });
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.26, 0.2), frameMat);
  frame.position.set(0.58, 1.16, 0.7);
  const glowMat = new THREE.MeshStandardMaterial({
    color: 0xffe2a8,
    emissive: 0xffb03a,
    emissiveIntensity: 6.5,
    roughness: 0.35,
  });
  const glow = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, 0.16), glowMat);
  glow.position.copy(frame.position);
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0xffc56a,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  });
  const halo = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), haloMat);
  halo.position.copy(frame.position);
  const light = new THREE.PointLight(0xffb45a, 18, 12, 2);
  light.position.copy(frame.position);
  g.add(pole, arm, frame, glow, halo, light);
  return { group: g, glowMat, light, localPos: frame.position.clone() };
}

export function createBoat() {
  const group = new THREE.Group();
  group.rotation.order = 'YXZ';
  const woodDiff = loadTex('/assets/wood/weathered_planks_diff_1k.jpg', THREE.SRGBColorSpace);
  const woodNor = loadTex('/assets/wood/weathered_planks_nor_gl_1k.jpg', THREE.LinearSRGBColorSpace);
  const woodRough = loadTex('/assets/wood/weathered_planks_rough_1k.jpg', THREE.LinearSRGBColorSpace);
  const plankMaps = { map: woodDiff, normalMap: woodNor, roughnessMap: woodRough };

  const bands = 6;
  for (let i = 0; i < bands; i++) {
    const v0 = i / bands;
    const v1 = (i + 1) / bands;
    const mat = new THREE.MeshStandardMaterial({
      ...plankMaps,
      color: WOOD[i % WOOD.length],
      roughness: i > 3 ? 0.58 : 0.72,
      metalness: 0.04,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(bandGeometry(v0, v1, i), mat);
    group.add(mesh);
  }

  const transomMat = new THREE.MeshStandardMaterial({
    ...plankMaps,
    color: 0xb48962,
    roughness: 0.8,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });
  group.add(new THREE.Mesh(transomGeometry(), transomMat));

  const darkWood = new THREE.MeshStandardMaterial({
    ...plankMaps,
    color: 0x8d6a45,
    roughness: 0.78,
    metalness: 0.03,
  });
  const floorMat = new THREE.MeshStandardMaterial({
    ...plankMaps,
    color: 0xc4a074,
    roughness: 0.8,
    metalness: 0.02,
  });

  for (let i = 0; i < 4; i++) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.028, 2.35), floorMat);
    plank.position.set(-0.27 + i * 0.18, 0.02, -0.05);
    group.add(plank);
  }

  const gunwaleGeo = new THREE.BoxGeometry(0.06, 0.045, 2.7);
  const gunL = new THREE.Mesh(gunwaleGeo, darkWood);
  gunL.position.set(-0.52, 0.36, -0.15);
  const gunR = new THREE.Mesh(gunwaleGeo, darkWood);
  gunR.position.set(0.52, 0.36, -0.15);
  group.add(gunL, gunR);

  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.04, 0.2), darkWood);
  seat.position.set(0, 0.22, -0.18);
  const seat2 = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.035, 0.16), darkWood);
  seat2.position.set(0, 0.2, 0.55);
  group.add(seat, seat2);

  const postMat = new THREE.MeshStandardMaterial({
    ...plankMaps,
    color: 0xc98448,
    roughness: 0.66,
    metalness: 0.03,
  });
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.98, 0.06), postMat);
  post.position.set(0, 0.62, -1.62);
  const postCap = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.09), postMat);
  postCap.position.set(0, 1.1, -1.62);
  const bowPost = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.28, 0.04), darkWood);
  bowPost.position.set(0, 0.32, 1.7);
  group.add(post, postCap, bowPost);

  const black = new THREE.MeshBasicMaterial({ color: 0x050308 });
  group.add(makeRower(black));

  const oarL = makeOar(-1);
  const oarR = makeOar(1);
  group.add(oarL, oarR);

  const lantern = makeLantern(darkWood);
  group.add(lantern.group);

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
        sweep = THREE.MathUtils.lerp(-0.34, 0.46, e);
        lift = 0.02;
      } else {
        const u = (p - 0.62) / 0.38;
        sweep = THREE.MathUtils.lerp(0.46, -0.34, u);
        lift = Math.sin(u * Math.PI) * -0.28;
      }
    } else {
      sweep = Math.sin(time * 0.7 + sign) * 0.02;
      lift = Math.sin(time * 0.5) * 0.012;
    }
    pivot.rotation.y = sign * sweep;
    pivot.rotation.z = sign * lift;
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
      if (turnLeft && !turnRight) side = 'right';
      else if (turnRight && !turnLeft) side = 'left';
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
    const ease = 1 - Math.exp(-TURN_EASE * dt);
    state.yawRate += (turn * TURN_RATE - state.yawRate) * ease;

    state.yaw += state.yawRate * dt;
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
        state.yawRate += -sign * 0.35 * outward;
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

    group.position.set(state.x, yC, state.z);
    group.rotation.y = state.yaw;
    group.rotation.x = -(yF - yB) * 0.55 + Math.sin(time * 0.45) * 0.01;
    group.rotation.z = (yR - yL) * 0.7 + Math.sin(time * 0.33 + 1.0) * 0.012;

    poseOar(oarL, 'left', time);
    poseOar(oarR, 'right', time);

    const flicker = 1 + Math.sin(time * 2.3) * 0.03 + Math.sin(time * 5.1) * 0.015;
    lantern.light.intensity = (9 - input.day * 4) * flicker;
    lantern.glowMat.emissiveIntensity = (6.5 - input.day * 2.2) * flicker;
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
      return {
        left: bladeHeight(oarL),
        right: bladeHeight(oarR),
        strokeLeft: strokeT.left,
        strokeRight: strokeT.right,
      };
    },
  };
}
