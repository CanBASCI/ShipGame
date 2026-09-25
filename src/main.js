import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createWater, setWaterLights } from './water.js';
import { createBoat } from './boat.js';
import { createWorld } from './world.js';
import { createBats } from './bats.js';

const canvas = document.getElementById('c');
const hint = document.getElementById('hint');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  powerPreference: 'high-performance',
  preserveDrawingBuffer: true,
});
renderer.setClearColor(0x05010c, 1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.82;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05010c);
scene.fog = new THREE.FogExp2(0x0c0612, 0.034);

const camera = new THREE.PerspectiveCamera(42, 1, 0.08, 280);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.24, 0.4, 1.08);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const ambient = new THREE.AmbientLight(0x1a1028, 0.012);
scene.add(ambient);
const hemi = new THREE.HemisphereLight(0x241430, 0x000000, 0.03);
scene.add(hemi);
const moon = new THREE.DirectionalLight(0x6e6290, 0.045);
moon.position.set(-18, 24, -8);
scene.add(moon);

// Sivaln's full-moon photograph, ahead of the boat on the canal centerline.
const MOON_AHEAD = 30;
const MOON_HEIGHT = 9.2;
const fullMoonTex = new THREE.TextureLoader().load('/assets/moon/full-moon.png');
fullMoonTex.colorSpace = THREE.SRGBColorSpace;
const fullMoon = new THREE.Sprite(new THREE.SpriteMaterial({
  map: fullMoonTex,
  transparent: true,
  depthWrite: false,
  fog: false,
}));
fullMoon.renderOrder = 8;
fullMoon.scale.set(3.075, 3.075, 1);
fullMoon.position.set(0, MOON_HEIGHT, MOON_AHEAD);
scene.add(fullMoon);
const moonColor = new THREE.Color(0xd5e0ff);
// Median of Sivaln's moon photograph, so the streak matches the disc.
const moonReflect = new THREE.Color(0xe5bc7b);
const moonStreak = new THREE.Vector3();
const headPos = new THREE.Vector3();
const headAim = new THREE.Vector3();
const moonlight = new THREE.DirectionalLight(moonColor, 0);
moonlight.position.set(0, MOON_HEIGHT, MOON_AHEAD);
scene.add(moonlight);
scene.add(moonlight.target);

const world = createWorld(scene);
const bats = createBats(scene);
const water = createWater();
scene.add(water.mesh);
const boat = createBoat();
scene.add(boat.group);

const fogNight = new THREE.Color(0x0c0612);
const fogDay = new THREE.Color(0x6a5e5c);
const keys = new Set();
let time = 0;
let paused = false;
let hintHidden = false;
const camPos = new THREE.Vector3(0, 1.64, -3.85);
const lookAt = new THREE.Vector3(0, 1.22, 14);
const desiredPos = new THREE.Vector3();
const desiredLook = new THREE.Vector3();
const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);
const reflectionScratch = [];
const boatLanternColor = new THREE.Color(0xffb45a);

function hideHint() {
  if (hintHidden) return;
  hintHidden = true;
  hint.classList.add('hide');
}

let dayHold = 0;
const tune = { fog: true, bamboo: 0.3, water: 0.5, tree: 1.5, fener: 0.6, spread: 0.3 };
world.setTune(tune);

function dayAmount() {
  return dayHold;
}

function inputState(day) {
  return {
    forward: keys.has('KeyW') || keys.has('ArrowUp'),
    brake: keys.has('KeyS') || keys.has('ArrowDown'),
    turnLeft: keys.has('KeyA') || keys.has('ArrowLeft'),
    turnRight: keys.has('KeyD') || keys.has('ArrowRight'),
    day,
  };
}

function pressCode(code) {
  keys.add(code);
}

function releaseCode(code) {
  keys.delete(code);
}

window.addEventListener('keydown', (event) => {
  if (event.repeat) return;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) {
    event.preventDefault();
  }
  pressCode(event.code);
});

window.addEventListener('keyup', (event) => {
  releaseCode(event.code);
});

window.addEventListener('blur', () => keys.clear());

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const pr = Math.min(window.devicePixelRatio || 1, 1.6);
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h, false);
  composer.setPixelRatio(pr);
  composer.setSize(w, h);
}

