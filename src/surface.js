// ============================================================================
// surface.js — Helpers for living on a sphere: orient an object so its feet
// rest on the surface and it faces a given tangent direction.
// ============================================================================
import * as THREE from 'three';

const _up = new THREE.Vector3();
const _f = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();

/**
 * Orient `obj` at `position` (world) so +Y points away from the planet centre
 * and +Z (the avatar's facing) aligns with `faceDir` projected to the tangent
 * plane. If faceDir is degenerate the current orientation is kept.
 */
export function orientToSurface(obj, position, faceDir) {
  obj.position.copy(position);
  _up.copy(position).normalize();

  _f.copy(faceDir);
  _f.addScaledVector(_up, -_f.dot(_up)); // project onto tangent plane
  if (_f.lengthSq() < 1e-6) return;      // no clear facing -> keep current
  _f.normalize();

  _z.copy(_f);
  _x.crossVectors(_up, _z).normalize();
  _y.crossVectors(_z, _x).normalize();
  _m.makeBasis(_x, _y, _z);
  obj.quaternion.setFromRotationMatrix(_m);
}
