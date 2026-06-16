// ============================================================================
// player.js — The player avatar and its spherical movement controller.
// ============================================================================
import * as THREE from 'three';
import { buildAvatar, applyLook, animateAvatar } from './avatar.js';
import { orientToSurface } from './surface.js';
import {
  STAND_HEIGHT, GRAVITY, JUMP_SPEED, WALK_SPEED, RUN_SPEED, PLANET_RADIUS,
} from './config.js';
import { surfaceRadiusAt } from './planet.js';

export class Player {
  constructor(scene, look) {
    this.avatar = buildAvatar(look);
    scene.add(this.avatar);

    // Start on the beach near the fisherman.
    this.dir = new THREE.Vector3(0.2, -0.25, 1).normalize();
    this.position = new THREE.Vector3();
    this.face = new THREE.Vector3(1, 0, 0); // tangent facing direction
    this.jumpHeight = 0;
    this.vertVel = 0;
    this.onGround = true;
    this.animTime = 0;
    this.speed01 = 0;

    this._tmp = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._move = new THREE.Vector3();

    this._snapToSurface();
  }

  setLook(look) { applyLook(this.avatar, look); }

  _snapToSurface() {
    const r = surfaceRadiusAt(this.dir) + STAND_HEIGHT + this.jumpHeight;
    this.position.copy(this.dir).multiplyScalar(r);
  }

  /**
   * @param {number} dt
   * @param {{x:number,z:number,jump:boolean,run:boolean}} input  x=strafe, z=forward
   * @param {THREE.Vector3} camForward  tangent forward from the camera rig
   */
  update(dt, input, camForward) {
    const up = this._tmp.copy(this.dir).normalize();

    // Build movement direction in the tangent plane, camera-relative.
    this._right.crossVectors(camForward, up).normalize();
    this._move.set(0, 0, 0)
      .addScaledVector(camForward, input.z)
      .addScaledVector(this._right, input.x);

    const moving = this._move.lengthSq() > 1e-5;
    const speed = input.run ? RUN_SPEED : WALK_SPEED;

    if (moving) {
      this._move.normalize();
      // Rotate the unit direction along the great circle defined by `up` and
      // the tangent move direction: new = up*cos(a) + move*sin(a).
      const a = (speed * dt) / PLANET_RADIUS;
      this.dir.copy(up).multiplyScalar(Math.cos(a))
        .addScaledVector(this._move, Math.sin(a))
        .normalize();
      this.face.copy(this._move);
      this.speed01 = speed / RUN_SPEED;
    } else {
      this.speed01 = 0;
    }

    // Jump / gravity (radial)
    if (input.jump && this.onGround) {
      this.vertVel = JUMP_SPEED;
      this.onGround = false;
    }
    if (!this.onGround) {
      this.vertVel -= GRAVITY * dt;
      this.jumpHeight += this.vertVel * dt;
      if (this.jumpHeight <= 0) {
        this.jumpHeight = 0;
        this.vertVel = 0;
        this.onGround = true;
      }
    }

    this._snapToSurface();
    orientToSurface(this.avatar, this.position, this.face);

    // Walk animation
    this.animTime += dt * (0.5 + this.speed01 * 2);
    animateAvatar(this.avatar.userData.parts, this.animTime, this.speed01);
  }

  /** World position of the player's head, for camera targeting / bubbles. */
  headPosition(out = new THREE.Vector3()) {
    return out.copy(this.position).addScaledVector(this.dir.clone().normalize(), 1.6);
  }
}