window.addEventListener('resize', resize);
resize();

function updateCamera(dt, jump) {
  forward.set(Math.sin(boat.state.yaw), 0, Math.cos(boat.state.yaw));
  right.crossVectors(forward, up).normalize();
  desiredPos
    .copy(boat.group.position)
    .addScaledVector(forward, -3.85)
    .addScaledVector(up, 1.64)
    .addScaledVector(right, 0.1);
  desiredLook
    .copy(boat.group.position)
    .addScaledVector(forward, 15)
    .addScaledVector(up, 1.22);
  const k = jump ? 1 : 1 - Math.exp(-1.7 * dt);
  camPos.lerp(desiredPos, k);
  lookAt.lerp(desiredLook, jump ? 1 : 1 - Math.exp(-2.1 * dt));
  camera.position.copy(camPos);
  camera.lookAt(lookAt);
}

function update(dt) {
  const day = dayAmount();
  time += dt;
  boat.update(dt, time, inputState(day));
  if (Math.abs(boat.state.speed) > 0.05 || Math.abs(boat.state.yaw) > 0.02) hideHint();

  world.update(boat.group.position, time, day, boat.state.yaw);
  bats.update(boat.group.position, time, boat.state.yaw);
  boat.headlight.getWorldPosition(headPos);
  boat.headlight.target.getWorldPosition(headAim);
  headAim.sub(headPos);
  if (headAim.lengthSq() > 1e-6) headAim.normalize();
  const movingForward = boat.headlight.intensity > 0;
  const headAngle = Math.min(Math.PI * 0.5 - 0.02, 0.5 * tune.spread);
  boat.headlight.angle = headAngle;
  if (movingForward) boat.headlight.intensity = 42 * tune.fener;
  const headAmt = movingForward ? tune.fener : 0;
  const headSpread = Math.tan(headAngle);
  world.mist.uniforms.uBow.value.copy(headPos);
  world.mist.uniforms.uFwd.value.copy(headAim);
  world.mist.uniforms.uHead.value = headAmt;
  world.mist.uniforms.uHeadSpread.value = headSpread;
  water.uniforms.uHeadPos.value.copy(headPos);
  water.uniforms.uHeadDir.value.copy(headAim);
  water.uniforms.uHead.value = headAmt;
  water.uniforms.uHeadSpread.value = headSpread;
  scene.fog.color.copy(fogNight).lerp(fogDay, day);
  scene.fog.density = world.fogDensity.value;
  world.fogColor.copy(scene.fog.color);

  water.mesh.position.z = boat.state.z;
  water.uniforms.uTime.value = time;
  water.uniforms.uDay.value = day;
  water.uniforms.uBoat.value.copy(boat.group.position);
  water.uniforms.uYaw.value = boat.state.yaw;
  water.uniforms.uSpeed.value = Math.abs(boat.state.speed);
  water.uniforms.uFogColor.value.copy(scene.fog.color);
  water.uniforms.uFogDensity.value = scene.fog.density;

  reflectionScratch.length = 0;
  const lanternPos = boat.lanternPosition();
  boatLanternColor.set(0xffb45a).lerp(new THREE.Color(0xffc48a), day * 0.3);
  reflectionScratch.push({
    pos: lanternPos.clone(),
    color: boatLanternColor.clone(),
    gain: 1.51875,
    tight: 0.9,
    patch: true,
  });
  const night = 1 - day;
  fullMoon.position.set(0, MOON_HEIGHT, boat.state.z + MOON_AHEAD);
  fullMoon.material.opacity = night;
  moonlight.position.copy(fullMoon.position);
  moonlight.target.position.set(0, 1.2, boat.state.z);
  moonlight.intensity = 0.07 * night;
  if (night > 0.04) {
    // Water plane is 240 long and centered on the boat, so +120 is the far edge.
    moonStreak.set(0, 0, boat.state.z + 120);
    reflectionScratch.push({
      pos: moonStreak,
      color: moonReflect,
      gain: 0.315 * night,
      tight: 0.35,
      streak: true,
    });
  }
  world.reflections(boat.group.position, reflectionScratch, boat.state.yaw);
  setWaterLights(water.uniforms, reflectionScratch);

  ambient.intensity = THREE.MathUtils.lerp(0.012, 0.16, day);
  ambient.color.set(0x1a1028).lerp(new THREE.Color(0xffe0c8), day);
  hemi.intensity = THREE.MathUtils.lerp(0.025, 0.14, day);
  hemi.color.set(0x241430).lerp(new THREE.Color(0xd8c2b0), day);
  moon.intensity = THREE.MathUtils.lerp(0.04, 0.26, day);
  moon.color.set(0x6e6290).lerp(new THREE.Color(0xffd2b0), day);
  renderer.toneMappingExposure = 0.74 + day * 0.2;

  updateCamera(dt, false);
}

