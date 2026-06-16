// ============================================================================
// customization.js — Character look state, persistence and the swatch panel.
// Changes apply to the in-world avatar in real time (live preview).
// ============================================================================
import { CUSTOMIZATION, DEFAULT_LOOK } from './config.js';

const STORAGE_KEY = 'messenger.look';

export function loadLook() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_LOOK, ...JSON.parse(raw) };
  } catch (_) { /* ignore */ }
  return { ...DEFAULT_LOOK };
}

export function saveLook(look) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(look)); } catch (_) {}
}

/**
 * Build the customization panel.
 * @param {HTMLElement} container
 * @param {Object} look  current look (mutated in place)
 * @param {(look:Object)=>void} onChange
 */
export function buildCustomizePanel(container, look, onChange) {
  container.innerHTML = '';

  for (const [part, def] of Object.entries(CUSTOMIZATION)) {
    const group = document.createElement('div');
    group.className = 'cust-group';

    const title = document.createElement('h3');
    title.textContent = def.label;
    group.appendChild(title);

    const swatches = document.createElement('div');
    swatches.className = 'swatches';

    def.colors.forEach((hex) => {
      const sw = document.createElement('div');
      sw.className = 'swatch' + (look[part] === hex ? ' selected' : '');
      sw.style.background = '#' + hex.toString(16).padStart(6, '0');
      sw.addEventListener('click', () => {
        look[part] = hex;
        swatches.querySelectorAll('.swatch').forEach((s) => s.classList.remove('selected'));
        sw.classList.add('selected');
        saveLook(look);
        onChange(look);
      });
      swatches.appendChild(sw);
    });

    group.appendChild(swatches);
    container.appendChild(group);
  }
}
