# PROMPT — Gerador de Diagrama de Topologia de Custos de Rede Azure (HTML Interativo)

> **Instruções**: Cole este prompt no GitHub Copilot Agent Mode.  
> Forneça o CSV de fatura Azure EA (`Detail_Enrollment_*.csv`).  
> O agente irá: (1) extrair dados de rede do CSV, (2) gerar diagrama HTML interativo com topologia de custos.

---

## Objetivo

Gere um **diagrama HTML interativo standalone** (arquivo único, sem backend) que analise e visualize a **topologia de custos de rede Azure** de um cliente a partir do CSV de fatura EA. O diagrama deve mostrar:

- Arquitetura hub-spoke com tráfego bidirecional
- Custos de Data Transfer Out (DTO) e Data Transfer In (DTI)
- Agrupamento geográfico por região Azure
- Inventário de recursos de rede por subscription
- Interatividade: drag & drop, zoom, hover com detalhes

---

## 1. PIPELINE DE DADOS

### 1.1 Extração de Fluxos de Rede (CSV → JSON `_net_flows.json`)

Processar o CSV em streaming. Para cada linha com `MeterCategory` de rede (`Virtual Network`, `Bandwidth`, `ExpressRoute`, `Load Balancer`, `VPN Gateway`, `Azure Firewall`, `NAT Gateway`, `Azure DNS`, `CDN`, `Traffic Manager`, `Azure Front Door`, `Application Gateway`), acumular por `SubscriptionName`:

| Acumulador | Como calcular |
|---|---|
| `peering_egress_gb/cost` | `MeterSubCategory` contém "Peering" (não "Global") + `MeterName` contém "Egress" |
| `peering_ingress_gb/cost` | `MeterSubCategory` contém "Peering" (não "Global") + `MeterName` contém "Ingress" |
| `global_peering_egress_gb/cost` | `MeterSubCategory` contém "Global Peering" + `MeterName` contém "Egress" |
| `global_peering_ingress_gb/cost` | `MeterSubCategory` contém "Global Peering" + `MeterName` contém "Ingress" |
| `internet_egress_gb/cost` | `MeterCategory` = "Bandwidth" + `MeterName` contém "Transfer Out" ou "Egress" |
| `internet_ingress_gb/cost` | `MeterCategory` = "Bandwidth" + `MeterName` contém "Transfer In" ou "Ingress" |
| `expressroute_out_gb/cost` | `MeterCategory` = "ExpressRoute" + `MeterName` contém "Metered Data" (sem "Circuit") ou "Transfer Out" |
| `expressroute_in_gb/cost` | `MeterCategory` = "ExpressRoute" + `MeterName` contém "Data Transfer In" |
| `expressroute_circuit_cost` | `MeterCategory` = "ExpressRoute" + `MeterName` contém "Circuit" (custo fixo mensal do circuito) |
| `expressroute_gateway_cost` | `MeterCategory` = "ExpressRoute" + (`MeterSubCategory` contém "Gateway" ou `MeterName` contém "ErGw") |
| `vpn_cost` | `MeterCategory` = "VPN Gateway" (custo fixo mensal do gateway VPN) |
| `private_link_cost` | `MeterSubCategory` contém "Private Link" ou "Private Endpoint" |
| `firewall_cost` | `MeterCategory` = "Azure Firewall" |
| `nat_cost` | `MeterCategory` = "NAT Gateway" |
| `lb_cost` | `MeterCategory` in ("Load Balancer", "Application Gateway") |
| `total_net_cost` | Soma de todos os custos de rede |
| `region` | `ResourceLocation` mais frequente |

**IMPORTANTE — Custos de infraestrutura nos flows**: Os campos `expressroute_circuit_cost`, `expressroute_gateway_cost` e `vpn_cost` são **essenciais** para os edges que conectam hubs ao On-Premises. Sem eles, os tooltips e labels dessas linhas ficam zerados. Estes custos devem ser acumulados no **flows JSON** (não apenas no inventário de recursos), pois são usados diretamente pelos edges no diagrama.

A classificação dentro de `MeterCategory = "ExpressRoute"` segue esta ordem:
1. Se `MeterSubCategory` contém "Gateway" ou `MeterName` contém "ErGw" → `expressroute_gateway_cost`
2. Se `MeterName` contém "Circuit" → `expressroute_circuit_cost`
3. Se `MeterName` contém "Metered Data" (sem "Circuit") ou "Data Transfer" → `expressroute_out_gb/cost` ou `expressroute_in_gb/cost`
4. Catch-all ER → `expressroute_out` (tráfego metered genérico)

