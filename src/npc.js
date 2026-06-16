// ============================================================================
// npc.js — Creates NPC avatars on the planet surface and exposes proximity
// queries used by the interaction system.
// ============================================================================
import * as THREE from 'three';
import { buildAvatar } from './avatar.js';
import { orientToSurface } from './surface.js';
import { NPCS, latLonToVec3, DEFAULT_LOOK } from './config.js';
import { surfaceRadiusAt } from './planet.js';
import { STAND_HEIGHT } from './config.js';

export class NPCManager {
  constructor(scene) {
    this.scene = scene;
    this.npcs = {}; // id -> { id, data, group, position }
    this._build();
  }

  _build() {
    for (const [id, data] of Object.entries(NPCS)) {
      const look = { ...DEFAULT_LOOK, shirt: data.color, hair: 0x2b2b2b };
      const group = buildAvatar(look);

      const dir = latLonToVec3(data.lat, data.lon, 1).normalize();
      const pos = dir.multiplyScalar(surfaceRadiusAt(dir) + STAND_HEIGHT);

      // Face roughly "east" along the surface for variety.
      const face = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
      orientToSurface(group, pos, face);
      group.scale.setScalar(1.0);

      this.scene.add(group);

      // Oracle floats and glows.
      if (id === 'oracle') {
        group.position.addScaledVector(dir, 1.5);
        const glow = new THREE.Mesh(
          new THREE.SphereGeometry(1.4, 16, 16),
          new THREE.MeshBasicMaterial({ color: 0xf1c40f, transparent: true, opacity: 0.18 })
        );
        glow.position.y = 1.4;
        group.add(glow);
      }

      this.npcs[id] = { id, data, group, position: group.position.clone(), baseY: group.position.clone() };
    }
  }

  /** Returns the nearest NPC within `radius` of `pos`, or null. */
  nearest(pos, radius = 3.2) {
    let best = null, bestD = radius * radius;
    for (const npc of Object.values(this.npcs)) {
      const d = npc.group.position.distanceToSquared(pos);
      if (d < bestD) { bestD = d; best = npc; }
    }
    return best;
  }

  get(id) { return this.npcs[id]; }

  update(t) {
    // Idle bob for the oracle.
    const oracle = this.npcs.oracle;
    if (oracle) {
      const dir = oracle.position.clone().normalize();
      const bob = Math.sin(t * 1.5) * 0.25;
      oracle.group.position.copy(oracle.position).addScaledVector(dir, bob);
      oracle.group.rotateY(0.01);
    }
  }
}
