import * as THREE from 'three';

const MAX_LIGHTS = 40;

const vertexShader = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uDay;
  uniform vec3 uBoat;
  uniform float uYaw;
  uniform float uSpeed;
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
  uniform sampler2D uRough;
  uniform sampler2D uWave;
  uniform vec4 uSplash[16];

  varying vec3 vWorld;

  // circle_02's bright stroke, as a radius in the sprite's 0–1 UV.
  const float WAVE_RING = 0.277;

  float stamp(vec2 uv) {
    float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
    return texture(uWave, clamp(uv, 0.0, 1.0)).a * inside;
  }

  // Several thin crests leave the stem, open to both sides, and fade astern.
  float bowMask(vec2 p) {
    float sy = sin(uYaw);
    float cy = cos(uYaw);
    vec2 d = p - uBoat.xz;
    float lz = d.x * sy + d.y * cy;
    float lx = d.x * cy - d.y * sy;
    float back = 2.02 - lz;
    float trail = clamp(back, 0.0, 12.0);
    float gate = smoothstep(0.0, 0.2, back);
    float speed = smoothstep(0.02, 0.4, uSpeed);
    float bestBand = 1.0;
    float bestGain = 0.0;
    for (int k = 0; k < 4; k++) {
      float fk = float(k);
      float run = trail - fk * 0.22;
      float alive = smoothstep(0.0, 0.12, run);
      float open = 0.42 + fk * 0.30 + run * (0.20 + fk * 0.045);
      float band = abs(abs(lx) - open);
      float gain = alive * exp(-fk * 0.08) * exp(-max(run, 0.0) * 0.09);
      if (band < bestBand) {
        bestBand = band;
        bestGain = gain;
      }
    }
    // One stamp. The sprite stroke is about 0.055 UV wide, so the crest stays thin.
    float show = step(bestBand, 0.12) * step(0.001, bestGain) * gate * speed;
    float uvR = WAVE_RING + min(bestBand, 0.2) * (0.028 / 0.055);
    return stamp(vec2(0.5 + uvR, 0.5)) * bestGain * show;
  }

  float splashMask(vec2 p) {
    float bestGap = 1.0;
    float fade = 0.0;
    vec2 uv = vec2(0.0);
    for (int i = 0; i < 16; i++) {
      vec4 sp = uSplash[i];
      if (sp.w < 0.5) continue;
      float age = sp.z;
      float radius = max(age * 0.55, 0.001);
      // w is 24, 32, or 48. Ring 2 is 25% thinner, ring 3 is 50% thinner.
      float thin = 24.0 / sp.w;
      vec2 delta = p - sp.xy;
      float dist = length(delta);
      if (dist < 0.0001) continue;
      float uvR = dist * (WAVE_RING / radius);
      uvR = WAVE_RING + (uvR - WAVE_RING) / thin;
      float gap = abs(uvR - WAVE_RING);
      if (gap < bestGap) {
        bestGap = gap;
        fade = exp(-age * 0.85) * smoothstep(0.0, 0.04, age);
        uv = vec2(0.5) + (delta / dist) * uvR;
      }
    }
    return stamp(uv) * fade;
  }

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
    vec3 n = normalize(vec3(-hx / e, 1.0, -hz / e));
    vec3 viewDir = normalize(cameraPosition - vWorld);
    vec2 uvA = p * 0.72 + vec2(uTime * 0.013, uTime * 0.008);
    vec2 uvB = p * 1.45 + vec2(-uTime * 0.009, uTime * 0.017);
    vec3 tnA = texture(uNormal, uvA).xyz * 2.0 - 1.0;
    vec3 tnB = texture(uNormal, uvB).xyz * 2.0 - 1.0;
    vec3 tn = tnA + tnB * 0.72;
    // OpenGL normal on the XZ plane: tangent +X, bitangent along -Z.
    vec3 rip = vec3(tn.x, tn.z, -tn.y);
    n = normalize(n + vec3(rip.x, 0.0, rip.z) * 0.62);
    float rough = texture(uRough, uvA).r;

    vec3 deep = mix(vec3(0.0012, 0.0008, 0.0022), vec3(0.03, 0.027, 0.03), uDay);
    float fres = pow(1.0 - clamp(dot(n, viewDir), 0.0, 1.0), 6.0);
    vec3 color = deep + vec3(0.008, 0.007, 0.012) * fres * (1.0 - uDay * 0.4);
    float sheen = pow(clamp(dot(n, viewDir), 0.0, 1.0), mix(70.0, 28.0, rough));
    color += vec3(0.012, 0.01, 0.014) * sheen;

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
        // Moon only. The light sits on the far edge of the water. along
        // grows as the surface runs back toward the boat, and the band
        // narrows along that run. Not the round boat-lamp patch.
        float head = smoothstep(-1.4, 0.25, along);
        float t = clamp(along / 112.0, 0.0, 1.0);
        float k = mix(0.42, 28.0, t * t);
        float distCam = length(cameraPosition - vWorld);
        float fogT = exp(-uFogDensity * uFogDensity * distCam * distCam);
        float remain = exp(-t * 2.1);
        float lift = clamp(remain * 0.63 / max(fogT, 0.05), 0.0, 7.0);
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

    vec3 waveTint = vec3(0.22, 0.18, 0.15);
    color += waveTint * splashMask(p) * 0.55;
    color += waveTint * bowMask(p) * 0.55;
    color += vec3(0.22, 0.18, 0.15) * bowMask(p) * 0.55;

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
  const flatRough = new THREE.DataTexture(new Uint8Array([180, 180, 180, 255]), 1, 1);
  flatRough.needsUpdate = true;
  flatRough.colorSpace = THREE.NoColorSpace;
  flatRough.wrapS = THREE.RepeatWrapping;
  flatRough.wrapT = THREE.RepeatWrapping;
  const flatWave = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  flatWave.needsUpdate = true;
  flatWave.colorSpace = THREE.NoColorSpace;
  flatWave.wrapS = THREE.ClampToEdgeWrapping;
  flatWave.wrapT = THREE.ClampToEdgeWrapping;

  const uniforms = {
    uTime: { value: 0 },
    uDay: { value: 0 },
    uBoat: { value: new THREE.Vector3() },
    uYaw: { value: 0 },
    uSpeed: { value: 0 },
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
    uRough: { value: flatRough },
    uSplash: { value: Array.from({ length: 16 }, () => new THREE.Vector4(0, 0, 8, 0)) },
    uWave: { value: flatWave },
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
  bindMap('/assets/water/Foam001_Roughness.jpg', uniforms.uRough, flatRough);
  loader.load('/assets/water/wave-ring.png', (tex) => {
    tex.colorSpace = THREE.NoColorSpace;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    uniforms.uWave.value = tex;
  });

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
  });

  const geometry = new THREE.PlaneGeometry(13.2, 240, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;

  return { mesh, uniforms };
}

