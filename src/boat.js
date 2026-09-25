import * as THREE from 'three';

const MAX_SPEED = 2.15;
const MIN_SPEED = -1.05;
const OAR_IMPULSE = 0.3;
const OAR_YAW = 0.22;
const OAR_INTERVAL = 0.62;
const THROTTLE_ACCEL = 1.15;
const REVERSE_ACCEL = 0.62;
const WATER_DRAG = 0.4;
const STEER_ACCEL = 0.42;
const YAW_DRAG = 1.7;
const BANK = 4.72;

const WOOD = [0xd7b089, 0xc49a70, 0xe0c4a0, 0xb58962, 0xc9a67c, 0xa67c55];

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

function makeWoodTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const g = canvas.getContext('2d');
  g.fillStyle = '#c9a57a';
  g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y++) {
    const shade = 70 + Math.floor(Math.sin(y * 0.37) * 18 + Math.random() * 22);
    g.strokeStyle = `rgba(${shade}, ${Math.floor(shade * 0.72)}, ${Math.floor(shade * 0.42)}, 0.18)`;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(256, y + Math.sin(y * 0.2) * 1.5);
    g.stroke();
  }
  for (let i = 0; i < 18; i++) {
    g.strokeStyle = `rgba(90, 60, 30, ${0.05 + Math.random() * 0.08})`;
    g.beginPath();
    const y = Math.random() * 256;
    g.moveTo(0, y);
    g.bezierCurveTo(80, y + 6, 160, y - 5, 256, y + 2);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function bandGeometry(v0, v1) {
  const U = 24;
  const positions = [];
  const uvs = [];
  const indices = [];

  function addStrip(side) {
    const base = positions.length / 3;
    for (let i = 0; i <= U; i++) {
      const t = i / U;
      const z = -1.68 + t * 3.42;
      const hb = halfBeam(t);
      for (const v of [v0, v1]) {
        const s = section(v, hb);
        positions.push(side * s.x, s.y, z);
        uvs.push(t * 3.2, (v - v0) / Math.max(0.0001, v1 - v0));
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
  const black = new THREE.MeshBasicMaterial({ color: 0x07060a });
  const pivot = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, 1.95, 5), black);
  shaft.rotation.z = Math.PI / 2;
  shaft.position.set(side * 0.95, -0.14, -0.2);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 0.18), black);
  blade.position.set(side * 1.92, -0.34, -0.42);
  blade.rotation.y = side * -0.25;
  blade.rotation.z = side * -0.15;
  pivot.add(shaft, blade);
  pivot.position.set(side * 0.5, 0.34, -0.12);
  pivot.userData.blade = blade;
  return pivot;
}

function makeRower(black) {
  const g = new THREE.Group();
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.34, 0.62, 8), black);
  skirt.position.set(0, 0.42, -0.16);
  skirt.scale.z = 0.72;
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 0.4, 8), black);
  torso.position.set(0, 0.86, -0.04);
  torso.rotation.x = -0.16;
  const shoulders = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.1, 0.18), black);
  shoulders.position.set(0, 1.02, -0.02);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.105, 10, 8), black);
  head.scale.set(1, 1.05, 0.92);
  head.position.set(0, 1.2, 0.0);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.118, 0.128, 0.055, 10), black);
  cap.position.set(0, 1.3, 0.0);
  const brim = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.018, 0.16), black);
  brim.position.set(0, 1.268, 0.03);
  const armGeo = new THREE.CylinderGeometry(0.04, 0.035, 0.42, 5);
  const armL = new THREE.Mesh(armGeo, black);
  armL.position.set(-0.28, 0.84, 0.08);
  armL.rotation.z = 0.85;
  armL.rotation.x = 0.55;
  const armR = new THREE.Mesh(armGeo, black);
  armR.position.set(0.28, 0.84, 0.08);
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
  const woodTex = makeWoodTexture();

  const bands = 5;
  for (let i = 0; i < bands; i++) {
    const v0 = i / bands;
    const v1 = (i + 1) / bands;
    const mat = new THREE.MeshStandardMaterial({
      map: woodTex,
      color: WOOD[i % WOOD.length],
      roughness: 0.74,
      metalness: 0.02,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(bandGeometry(v0, v1), mat);
    group.add(mesh);
  }

  const transomMat = new THREE.MeshStandardMaterial({
    map: woodTex,
    color: 0xb48962,
    roughness: 0.8,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });
  group.add(new THREE.Mesh(transomGeometry(), transomMat));

  const darkWood = new THREE.MeshStandardMaterial({
    map: woodTex,
    color: 0x8d6a45,
    roughness: 0.78,
    metalness: 0.03,
  });
  const floorMat = new THREE.MeshStandardMaterial({
    map: woodTex,
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

  const post = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.6, 0.05), darkWood);
  post.position.set(0, 0.48, -1.64);
  const bowPost = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.28, 0.04), darkWood);
  bowPost.position.set(0, 0.32, 1.7);
  group.add(post, bowPost);

  const black = new THREE.MeshBasicMaterial({ color: 0x07060a });
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

  function applyStroke(side) {
    const sign = side === 'left' ? -1 : 1;
    state.speed = clamp(state.speed + OAR_IMPULSE, MIN_SPEED, MAX_SPEED);
    state.yawRate = clamp(state.yawRate + sign * OAR_YAW, -0.7, 0.7);
    strokeT[side] = 0;
    cooldown[side] = OAR_INTERVAL;
  }

  function tryStroke(side) {
    if (cooldown[side] > 0) return false;
    applyStroke(side);
    return true;
  }

  function poseOar(pivot, side, time) {
    const sign = side === 'left' ? -1 : 1;
    const t = strokeT[side];
    let sweep = 0;
    let lift = 0;
    if (t >= 0) {
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
    const throttle = input.throttle;
    const accel = throttle >= 0 ? THROTTLE_ACCEL : REVERSE_ACCEL;
    state.speed += throttle * accel * dt;
    state.yawRate += input.steer * STEER_ACCEL * dt;

    for (const side of ['left', 'right']) {
      cooldown[side] = Math.max(0, cooldown[side] - dt);
      if (strokeT[side] >= 0) {
        strokeT[side] += dt;
        if (strokeT[side] > OAR_INTERVAL) strokeT[side] = -1;
      }
      if (input[side] && cooldown[side] <= 0) applyStroke(side);
    }

    state.speed = clamp(state.speed, MIN_SPEED, MAX_SPEED);
    state.yawRate = clamp(state.yawRate, -0.7, 0.7);
    state.speed *= Math.exp(-WATER_DRAG * dt);
    state.yawRate *= Math.exp(-YAW_DRAG * dt);
    if (Math.abs(state.speed) < 0.004) state.speed = 0;

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
        state.speed = forwardness >= 0 ? sp : -sp;
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
    lantern.light.intensity = (14 - input.day * 6) * flicker;
    lantern.glowMat.emissiveIntensity = (6.5 - input.day * 2.2) * flicker;
  }

  const lanternWorld = new THREE.Vector3();
  function lanternPosition() {
    group.updateWorldMatrix(true, false);
    return lantern.group.localToWorld(lanternWorld.copy(lantern.localPos));
  }

  return {
    group,
    state,
    tryStroke,
    update,
    lanternPosition,
    lanternColor: new THREE.Color(0xffb45a),
  };
}
