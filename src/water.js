import * as THREE from 'three';

const WATER_WIDTH = 13.2;
const WATER_LENGTH = 240;
// Same stretch as the old canal plane, so the moon streak still has water under it.
const SEA_LENGTH = 240;

const MAX_LIGHTS = 40;

const vertexShader = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uDay;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform vec3 uHeadPos;
  uniform vec3 uHeadDir;
  uniform float uHead;
  uniform float uHeadSpread;
  uniform vec3 uPos[${MAX_LIGHTS}];
  uniform vec3 uCol[${MAX_LIGHTS}];
  uniform float uGain[${MAX_LIGHTS}];
  uniform float uTight[${MAX_LIGHTS}];
  uniform float uPatch[${MAX_LIGHTS}];
  uniform sampler2D uNormal;

  varying vec3 vWorld;
  varying vec3 vNormal;

  float waveH(vec2 p) {
    float h = 0.0;
    h += sin(p.x * 0.72 + p.y * 0.28 + uTime * 0.48) * 0.018;
    h += sin(p.x * 1.55 - p.y * 1.05 + uTime * 0.72) * 0.008;
    h += sin(dot(p, vec2(2.6, -1.4)) + uTime * 1.15) * 0.0035;
    h += sin(p.x * 9.5 + p.y * 7.2 + uTime * 1.35) * 0.0016;
    return h;
  }

  void main() {
    vec2 p = vWorld.xz;
    float e = 0.18;
    float h = waveH(p);
    float hx = waveH(p + vec2(e, 0.0)) - h;
    float hz = waveH(p + vec2(0.0, e)) - h;
    vec3 geoN = normalize(vNormal);
    vec3 n = normalize(vec3(geoN.x - hx / e, geoN.y, geoN.z - hz / e));
    vec3 viewDir = normalize(cameraPosition - vWorld);
    vec2 uvA = p * 0.72 + vec2(uTime * 0.013, uTime * 0.008);
    vec2 uvB = p * 1.45 + vec2(-uTime * 0.009, uTime * 0.017);
    vec3 tnA = texture(uNormal, uvA).xyz * 2.0 - 1.0;
    vec3 tnB = texture(uNormal, uvB).xyz * 2.0 - 1.0;
    vec3 tn = tnA + tnB * 0.72;
    // OpenGL normal on the XZ plane: tangent +X, bitangent along -Z.
    vec3 rip = vec3(tn.x, tn.z, -tn.y);
    n = normalize(n + vec3(rip.x, 0.0, rip.z) * 0.35);

    // Plane material on sea_part/scene.gltf. Night water is that dark blue-black.
    vec3 seaBase = vec3(0.00735463, 0.00553134, 0.01596361);
    float seaMetal = 0.58063112;
    float seaRough = 0.06870444;
    vec3 deep = mix(seaBase, vec3(0.03, 0.027, 0.03), uDay);
    vec3 color = deep;
    vec3 f0 = mix(vec3(0.04), seaBase, seaMetal);
    float ndv = clamp(dot(n, viewDir), 0.0, 1.0);
    float fres = pow(1.0 - ndv, mix(6.0, 64.0, 1.0 - seaRough));
    color += f0 * fres;

    vec3 refl = vec3(0.0);
    vec2 camXZ = cameraPosition.xz;
    vec2 viewFwd = p + n.xz * 0.42 - camXZ;
    float viewLen = length(viewFwd);
    vec2 vd = viewFwd / max(viewLen, 0.001);

    for (int i = 0; i < ${MAX_LIGHTS}; i++) {
      float gain = uGain[i];
      if (gain < 0.001) continue;
      vec2 lp = uPos[i].xz;
      vec2 toL = lp - p;
      float along = dot(toL, vd);
      float across = length(toL - vd * along);
      float tight = uTight[i];
      float band = exp(-across * across * mix(6.0, 90.0, tight));
      // The head of the arrowhead sits on the lantern. The old gate peaked
      // in front of the lamp and the round core then drew a second spot beside it.
      float gate = smoothstep(-0.45, 0.0, along) * exp(-max(along, 0.0) * mix(0.012, 0.04, tight));
      float ripple = sin(across * 54.0 + along * 11.0 + uTime * 2.6 + float(i) * 1.7);
      float shim = 0.35 + 0.65 * pow(clamp(0.5 + 0.5 * ripple, 0.0, 1.0), 4.0);
      float distL = length(toL);
      float atten = gain / (1.0 + distL * distL * 0.0022);
      vec3 tint = uCol[i];
      if (uPatch[i] > 1.5) {
        // Moon only. The head is under the moon. along grows back toward
        // the boat, the path narrows, and the light fades. Not the canal banks.
        float head = smoothstep(-1.2, 0.35, along);
        float t = clamp(along / 34.0, 0.0, 1.0);
        float k = mix(0.85, 7.5, t);
        float distCam = length(cameraPosition - vWorld);
        float fogT = exp(-uFogDensity * uFogDensity * distCam * distCam);
        float fade = exp(-t * 1.55);
        float lift = clamp(fade * 0.72 / max(fogT, 0.22), 0.0, 2.6);
        float streak = head * exp(-across * across * k);
        float ripple = 0.84 + 0.16 * sin(along * 1.2 + uTime * 1.1);
        refl += tint * streak * ripple * gain * 1.05 * lift;
      } else if (uPatch[i] > 0.5) {
        float soft = exp(-distL * distL * 2.2);
        refl += tint * soft * gain * 1.35;
      } else {
        // Bamboo lanterns use the moon's narrow streak: it starts on the
        // lantern and thins as it runs back toward the boat. Not an arrowhead.
        float headL = smoothstep(-1.4, 0.25, along);
        float tL = clamp(along / 112.0, 0.0, 1.0);
        // Same narrow beam the arrow used. The streak still starts on the
        // lantern and thins toward the boat.
        float kL = mix(6.0, 90.0, tight) * mix(1.0, 28.0 / 0.42, tL * tL);
        float streakL = headL * exp(-tL * 2.1) * exp(-across * across * kL);
        float rippleL = 0.84 + 0.16 * sin(along * 1.2 + uTime * 1.1 + float(i));
        refl += tint * streakL * rippleL * atten * 5.2;
      }
    }

    float near = smoothstep(0.15, 3.2, viewLen);
    refl *= mix(0.72, 1.0, near);
    refl *= mix(1.0, 0.5, uDay);
    color += min(refl, vec3(4.5));

    vec3 toHead = vWorld - uHeadPos;
    float headAhead = dot(toHead, uHeadDir);
    float headSide = length(toHead - uHeadDir * headAhead);
    float headRadius = 0.05 + max(headAhead, 0.0) * uHeadSpread;
    float headCone = exp(-pow(headSide / max(headRadius, 0.08), 2.0));
    headCone *= step(0.0, headAhead);
    float headFall = 1.0 / (1.0 + headAhead * headAhead * 0.0035);
    color += vec3(1.0, 0.78, 0.46) * headCone * headFall * uHead * 0.42;

    float fd = length(vWorld - cameraPosition);
    float fogF = 1.0 - exp(-uFogDensity * uFogDensity * fd * fd);
    color = mix(color, uFogColor, clamp(fogF, 0.0, 1.0));

    gl_FragColor = vec4(color, 1.0);
  }