Para `MeterCategory = "VPN Gateway"` → acumular direto em `vpn_cost`.

### 1.2 Extração de Inventário de Recursos (CSV → JSON `_net_resources.json`)

Para cada subscription, contar **recursos únicos** (`ResourceName`) por tipo:

| Tipo de recurso | Padrões para detectar (em `MeterCategory + MeterSubCategory + MeterName + ConsumedService`) |
|---|---|
| `expressroute_gateway` | "ErGw", "expressroute gateway" — **detectar antes de circuit** |
| `expressroute_circuit` | "Circuit" (apenas!) — NÃO incluir "Metered Data" ou "Data Transfer" |
| `expressroute_data` | "Metered Data", "Data Transfer" — custo de tráfego ER, separado do circuit |
| `vpn_gateway` | "VpnGw", "VPN Gateway", "Basic Gateway" |
| `private_endpoint` | "Private Endpoint" |
| `private_link` | "Private Link" |
| `firewall` | "Azure Firewall" |
| `nat_gateway` | "NAT Gateway" |
| `load_balancer` | "Load Balancer" |
| `app_gateway` | "Application Gateway" |
| `vnet_peering` | "Peering" |
| `public_ip` | "Public IP", "IP Addresses" |
| `dns` | "DNS" |

**IMPORTANTE**: A ordem de detecção importa. Usar lista ordenada (não dict):
1. `expressroute_gateway` (mais específico — "ErGw")
2. `expressroute_circuit` (apenas "Circuit")
3. `expressroute_data` (catch-all ER — "Metered Data", "Data Transfer")
4. `vpn_gateway`
5. ... demais tipos

**NUNCA** misturar custo de data transfer com custo de circuit. O custo do circuit é a taxa fixa mensal; o data transfer é o tráfego cobrado por GB. São coisas diferentes e devem ser separadas no inventário.

### 1.3 Detalhes de SKU de Gateways e Circuitos

Para recursos do tipo `expressroute_gateway`, `expressroute_circuit` e `vpn_gateway`, capturar **adicionalmente** o detalhe individual de cada recurso:

| Campo | Origem |
|---|---|
| `type` | Tipo do recurso (expressroute_circuit, expressroute_gateway, vpn_gateway) |
| `resource` | `ResourceName` — nome do recurso (ex: `erc-ascenty-prd-brazilsouth-003`) |
| `sku` | `MeterName` — contém o SKU/tier exato do recurso |
| `cost` | Custo total do recurso no período |

Salvar como lista `_gateway_details` dentro do JSON de cada subscription, ordenada por custo desc.

**Exemplos de SKU esperados no campo `MeterName`:**

| Tipo | Exemplos de SKU/MeterName |
|---|---|
| ER Circuit | `Standard Metered Data 2 Gbps Circuit`, `Premium Unlimited Data 10 Gbps Circuit`, `Standard Metered Data 1 Gbps Circuit`, `Local 1 Gbps Circuit` |
| ER Gateway | `ErGw1AZ Gateway`, `ErGw2AZ Gateway`, `ErGw3AZ Gateway`, `High Performance Gateway`, `Ultra Performance Gateway`, `Standard Gateway` |
| VPN Gateway | `VpnGw1`, `VpnGw1AZ`, `VpnGw2AZ`, `VpnGw3AZ`, `VpnGw4AZ`, `VpnGw5AZ`, `Basic Gateway`, `High Performance Gateway` |

**Deduplicar** por `ResourceName` (somar custos se houver múltiplas linhas para o mesmo recurso).

### 1.4 Mapeamento Dinâmico de Componentes Não-Mapeados

Os padrões listados nas seções 1.1, 1.2 e 1.3 cobrem os componentes de rede mais comuns, mas faturas de clientes podem conter **MeterCategory/MeterSubCategory/MeterName** ainda não previstos (ex: novos serviços Azure, SKUs regionais, variantes de naming).

**Regra**: Se uma linha do CSV pertence a uma `MeterCategory` de rede (listada em `NET_CATS`) mas **não foi capturada** por nenhum dos acumuladores de fluxo (seção 1.1) nem por nenhum padrão de recurso (seção 1.2), ela **deve** ser:

