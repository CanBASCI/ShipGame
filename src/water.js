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
  uniform float uPatch[16];
  uniform sampler2D uNormal;
  uniform sampler2D uRough;

  varying vec3 vWorld;

  float waveH(vec2 p) {
    float h = 0.0;
    h += sin(p.x * 0.72 + p.y * 0.28 + uTime * 0.48) * 0.018;
    h += sin(p.x * 1.55 - p.y * 1.05 + uTime * 0.72) * 0.008;
    h += sin(dot(p, vec2(2.6, -1.4)) + uTime * 1.15) * 0.0035;
    h += sin(p.x * 9.5 + p.y * 7.2 + uTime * 1.35) * 0.0016;
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

    for (int i = 0; i < 16; i++) {
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
      if (uPatch[i] > 0.5) {
        float soft = exp(-distL * distL * 2.2);
        refl += tint * soft * gain * 1.35;
      } else {
        refl += tint * band * gate * shim * atten * 5.2;
      }
    }

    float near = smoothstep(0.15, 3.2, viewLen);
    refl *= mix(0.72, 1.0, near);
    refl *= mix(1.0, 0.5, uDay);
    color += min(refl, vec3(4.5));

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
    uPatch: { value: new Float32Array(MAX_LIGHTS) },
    uNormal: { value: flatNormal },
    uRough: { value: flatRough },
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
    patch[i] = src.patch ? 1 : 0;
  }
}
