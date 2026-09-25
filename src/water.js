import * as THREE from 'three';

const MAX_LIGHTS = 16;

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
  uniform vec3 uPos[16];
  uniform vec3 uCol[16];
  uniform float uGain[16];
  uniform float uTight[16];

  varying vec3 vWorld;

  float waveH(vec2 p) {
    float h = 0.0;
    h += sin(p.x * 0.72 + p.y * 0.28 + uTime * 0.48) * 0.03;
    h += sin(p.x * 1.55 - p.y * 1.05 + uTime * 0.72) * 0.014;
    h += sin(dot(p, vec2(2.6, -1.4)) + uTime * 1.15) * 0.006;
    float sy = sin(uYaw);
    float cy = cos(uYaw);
    vec2 d = p - uBoat.xz;
    float lz = d.x * sy + d.y * cy;
    float lx = d.x * cy - d.y * sy;
    float behind = clamp(-lz - 1.15, 0.0, 14.0);
    float wake = exp(-lx * lx * 2.4) * exp(-behind * 0.2) * uSpeed;
    h += wake * 0.045 * sin(behind * 3.2 - uTime * 3.0);
    return h;
  }

  void main() {
    vec2 p = vWorld.xz;
    float e = 0.18;
    float h = waveH(p);
    float hx = waveH(p + vec2(e, 0.0)) - h;
    float hz = waveH(p + vec2(0.0, e)) - h;
    vec3 n = normalize(vec3(-hx / e, 1.0, -hz / e));
    float micro = sin(p.x * 7.5 + uTime * 1.3) * sin(p.y * 6.4 - uTime * 1.05);
    n.x += micro * 0.07;
    n.z += cos(p.x * 5.1 - p.y * 4.4 + uTime) * 0.05;
    n = normalize(n);

    vec3 viewDir = normalize(cameraPosition - vWorld);
    vec3 deep = mix(vec3(0.004, 0.003, 0.008), vec3(0.035, 0.032, 0.034), uDay);
    float fres = pow(1.0 - clamp(dot(n, viewDir), 0.0, 1.0), 4.0);
    vec3 color = deep + vec3(0.02, 0.018, 0.03) * fres * (1.0 - uDay * 0.4);

    vec3 refl = vec3(0.0);
    vec2 camXZ = cameraPosition.xz;
    vec2 viewFwd = p - camXZ;
    float viewLen = length(viewFwd);
    vec2 vd = viewFwd / max(viewLen, 0.001);

    for (int i = 0; i < 16; i++) {
      float gain = uGain[i];
      if (gain < 0.001) continue;
      vec2 lp = uPos[i].xz;
      vec2 toL = lp - p;
      float along = dot(toL, vd);
      float across = length(toL - vd * along);
      float tight = uTight[i];
      float band = exp(-across * across * mix(0.9, 26.0, tight));
      float gate = smoothstep(-0.6, 1.6, along) * exp(-max(along, 0.0) * mix(0.018, 0.055, tight));
      float shim = 0.6 + 0.4 * sin(across * 16.0 + along * 2.6 + uTime * 1.6 + float(i) * 1.7);
      float distL = length(toL);
      float atten = gain / (1.0 + distL * distL * 0.0035);
      vec3 tint = uCol[i];
      refl += tint * band * gate * shim * atten * 2.1;
      float core = exp(-distL * distL * mix(0.12, 0.9, tight)) * gain * 0.45;
      refl += tint * core;
    }

    float near = smoothstep(0.3, 4.5, viewLen);
    refl *= mix(0.55, 1.0, near);
    refl *= mix(1.0, 0.55, uDay);
    color += min(refl, vec3(3.2));

    float sy = sin(uYaw);
    float cy = cos(uYaw);
    vec2 bd = p - uBoat.xz;
    float lz = bd.x * sy + bd.y * cy;
    float lx = bd.x * cy - bd.y * sy;
    float behind = clamp(-lz - 1.1, 0.0, 12.0);
    float wake = exp(-lx * lx * 1.8) * exp(-behind * 0.18) * uSpeed;
    color += vec3(0.22, 0.16, 0.12) * wake * 0.28;

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

  const uniforms = {
    uTime: { value: 0 },
    uDay: { value: 0 },
    uBoat: { value: new THREE.Vector3() },
    uYaw: { value: 0 },
    uSpeed: { value: 0 },
    uFogColor: { value: new THREE.Color(0x0c0612) },
    uFogDensity: { value: 0.034 },
    uPos: { value: positions },
    uCol: { value: colors },
    uGain: { value: new Float32Array(MAX_LIGHTS) },
    uTight: { value: new Float32Array(MAX_LIGHTS) },
  };

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

export function setWaterLights(uniforms, sources) {
  const gain = uniforms.uGain.value;
  const tight = uniforms.uTight.value;
  for (let i = 0; i < MAX_LIGHTS; i++) {
    const src = sources[i];
    if (!src) {
      gain[i] = 0;
      continue;
    }
    uniforms.uPos.value[i].copy(src.pos);
    uniforms.uCol.value[i].copy(src.color);
    gain[i] = src.gain;
    tight[i] = src.tight;
  }
}
