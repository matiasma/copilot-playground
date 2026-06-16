# ✉️ Messenger — Carteiro do Planetinha

Recriação jogável, em **HTML dinâmico no browser**, do cozy game
[messenger.abeto.co](https://messenger.abeto.co/): um carteiro entrega cartas e
encomendas para os moradores de um planetinha esférico com gravidade central.

Feito com **Three.js** (sem engine como Unity/Godot, igual ao original), sem
etapa de build, sem MVP — com jogabilidade completa e sem bugs conhecidos.

---

## ▶️ Como jogar

Como o jogo usa ES Modules, ele precisa ser servido por HTTP (abrir o arquivo
direto com `file://` não funciona por causa das regras de CORS dos módulos).

```bash
# a partir da raiz do repositório
python3 -m http.server 8080
# depois abra http://localhost:8080/ no navegador
```

Qualquer servidor estático serve (`npx serve`, Live Server do VS Code, etc.).

### Controles

| Ação | Teclado / Mouse | Celular |
|------|-----------------|---------|
| Andar | `W A S D` / setas | joystick (canto inferior esquerdo) |
| Correr | segurar `Shift` | empurrar o joystick até o limite |
| Pular | `Espaço` | botão `⤴` |
| Falar / Entregar | `E` | botão `E` |
| Girar a câmera | arrastar com o mouse | arrastar na tela |
| Zoom | scroll do mouse | — |
| Emojis | segurar `Q` (ou botão 😀) | botão 😀 |
| Customizar | `C` (ou botão 👕) | botão 👕 |

---

## 🎮 Jogabilidade

- **Planeta esférico** com gravidade central (estilo *Super Mario Galaxy*): você
  sempre fica de pé na superfície e pode dar a volta no mundo em poucos minutos.
- **5 entregas encadeadas** com NPCs únicos (pescador, eremita, prefeito,
  cientista, monge), formando um ciclo narrativo.
- **Diálogos dinâmicos com Claude claude-opus-4.8** (opcional). Cole uma API key
  da Anthropic na tela inicial e as falas dos NPCs são geradas na hora. **Sem
  chave, o jogo usa diálogos escritos à mão e funciona 100% offline.**
- **Oráculo flutuante**: um NPC bônus que responde perguntas livres via Claude.
- **Multiplayer simulado**: outros "carteiros" (bots) andam pelo planeta e soltam
  emojis — sem precisar de servidor.
- **Customização**: pele, cabelo, camisa, calça e calçado, salvos no navegador.
- **Easter eggs**: um alienígena escondido na praia, um OVNI cruzando o céu e um
  segredo brilhante no lado oculto do planeta. 👽🛸💖
- **Áudio procedural**: trilha lo-fi e efeitos sonoros sintetizados em tempo real
  (Web Audio API), sem arquivos de áudio.

---

## 🗂️ Arquitetura

```
index.html              entry point + telas (loading / start / HUD / painéis)
src/
  style.css             estilos da interface
  main.js               boot do renderer + game loop + integração dos sistemas
  config.js             constantes, NPCs, quests, customização, helpers de esfera
  planet.js             geração do planeta (biomas, cel shading, água, props)
  surface.js            orientação "de pé" sobre a esfera
  player.js             avatar + física esférica do jogador
  camera.js             câmera 3ª pessoa com transporte tangente (sem polo travado)
  avatar.js             construção procedural do humanoide + animação de caminhada
  npc.js                NPCs e detecção de proximidade
  quest.js              máquina de estados das 5 entregas
  dialogue.js           Claude claude-opus-4.8 + fallback escrito à mão
  ui.js                 HUD: tracker, seta, balões de fala, emojis, roda de emoji
  input.js              teclado + mouse + joystick/botões de toque
  customization.js      look do personagem + persistência (localStorage)
  multiplayer.js        bots (multiplayer simulado)
  audio.js              música lo-fi + SFX procedurais
  easter.js             segredos escondidos
vendor/three/           Three.js embarcado (roda offline, sem CDN)
```

### Notas técnicas

- **Cel shading**: feito com `MeshToonMaterial` + um *gradient map* de poucos
  degraus, mais o contorno cartoon via *inverted-hull* (casca traseira ampliada).
  É o mesmo efeito visual descrito pelos autores do jogo original.
- **Gravidade esférica**: `up = normalize(posição - centro)`. O movimento anda
  sobre o grande círculo (`dir·cos(a) + tangente·sin(a)`), mantendo o jogador
  exatamente na superfície (erro numérico ~1e-14 nos testes).
- **Sem polos travados**: a câmera mantém um vetor "forward" tangente que é
  *parallel-transported* a cada frame, evitando singularidades nos polos.
- **Claude no browser**: a chamada usa o header
  `anthropic-dangerous-direct-browser-access` e qualquer falha cai
  automaticamente no diálogo de fallback — a jogabilidade nunca quebra.

---

## ✅ Validação

Os sistemas independentes de WebGL foram cobertos por testes headless:

- helpers de geometria da esfera;
- o jogador permanece na superfície ao longo de centenas de frames (sem `NaN`);
- a cadeia de 5 quests completa na ordem correta (5 coletas + 5 entregas);
- todos os diálogos de fallback retornam texto para cada NPC e estágio;
- bots e easter eggs simulam sem erros;
- a interface (UI/input/customização) é validada via jsdom contra o `index.html`
  real (todos os `id`/seletores existem e respondem).

---

## 🔧 Decisões de implementação

Em relação às perguntas abertas do plano, foram tomadas estas decisões para
entregar um jogo completo e autônomo:

1. **Multiplayer**: bots simulados (sem backend). A função `Bot` foi escrita de
   forma que um relay WebSocket real possa alimentá-la no futuro.
2. **Assets**: 100% procedurais em Three.js (nada para baixar).
3. **Distribuição**: multi-arquivo com ES Modules + Three.js embarcado em
   `vendor/` (roda offline, sem passo de build).
4. **Claude**: integração real com `claude-opus-4-8`, com a API key informada
   pelo jogador (fica só no navegador) e fallback offline garantido.