updateCamera(0, true);
update(0);
composer.render();

let last = performance.now();
let frames = 0;

function frame(now) {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  if (!paused) {
    update(dt);
    composer.render();
  }
  frames += 1;
  if (frames > 8) window.__ship.ready = true;
  paintTune();
  requestAnimationFrame(frame);
}

const errors = [];
const origError = console.error.bind(console);
console.error = (...args) => {
  errors.push(args.map((item) => String(item)).join(' '));
  origError(...args);
};
window.addEventListener('error', (event) => {
  errors.push(String(event.message || event.error || 'error'));
});

const TUNE_STEP = 1.1;
const fogToggle = document.getElementById('fog-toggle');
const daySlider = document.getElementById('day-slider');
const dayVal = document.getElementById('day-val');

function paintTune() {
  for (const el of document.querySelectorAll('.tune-val')) {
    el.textContent = tune[el.dataset.val].toFixed(1);
  }
  dayVal.textContent = dayAmount().toFixed(1);
}

function applyTune() {
  world.setTune(tune);
  paintTune();
}

fogToggle.addEventListener('click', () => {
  tune.fog = !tune.fog;
  fogToggle.setAttribute('aria-pressed', String(tune.fog));
  applyTune();
});

document.getElementById('tune').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-tune]');
  if (!button) return;
  const key = button.dataset.tune;
  const next = tune[key] * (Number(button.dataset.dir) > 0 ? TUNE_STEP : 1 / TUNE_STEP);
  tune[key] = Math.min(4, Math.max(0.25, next));
  applyTune();
});

function holdDayFromSlider() {
  dayHold = Number(daySlider.value);
  paintTune();
}

daySlider.addEventListener('input', holdDayFromSlider);
daySlider.addEventListener('change', holdDayFromSlider);

window.__ship = {
  ready: false,
  errors,
  pause(value) {
    paused = value;
  },
  step(dt) {
    const started = performance.now();
    update(dt);
    composer.render();
    renderer.getContext().finish();
    window.__ship.lastFrameMs = performance.now() - started;
    frames += 1;
    window.__ship.ready = true;
  },
  sim(dt) {
    update(dt);
  },
  press(code) {
    pressCode(code);
  },
  release(code) {
    releaseCode(code);
  },
  setTime(t) {
    time = t;
  },
  reset() {
    keys.clear();
    boat.reset();
    hintHidden = false;
    hint.classList.remove('hide');
  },
  state() {
    const ahead = boat.group.position.clone();
    ahead.x += Math.sin(boat.state.yaw) * 6;
    ahead.z += Math.cos(boat.state.yaw) * 6;
    const center = boat.group.position.clone();
    ahead.project(camera);
    center.project(camera);
    return {
      x: boat.state.x,
      z: boat.state.z,
      yaw: boat.state.yaw,
      yawRate: boat.state.yawRate,
      speed: boat.state.speed,
      day: dayAmount(),
      dayHeld: dayHold != null,
      tune: { ...tune },
      time,
      hintHidden,
      bowX: ahead.x,
      centerX: center.x,
      blades: (() => {
        const blades = boat.blades();
        const project = (point) => {
          const p = point.clone();
          p.project(camera);
          return p.x;
        };
        return {
          left: blades.left,
          right: blades.right,
          strokeLeft: blades.strokeLeft,
          strokeRight: blades.strokeRight,
          leftScreenX: project(blades.leftPoint),
          rightScreenX: project(blades.rightPoint),
        };
      })(),
      hint: hint.textContent,
    };
  },
};

const manual = new URLSearchParams(location.search).has('manual');
if (manual) window.__ship.ready = true;
else requestAnimationFrame(frame);
