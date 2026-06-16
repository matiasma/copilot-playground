// ============================================================================
// camera.js — Third-person camera that follows the player across the sphere.
// Keeps a tangent "forward" vector that is parallel-transported each frame so
// there are no singularities at the poles. Mouse / touch drag rotates yaw and
// pitch; the same forward vector drives camera-relative movement.
// ============================================================================
import * as THREE from 'three';

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.forward = new THREE.Vector3(1, 0, 0); // tangent forward (transported)
    this.pitch = 0.5;        // radians above the horizon
    this.distance = 9;
    this.height = 2.2;

    this._up = new THREE.Vector3();
    this._desired = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this._camPos = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._initialized = false;
  }

  /** Rotate yaw (around local up) and adjust pitch from drag deltas. */
  rotate(dx, dy, up) {
    this._q.setFromAxisAngle(up, -dx);
    this.forward.applyQuaternion(this._q).normalize();
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy, -0.2, 1.2);
  }

  zoom(delta) {
    this.distance = THREE.MathUtils.clamp(this.distance + delta, 5, 16);
  }

  /** @param {THREE.Vector3} playerPos */
  update(playerPos, dt) {
    this._up.copy(playerPos).normalize();

    // Re-orthogonalise the forward vector against the (possibly changed) up.
    this.forward.addScaledVector(this._up, -this.forward.dot(this._up));
    if (this.forward.lengthSq() < 1e-6) {
      this.forward.set(this._up.z, this._up.x, this._up.y); // any tangent
      this.forward.addScaledVector(this._up, -this.forward.dot(this._up));
    }
    this.forward.normalize();

    // Camera sits behind the player along -forward, lifted by pitch.
    this._target.copy(playerPos).addScaledVector(this._up, this.height);
    const back = this.forward.clone().multiplyScalar(-Math.cos(this.pitch) * this.distance);
    const lift = this._up.clone().multiplyScalar(Math.sin(this.pitch) * this.distance);
    this._desired.copy(this._target).add(back).add(lift);

    if (!this._initialized) {
      this._camPos.copy(this._desired);
      this._initialized = true;
    } else {
      // Smooth follow.
      const k = 1 - Math.pow(0.0008, dt);
      this._camPos.lerp(this._desired, k);
    }

    this.camera.position.copy(this._camPos);
    this.camera.up.copy(this._up);
    this.camera.lookAt(this._target);
  }
}