1. **Registrada no inventário** como tipo `other_network` com:
   - `ResourceName` como identificador do recurso
   - `MeterCategory + MeterSubCategory` como label de exibição
   - `UnitOfMeasure` preservado (ex: "1 GB", "1 Hour", "10K Transactions")
   - `Quantity` acumulado na unidade original
   - `Cost` acumulado
2. **Incluída no `total_net_cost`** do flow (já acontece naturalmente pois o custo é somado no início do loop)
3. **Exibida no tooltip** do nó, na seção "🛡️ Serviços de Rede", com o label `MeterCategory - MeterSubCategory` e o custo total
4. **Logada em console** durante a extração com `[UNMAPPED]` para facilitar a adição futura no prompt:
   ```
   [UNMAPPED] Sub=XYZ | Cat=Azure Bastion | SubCat=Standard | Name=Standard Data Transfer | Unit=1 GB | Cost=123.45
   ```

Isso garante que **nenhum custo de rede é silenciosamente descartado**, mesmo para serviços não previstos.

---

## 2. ARQUITETURA DO DIAGRAMA HTML

### 2.1 Tecnologias (inline, arquivo único)
- **Google Fonts**: Inter + JetBrains Mono
- **SVG**: Linhas de conexão (edges) com hit areas para hover. **SVGs (`svgEdges` e `svgLabels`) devem estar DENTRO do `#world` div**, não como irmãos do `#world` dentro do `#canvas`. Isso garante que o `transform` (pan/zoom) seja aplicado uma única vez no `#world` e os SVGs acompanhem automaticamente sem drift.
- **HTML divs**: Cada nó é um elemento DOM independente, arrastável
- **CSS Custom Properties**: Dark/light theme
- **JavaScript vanilla**: Drag & drop, pan, zoom, tooltips, regiões arrastáveis

**Estrutura HTML correta do canvas:**
```html
<div id="canvas">
  <div id="world">
    <svg id="svgEdges" style="position:absolute;top:0;left:0;width:1px;height:1px;pointer-events:none;z-index:8;overflow:visible"></svg>
    <svg id="svgLabels" style="position:absolute;top:0;left:0;width:1px;height:1px;pointer-events:none;z-index:20;overflow:visible"></svg>
    <!-- region boxes e node divs são adicionados aqui via JS -->
  </div>
</div>
```

**IMPORTANTE**: O `transform` (translate + scale) é aplicado APENAS no `#world`. Como os SVGs estão dentro, eles herdam o transform automaticamente. **NÃO** aplicar transform separado nos SVGs — isso causa desalinhamento entre edges e nós ao fazer zoom ou pan.

### 2.2 Princípios de Layout

1. **Hubs na PARTE INFERIOR da sua região** — subscriptions com ExpressRoute ou VPN Gateway são posicionadas na **base da region box** da sua respectiva região Azure (pois se conectam para baixo ao On-Premises). Se houver mais de um hub na mesma região, distribuir horizontalmente na base. **NÃO** posicionar hubs numa faixa separada fora das region boxes.
2. **Spokes acima dos hubs** — subscriptions normais (spokes) são organizadas em grid **acima** dos hubs dentro da mesma region box.
3. **On-Premises** = posicionado na **base** do desenho (abaixo das regiões)
3. **Internet** = **um nó por região Azure** que tem tráfego de internet significativo, posicionado **acima** de cada região. Cada nó Internet mostra o custo de egress daquela região e, no tooltip, lista as subscriptions, tráfego agregado, e o total global de Internet. Preço de egress varia por região (Brasil ~2x mais caro que EUA) — essa separação é essencial para otimização.
4. **Subscriptions normais (spokes)** = organizadas em grid acima dos hubs, dentro da mesma region box
5. **Regiões Azure** = caixas tracejadas agrupando **TODAS** as subscriptions da mesma região (hubs + spokes). Posicionadas de forma a refletir geografia:
   - Regiões do Brasil (brazilsouth) = centro
   - Regiões dos EUA (EastUS, EastUS2, CentralUS, WestUS) = acima/direita
   - Regiões da Europa = acima/esquerda
   - Regiões da Ásia = direita