`;

export function createWater() {
  const positions = [];
  const colors = [];
  for (let i = 0; i < MAX_LIGHTS; i++) {
    positions.push(new THREE.Vector3());
    colors.push(new THREE.Color());
  }

  const flatNormal = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
  flatNormal.needsUpdate = true;
  flatNormal.colorSpace = THREE.NoColorSpace;
  flatNormal.wrapS = THREE.RepeatWrapping;
  flatNormal.wrapT = THREE.RepeatWrapping;
  const uniforms = {
    uTime: { value: 0 },
    uDay: { value: 0 },
    uFogColor: { value: new THREE.Color(0x0c0612) },
    uFogDensity: { value: 0.034 },
    uHeadPos: { value: new THREE.Vector3() },
    uHeadDir: { value: new THREE.Vector3(0, 0, 1) },
    uHead: { value: 0 },
    uHeadSpread: { value: Math.tan(0.5) },
    uPos: { value: positions },
    uCol: { value: colors },
    uGain: { value: new Float32Array(MAX_LIGHTS) },
    uTight: { value: new Float32Array(MAX_LIGHTS) },
    uPatch: { value: new Float32Array(MAX_LIGHTS) },
    uNormal: { value: flatNormal },
  };

  const loader = new THREE.TextureLoader();
  const bindMap = (url, uniform, fallback) => {
    loader.load(url, (tex) => {
      tex.colorSpace = THREE.NoColorSpace;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      uniform.value = tex;
    });
    uniform.value = fallback;
  };
  bindMap('/assets/water/Foam001_NormalGL.jpg', uniforms.uNormal, flatNormal);

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    side: THREE.DoubleSide,
  });

  const geometry = new THREE.PlaneGeometry(WATER_WIDTH, WATER_LENGTH, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;

  loadSeaSurface().then((sea) => {
    if (!sea) return;
    mesh.geometry.dispose();
    mesh.geometry = sea.geometry;
    mesh.userData.seaTile = sea.tile;
  }).catch((err) => {
    console.error(err);
  });

  return { mesh, uniforms };
}

// The bin is mostly unused morph targets. Read the base surface and tile it.
async function loadSeaSurface() {
  const [gltf, bin] = await Promise.all([
    fetch('/assets/water/sea_part/scene.gltf').then((res) => res.json()),
    fetch('/assets/water/sea_part/scene.bin').then((res) => res.arrayBuffer()),
  ]);
  const primitive = gltf.meshes[0].primitives[0];
  const srcPos = readVec3(gltf, bin, primitive.attributes.POSITION);
  const world = seaMatrix(gltf);
  const v = new THREE.Vector3();
  let minX = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  const baked = new Float32Array(srcPos.length);
  for (let i = 0; i < srcPos.length; i += 3) {
    v.set(srcPos[i], srcPos[i + 1], srcPos[i + 2]).applyMatrix4(world);
    baked[i] = v.x;
    baked[i + 1] = v.y;
    baked[i + 2] = v.z;
    minX = Math.min(minX, v.x);
    maxX = Math.max(maxX, v.x);
    maxY = Math.max(maxY, v.y);
    minZ = Math.min(minZ, v.z);
    maxZ = Math.max(maxZ, v.z);
  }
  const sizeX = maxX - minX;
  const sizeZ = maxZ - minZ;
  if (sizeX < 1e-4 || sizeZ < 1e-4) return null;
  const cols = 48;
  const rows = 24;
  const heights = new Float32Array(cols * rows);
  const counts = new Uint16Array(cols * rows);
  for (let i = 0; i < baked.length; i += 3) {
    const cx = Math.min(cols - 1, Math.max(0, Math.round(((baked[i] - minX) / sizeX) * (cols - 1))));
    const cz = Math.min(rows - 1, Math.max(0, Math.round(((baked[i + 2] - minZ) / sizeZ) * (rows - 1))));
    const cell = cz * cols + cx;
    heights[cell] += baked[i + 1];
    counts[cell] += 1;
  }
  for (let i = 0; i < heights.length; i += 1) {
    if (counts[i] > 0) heights[i] /= counts[i];
  }
  for (let pass = 0; pass < 4; pass += 1) {
    for (let i = 0; i < heights.length; i += 1) {
      if (counts[i] > 0) continue;
      let sum = 0;
      let n = 0;
      const cz = Math.floor(i / cols);
      const cx = i - cz * cols;
      for (let dz = -1; dz <= 1; dz += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = cx + dx;
          const nz = cz + dz;
          if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
          const ni = nz * cols + nx;
          if (counts[ni] === 0 && pass === 0) continue;
          if (counts[ni] === 0 && heights[ni] === 0) continue;
          sum += heights[ni];
          n += 1;
        }
      }
      if (n > 0) heights[i] = sum / n;
    }
  }
  // The patch edges do not meet. Ease the end of each tile into its start
  // so the repeat does not step.
  const blendRows = 3;
  for (let b = 0; b < blendRows; b += 1) {
    const cz = rows - 1 - b;
    const w = 1 - b / blendRows;
    for (let cx = 0; cx < cols; cx += 1) {
      const i = cz * cols + cx;
      heights[i] = heights[i] * (1 - w) + heights[cx] * w;
    }
  }
  let crest = -Infinity;
  for (let i = 0; i < heights.length; i += 1) crest = Math.max(crest, heights[i]);
  const copies = Math.ceil(SEA_LENGTH / sizeZ);
  const positions = new Float32Array(cols * rows * copies * 3);
  const indices = new Uint32Array((cols - 1) * (rows - 1) * 6 * copies);
  let indexAt = 0;
  for (let copy = 0; copy < copies; copy += 1) {
    const z0 = -SEA_LENGTH / 2 + copy * sizeZ;
    const base = copy * cols * rows;
    for (let cz = 0; cz < rows; cz += 1) {
      for (let cx = 0; cx < cols; cx += 1) {
        const o = (base + cz * cols + cx) * 3;
        positions[o] = (cx / (cols - 1) - 0.5) * WATER_WIDTH;
        positions[o + 1] = heights[cz * cols + cx] - crest;
        positions[o + 2] = z0 + (cz / (rows - 1)) * sizeZ;
      }
    }
    for (let cz = 0; cz < rows - 1; cz += 1) {
      for (let cx = 0; cx < cols - 1; cx += 1) {
        const a = base + cz * cols + cx;
        indices[indexAt] = a;
        indices[indexAt + 1] = a + cols;
        indices[indexAt + 2] = a + 1;
        indices[indexAt + 3] = a + 1;
        indices[indexAt + 4] = a + cols;
        indices[indexAt + 5] = a + cols + 1;
        indexAt += 6;
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  return { geometry: geo, tile: sizeZ };
}

function seaMatrix(gltf) {
  const world = new THREE.Matrix4();
  for (const node of [gltf.nodes[0], gltf.nodes[2], gltf.nodes[5]]) {
    const step = new THREE.Matrix4();
    if (node.matrix) step.fromArray(node.matrix);
    else step.compose(
      new THREE.Vector3().fromArray(node.translation || [0, 0, 0]),
      new THREE.Quaternion().fromArray(node.rotation || [0, 0, 0, 1]),
      new THREE.Vector3().fromArray(node.scale || [1, 1, 1]),
    );
    world.multiply(step);
  }
  return world;
}

function readVec3(gltf, bin, accessorIndex) {
  const accessor = gltf.accessors[accessorIndex];
  const view = gltf.bufferViews[accessor.bufferView];
  const start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const stride = view.byteStride || 12;
  const out = new Float32Array(accessor.count * 3);
  const data = new DataView(bin);
  for (let i = 0; i < accessor.count; i += 1) {
    const at = start + i * stride;
    out[i * 3] = data.getFloat32(at, true);
    out[i * 3 + 1] = data.getFloat32(at + 4, true);
    out[i * 3 + 2] = data.getFloat32(at + 8, true);
  }
  return out;
}

export function setWaterLights(uniforms, sources) {
  const gain = uniforms.uGain.value;
  const tight = uniforms.uTight.value;
  const patch = uniforms.uPatch.value;
  for (let i = 0; i < MAX_LIGHTS; i++) {
    const src = sources[i];
    if (!src) {
      gain[i] = 0;
      patch[i] = 0;
      continue;
    }
    uniforms.uPos.value[i].copy(src.pos);
    uniforms.uCol.value[i].copy(src.color);
    gain[i] = src.gain;
    tight[i] = src.tight;
    patch[i] = src.streak ? 2 : src.patch ? 1 : 0;
  }
}
