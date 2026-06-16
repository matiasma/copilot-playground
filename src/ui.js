// ============================================================================
// ui.js — HUD: quest tracker, direction arrow, interact prompt, inventory,
// speech bubbles, floating emojis, emoji wheel, toasts. Handles projecting
// world positions to screen each frame.
// ============================================================================
import * as THREE from 'three';
import { EMOJIS } from './config.js';

export class UI {
  constructor(camera, renderer) {
    this.camera = camera;
    this.renderer = renderer;

    this.tracker = document.getElementById('quest-tracker');
    this.trackerTitle = this.tracker.querySelector('.quest-title');
    this.trackerSub = this.tracker.querySelector('.quest-sub');
    this.arrow = document.getElementById('direction-arrow');
    this.prompt = document.getElementById('interact-prompt');
    this.inventory = document.getElementById('inventory');
    this.invItem = this.inventory.querySelector('.inv-item');
    this.bubbleLayer = document.getElementById('bubble-layer');
    this.toastEl = document.getElementById('toast');
    this.wheel = document.getElementById('emoji-wheel');

    this._anchors = []; // { el, worldPos, expire }
    this._proj = new THREE.Vector3();
    this._buildWheel();
  }

  setQuest({ title, sub }) {
    this.trackerTitle.textContent = title;
    this.trackerSub.textContent = sub;
  }

  setInventory(item) {
    if (item) { this.invItem.textContent = item; this.inventory.classList.remove('hidden'); }
    else this.inventory.classList.add('hidden');
  }

  showPrompt(show, label = 'Falar') {
    this.prompt.innerHTML = `<span class="key">E</span> ${label}`;
    this.prompt.classList.toggle('hidden', !show);
  }

  toast(text, ms = 2200) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  // ----- World-anchored elements -----
  _project(worldPos) {
    this._proj.copy(worldPos).project(this.camera);
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;
    return {
      x: (this._proj.x * 0.5 + 0.5) * w,
      y: (-this._proj.y * 0.5 + 0.5) * h,
      visible: this._proj.z < 1,
    };
  }

  showBubble(worldPos, text, name) {
    const el = document.createElement('div');
    el.className = 'speech-bubble';
    el.innerHTML = (name ? `<div class="npc-name">${name}</div>` : '') +
      `<div>${text}</div>`;
    this.bubbleLayer.appendChild(el);
    const anchor = { el, worldPos: worldPos.clone(), expire: performance.now() + 5200 };
    this._anchors.push(anchor);
    return anchor;
  }

  showThinking(worldPos, name) {
    const el = document.createElement('div');
    el.className = 'speech-bubble thinking';
    el.innerHTML = `<div class="npc-name">${name}</div><div>…</div>`;
    this.bubbleLayer.appendChild(el);
    const anchor = { el, worldPos: worldPos.clone(), expire: performance.now() + 8000 };
    this._anchors.push(anchor);
    return anchor;
  }

  removeAnchor(anchor) {
    if (!anchor) return;
    anchor.el.remove();
    const i = this._anchors.indexOf(anchor);
    if (i >= 0) this._anchors.splice(i, 1);
  }

  floatEmoji(worldPos, emoji) {
    const el = document.createElement('div');
    el.className = 'float-emoji';
    el.textContent = emoji;
    this.bubbleLayer.appendChild(el);
    const anchor = { el, worldPos: worldPos.clone(), expire: performance.now() + 2400, fixed: true };
    this._anchors.push(anchor);
    setTimeout(() => this.removeAnchor(anchor), 2400);
  }

  updateArrow(targetWorldPos) {
    if (!targetWorldPos) { this.arrow.classList.add('hidden'); return; }
    const p = this._project(targetWorldPos);
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;
    const cx = w / 2, cy = h / 2;
    let dx = p.x - cx, dy = p.y - cy;
    if (!p.visible) { dx = -dx; dy = -dy; }
    const ang = Math.atan2(dy, dx);
    // place arrow on a ring around the centre
    const ring = Math.min(w, h) * 0.32;
    const ax = cx + Math.cos(ang) * ring;
    const ay = cy + Math.sin(ang) * ring;
    this.arrow.style.left = ax + 'px';
    this.arrow.style.top = ay + 'px';
    this.arrow.style.transform = `translate(-50%,-50%) rotate(${ang}rad)`;
    // hide if the target is comfortably on-screen & near centre
    const near = p.visible && Math.hypot(dx, dy) < ring * 0.6;
    this.arrow.classList.toggle('hidden', near);
  }

  /** Reposition all world-anchored DOM elements; cull expired ones. */
  update() {
    const now = performance.now();
    for (let i = this._anchors.length - 1; i >= 0; i--) {
      const a = this._anchors[i];
      if (!a.fixed && now > a.expire) { this.removeAnchor(a); continue; }
      const p = this._project(a.worldPos);
      a.el.style.left = p.x + 'px';
      a.el.style.top = p.y + 'px';
      a.el.style.display = p.visible ? '' : 'none';
    }
  }

  // ----- Emoji wheel -----
  _buildWheel() {
    EMOJIS.forEach((emoji, i) => {
      const a = (i / EMOJIS.length) * Math.PI * 2 - Math.PI / 2;
      const el = document.createElement('div');
      el.className = 'wheel-emoji';
      el.textContent = emoji;
      el.style.left = (110 + Math.cos(a) * 85) + 'px';
      el.style.top = (110 + Math.sin(a) * 85) + 'px';
      el.addEventListener('click', () => { if (this.onEmoji) this.onEmoji(emoji); this.hideWheel(); });
      this.wheel.appendChild(el);
    });
  }
  showWheel() { this.wheel.classList.remove('hidden'); }
  hideWheel() { this.wheel.classList.add('hidden'); }
  toggleWheel() { this.wheel.classList.toggle('hidden'); }
  isWheelOpen() { return !this.wheel.classList.contains('hidden'); }
}