6. **Top N global + Top M per-region** — dois níveis de agregação:
   - **Global**: Top 14-16 subscriptions por custo de rede são mostradas individualmente; restante agregadas em nó "Outros (X subs)" global com botão expandir/contrair
   - **Per-region**: Dentro de cada region box, se houver mais de **6 spokes** (excluindo hubs), mostrar apenas os **top 6 por custo** e agregar o restante em um nó **"Outros (RegionLabel: X subs)"** dentro da própria region box
   - O nó "Outros" per-region tem botão **expandir/contrair** que funciona independentemente do "Outros" global
   - Ao expandir um "Outros" regional, os nós individuais aparecem **dentro da mesma region box**, que se redimensiona automaticamente
   - Ao contrair, volta ao nó agregado sem afetar outras regiões
   - O nó "Outros" regional mostra no tooltip a lista de subs agregadas com custo individual
   - **Peering edges** das subs agregadas no "Outros" regional são somados no edge do nó agregado (como no "Outros" global)
   - Constante `MAX_SPOKES_PER_REGION = 6` configurável
7. **Collision avoidance em 3 fases** (ver seção 2.4)

### 2.4 Collision Avoidance — 3 Fases

**NUNCA** usar um loop global que empurra todos os nós indiscriminadamente. Isso causa drift de nós entre regiões. Usar **3 fases sequenciais**:

**Fase 1 — Intra-região**: Para cada região, resolver sobreposições apenas entre os nós daquela região. Nós de regiões diferentes **não interagem** nesta fase. Isso mantém cada cluster coeso.

**Fase 2 — Inter-região (box separation)**: Tratar cada region box como um retângulo e verificar sobreposição entre pares de region boxes. Se duas boxes se sobrepõem, empurrar **todas as suas nodes juntas** na direção de menor sobreposição (horizontal ou vertical). Recalcular os bounds da region box após cada empurrão. Iterar até convergir (~50 iterações).

**Fase 3 — Nós especiais**: Resolver sobreposições entre nós especiais (`__onprem__`, `__inet_*__`) e todos os nós regulares. Isso posiciona On-Premises e Internet sem conflito com as regiões.

### 2.5 Recálculo de Region Boxes Pós-Render

As region boxes devem ser **recalculadas após o rendering dos nós no DOM**, porque a altura real de cada nó depende do conteúdo (chips, nome, etc.) e pode ser maior que a estimativa usada no layout (ex: 120px estimado vs 160px real). O fluxo correto no `render()` é:

1. Desenhar region boxes com dimensões estimadas
2. Desenhar todos os nós (atualiza `pos[id].h = el.offsetHeight`)
3. Recalcular region boxes com as alturas reais (`recalcRB()`)
4. Atualizar o DOM das region boxes com as novas dimensões

A função `recalcRB()` percorre `regionBoxes[rk].nodes`, lê `pos[id]` com `w` e `h` atualizados, e recalcula `x, y, w, h` do box com padding de 20px lateral e 28px topo.

### 2.6 Setas e Direção — REGRA FUNDAMENTAL

| Conceito Azure | Seta | Cor | Significado visual | Custo |
|---|---|---|---|---|
| **Data Transfer Out (DTO)** | ⬇ | 🔴 Vermelho | Dados saindo do Azure (download) | **Cobrado por GB** |
| **Data Transfer In (DTI)** | ⬆ | 🟢 Verde | Dados entrando no Azure (upload) | **Grátis** (maioria dos cenários) |

**IMPORTANTE**: Nunca inverter. DTO = saída = ⬇ (download). DTI = entrada = ⬆ (upload).

---

## 3. INTERATIVIDADE

### 3.1 Drag & Drop de Nós
- Cada caixa de subscription é arrastável individualmente
- As linhas SVG de conexão acompanham o movimento em tempo real
- Ao soltar, executar collision avoidance e redesenhar edges

### 3.2 Drag & Drop de Regiões
- Cada caixa de região tem um **anel invisível de ~6px** ao redor da borda (`.rdrag`) e o **label** como handles de drag
- O interior da região é `pointer-events:none` para não bloquear hover nas linhas
- Ao arrastar, **TODOS os nós dentro se movem juntos**
- Manter posições relativas dos nós dentro da região

### 3.3 Pan & Zoom
- **Pan**: Clique + arraste no fundo do canvas
- **Zoom**: Scroll do mouse (zoom toward cursor)
- **Fit**: Botão "⊞ Fit" enquadra todos os nós na viewport
- **Reset**: Botão "⟳ Reset" restaura layout original

