// ============================================================================
// dialogue.js — Generates NPC lines. Uses Claude claude-opus-4.8 when an API
// key is provided, otherwise falls back to handwritten lines so the game is
// fully playable offline. Results are cached per (npc, stage) within a session.
// ============================================================================

const MODEL = 'claude-opus-4-8'; // Claude claude-opus-4.8
let apiKey = null;
const cache = new Map();

export function setApiKey(key) {
  apiKey = (key || '').trim() || null;
}
export function hasApiKey() {
  return !!apiKey;
}

// Handwritten fallback lines keyed by `${npcId}:${stage}`.
const FALLBACK = {
  'fisherman:offer': 'Ô, carteiro! Achei essa garrafa com uma carta dentro. Será que você leva pro Dave lá da cachoeira? Minhas pernas já não nadam como antes.',
  'fisherman:reminder': 'A carta na garrafa, lembra? O Dave mora lá perto da cachoeira a leste.',
  'fisherman:final': 'Um presente?! Pra mim?? Ora, ora... obrigado, carteiro. Você fechou o ciclo com chave de ouro!',
  'dave:receive': 'Ah... essa carta sou EU que escrevi, há vinte anos. Que viagem no tempo. Valeu, carteiro!',
  'dave:offer': 'Já que você é bom de entrega... leva esse pergaminho velho pro prefeito? Ele vive me cobrando.',
  'dave:reminder': 'O prefeito Bonifácio tá lá na cidade, ao norte. Leva o pergaminho pra ele!',
  'mayor:receive': 'Hmm! Um pergaminho histórico. A cidade agradece os seus serviços postais.',
  'mayor:offer': 'Excelente! Agora preciso que esta encomenda lacrada chegue à Dra. Íris no laboratório. Assunto oficial!',
  'mayor:reminder': 'A Dra. Íris está no laboratório, a noroeste. A encomenda é urgente!',
  'sci:receive': 'Finalmente! Eu tinha trocado tudo. Você é mais eficiente que meus robôs.',
  'sci:offer': 'Já que está aqui: esta esfera estranha precisa ir ao Monge Lin, lá no templo da montanha. Cuidado, ela... pulsa.',
  'sci:reminder': 'O Monge Lin medita no templo, bem no alto da montanha a nordeste.',
  'monk:receive': 'A esfera retornou ao templo. O universo respira aliviado. Namastê, carteiro.',
  'monk:offer': 'Uma última tarefa: devolva este presente ao pescador Téo. Tudo volta à sua origem.',
  'monk:reminder': 'O pescador Téo está lá na praia, ao sul. Feche o ciclo.',
  'oracle:idle': 'Pergunte, viajante... ou apenas aprecie a vista. As duas coisas têm valor.',
};

function fallbackLine(npcId, stage, userText) {
  if (npcId === 'oracle') {
    const replies = [
      'O caminho mais curto entre dois pontos, neste planeta, é sempre uma curva. 🌍',
      'Entregue com carinho e o resto se resolve.',
      'Procure o estranho na praia... ele veio de longe. 👽',
      'A felicidade é uma encomenda que você entrega a si mesmo.',
    ];
    return replies[Math.floor(Math.random() * replies.length)];
  }
  return FALLBACK[`${npcId}:${stage}`] || '...';
}

function buildPrompt(npc, stage, userText) {
  const stageDesc = {
    offer: 'Você dá uma missão de entrega ao carteiro.',
    reminder: 'Você lembra o carteiro da entrega pendente.',
    receive: 'Você recebe uma entrega e agradece.',
    final: 'Você recebe o presente final e se emociona.',
    idle: 'Você responde a uma pergunta do viajante.',
  }[stage] || 'Você conversa com o carteiro.';

  return `Você é ${npc.name}, ${npc.persona}, num joguinho relaxante de entregas ` +
    `num planeta minúsculo. Tom: ${npc.tone}. ${stageDesc} ` +
    (userText ? `O viajante disse: "${userText}". ` : '') +
    `Responda em português, 1 a 2 frases curtas, leve e cativante. Sem aspas.`;
}

/**
 * Get a line of dialogue. Always resolves (never throws) so gameplay can't
 * break on a network error.
 */
export async function getDialogue(npcId, npc, stage, userText = '') {
  const key = `${npcId}:${stage}:${userText}`;
  if (cache.has(key)) return cache.get(key);

  if (!apiKey) {
    const line = fallbackLine(npcId, stage, userText);
    cache.set(key, line);
    return line;
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 120,
        messages: [{ role: 'user', content: buildPrompt(npc, stage, userText) }],
      }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const text = data?.content?.[0]?.text?.trim();
    const line = text || fallbackLine(npcId, stage, userText);
    cache.set(key, line);
    return line;
  } catch (err) {
    console.warn('[dialogue] Claude indisponível, usando fallback:', err.message);
    const line = fallbackLine(npcId, stage, userText);
    cache.set(key, line);
    return line;
  }
}
