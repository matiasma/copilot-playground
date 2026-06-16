// ============================================================================
// planet.js — Builds the tiny spherical world: terrain with biome colours,
// cel-shaded materials, an ocean shell, decorative props (trees, rocks,
// buildings, temple, lighthouse, waterfall) and a starry backdrop.
// ============================================================================
import * as THREE from 'three';
import { PLANET_RADIUS, BIOMES, biomeForLat, latLonToVec3 } from './config.js';

const DEG2RAD = Math.PI / 180;

/** Small stepped gradient texture so MeshToonMaterial looks cel-shaded. */
export function makeToonGradient() {
  const colors = new Uint8Array([60, 110, 170, 230, 255]);
  const tex = new THREE.DataTexture(colors, colors.length, 1, THREE.RedFormat);
  tex.needsUpdate = true;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

const gradient = makeToonGradient();

function toonMat(color) {
  return new THREE.MeshToonMaterial({ color, gradientMap: gradient });
}

// Deterministic pseudo-random so the world is identical every run.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(1337);

/** Height offset (terrain relief) as a function of position on unit sphere. */
function terrainHeight(dir) {
  // A few smooth sine lobes -> rolling hills + one mountain near the north.
  const h =
    1.2 * Math.sin(dir.x * 2.1 + 1.0) * Math.cos(dir.z * 1.7) +
    0.8 * Math.sin(dir.y * 3.3 + 2.0) +
    0.6 * Math.cos(dir.x * 4.0) * Math.sin(dir.z * 3.0);
  // Mountain bump near north pole-ish (lat ~ 48)
  const mountainDir = latLonToVec3(48, 120, 1).normalize();
  const m = Math.max(0, dir.dot(mountainDir) - 0.6) * 14;
  return h + m;
}

/** Returns the surface radius (planet + terrain) along a given unit direction. */
export function surfaceRadiusAt(dirUnit) {
  return PLANET_RADIUS + Math.max(0, terrainHeight(dirUnit));
}

export function buildPlanet(scene, highQuality) {
  const root = new THREE.Group();
  scene.add(root);

  // --- Terrain mesh -------------------------------------------------------
  const geo = new THREE.IcosahedronGeometry(PLANET_RADIUS, 24);
  const pos = geo.attributes.position;
  const colorAttr = [];
  const color = new THREE.Color();
  const v = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const dir = v.clone().normalize();
    const r = surfaceRadiusAt(dir);
    v.copy(dir).multiplyScalar(r);
    pos.setXYZ(i, v.x, v.y, v.z);

    const lat = Math.asin(dir.y) / DEG2RAD;
    const biome = biomeForLat(lat);
    color.set(biome.name === 'ocean' ? 0x6fcf97 : biome.color);
    // subtle per-vertex variation
    const j = (rand() - 0.5) * 0.06;
    color.offsetHSL(0, 0, j);
    colorAttr.push(color.r, color.g, color.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colorAttr, 3));
  geo.computeVertexNormals();

  const terrainMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: gradient });
  const terrain = new THREE.Mesh(geo, terrainMat);
  terrain.receiveShadow = true;
  terrain.castShadow = true;
  root.add(terrain);

  // --- Inverted-hull outline (cartoon black edge) -------------------------
  const outlineMat = new THREE.MeshBasicMaterial({ color: 0x1a1a22, side: THREE.BackSide });
  const outline = new THREE.Mesh(geo.clone(), outlineMat);
  outline.scale.setScalar(1.012);
  root.add(outline);

  // --- Ocean shell --------------------------------------------------------
  const oceanGeo = new THREE.IcosahedronGeometry(PLANET_RADIUS - 0.4, 5);
  const oceanMat = new THREE.MeshToonMaterial({
    color: 0x3aa6c9, transparent: true, opacity: 0.85, gradientMap: gradient,
  });
  const ocean = new THREE.Mesh(oceanGeo, oceanMat);
  root.add(ocean);
  // animate the ocean with a gentle vertex wobble
  const oceanPos = oceanGeo.attributes.position;
  const oceanBase = oceanPos.array.slice();
  ocean.userData.update = (t) => {
    for (let i = 0; i < oceanPos.count; i++) {
      const ix = i * 3;
      const bx = oceanBase[ix], by = oceanBase[ix + 1], bz = oceanBase[ix + 2];
      const wob = 0.18 * Math.sin(t * 1.5 + bx * 0.5 + bz * 0.5);
      const len = Math.sqrt(bx * bx + by * by + bz * bz);
      const k = (len + wob) / len;
      oceanPos.array[ix] = bx * k;
      oceanPos.array[ix + 1] = by * k;
      oceanPos.array[ix + 2] = bz * k;
    }
    oceanPos.needsUpdate = true;
  };

  // --- Props --------------------------------------------------------------
  placeProps(root, highQuality);

  // --- Stars backdrop -----------------------------------------------------
  addStars(scene);

  return { root, terrain, ocean };
}