### 3.4 Controle de Fonte
- Botões A−/A+/A⟲ para ajustar `fontScale` (0.5x a 2x)
- Aplica-se tanto ao CSS (`documentElement.style.fontSize`) quanto aos labels SVG

### 3.5 Hover/Tooltip nos Nós
Ao passar o mouse sobre qualquer caixa de subscription, exibir **tooltip flutuante** (position:fixed, pointer-events:none) com:

1. **Cabeçalho**: Nome, região, ambiente (PROD/DEV/UAT), flags (HUB, ExpressRoute, VPN)
2. **Custo total de rede** (destaque)
3. **📦 Inventário de Recursos** (grid 2 colunas):
   - Tipo de recurso com ícone → Quantidade × Custo
   - Ordenado por custo desc
   - Exemplos: `🔌 ER Circuit 2x R$ 84.114`, `🔥 Firewall 1x R$ 4.939`
4. **🔧 Detalhes de Gateways & Circuitos** (se houver ER/VPN):
   - Listar cada gateway e circuito individualmente
   - Para cada um mostrar: Tipo (ER Circuit / ER Gateway / VPN Gateway) + Custo
   - Nome do recurso (ex: `erc-ascenty-prd-brazilsouth-003`)
   - **SKU**: O tier/tipo exato do recurso (ex: `Standard Metered Data 2 Gbps Circuit`, `ErGw1AZ Gateway`, `VpnGw2AZ`)
   - Ordenado por custo desc
5. **Seções de tráfego** (se houver):
   - 🔌 ExpressRoute: ⬇DTO (saída) com volume + custo | ⬆DTI (entrada) com volume + "GRÁTIS"
   - 🔗 VNet Peering: ⬇DTO | ⬆DTI com custos
   - ☁️ Internet: ⬇DTO | ⬆DTI
   - Cada seção com **explicação contextual** (o que é, por que cobra, como otimizar)
6. **🛡️ Serviços de rede**: Private Link, Firewall, NAT Gateway, LB/AppGw com custos

### 3.6 Hover/Tooltip nas Linhas (Edges)
Ao passar o mouse sobre uma linha de conexão, exibir tooltip com:
- Tipo de conexão
- **Custo total da conexão** (destaque) = soma de DTO + DTI + custos fixos de infraestrutura

#### 3.6.1 Edge para On-Premises — APENAS ExpressRoute

A linha para On-Premises existe **somente** para hubs com ExpressRoute. VPN Gateway **NÃO** gera linha para On-Premises — o tráfego VPN transita pela internet e é cobrado como Bandwidth genérica na fatura EA.

O edge tipo `onprem` carrega:
- DTO/DTI do ExpressRoute metered (volume + custo)
- Custo fixo dos Circuitos ER (se > 0)

O tooltip mostra:
- Seção 🔌 ExpressRoute com DTO, DTI, custo dos circuitos e explicação

**Estilo visual:** azul dashed (`stroke-dasharray: 12,6`)

**Nó On-Premises:** mostrado apenas se existir pelo menos 1 hub com ExpressRoute (`erHubSubs.length > 0`). Se o cliente só tem VPN (sem ER), o nó On-Premises **não aparece**.

#### 3.6.2 Edges de Peering/Internet
- ⬇ DTO + ⬆ DTI com volumes e custos

**IMPORTANTE**: O custo total do edge (`tc`) para cálculo de espessura e labels deve incluir **apenas**:
- `doc + dic` (custos de data transfer ER metered)
- `cir` (custo de circuitos ER, se houver)

**NÃO incluir** no custo do edge:
- `gwy` (custo de gateway ER) — pertence ao nó
- `vpnc` (custo de VPN gateway) — pertence ao nó. O tráfego VPN não tem meter separado na fatura EA.

### 3.7 Posicionamento do Tooltip
- Aparece a 18px à direita e 10px acima do cursor
- Se ultrapassar a borda direita da janela, vai para a esquerda do cursor
- Se ultrapassar a borda inferior, ajusta para cima
- Nunca sai da viewport

### 3.8 Tooltip durante Drag
- Ao iniciar qualquer drag (nó, região ou pan), **esconder o tooltip imediatamente**
- Durante o drag, **ignorar todos os eventos de hover** — `showTip` deve verificar se há drag ativo e retornar sem fazer nada
- Tooltip volta a funcionar normalmente ao soltar o botão do mouse

