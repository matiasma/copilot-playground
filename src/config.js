// ============================================================================
// config.js — Shared constants, world data, NPCs, quests and customization.
// All gameplay tuning lives here so the rest of the code stays declarative.
// ============================================================================
import * as THREE from 'three';

export const PLANET_RADIUS = 30;
export const STAND_HEIGHT = 1.0;        // distance from feet contact to player origin
export const GRAVITY = 22;              // used for jump arc
export const JUMP_SPEED = 9;
export const WALK_SPEED = 7.5;
export const RUN_SPEED = 12;

const DEG2RAD = Math.PI / 180;

/**
 * Convert latitude/longitude (degrees) to a point on a sphere of given radius.
 * lat:  -90 (south pole) .. +90 (north pole)
 * lon: -180 .. 180
 */
export function latLonToVec3(lat, lon, radius = PLANET_RADIUS) {
  const phi = (90 - lat) * DEG2RAD;
  const theta = (lon + 180) * DEG2RAD;
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

// ---------------------------------------------------------------------------
// Biomes — chosen by latitude band. Drives planet vertex colours & props.
// ---------------------------------------------------------------------------
export const BIOMES = [
  { name: 'ice',     maxLat: 90,  color: 0xeaf4ff },
  { name: 'mountain',maxLat: 60,  color: 0x8a8d99 },
  { name: 'city',    maxLat: 30,  color: 0x9fae8f },
  { name: 'forest',  maxLat: 8,   color: 0x4f9d54 },
  { name: 'plains',  maxLat: -10, color: 0x76c36b },
  { name: 'beach',   maxLat: -22, color: 0xf3e2a9 },
  { name: 'ocean',   maxLat: -90, color: 0x3aa6c9 },
];

export function biomeForLat(lat) {
  for (const b of BIOMES) if (lat <= b.maxLat) return b;
  return BIOMES[BIOMES.length - 1];
}

// ---------------------------------------------------------------------------
// NPCs. Each has a fixed lat/lon position, a body colour and a personality
// used to seed the dialogue (Claude prompt + handwritten fallback lines).
// ---------------------------------------------------------------------------
export const NPCS = {
  fisherman: {
    name: 'Téo, o Pescador',
    lat: -16, lon: -40,
    color: 0x4a90d9, tone: 'humorístico',
    persona: 'um pescador desastrado que achou uma garrafa com uma carta dentro',
  },
  dave: {
    name: 'Dave da Cachoeira',
    lat: 4, lon: 35,
    color: 0x9b59b6, tone: 'nostálgico',
    persona: 'um eremita que vive perto da cachoeira e adora cartas antigas',
  },
  sci: {
    name: 'Dra. Íris',
    lat: 26, lon: -75,
    color: 0xe67e22, tone: 'apressado',
    persona: 'uma cientista distraída que trocou as encomendas do laboratório',
  },
  monk: {
    name: 'Monge Lin',
    lat: 48, lon: 120,
    color: 0xe74c3c, tone: 'sereno',
    persona: 'um monge no templo da montanha que espera uma oferenda',
  },
  mayor: {
    name: 'Prefeito Bonifácio',
    lat: 20, lon: 150,
    color: 0x16a085, tone: 'pomposo',
    persona: 'o prefeito atarefado da cidadezinha que perdeu um documento importante',
  },
  // A bonus "oracle" NPC — answers free questions via Claude (easter egg-ish).
  oracle: {
    name: 'O Oráculo Flutuante',
    lat: -4, lon: 95,
    color: 0xf1c40f, tone: 'enigmático',
    persona: 'um oráculo brincalhão que responde qualquer pergunta com bom humor',
  },
};

// ---------------------------------------------------------------------------
// Quests. A linear chain of 5 deliveries. Each quest is given by one NPC and
// delivered to another. Completing one unlocks the next (via `unlocks`).
// ---------------------------------------------------------------------------
export const QUESTS = [
  {
    id: 'q1', giver: 'fisherman', recipient: 'dave',
    item: '✉️', itemName: 'Carta na garrafa',
    summary: 'Leve a carta encontrada na garrafa para o Dave da Cachoeira.',
    unlocks: 'q2',
  },
  {
    id: 'q2', giver: 'dave', recipient: 'mayor',
    item: '📜', itemName: 'Pergaminho antigo',
    summary: 'Entregue o pergaminho antigo do Dave ao Prefeito Bonifácio.',
    unlocks: 'q3',
  },
  {
    id: 'q3', giver: 'mayor', recipient: 'sci',
    item: '📦', itemName: 'Encomenda lacrada',
    summary: 'Leve a encomenda da prefeitura para a Dra. Íris no laboratório.',
    unlocks: 'q4',
  },
  {
    id: 'q4', giver: 'sci', recipient: 'monk',
    item: '🔮', itemName: 'Esfera estranha',
    summary: 'A Dra. Íris pede que você leve a esfera ao Monge Lin no templo.',
    unlocks: 'q5',
  },
  {
    id: 'q5', giver: 'monk', recipient: 'fisherman',
    item: '🎁', itemName: 'Presente misterioso',
    summary: 'O Monge devolve um presente ao Téo. Feche o ciclo de entregas!',
    unlocks: null,
  },
];

// ---------------------------------------------------------------------------
// Character customization options. Stored in localStorage.
// ---------------------------------------------------------------------------
export const CUSTOMIZATION = {
  skin:  { label: 'Pele',    colors: [0xf2c8a0, 0xe0a878, 0xb07b52, 0x8a5a36, 0xf7d9b0] },
  hair:  { label: 'Cabelo',  colors: [0x2b2b2b, 0x6b3f1e, 0xd9a441, 0xc0392b, 0xe8e8e8, 0x3498db] },
  shirt: { label: 'Camisa',  colors: [0xe74c3c, 0x3498db, 0x2ecc71, 0xf1c40f, 0x9b59b6, 0xecf0f1] },
  pants: { label: 'Calça',   colors: [0x34495e, 0x7f8c8d, 0x2c3e50, 0x8e6f47, 0x16a085] },
  shoes: { label: 'Calçado', colors: [0x2c2c2c, 0xffffff, 0xc0392b, 0xf39c12] },
};

export const DEFAULT_LOOK = {
  skin: 0xf2c8a0, hair: 0x6b3f1e, shirt: 0xe74c3c, pants: 0x34495e, shoes: 0x2c2c2c,
};

export const EMOJIS = ['❤️', '😀', '👋', '😂', '💩', '👍', '🎉', '😮'];
