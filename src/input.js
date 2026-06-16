// ============================================================================
// input.js — Unified input: keyboard + mouse drag + mobile joystick/buttons.
// Exposes a polled movement state and edge-triggered action flags.
// ============================================================================
import * as THREE from 'three';

export class Input {
  constructor(domElement) {
    this.dom = domElement;
    this.keys = new Set();
    this.move = { x: 0, z: 0 };
    this.run = false;
    this._jumpQueued = false;
    this._interactQueued = false;
    this.onDrag = null;   // (dx, dy) => void
    this.onZoom = null;   // (delta) => void
    this.onEmojiHold = null; // (down:boolean) => void

    this._dragging = false;
    this._lastX = 0; this._lastY = 0;
    this._dragPointerId = null;
    this._joyActive = false;
    this._joyVec = new THREE.Vector2();

    this._bindKeyboard();
    this._bindPointer();
    this._bindMobile();
  }

  // ----- Keyboard -----
  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (k === ' ' || k === 'spacebar') { this._jumpQueued = true; e.preventDefault(); }
      if (k === 'e' || k === 'enter') this._interactQueued = true;
      if (k === 'q' && this.onEmojiHold) this.onEmojiHold(true);
    });
    window.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      this.keys.delete(k);
      if (k === 'q' && this.onEmojiHold) this.onEmojiHold(false);
    });
    window.addEventListener('blur', () => this.keys.clear());
  }

  // ----- Mouse / pointer drag for camera -----
  _bindPointer() {
    const el = this.dom;
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return; // touch handled separately
      this._dragging = true;
      this._lastX = e.clientX; this._lastY = e.clientY;
    });
    window.addEventListener('pointermove', (e) => {
      if (!this._dragging) return;
      const dx = (e.clientX - this._lastX) * 0.005;
      const dy = (e.clientY - this._lastY) * 0.005;
      this._lastX = e.clientX; this._lastY = e.clientY;
      if (this.onDrag) this.onDrag(dx, dy);
    });
    window.addEventListener('pointerup', () => { this._dragging = false; });
    el.addEventListener('wheel', (e) => {
      if (this.onZoom) this.onZoom(e.deltaY * 0.01);
      e.preventDefault();
    }, { passive: false });
  }

  // ----- Mobile joystick + camera drag on right side -----
  _bindMobile() {
    const zone = document.getElementById('joystick-zone');
    const thumb = document.getElementById('joystick-thumb');
    if (!zone) return;
    const base = document.getElementById('joystick-base');
    const radius = 50;

    const setThumb = (dx, dy) => {
      thumb.style.left = (35 + dx) + 'px';
      thumb.style.top = (35 + dy) + 'px';
    };

    zone.addEventListener('touchstart', (e) => { this._joyActive = true; e.preventDefault(); }, { passive: false });
    zone.addEventListener('touchmove', (e) => {
      const t = e.touches[0];
      const rect = base.getBoundingClientRect();
      let dx = t.clientX - (rect.left + rect.width / 2);
      let dy = t.clientY - (rect.top + rect.height / 2);
      const len = Math.hypot(dx, dy);
      if (len > radius) { dx = dx / len * radius; dy = dy / len * radius; }
      setThumb(dx, dy);
      this._joyVec.set(dx / radius, dy / radius);
      e.preventDefault();
    }, { passive: false });
    const end = () => { this._joyActive = false; this._joyVec.set(0, 0); setThumb(0, 0); };
    zone.addEventListener('touchend', end);
    zone.addEventListener('touchcancel', end);

    // Camera drag via touch anywhere on canvas (not over UI).
    this.dom.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      this._camTouchId = t.identifier;
      this._lastX = t.clientX; this._lastY = t.clientY;
    }, { passive: true });
    this.dom.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== this._camTouchId) continue;
        const dx = (t.clientX - this._lastX) * 0.006;
        const dy = (t.clientY - this._lastY) * 0.006;
        this._lastX = t.clientX; this._lastY = t.clientY;
        if (this.onDrag) this.onDrag(dx, dy);
      }
    }, { passive: true });

    document.getElementById('btn-jump')?.addEventListener('click', () => { this._jumpQueued = true; });
    document.getElementById('btn-action')?.addEventListener('click', () => { this._interactQueued = true; });
  }

  /** Poll the current movement axes (call once per frame). */
  poll() {
    let x = 0, z = 0;
    if (this.keys.has('w') || this.keys.has('arrowup')) z += 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) z -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) x += 1;
    if (this.keys.has('a') || this.keys.has('arrowleft')) x -= 1;
    this.run = this.keys.has('shift');

    if (this._joyActive) {
      x += this._joyVec.x;
      z -= this._joyVec.y; // up on joystick = forward
      if (Math.hypot(x, z) > 0.8) this.run = true;
    }
    this.move.x = THREE.MathUtils.clamp(x, -1, 1);
    this.move.z = THREE.MathUtils.clamp(z, -1, 1);
    return { x: this.move.x, z: this.move.z, run: this.run };
  }

  consumeJump() { const j = this._jumpQueued; this._jumpQueued = false; return j; }
  consumeInteract() { const i = this._interactQueued; this._interactQueued = false; return i; }
  queueInteract() { this._interactQueued = true; }
  isKey(k) { return this.keys.has(k); }
}