### 3.9 Expandir/Contrair nó "Outros" (Global)
- O nó "Outros (X subs)" contém um **botão "📦 Expandir X subs"** dentro da caixa
- No toolbar, há um **botão "📦 Expandir Outros"** / **"📦 Contrair Outros"**
- **Expandir**: remove o nó "Outros" do diagrama e cria nós individuais para cada subscription agregada, com suas conexões e posições por região. O nó "Outros" desaparece.
- **Contrair**: remove todos os nós expandidos e recria o nó "Outros" com custo e fluxos agregados. O nó "Outros" reaparece no diagrama.
- Ciclo expandir/contrair deve funcionar múltiplas vezes sem bugs
- **CUIDADO**: Ao contrair, limpar completamente o nó "Outros" de DATA, pos, byRegion e edges antes de recriá-lo
- **Nós Internet dinâmicos**: Ao reconstruir edges (`rebuildEdges`), **substituir** o mapa `inetRegions` inteiro com o recém-calculado (não apenas adicionar). Isso garante que o nó "Internet (Mixed)" desapareça ao expandir (pois as subs individuais vão para suas regiões reais) e reapareça ao contrair (pois "Outros" usa região "mixed").

### 3.9.1 Expandir/Contrair "Outros" Per-Region
- Cada region box com mais de `MAX_SPOKES_PER_REGION` (6) spokes gera um nó **"Outros (RegionLabel: X subs)"** dentro da region box
- Esse nó tem um **botão "📦 Expandir X subs"** que funciona **independentemente** do "Outros" global
- **Expandir regional**: o nó agregado desaparece, os nós individuais aparecem dentro da mesma region box. A region box se redimensiona (`recalcRB()`). Edges são recalculados apenas para aquela região.
- **Contrair regional**: os nós individuais desaparecem, o nó agregado volta. Region box encolhe.
- Múltiplas regiões podem ter seus "Outros" expandidos/contraídos de forma independente
- **Estado de expansão**: manter um mapa `regionExpanded = { rk: boolean }` para cada região. Ao fazer `resetLayout()`, restaurar todos para contraído.
- **Interação com "Outros" global**: Ao expandir/contrair o "Outros" global, o estado de expansão per-region é **resetado** (todos voltam a contraído). Isso evita conflitos de estado.

### 3.10 Tooltip nos Nós de Internet
- Cada nó Internet regional mostra no tooltip:
  - Custo de egress daquela região (destaque)
  - ⬇ DTO e ⬆ DTI com volumes e custos
  - Explicação de que egress varia por região
  - Lista de subscriptions que usam essa saída
  - **Total global de Internet** (todas as regiões somadas)

---

## 4. DESIGN VISUAL

### 4.1 Theme (Dark default)
```css
--bg:#0c0f17; --sf:#141a26; --cd:#1b2234; --bd:#2a3450;
--tx:#e8ecf4; --mt:#8b95ab; --ft:#505d75;
--bl:#4aa3e8; --pu:#a87de0; --tl:#2ec4a8;
--or:#f0a030; --rd:#f05555; --gn:#45c45a;
```

### 4.2 Cores de Nós por Tipo
| Tipo | Barra topo | Borda |
|---|---|---|
| Hub (ER/VPN) | `linear-gradient(90deg, --bl, --pu)` | `--bl` semitransparente |
| PROD | `--gn` | `--gn` semitransparente |
| DEV | `--or` | `--or` semitransparente |
| UAT | `--pu` | `--pu` semitransparente |
| Agregado/Outros | `--ft` | Border dashed |
| Especial (On-Prem, Internet) | `--ft` | Border dashed |

### 4.3 Edges
- **Espessura** proporcional ao custo: `max(2, min(9, cost/5000))` pixels
- **Opacidade**: 0.45 para edges > R$ 1.500, 0.18 para edges menores
- **ExpressRoute**: `stroke-dasharray: 12,6`
- **Labels**: Apenas em edges com custo > R$ 1.500, com fundo semi-transparente para legibilidade
- **Hit area**: Linha invisível de 24px de largura para hover
- **Anchor points de nós especiais**: As linhas de conexão devem se ancorar nos pontos lógicos de cada nó, não no centro:
  - **On-Premises** (base da tela): linhas chegam pela **parte superior** da caixa (`y = pt.y`)
  - **Internet** (topo da tela): linhas chegam pela **parte inferior** da caixa (`y = pt.y + pt.h`)
  - **Hub → On-Prem**: a linha sai da **base** do hub (`y = pf.y + pf.h`)
  - **Node → Internet**: a linha sai do **topo** do nó (`y = pf.y`)
  - **Peering (node ↔ hub)**: usa o **centro** (`y = pos.y + pos.h/2`) em ambos os lados

