// ============================================================================
// easter.js — Hidden surprises: a shy alien on the beach, a UFO that drifts
// across the sky, and a secret message hidden beneath the planet.
// ============================================================================
import * as THREE from 'three';
import { latLonToVec3, PLANET_RADIUS } from './config.js';
import { surfaceRadiusAt } from './planet.js';
import { orientToSurface } from './surface.js';

export class EasterEggs {
  constructor(scene) {
    this.scene = scene;
    this.found = { alien: false };
    this._buildAlien();
    this._buildUFO();
    this._buildSecret();
    this.t = 0;
  }

  _buildAlien() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.3, 0.4, 4, 8),
      new THREE.MeshToonMaterial({ color: 0x6ce06c })
    );
    body.position.y = 0.6;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 12), new THREE.MeshToonMaterial({ color: 0x6ce06c }));
    head.position.y = 1.2;
    const eye1 = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    eye1.position.set(-0.13, 1.25, 0.28);
    const eye2 = eye1.clone(); eye2.position.x = 0.13;
    g.add(body, head, eye1, eye2);

    // Hidden behind the beach near a quiet spot.
    const dir = latLonToVec3(-20, -120, 1).normalize();
    const pos = dir.multiplyScalar(surfaceRadiusAt(dir) + 1);
    orientToSurface(g, pos, new THREE.Vector3(1, 0, 0));
    this.alien = g;
    this.alienPos = pos.clone();
    this.scene.add(g);
  }

  _buildUFO() {
    const g = new THREE.Group();
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(1.6, 2.2, 0.5, 20),
      new THREE.MeshToonMaterial({ color: 0xb0b0c0 })
    );
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(1.0, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshToonMaterial({ color: 0x88e0ff, transparent: true, opacity: 0.8 })
    );
    dome.position.y = 0.3;
    g.add(disc, dome);
    this.ufo = g;
    this.scene.add(g);
  }

  _buildSecret() {
    // A glowing message orb directly "below" the planet (opposite the start),
    // reachable by curious explorers who circle to the far side.
    const dir = latLonToVec3(-78, 60, 1).normalize();
    const pos = dir.multiplyScalar(surfaceRadiusAt(dir) + 1.2);
    const orb = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.8, 1),
      new THREE.MeshToonMaterial({ color: 0xff7ad9 })
    );
    orb.position.copy(pos);
    this.scene.add(orb);
    this.secretOrb = orb;
    this.secretPos = pos.clone();
  }

  /** @returns {string|null} an event name when the player triggers an egg */
  update(dt, playerPos) {
    this.t += dt;
    let event = null;

    // UFO orbits high above the planet.
    const r = PLANET_RADIUS + 18;
    this.ufo.position.set(
      Math.cos(this.t * 0.25) * r,
      Math.sin(this.t * 0.15) * 10,
      Math.sin(this.t * 0.25) * r
    );
    this.ufo.rotation.y += dt * 0.6;

    // Alien wiggles; reveal toast once when the player gets close.
    this.alien.position.copy(this.alienPos);
    this.alien.position.y += Math.sin(this.t * 3) * 0.05;
    if (!this.found.alien && playerPos.distanceTo(this.alienPos) < 3) {
      this.found.alien = true;
      event = 'alien';
    }

    // Secret orb pulses.
    this.secretOrb.rotation.y += dt;
    const s = 1 + Math.sin(this.t * 2) * 0.1;
    this.secretOrb.scale.setScalar(s);
    if (!this.found.secret && playerPos.distanceTo(this.secretPos) < 3) {
      this.found.secret = true;
      event = 'secret';
    }

    return event;
  }
}
