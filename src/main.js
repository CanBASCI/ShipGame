import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createWater, setWaterLights } from './water.js';
import { createBoat } from './boat.js';
import { createWorld } from './world.js';

const CYCLE = 180;

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
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.32, 0.55, 1.05);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const ambient = new THREE.AmbientLight(0x1a1028, 0.012);
scene.add(ambient);
const hemi = new THREE.HemisphereLight(0x241430, 0x000000, 0.03);
scene.add(hemi);
const moon = new THREE.DirectionalLight(0x6e6290, 0.045);
moon.position.set(-18, 24, -8);
scene.add(moon);

const world = createWorld(scene);
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

function dayAmount() {
  return 0.5 - 0.5 * Math.cos((time / CYCLE) * Math.PI * 2);
}

function inputState(day) {
  const throttle = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const steer = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  return {
    throttle,
    steer,
    left: keys.has('KeyQ'),
    right: keys.has('KeyE'),
    day,
  };
}

function pressCode(code) {
  keys.add(code);
  hideHint();
  if (code === 'KeyQ') boat.tryStroke('left');
  if (code === 'KeyE') boat.tryStroke('right');
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
  if (Math.abs(boat.state.speed) > 0.2) hideHint();

  world.update(boat.group.position, time, day);
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
    gain: 2.15,
    tight: 0.82,
  });
  world.reflections(boat.group.position, reflectionScratch);
  setWaterLights(water.uniforms, reflectionScratch);

  ambient.intensity = THREE.MathUtils.lerp(0.012, 0.16, day);
  ambient.color.set(0x1a1028).lerp(new THREE.Color(0xffe0c8), day);
  hemi.intensity = THREE.MathUtils.lerp(0.025, 0.14, day);
  hemi.color.set(0x241430).lerp(new THREE.Color(0xd8c2b0), day);
  moon.intensity = THREE.MathUtils.lerp(0.04, 0.26, day);
  moon.color.set(0x6e6290).lerp(new THREE.Color(0xffd2b0), day);
  renderer.toneMappingExposure = 0.8 + day * 0.18;

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
  press(code) {
    pressCode(code);
  },
  release(code) {
    releaseCode(code);
  },
  setTime(t) {
    time = t;
  },
  state() {
    return {
      x: boat.state.x,
      z: boat.state.z,
      yaw: boat.state.yaw,
      speed: boat.state.speed,
      day: dayAmount(),
      time,
      hintHidden,
    };
  },
};

const manual = new URLSearchParams(location.search).has('manual');
if (manual) window.__ship.ready = true;
else requestAnimationFrame(frame);
