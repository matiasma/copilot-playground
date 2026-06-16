// ============================================================================
// main.js — Entry point. Boots the renderer, builds the world and runs the
// game loop, wiring together player, camera, NPCs, quests, UI, audio and the
// extra flavour systems (bots, easter eggs).
// ============================================================================
import * as THREE from 'three';

import { PLANET_RADIUS, STAND_HEIGHT } from './config.js';
import { buildPlanet } from './planet.js';
import { Player } from './player.js';
import { CameraRig } from './camera.js';
import { NPCManager } from './npc.js';
import { QuestManager } from './quest.js';
import { UI } from './ui.js';
import { Input } from './input.js';
import { BotManager } from './multiplayer.js';
import { EasterEggs } from './easter.js';
import { loadLook, saveLook, buildCustomizePanel } from './customization.js';
import { setApiKey, getDialogue, hasApiKey } from './dialogue.js';
import * as audio from './audio.js';

// ---------------------------------------------------------------------------
// Renderer / scene / camera
// ---------------------------------------------------------------------------
const root = document.getElementById('game-root');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
root.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x16263b);
scene.fog = new THREE.Fog(0x16263b, 90, 200);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);
camera.position.set(0, 40, 40);

// Lights
const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x4a4030, 0.7);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff3da, 1.1);
sun.position.set(60, 80, 40);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 250;
sun.shadow.camera.left = -60;
sun.shadow.camera.right = 60;
sun.shadow.camera.top = 60;
sun.shadow.camera.bottom = -60;
scene.add(sun);
scene.add(new THREE.AmbientLight(0xffffff, 0.25));

// ---------------------------------------------------------------------------
// Loading sequence
// ---------------------------------------------------------------------------
const progressBar = document.getElementById('progress-bar');
const loadingTip = document.getElementById('loading-tip');
const loadingScreen = document.getElementById('loading-screen');
const startScreen = document.getElementById('start-screen');

let world, player, cameraRig, npcManager, questManager, ui, input, bots, eggs;
let look = loadLook();
let highQuality = true;

const steps = [
  ['Modelando o planeta…', () => { world = buildPlanet(scene, highQuality); }],
  ['Acordando os moradores…', () => { npcManager = new NPCManager(scene); }],
  ['Convocando outros carteiros…', () => { bots = new BotManager(scene, 4); }],
  ['Escondendo segredos…', () => { eggs = new EasterEggs(scene); }],
  ['Quase lá…', () => {
    questManager = new QuestManager();
    cameraRig = new CameraRig(camera);
    ui = new UI(camera, renderer);
    input = new Input(renderer.domElement);
    player = new Player(scene, look);
  }],
];

async function runLoading() {
  for (let i = 0; i < steps.length; i++) {
    const [tip, fn] = steps[i];
    loadingTip.textContent = tip;
    progressBar.style.width = Math.round(((i + 1) / steps.length) * 100) + '%';
    // Yield so the browser can paint the progress bar.
    await new Promise((r) => setTimeout(r, 120));
    fn();
  }
  loadingScreen.classList.add('hidden');
  startScreen.classList.remove('hidden');
}

// ---------------------------------------------------------------------------
// Start screen -> game
// ---------------------------------------------------------------------------
document.getElementById('start-button').addEventListener('click', startGame);

function startGame() {
  const key = document.getElementById('api-key').value;
  if (key) setApiKey(key);
  const playerName = (document.getElementById('player-name').value || 'Carteiro').trim();

  startScreen.classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');

  // Mobile controls
  if (isTouch()) {
    document.getElementById('joystick-zone').classList.remove('hidden');
    document.getElementById('mobile-buttons').classList.remove('hidden');
  }

  audio.initAudio();
  audio.startMusic();

  wireUI();
  questManager && refreshQuestHUD();
  ui.toast(`Bem-vindo(a), ${playerName}! Encontre o pescador na praia. 🏖️`, 4000);
  loop();
}

function isTouch() {
  return ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
}

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------
function wireUI() {
  // Emoji wheel: hold Q (desktop) or tap button.
  input.onEmojiHold = (down) => { down ? ui.showWheel() : ui.hideWheel(); };
  document.getElementById('btn-emote').addEventListener('click', () => ui.toggleWheel());
  ui.onEmoji = (emoji) => {
    const head = player.headPosition();
    ui.floatEmoji(head, emoji);
    audio.sfx.emoji();
  };

  // Camera drag / zoom
  input.onDrag = (dx, dy) => cameraRig.rotate(dx, dy, player.position.clone().normalize());
  input.onZoom = (d) => cameraRig.zoom(d);

  // Customize panel
  const custPanel = document.getElementById('customize-panel');
  const custOptions = document.getElementById('customize-options');
  buildCustomizePanel(custOptions, look, (newLook) => {
    player.setLook(newLook);
    saveLook(newLook);
  });
  document.getElementById('btn-customize').addEventListener('click', () => custPanel.classList.toggle('hidden'));
  document.getElementById('close-customize').addEventListener('click', () => custPanel.classList.add('hidden'));

  // Settings panel
  const setPanel = document.getElementById('settings-panel');
  document.getElementById('btn-settings').addEventListener('click', () => setPanel.classList.toggle('hidden'));
  document.getElementById('close-settings').addEventListener('click', () => setPanel.classList.add('hidden'));
  document.getElementById('music-volume').addEventListener('input', (e) => audio.setMusicVolume(e.target.value / 100));
  document.getElementById('sfx-volume').addEventListener('input', (e) => audio.setSfxVolume(e.target.value / 100));
  document.getElementById('quality-toggle').addEventListener('change', (e) => {
    renderer.shadowMap.enabled = e.target.checked;
    scene.traverse((o) => { if (o.isMesh) o.castShadow = e.target.checked && o.castShadow; });
  });

  // Keyboard shortcut: C toggles customize
  window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'c') custPanel.classList.toggle('hidden');
  });
}

