// ============================================================================
// audio.js — Fully procedural lo-fi soundtrack and SFX via the Web Audio API.
// No audio files needed; a gentle chord pad loops and short blips play for
// actions. Created lazily on the first user gesture (browser autoplay rules).
// ============================================================================

let ctx = null;
let musicGain = null;
let sfxGain = null;
let started = false;
let chordTimer = null;

// A simple, soothing chord progression (semitone offsets from a root).
const ROOT = 220; // A3
const PROGRESSION = [
  [0, 4, 7],    // A major
  [-3, 0, 4],   // F# minor-ish
  [-5, -1, 2],  // D
  [2, 5, 9],    // B minor-ish
];
let chordIndex = 0;

function semis(n) { return ROOT * Math.pow(2, n / 12); }

export function initAudio() {
  if (ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  musicGain = ctx.createGain();
  musicGain.gain.value = 0.4;
  musicGain.connect(ctx.destination);
  sfxGain = ctx.createGain();
  sfxGain.gain.value = 0.6;
  sfxGain.connect(ctx.destination);
}

export function startMusic() {
  if (!ctx || started) return;
  started = true;
  scheduleChord();
}

function scheduleChord() {
  if (!ctx) return;
  const now = ctx.currentTime;
  const chord = PROGRESSION[chordIndex % PROGRESSION.length];
  chordIndex++;

  chord.forEach((n, i) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = i === 0 ? 'sine' : 'triangle';
    osc.frequency.value = semis(n) / (i === 0 ? 2 : 1); // bass on first note
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.18, now + 0.6);
    g.gain.linearRampToValueAtTime(0.0, now + 3.6);
    osc.connect(g);
    g.connect(musicGain);
    osc.start(now);
    osc.stop(now + 3.8);
  });

  // soft arpeggio sparkle
  const sp = ctx.createOscillator();
  const spg = ctx.createGain();
  sp.type = 'sine';
  sp.frequency.value = semis(chord[2] + 12);
  spg.gain.setValueAtTime(0.0, now + 1.5);
  spg.gain.linearRampToValueAtTime(0.08, now + 1.6);
  spg.gain.linearRampToValueAtTime(0.0, now + 2.4);
  sp.connect(spg); spg.connect(musicGain);
  sp.start(now + 1.5); sp.stop(now + 2.5);

  chordTimer = setTimeout(scheduleChord, 3500);
}

function blip(freq, dur, type = 'square', vol = 0.3) {
  if (!ctx) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  g.gain.setValueAtTime(vol, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + dur);
  osc.connect(g); g.connect(sfxGain);
  osc.start(now); osc.stop(now + dur);
}

export const sfx = {
  step() { blip(140 + Math.random() * 30, 0.07, 'sine', 0.12); },
  jump() { if (!ctx) return; const n = ctx.currentTime; const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = 'square'; o.frequency.setValueAtTime(300, n); o.frequency.exponentialRampToValueAtTime(700, n + 0.15);
    g.gain.setValueAtTime(0.2, n); g.gain.exponentialRampToValueAtTime(0.001, n + 0.2);
    o.connect(g); g.connect(sfxGain); o.start(n); o.stop(n + 0.2); },
  land() { blip(180, 0.12, 'sine', 0.2); },
  talk() { blip(520, 0.08, 'triangle', 0.18); },
  deliver() { blip(660, 0.12, 'triangle', 0.25); setTimeout(() => blip(880, 0.18, 'triangle', 0.25), 120); },
  emoji() { blip(720, 0.1, 'sine', 0.2); },
  complete() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => blip(f, 0.25, 'triangle', 0.25), i * 140)); },
};

export function setMusicVolume(v01) { if (musicGain) musicGain.gain.value = 0.5 * v01; }
export function setSfxVolume(v01) { if (sfxGain) sfxGain.gain.value = v01; }