/** Orient an object so its local +Y points away from planet centre at pos. */
function orientUp(obj, pos, spin = 0) {
  const up = pos.clone().normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
  obj.position.copy(pos);
  obj.quaternion.copy(q);
  obj.rotateY(spin);
}

function tree() {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.26, 1.4, 7), toonMat(0x7a4b25));
  trunk.position.y = 0.7;
  const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(1.0, 1), toonMat(0x3c8d3f));
  leaves.position.y = 1.9;
  const leaves2 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.7, 1), toonMat(0x4fa84f));
  leaves2.position.y = 2.6;
  g.add(trunk, leaves, leaves2);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

function pine() {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 1.0, 6), toonMat(0x6b4423));
  trunk.position.y = 0.5;
  for (let i = 0; i < 3; i++) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.9 - i * 0.22, 1.0, 7), toonMat(0x2f6f43));
    cone.position.y = 1.1 + i * 0.6;
    g.add(cone);
  }
  g.add(trunk);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

function rock() {
  const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.6 + Math.random() * 0.5, 0), toonMat(0x8a8d99));
  m.castShadow = true;
  return m;
}

function house(color) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.4, 1.8), toonMat(color));
  base.position.y = 0.7;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.5, 1.0, 4), toonMat(0xb04a3a));
  roof.position.y = 1.9;
  roof.rotation.y = Math.PI / 4;
  g.add(base, roof);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

function temple() {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.6, 0.6, 12), toonMat(0xd8c7a0));
  base.position.y = 0.3;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 2.0, 8), toonMat(0xefe6d0));
    col.position.set(Math.cos(a) * 1.8, 1.3, Math.sin(a) * 1.8);
    g.add(col);
  }
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.6, 1.4, 12), toonMat(0xc0392b));
  roof.position.y = 3.0;
  g.add(base, roof);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

function lighthouse() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.0, 3.2, 12), toonMat(0xf4f4f4));
  body.position.y = 1.6;
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.9, 0.6, 12), toonMat(0xe74c3c));
  stripe.position.y = 1.6;
  const top = new THREE.Mesh(new THREE.ConeGeometry(0.8, 0.8, 12), toonMat(0xc0392b));
  top.position.y = 3.6;
  g.add(body, stripe, top);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

function placeProps(root, highQuality) {
  const density = highQuality ? 1 : 0.55;

  const scatter = (count, latMin, latMax, factory) => {
    const n = Math.floor(count * density);
    for (let i = 0; i < n; i++) {
      const lat = latMin + rand() * (latMax - latMin);
      const lon = -180 + rand() * 360;
      const dir = latLonToVec3(lat, lon, 1).normalize();
      const r = surfaceRadiusAt(dir);
      const pos = dir.multiplyScalar(r);
      const obj = factory();
      obj.scale.setScalar(0.7 + rand() * 0.6);
      orientUp(obj, pos, rand() * Math.PI * 2);
      root.add(obj);
    }
  };

  scatter(60, -8, 12, tree);        // forest belt
  scatter(40, 12, 30, tree);        // plains/city greenery
  scatter(30, 40, 60, pine);        // mountain pines
  scatter(50, -90, 70, rock);       // rocks everywhere
  const houseColors = [0xf4d35e, 0xee964b, 0x8ecae6, 0xc8b6ff];
  scatter(14, 14, 30, () => house(houseColors[Math.floor(rand() * houseColors.length)]));

  // Landmark buildings at fixed spots
  const place = (factory, lat, lon, scale = 1) => {
    const dir = latLonToVec3(lat, lon, 1).normalize();
    const pos = dir.multiplyScalar(surfaceRadiusAt(dir));
    const obj = factory();
    obj.scale.setScalar(scale);
    orientUp(obj, pos);
    root.add(obj);
    return obj;
  };
  place(temple, 48, 120, 1.1);            // mountain temple (near Monk)
  place(lighthouse, -16, -45, 1.0);       // by the fisherman's beach
  place(() => house(0x16a085), 20, 150, 1.4); // town hall (mayor)
  place(() => house(0xe67e22), 26, -75, 1.2); // lab (scientist)

  // Waterfall near Dave
  const wfDir = latLonToVec3(4, 35, 1).normalize();
  const wfPos = wfDir.multiplyScalar(surfaceRadiusAt(wfDir));
  const cliff = new THREE.Mesh(new THREE.BoxGeometry(3, 4, 1.5), toonMat(0x8a8d99));
  cliff.castShadow = true;
  const water = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 4), new THREE.MeshToonMaterial({
    color: 0x9fdfff, transparent: true, opacity: 0.8, gradientMap: gradient, side: THREE.DoubleSide,
  }));
  water.position.set(0, 2, 0.8);
  const wfGroup = new THREE.Group();
  cliff.position.y = 2;
  wfGroup.add(cliff, water);
  orientUp(wfGroup, wfPos);
  root.add(wfGroup);
}

function addStars(scene) {
  const n = 800;
  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const dir = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
    dir.multiplyScalar(220 + rand() * 60);
    positions.set([dir.x, dir.y, dir.z], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.1, sizeAttenuation: false }));
  scene.add(stars);
}