function refreshQuestHUD() {
  ui.setQuest(questManager.hud());
  ui.setInventory(questManager.carriedItem());
}

// ---------------------------------------------------------------------------
// Interaction with NPCs
// ---------------------------------------------------------------------------
let dialogueBusy = false;

async function interactWith(npc) {
  if (dialogueBusy) return;
  dialogueBusy = true;

  const headPos = npc.group.position.clone()
    .addScaledVector(npc.group.position.clone().normalize(), 2.4);

  const { stage, effect } = questManager.interaction(npc.id);

  // The oracle answers free questions when an API key is set.
  let userText = '';
  if (npc.id === 'oracle') {
    const q = window.prompt('Pergunte ao Oráculo (ou deixe em branco):', '');
    userText = q || '';
  }

  audio.sfx.talk();
  let thinking = null;
  if (npc.id === 'oracle' || stageNeedsWait()) thinking = ui.showThinking(headPos, npc.data.name);

  let line;
  try {
    line = await getDialogue(npc.id, npc.data, stage, userText);
  } finally {
    ui.removeAnchor(thinking);
  }
  ui.showBubble(headPos, line, npc.data.name);

  if (effect) {
    const status = questManager.applyEffect(effect);
    if (status === 'pickup') {
      audio.sfx.deliver();
      ui.toast('📦 Você pegou: ' + questManager.quests[questManager.index].itemName);
    } else if (status === 'delivered') {
      audio.sfx.deliver();
      ui.toast('✅ Entrega concluída!');
    } else if (status === 'complete-all') {
      audio.sfx.complete();
      ui.toast('🎉 Todas as entregas feitas! Obrigado, carteiro!');
    }
    refreshQuestHUD();
  }

  dialogueBusy = false;
}

// Only show a "thinking" bubble when a live API call may take time.
function stageNeedsWait() { return hasApiKey(); }

// ---------------------------------------------------------------------------
// Game loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();
let stepTimer = 0;
let nearestNpc = null;

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  // --- Input & player ---
  const mv = input.poll();
  const wasGround = player.onGround;
  const jump = input.consumeJump();
  player.update(dt, { x: mv.x, z: mv.z, jump, run: mv.run }, cameraRig.forward);
  if (!wasGround && player.onGround) audio.sfx.land();
  if (jump && player.vertVel > 0) audio.sfx.jump();

  // footstep sfx
  if (player.onGround && player.speed01 > 0.1) {
    stepTimer -= dt;
    if (stepTimer <= 0) { audio.sfx.step(); stepTimer = 0.42 - player.speed01 * 0.18; }
  }

  cameraRig.update(player.position, dt);

  // --- World systems ---
  if (world.ocean.userData.update) world.ocean.userData.update(t);
  npcManager.update(t);
  bots.update(dt, (emoji, pos) => ui.floatEmoji(pos, emoji));
  const egg = eggs.update(dt, player.position);
  if (egg === 'alien') ui.toast('👽 Você encontrou o alienígena escondido!', 3000);
  if (egg === 'secret') ui.toast('💖 Um segredo brilhante no lado oculto do planeta!', 3000);

  // --- Interaction detection ---
  nearestNpc = npcManager.nearest(player.position, 3.4);
  if (nearestNpc) {
    const label = nearestNpc.id === 'oracle' ? 'Perguntar'
      : (questManager.interaction(nearestNpc.id).effect === 'deliver' ? 'Entregar' : 'Falar');
    ui.showPrompt(true, label);
    if (input.consumeInteract()) interactWith(nearestNpc);
  } else {
    ui.showPrompt(false);
    input.consumeInteract(); // discard
  }

  // --- HUD overlays ---
  const targetId = questManager.targetNpcId();
  const targetNpc = targetId ? npcManager.get(targetId) : null;
  ui.updateArrow(targetNpc ? targetNpc.group.position : null);
  ui.update();

  renderer.render(scene, camera);
}

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Kick off.
runLoading();
