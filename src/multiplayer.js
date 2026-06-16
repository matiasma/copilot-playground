// ============================================================================
// multiplayer.js — Simulated multiplayer. A handful of bot "players" wander
// the planet, animate, and occasionally emit floating emojis. No backend.
// (A real WebSocket relay could replace this by feeding the same Bot.setState.)
// ============================================================================
import * as THREE from 'three';
import { buildAvatar, animateAvatar } from './avatar.js';
import { orientToSurface } from './surface.js';
import { surfaceRadiusAt } from './planet.js';
import { STAND_HEIGHT, PLANET_RADIUS, WALK_SPEED, CUSTOMIZATION, EMOJIS } from './config.js';

function randomDir() {
  return new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
}
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

const NAMES = ['Pip', 'Juno', 'Mochi', 'Bolt', 'Cleo', 'Ziggy', 'Noa'];

class Bot {
  constructor(scene) {
    const look = {
      skin: pick(CUSTOMIZATION.skin.colors),
      hair: pick(CUSTOMIZATION.hair.colors),
      shirt: pick(CUSTOMIZATION.shirt.colors),
      pants: pick(CUSTOMIZATION.pants.colors),
      shoes: pick(CUSTOMIZATION.shoes.colors),
    };
    this.group = buildAvatar(look);
    this.name = pick(NAMES);
    scene.add(this.group);

    this.dir = randomDir();
    this.target = randomDir();
    this.face = new THREE.Vector3(1, 0, 0);
    this.animTime = Math.random() * 10;
    this.emojiTimer = 3 + Math.random() * 6;
    this.position = new THREE.Vector3();
    this._snap();
  }

  _snap() {
    const r = surfaceRadiusAt(this.dir) + STAND_HEIGHT;
    this.position.copy(this.dir).multiplyScalar(r);
  }

  update(dt) {
    // Move along great circle toward target direction.
    const up = this.dir.clone().normalize();
    const toTarget = this.target.clone().addScaledVector(up, -this.target.dot(up));
    if (toTarget.lengthSq() < 1e-4 || this.dir.angleTo(this.target) < 0.05) {
      this.target = randomDir();
    } else {
      toTarget.normalize();
      const a = (WALK_SPEED * 0.6 * dt) / PLANET_RADIUS;
      this.dir.copy(up).multiplyScalar(Math.cos(a)).addScaledVector(toTarget, Math.sin(a)).normalize();
      this.face.copy(toTarget);
    }
    this._snap();
    orientToSurface(this.group, this.position, this.face);
    this.animTime += dt * 1.5;
    animateAvatar(this.group.userData.parts, this.animTime, 0.7);
  }
}

export class BotManager {
  constructor(scene, count = 4) {
    this.bots = [];
    for (let i = 0; i < count; i++) this.bots.push(new Bot(scene));
  }

  /** @param {(emoji:string, worldPos:THREE.Vector3)=>void} onEmoji */
  update(dt, onEmoji) {
    for (const bot of this.bots) {
      bot.update(dt);
      bot.emojiTimer -= dt;
      if (bot.emojiTimer <= 0) {
        bot.emojiTimer = 6 + Math.random() * 10;
        const head = bot.position.clone().addScaledVector(bot.dir.clone().normalize(), 1.8);
        onEmoji(pick(EMOJIS), head);
      }
    }
  }
}