### 4.4 Region Boxes
- Border dashed com cor da região, border-radius 18px
- `pointer-events:none` no box (interior transparente a cliques)
- Anel de drag (`.rdrag`) com `pointer-events:auto` ao redor da borda
- Label com bandeira emoji + nome da região no topo, com `pointer-events:auto` para drag
- Cor e label por região (configurável):
  - brazilsouth: 🇧🇷 verde-teal
  - EastUS/EastUS2: 🇺🇸 azul
  - CentralUS/WestUS: 🇺🇸 roxo
  - westeurope/northeurope: 🇪🇺 laranja
  - etc.

### 4.5 Flow Chips (badges nos nós)
Cada nó mostra mini-badges com fluxos relevantes:
- `⬇ER 100TB` (chip vermelho = DTO)
- `⬆Peer 65TB` (chip verde = DTI)
- `🔌ER×2` (chip azul = recurso)
- `🔥FW` (chip azul = recurso)
- `🔗PE×15` (chip azul = private endpoints)

### 4.6 Z-Index — REGRA DE CAMADAS

| Z-Index | Camada | Pointer Events | Função |
|---|---|---|---|
| 2 | Region boxes (borda visual) | none (interior) | Agrupamento visual |
| 8 | SVG edges + hit areas | stroke (24px invisível) | Linhas de conexão + hover |
| 10 | Node cards (divs) | auto | Caixas de subscription |
| 12 | Region drag handles (borda + label) | auto | Arrastar regiões |
| 20 | Edge labels (SVG separado) | none | DTO/DTI com fundo |

**IMPORTANTE**: Linhas SEMPRE acima das region boxes para que hover funcione em qualquer lugar. Edge labels SEMPRE acima dos node cards para legibilidade.

---

## 5. GERAÇÃO — DOIS SCRIPTS

### 5.0 Convenção de Nomes — Prefixo do Cliente

**TODOS** os arquivos gerados durante o processo devem incluir o **nome do cliente** como prefixo no nome do arquivo. Isso evita conflito quando múltiplos processos rodam em paralelo para clientes diferentes no mesmo diretório.

| Tipo de arquivo | Padrão de nome | Exemplo |
|---|---|---|
| Script de extração | `[CLIENTE]_extract_network_data.py` | `Renner_extract_network_data.py` |
| Script de geração | `[CLIENTE]_gen_network_diagram.py` | `Renner_gen_network_diagram.py` |
| JSON de fluxos | `[CLIENTE]_net_flows.json` | `Renner_net_flows.json` |
| JSON de recursos | `[CLIENTE]_net_resources.json` | `Renner_net_resources.json` |
| HTML final | `[CLIENTE]_Network_Architecture_[PERIODO].html` | `Renner_Network_Architecture_202604.html` |

O nome do cliente é derivado automaticamente do nome do CSV de entrada (ex: `Renner_Detail_Enrollment_86970151_202604_en.csv` → `Renner`).

### Script 1: `[CLIENTE]_extract_network_data.py`
```
Entrada: CSV de fatura Azure EA
Saída: [CLIENTE]_net_flows.json + [CLIENTE]_net_resources.json
```
- Streaming (sem carregar tudo em memória)
- Encoding utf-8-sig, mapeamento por nome de coluna
- Acumula fluxos e recursos por subscription
- **Captura detalhes de SKU** de cada ER Gateway, ER Circuit e VPN Gateway (recurso + MeterName como SKU)
- Salva `_gateway_details` com lista de recursos individuais, deduplicados por ResourceName

### Script 2: `[CLIENTE]_gen_network_diagram.py`
```
Entrada: [CLIENTE]_net_flows.json + [CLIENTE]_net_resources.json
Saída: [CLIENTE]_Network_Architecture_[PERIODO].html
```
- Lê JSONs, calcula layout, gera HTML standalone
- Todo CSS/JS inline
- Dados hardcoded no JavaScript