const splashSlots = Array.from({ length: 16 }, () => ({ x: 0, z: 0, birth: -20, sharp: 0 }));
let splashNext = 0;
const splashWet = { left: false, right: false };
// Ring 1 keeps the current band. Ring 2 is 25% thinner, ring 3 is 50% thinner.
const SPLASH_SHARP = [24, 24 / 0.75, 24 / 0.5];

export function noteSplashes(uniforms, blades, time) {
  const emitTrain = (point) => {
    for (let k = 0; k < SPLASH_SHARP.length; k++) {
      const slot = splashSlots[splashNext];
      splashNext = (splashNext + 1) % splashSlots.length;
      slot.x = point.x;
      slot.z = point.z;
      slot.birth = time + k * 0.14;
      slot.sharp = SPLASH_SHARP[k];
    }
  };
  const consider = (point, stroke, side) => {
    const inWater = stroke >= 0 && point && point.y < 0;
    if (inWater && !splashWet[side]) emitTrain(point);
    splashWet[side] = inWater;
  };
  consider(blades.leftPoint, blades.strokeLeft, 'left');
  consider(blades.rightPoint, blades.strokeRight, 'right');
  const out = uniforms.uSplash.value;
  for (let i = 0; i < splashSlots.length; i++) {
    const slot = splashSlots[i];
    const age = time - slot.birth;
    const alive = age >= 0 && age < 2.2;
    out[i].set(slot.x, slot.z, alive ? age : 8, alive ? slot.sharp : 0);
  }
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
