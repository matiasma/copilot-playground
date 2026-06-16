// ============================================================================
// avatar.js — Builds a simple procedural humanoid avatar from coloured
// primitives. Returned object exposes parts so colours can be re-tinted and
// limbs can be animated (walk cycle) by the caller.
// ============================================================================
import * as THREE from 'three';

export function buildAvatar(look) {
  const group = new THREE.Group();

  const mat = (hex) => new THREE.MeshToonMaterial({ color: hex });

  const skinMat = mat(look.skin);
  const hairMat = mat(look.hair);
  const shirtMat = mat(look.shirt);
  const pantsMat = mat(look.pants);
  const shoesMat = mat(look.shoes);

  // Torso
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.55, 4, 10), shirtMat);
  torso.position.y = 1.15;
  group.add(torso);

  // Head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.38, 18, 16), skinMat);
  head.position.y = 1.95;
  group.add(head);

  // Hair (a cap on top of the head)
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.4, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.62), hairMat);
  hair.position.y = 2.0;
  group.add(hair);

  // Eyes
  const eyeGeo = new THREE.SphereGeometry(0.05, 8, 8);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
  eyeL.position.set(-0.13, 1.98, 0.34);
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.13;
  group.add(eyeL, eyeR);

  // Arms (pivoted at the shoulder for swing animation)
  const armGeo = new THREE.CapsuleGeometry(0.12, 0.55, 4, 8);
  const armL = new THREE.Group();
  const armLMesh = new THREE.Mesh(armGeo, skinMat);
  armLMesh.position.y = -0.35;
  armL.add(armLMesh);
  armL.position.set(-0.5, 1.5, 0);
  const armR = armL.clone();
  armR.position.x = 0.5;
  group.add(armL, armR);

  // Legs (pivoted at the hip)
  const legGeo = new THREE.CapsuleGeometry(0.15, 0.55, 4, 8);
  const legL = new THREE.Group();
  const legLMesh = new THREE.Mesh(legGeo, pantsMat);
  legLMesh.position.y = -0.35;
  legL.add(legLMesh);
  const shoeL = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.16, 0.4), shoesMat);
  shoeL.position.set(0, -0.7, 0.08);
  legL.add(shoeL);
  legL.position.set(-0.22, 0.75, 0);
  const legR = legL.clone();
  legR.position.x = 0.22;
  group.add(legL, legR);

  // Shadow casters
  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });

  group.userData.parts = {
    skinMat, hairMat, shirtMat, pantsMat, shoesMat,
    armL, armR, legL, legR, head,
  };

  return group;
}

/** Re-tint an existing avatar in place. */
export function applyLook(avatar, look) {
  const p = avatar.userData.parts;
  p.skinMat.color.set(look.skin);
  p.hairMat.color.set(look.hair);
  p.shirtMat.color.set(look.shirt);
  p.pantsMat.color.set(look.pants);
  p.shoesMat.color.set(look.shoes);
}

/**
 * Animate a simple walk/idle cycle.
 * @param {Object} parts  avatar.userData.parts
 * @param {number} t      accumulated time
 * @param {number} speed01  0 = idle, 1 = full run (controls swing amplitude)
 */
export function animateAvatar(parts, t, speed01) {
  const amp = 0.15 + speed01 * 0.7;
  const freq = 6 + speed01 * 6;
  const s = Math.sin(t * freq) * amp;
  parts.legL.rotation.x = s;
  parts.legR.rotation.x = -s;
  parts.armL.rotation.x = -s * 0.8;
  parts.armR.rotation.x = s * 0.8;
  // gentle idle bob of the head
  parts.head.position.y = 1.95 + Math.sin(t * 2) * 0.02 * (1 - speed01);
}