### Fluxo de uso
```
1. python [CLIENTE]_extract_network_data.py [CSV]   # processa CSV → JSONs
2. python [CLIENTE]_gen_network_diagram.py            # gera HTML interativo
3. Abrir HTML no navegador
```

---

## 6. ADAPTAÇÃO PARA DIFERENTES TOPOLOGIAS

O gerador deve funcionar automaticamente para:

| Topologia | Como detectar | Layout |
|---|---|---|
| **Hub-spoke com ExpressRoute** | Subscription com `expressroute_circuit` ou `expressroute_gateway` | Hub na base da region box, ER connection para On-Prem |
| **Hub-spoke com VPN** | Subscription com `vpn_gateway` | Hub na base da region box, **sem linha para On-Prem** — VPN transita pela internet |
| **Multi-hub** | Múltiplas subscriptions com ER ou VPN | Cada hub na base da sua region box; se na mesma região, distribuir horizontalmente |
| **Cloud-only (sem on-prem)** | Nenhuma subscription com ER/VPN | Sem nó On-Prem; hub é a subscription com mais peering |
| **Multi-region** | Subscriptions em regiões diferentes | Agrupar por região com layout geográfico |
| **Single-region** | Todas na mesma região | Layout simples em grid |

### Detecção automática de Hub
1. Se há subscription com `expressroute_circuit` → é hub
2. Se há subscription com `vpn_gateway` → é hub  
3. Se nenhum ER/VPN, a subscription com mais `vnet_peering` ingress = hub
4. Se múltiplos hubs **na mesma região**, distribuir horizontalmente na base da region box
5. Hubs em **regiões diferentes** ficam cada um na base da sua respectiva region box

### Detecção de On-Premises
- Se há **ExpressRoute** (circuit ou gateway) → mostrar nó On-Premises
- Se há apenas VPN (sem ER) → **NÃO** mostrar nó On-Premises (VPN transita pela internet)
- Se não há ER nem VPN → omitir nó On-Premises

---

## 7. CHECKLIST DE QUALIDADE

- [ ] Todas as setas ⬇=DTO(cobra), ⬆=DTI(grátis) — **NUNCA inverter**
- [ ] Cada caixa é um div HTML independente, não Canvas
- [ ] Hover tooltip funciona em TODOS os nós E em TODAS as linhas
- [ ] Tooltip mostra inventário de recursos (ER Gateway, ER Circuit, VPN, Private Endpoint, etc.)
- [ ] Tooltip mostra **detalhes de SKU** de cada ER Gateway, ER Circuit e VPN Gateway (nome do recurso + SKU/tier + custo individual)
- [ ] Regiões são arrastáveis (movem todos os nós dentro)
- [ ] Nós individuais são arrastáveis (linhas acompanham)
- [ ] Collision avoidance evita sobreposição
- [ ] On-Premises na BASE, Internet **por região no TOPO**, Hub(s) **na base da sua region box**
- [ ] Subscriptions agrupadas por região com caixas tracejadas (hubs + spokes dentro da mesma box)
- [ ] Collision avoidance em 3 fases: intra-região → inter-região → especiais (NUNCA global indiscriminado)
- [ ] Region boxes recalculadas pós-render com alturas reais do DOM
- [ ] Dark theme padrão com toggle para light
- [ ] Controles de fonte (A−/A+/A⟲)
- [ ] Fit e Reset layout
- [ ] Valores monetários em padrão brasileiro (R$ X.XXX,XX)
- [ ] Labels de edges só nos custos > R$ 1.500
- [ ] Explicações contextuais em cada seção do tooltip
- [ ] Funciona com qualquer número de subscriptions (1 a 100+)
- [ ] Funciona com ou sem ExpressRoute/VPN
- [ ] Internet separada por região (um nó por região com tráfego)
- [ ] Tooltip de Internet mostra tráfego agregado da região + total global
- [ ] Botão expandir/contrair "Outros" funciona em ciclos múltiplos
- [ ] Tooltip esconde durante drag (nó, região ou pan)
- [ ] Linhas (edges) sempre acima das region boxes (z-index 8 > 2)
- [ ] Region boxes transparentes a cliques no interior (pointer-events:none)
- [ ] Drag de região via borda/label — não bloqueia hover nas linhas
- [ ] Todos os scripts e arquivos de apoio usam prefixo `[CLIENTE]_` no nome (ex: `Renner_net_flows.json`)
