// ============================================================================
// quest.js — Linear 5-delivery quest chain state machine.
// ============================================================================
import { QUESTS, NPCS } from './config.js';

export class QuestManager {
  constructor() {
    this.quests = QUESTS;
    this.index = 0;        // current quest being worked on
    this.carrying = false; // have we picked the item up from the giver?
    this.done = false;
  }

  current() { return this.done ? null : this.quests[this.index]; }

  /** Id of the NPC the player should head to next (for the HUD arrow). */
  targetNpcId() {
    const q = this.current();
    if (!q) return null;
    return this.carrying ? q.recipient : q.giver;
  }

  /** Human readable HUD strings. */
  hud() {
    if (this.done) {
      return { title: 'Todas as entregas feitas! 🎉', sub: 'Explore o planeta e procure segredos.' };
    }
    const q = this.current();
    if (!this.carrying) {
      return {
        title: `Falar com ${NPCS[q.giver].name}`,
        sub: q.summary,
      };
    }
    return {
      title: `Entregar: ${q.itemName} ${q.item}`,
      sub: `Leve para ${NPCS[q.recipient].name}.`,
    };
  }

  /** The item emoji currently carried, or null. */
  carriedItem() {
    if (this.done || !this.carrying) return null;
    return this.quests[this.index].item;
  }

  /**
   * Decide what should happen when the player interacts with `npcId`.
   * Returns { stage, effect } where effect is applied via `applyEffect`.
   */
  interaction(npcId) {
    if (npcId === 'oracle') return { stage: 'idle', effect: null };
    if (this.done) return { stage: 'idle', effect: null };

    const q = this.current();

    if (!this.carrying && npcId === q.giver) {
      return { stage: 'offer', effect: 'pickup' };
    }
    if (this.carrying && npcId === q.recipient) {
      const last = q.unlocks === null;
      return { stage: last ? 'final' : 'receive', effect: 'deliver' };
    }
    if (this.carrying && npcId === q.giver) {
      return { stage: 'reminder', effect: null };
    }
    // Anyone else: light ambient chatter.
    return { stage: 'idle', effect: null };
  }

  /** Apply a side effect returned by interaction(). Returns a status string. */
  applyEffect(effect) {
    if (effect === 'pickup') {
      this.carrying = true;
      return 'pickup';
    }
    if (effect === 'deliver') {
      this.carrying = false;
      if (this.quests[this.index].unlocks === null) {
        this.done = true;
        return 'complete-all';
      }
      this.index += 1;
      return 'delivered';
    }
    return null;
  }
}
