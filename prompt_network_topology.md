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
- **Filtros interativos**: barra de filtros por tipo de componente de rede + painel lateral de subscriptions com toggle individual

---

## 1. PIPELINE DE DADOS

### 1.1 Extração de Fluxos de Rede (CSV → JSON `_net_flows.json`)

Processar o CSV em streaming. Para cada linha com `MeterCategory` de rede (`Virtual Network`, `Bandwidth`, `ExpressRoute`, `Load Balancer`, `VPN Gateway`, `Azure Firewall`, `NAT Gateway`, `Azure DNS`, `CDN`, `Traffic Manager`, `Azure Front Door`, `Azure Front Door Service`, `Application Gateway`, `Virtual WAN`, `Azure Firewall Manager`, `Azure Bastion`, `Network Watcher`), acumular por `SubscriptionName`:

| Acumulador | Como calcular |
|---|---|
| `peering_egress_gb/cost` | `MeterSubCategory` contém "Peering" (não "Global") + `MeterName` contém "Egress" |
| `peering_ingress_gb/cost` | `MeterSubCategory` contém "Peering" (não "Global") + `MeterName` contém "Ingress" |
| `global_peering_egress_gb/cost` | `MeterSubCategory` contém "Global Peering" + `MeterName` contém "Egress" |
| `global_peering_ingress_gb/cost` | `MeterSubCategory` contém "Global Peering" + `MeterName` contém "Ingress" |
| `internet_egress_gb/cost` | `MeterCategory` = "Bandwidth" + `MeterSubCategory` NÃO "Inter-Region" + `MeterName` contém "Transfer Out" ou "Egress" |
| `internet_ingress_gb/cost` | `MeterCategory` = "Bandwidth" + `MeterName` contém "Transfer In" ou "Ingress" |
| `interregion_egress_gb/cost` | `MeterCategory` = "Bandwidth" + (`MeterSubCategory` = "Inter-Region" OU `MeterName` contém "Inter Continent" ou "Intra Continent"). Tráfego **cross-region interno do Azure**, NÃO internet. |
| `expressroute_out_gb/cost` | `MeterCategory` = "ExpressRoute" + `MeterName` contém "Metered Data" (sem "Circuit") ou "Transfer Out" |
| `expressroute_in_gb/cost` | `MeterCategory` = "ExpressRoute" + `MeterName` contém "Data Transfer In" |
| `expressroute_circuit_cost` | `MeterCategory` = "ExpressRoute" + `MeterName` contém "Circuit" (custo fixo mensal do circuito) |
| `expressroute_gateway_cost` | `MeterCategory` = "ExpressRoute" + (`MeterSubCategory` contém "Gateway" ou `MeterName` contém "ErGw"). Também: `MeterCategory` = "Virtual WAN" + `MeterName` contém "ExpressRoute Scale Unit" ou "ExpressRoute Connection Unit" |
| `vpn_cost` | `MeterCategory` = "VPN Gateway". Também: `MeterCategory` = "Virtual WAN" + `MeterName` contém "VPN S2S Scale Unit" |
| `vwan_hub_cost` | `MeterCategory` = "Virtual WAN" + `MeterName` contém "Hub Unit" ou "Hub Data Processed" (custo fixo do hub vWAN) |
| `private_endpoint_cost` | `MeterSubCategory` contém "Private Endpoint" + `MeterName` contém "Private Endpoint" + UoM hora/mês (custo fixo hourly dos endpoints) |
| `private_link_ingress_gb/cost` | `MeterSubCategory` contém "Private Link" + `MeterName` contém "Ingress" (dados processados por GB — flow, não infra) |
| `private_link_egress_gb/cost` | `MeterSubCategory` contém "Private Link" + `MeterName` contém "Egress" (dados processados por GB — flow, não infra) |
| `firewall_cost` | `MeterCategory` = "Azure Firewall" |
| `firewall_manager_cost` | `MeterCategory` = "Azure Firewall Manager" |
| `nat_cost` | `MeterCategory` = "NAT Gateway" |
| `lb_cost` | `MeterCategory` = "Load Balancer" (apenas) |
| `appgw_cost` | `MeterCategory` = "Application Gateway" (separado de LB — é edge security L7 WAF, não L4) |
| `frontdoor_egress_gb/cost` | `MeterCategory` in ("Azure Front Door", "Azure Front Door Service") + `MeterName` contém "Transfer Out" ou "Egress" |
| `frontdoor_ingress_gb/cost` | `MeterCategory` in ("Azure Front Door", "Azure Front Door Service") + `MeterName` contém "Transfer In" ou "Ingress" |
| `frontdoor_infra_cost` | `MeterCategory` in ("Azure Front Door", "Azure Front Door Service") + demais meters (Base Fees, Requests, etc.) |
| `dns_cost` | `MeterCategory` = "Azure DNS" |
| `bastion_cost` | `MeterCategory` = "Azure Bastion" |
| `total_net_cost` | Soma de todos os custos de rede |
| `region` | `ResourceLocation` mais frequente |

**IMPORTANTE — Separação Bandwidth vs Inter-Region**: O campo `internet_egress` deve conter APENAS tráfego de saída para a internet. Tráfego cross-region interno do Azure (`MeterSubCategory` = "Inter-Region", ou nomes como "Inter Continent Data Transfer Out", "Intra Continent Data Transfer Out") deve ir para `interregion_egress`, **NÃO** para `internet_egress`. Misturar os dois inflaciona drasticamente o nó Internet e oculta o custo real de tráfego cross-region.

**IMPORTANTE — Private Link split**: Private Link tem 3 naturezas distintas:
- **PE hourly** (`private_endpoint_cost`): custo fixo por hora de cada Private Endpoint — é infraestrutura
- **Data Ingress** (`private_link_ingress_gb/cost`): dados processados entrando via PE — é data transfer, mostrar como flow com volume
- **Data Egress** (`private_link_egress_gb/cost`): dados processados saindo via PE — é data transfer
Nunca agregar os 3 em um único `private_link_cost`.

**IMPORTANTE — Application Gateway ≠ Load Balancer**: Application Gateway (WAF v2, Standard v2) é um serviço de borda L7 (WAF, SSL offload, routing). Load Balancer é L4 interno. Custos e funções são completamente diferentes. Usar acumuladores separados.

**IMPORTANTE — Custos de infraestrutura nos flows**: Os campos `expressroute_circuit_cost`, `expressroute_gateway_cost` e `vpn_cost` são **essenciais** para os edges que conectam hubs ao On-Premises. Sem eles, os tooltips e labels dessas linhas ficam zerados. Estes custos devem ser acumulados no **flows JSON** (não apenas no inventário de recursos), pois são usados diretamente pelos edges no diagrama.

A classificação dentro de `MeterCategory = "ExpressRoute"` segue esta ordem:
1. Se `MeterSubCategory` contém "Gateway" ou `MeterName` contém "ErGw" → `expressroute_gateway_cost`
2. Se `MeterName` contém "Circuit" → `expressroute_circuit_cost` — **independente** de o nome também conter "Metered" (ex: `Premium Metered Data 10 Gbps Circuit` deve ir para circuit, NÃO para metered data)
3. Se `MeterName` contém "Metered Data" ou "Transfer Out" → `expressroute_out_gb/cost`
4. Se `MeterName` contém "Data Transfer In" ou "Transfer In" → `expressroute_in_gb/cost`
5. Catch-all ER → `expressroute_out` (tráfego metered genérico)

**ATENÇÃO — Armadilha conhecida**: Alguns `MeterName` de circuitos contêm simultaneamente as palavras "Metered Data" e "Circuit" (ex: `Premium Metered Data 10 Gbps Circuit`, `Standard Metered Data 2 Gbps Circuit`). A regra "Circuit" **DEVE** ser avaliada **ANTES** de "Metered Data" e **SEM** excluir nomes que contenham "metered". Se a condição for `"circuit" in nl and "metered" not in nl`, esses circuitos serão classificados erroneamente como DTO metered data, inflando o valor de DTO e zerando o custo de circuit. Isso é um bug grave que distorce completamente os custos no diagrama.

Para `MeterCategory = "VPN Gateway"` → acumular direto em `vpn_cost`.

### 1.1.1 Classificação de Virtual WAN

A `MeterCategory = "Virtual WAN"` contém recursos que são equivalentes funcionais dos gateways tradicionais. Classificar:

1. Se `MeterName` contém "ExpressRoute Scale Unit" ou "ExpressRoute Connection Unit" → `expressroute_gateway_cost` (funcionalmente equivalente a ER Gateway)
2. Se `MeterName` contém "VPN S2S Scale Unit" → `vpn_cost` (funcionalmente equivalente a VPN Gateway)
3. Demais (`Standard Hub Unit`, `Standard Hub Data Processed`, etc.) → `vwan_hub_cost` (custo fixo do hub vWAN)

Esta classificação é **essencial** para que subscriptions com Virtual WAN sejam corretamente detectadas como HUB e gerem edges para On-Premises.

### 1.1.2 Classificação de Azure Front Door Service

**ATENÇÃO**: A fatura EA pode usar `MeterCategory` = "Azure Front Door Service" (com "Service" no final), diferente do que a documentação Azure chama de "Azure Front Door". O NET_CATS deve incluir **ambas** as variantes. Classificar:

1. Se `MeterName` contém "Transfer Out" ou "Egress" → `frontdoor_egress_gb/cost`
2. Se `MeterName` contém "Transfer In" ou "Ingress" → `frontdoor_ingress_gb/cost`
3. Demais (Base Fees, Requests, etc.) → `frontdoor_infra_cost`

### 1.1.3 Classificação de Azure Firewall Manager

`MeterCategory = "Azure Firewall Manager"` é separado de `Azure Firewall`. Acumular em `firewall_manager_cost`. No diagrama, mostrar como item separado no tooltip sob "Serviços de Rede".

### 1.2 Extração de Inventário de Recursos (CSV → JSON `_net_resources.json`)

Para cada subscription, contar **recursos únicos** (`ResourceName`) por tipo:

| Tipo de recurso | Padrões para detectar (em `MeterCategory + MeterSubCategory + MeterName + ConsumedService`) |
|---|---|
| `vwan_hub` | "Standard Hub Unit", "Standard Hub Data" — hub vWAN |
| `vwan_er_gateway` | "ExpressRoute Scale Unit", "ExpressRoute Connection Unit" — ER no vWAN |
| `vwan_vpn_gateway` | "VPN S2S Scale Unit" — VPN no vWAN |
| `expressroute_gateway` | "ErGw", "expressroute gateway" — **detectar antes de circuit** |
| `expressroute_circuit` | "Circuit" (apenas!) — NÃO incluir "Metered Data" ou "Data Transfer" |
| `vpn_gateway` | "VpnGw", "VPN Gateway", "Basic Gateway" |
| `private_endpoint` | "Private Endpoint" |
| `private_link` | "Private Link" |
| `firewall_manager` | "Firewall Manager", "Policy analytics" |
| `firewall` | "Azure Firewall" |
| `nat_gateway` | "NAT Gateway" |
| `load_balancer` | "Load Balancer" |
| `app_gateway` | "Application Gateway" |
| `vnet_peering` | "Peering" |
| `public_ip` | "Public IP", "IP Addresses" |
| `dns` | "DNS" |
| `front_door` | "Front Door" |

**IMPORTANTE**: A ordem de detecção importa. Usar lista ordenada (não dict):
1. `vwan_hub` (mais específico — "Standard Hub")
2. `vwan_er_gateway` ("ExpressRoute Scale Unit")
3. `vwan_vpn_gateway` ("VPN S2S Scale Unit")
4. `expressroute_gateway` (mais específico — "ErGw")
5. `expressroute_circuit` (apenas "Circuit")
6. `vpn_gateway`
7. ... demais tipos

**NÃO incluir `expressroute_data`** na lista de tipos de recurso. "Metered Data" e "Data Transfer" são registros de cobrança de tráfego, não componentes de rede gerenciáveis. O custo já está capturado nos acumuladores de flow (`expressroute_out_gb/cost`, `internet_egress_gb/cost`, etc.). Incluir como recurso gera um filtro inútil (quase todas as subs têm) e confunde o usuário.

**NUNCA** misturar custo de data transfer com custo de circuit. O custo do circuit é a taxa fixa mensal; o data transfer é o tráfego cobrado por GB. São coisas diferentes e devem ser separadas no inventário.

### 1.3 Detalhes de SKU de Gateways e Circuitos

Para recursos do tipo `expressroute_gateway`, `expressroute_circuit`, `vpn_gateway`, `vwan_hub`, `vwan_er_gateway` e `vwan_vpn_gateway`, capturar **adicionalmente** o detalhe individual de cada recurso:

| Campo | Origem |
|---|---|
| `type` | Tipo do recurso (expressroute_circuit, expressroute_gateway, vpn_gateway, vwan_hub, vwan_er_gateway, vwan_vpn_gateway) |
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
| vWAN ER | `ExpressRoute Scale Unit`, `ExpressRoute Connection Unit` |
| vWAN VPN | `VPN S2S Scale Unit` |
| vWAN Hub | `Standard Hub Unit`, `Standard Hub Data Processed` |

**Deduplicar** por `ResourceName` (somar custos se houver múltiplas linhas para o mesmo recurso).

### 1.4 Mapeamento Autônomo de Componentes Não Previstos

Os padrões listados nas seções 1.1, 1.2 e 1.3 cobrem os componentes de rede mais comuns, mas faturas de clientes podem conter **MeterCategory/MeterSubCategory/MeterName** ainda não previstos (ex: novos serviços Azure, SKUs regionais, variantes de naming).

**Regra (NÃO usar bucket `other_network`)**: Se uma linha do CSV pertence a uma `MeterCategory` de rede (em `NET_CATS`) ou a um serviço de rede que deveria estar em `NET_CATS` mas **não foi capturada** por nenhum dos acumuladores de fluxo (seção 1.1) nem por nenhum padrão de recurso (seção 1.2), o agente **deve mapear e classificar autonomamente** o componente:

1. **Identificar a natureza do componente** com base em `MeterCategory + MeterSubCategory + MeterName + ConsumedService`:
   - É um **fluxo de dados** (cobra por GB)? → criar acumulador de flow apropriado (egress/ingress, com `_gb` e `_cost`)
   - É um **custo fixo de infraestrutura** (cobra por hora/mês)? → criar acumulador de cost simples
   - É um **recurso gerenciável** (com `ResourceName` único)? → criar tipo de recurso no inventário
2. **Adicionar a categoria a `NET_CATS`** se for um `MeterCategory` novo
3. **Adicionar o padrão a `RES_PATTERNS`** se for um novo tipo de recurso (na posição correta de especificidade — mais específico primeiro)
4. **Criar o acumulador de flow** no `flows[...]` defaultdict com nome semanticamente consistente com os existentes (snake_case, sufixo `_cost` / `_gb`)
5. **Adicionar ao tooltip do nó** na seção apropriada (🛡️ Serviços de Rede / ☁️ Fluxos de Tráfego / 🔧 Recursos)
6. **Adicionar como chip de filtro** em `RES_ICONS` e nos filtros por componente (seção 3.11) com ícone apropriado
7. **Logar a decisão** em console durante a extração com prefixo `[AUTO-MAPPED]`:
   ```
   [AUTO-MAPPED] new flow accumulator 'azure_bastion_data_gb/cost' for: Cat=Azure Bastion | SubCat=Standard | Name=Standard Data Transfer | Unit=1 GB
   ```

**Alerta obrigatório ao fim da execução**: Se qualquer mapeamento autônomo foi criado, imprimir resumo:
```
⚠️  PROMPT UPDATE NEEDED — os seguintes mapeamentos foram criados autonomamente:
  • Cat='Azure Bastion' SubCat='Standard' Name='Standard Data Transfer'
      → flow accumulator: azure_bastion_data_gb/cost
      → adicionar à seção 1.1 do prompt
  • Cat='Azure DDoS Protection' Name='Standard Plan'
      → resource pattern: ddos_protection
      → adicionar à seção 1.2 do prompt
Sugestão: atualizar prompt_network_topology.md com estes mapeamentos para que o classificador deixe de depender de inferência autônoma neste padrão.
```

Isso garante que **nenhum custo de rede vai para um bucket genérico** (`other_network` é descontinuado) e que o prompt evolua conforme novos serviços Azure aparecem nas faturas.

---

### 1.5 Atribuição de Região por Linha (Cascade A1→A2→A3→A4)

**Regra fundamental**: Todo recurso de rede DEVE ser representado dentro dos limites visuais da sua região real. Uma subscription não é uma unidade geográfica — ela apenas contém recursos. A chave de acumulação NÃO é mais `SubscriptionName`, e sim a **tupla composta `(SubscriptionName, region_bucket)`**.

Para cada linha do CSV em `NET_CATS`, decidir o `region_bucket` em **cascade**:

| Etapa | Condição | Resultado |
|---|---|---|
| **A1** | `ResourceLocation` preenchido e válido (≠ `""`, `unassigned`, `unknown`, `all regions`, `global`, `zone N`) | Região Azure direta (ex: `brazilsouth`) |
| **A2** | `ResourceLocation` vazio mas `ResourceName` ou `ResourceId` contém token de região conhecida | Região inferida (badge `região inferida pelo nome` no tooltip) |
| **A3** | `MeterCategory` ∈ `{Azure DNS, Azure Front Door, Azure Front Door Service, CDN, Traffic Manager}` | Bucket sintético `__global__` |
| **A4** | Nenhuma das anteriores | Bucket sintético `__shared__` (com alerta ⚠️) |

**Lista mínima de tokens de região para A2** (lowercased substring match em `ResourceName + " " + ResourceId`):
```
brazilsouth, brazilsoutheast, eastus2, eastus, westus3, westus2, westus,
centralus, southcentralus, northcentralus, westcentralus,
canadacentral, canadaeast, northeurope, westeurope, uksouth, ukwest,
francecentral, germanywestcentral, switzerlandnorth, swedencentral,
norwayeast, italynorth, spaincentral, southeastasia, eastasia,
japaneast, japanwest, koreacentral, koreasouth,
australiaeast, australiasoutheast, centralindia, southindia, westindia,
southafricanorth, uaenorth, qatarcentral, chilecentral, mexicocentral
```

**Acumulação**: `flows[(sub, bucket)]`, `resources[(sub, bucket)]`, `gateway_details[(sub, bucket)]` — cada tupla é independente. Uma subscription com recursos em 3 regiões gera 3 entradas.

### 1.6 Merge Threshold (anti-fragmentação)

Após a acumulação, aplicar threshold para evitar que ruído crie nós espúrios:

- **Constante**: `MERGE_THRESHOLD = 1000.0` (em BRL ou moeda da fatura)
- **Recursos estruturais** (que SEMPRE justificam manter o split, mesmo com custo baixo):
  ```
  expressroute_circuit, expressroute_gateway, vpn_gateway,
  vwan_hub, vwan_er_gateway, vwan_vpn_gateway,
  firewall, firewall_manager, app_gateway, nat_gateway
  ```
- **Algoritmo de merge** por subscription:
  1. Identificar o **bucket dominante** = maior `total_net_cost` entre buckets de regiões reais (não `__global__`/`__shared__`). Fallback: maior bucket de qualquer tipo.
  2. Para cada bucket secundário da mesma sub:
     - Se `cost >= MERGE_THRESHOLD` → manter split
     - Se contém recurso estrutural → manter split
     - Se for `__global__` ou `__shared__` → manter split (nunca fundir em região real)
     - Caso contrário → **fundir** flows + resources + gateway_details no bucket dominante

### 1.7 Labels de Saída

| Caso | Label emitido | Exemplo |
|---|---|---|
| Sub single-region após merge | `sub` | `AZR-FSW-SHD` |
| Sub com 2+ buckets de região real | `sub@region` | `AZR-HUB-SHD@brazilsouth`, `AZR-HUB-SHD@eastus` |
| Bucket global | `sub 🌐 Global` | `AZR-HUB-SHD 🌐 Global` |
| Bucket shared/não atribuído | `sub ⚠ Shared` | `AZR-HUB-SHD ⚠ Shared` |

Cada entrada exportada tem metadata adicional:
- `_subscription`: nome original da sub
- `_bucket`: região (`brazilsouth`, `eastus`, `__global__`, `__shared__`)
- `_multi_region`: `true` se a sub aparece em mais de um bucket

### 1.8 Configuração Visual das Regiões Sintéticas

Em `REGION_CFG` do generator, adicionar:
```js
'__global__': {flag:'🌐', label:'Global (geo-distribuído)', color:'#6c7a92'},
'__shared__': {flag:'⚠',  label:'Shared / Não atribuído',   color:'#f0a030'},
```

- **Region box `Global`** aparece sempre que houver pelo menos 1 entrada com bucket `__global__`. Hospeda DNS público, Front Door, Traffic Manager, CDN.
- **Region box `Shared`** aparece **somente se houver custo não atribuível** (após A1+A2+A3 falharem). Borda laranja tracejada. Tooltip lista cada `MeterCategory + MeterName + Cost` para guiar correção futura do mapeamento.
- **Toolbar**: contador `⚠ R$ X não atribuídos` visível quando houver entradas `__shared__`.

---

## 2. ARQUITETURA DO DIAGRAMA HTML

### 2.1 Tecnologias (inline, arquivo único)
- **Google Fonts**: Inter + JetBrains Mono
- **SVG**: Linhas de conexão (edges) com hit areas para hover. **SVGs (`svgEdges` e `svgLabels`) devem estar DENTRO do `#world` div**, não como irmãos do `#world` dentro do `#canvas`. Isso garante que o `transform` (pan/zoom) seja aplicado uma única vez no `#world` e os SVGs acompanhem automaticamente sem drift.
- **HTML divs**: Cada nó é um elemento DOM independente, arrastável
- **CSS Custom Properties**: Dark/light theme
- **JavaScript vanilla**: Drag & drop, pan, zoom, tooltips, regiões arrastáveis

**Estrutura HTML correta do layout:**
```html
<div id="toolbar">...</div>
<div id="filterBar">
  <button id="btnFilterOpen" onclick="toggleFilterDropdown()">🔍 Filtros</button>
  <span id="filterMode" onclick="toggleFilterMode()">OR</span>
  <span id="filterCount"></span>
  <button id="filterClear" onclick="clearFilters()">✕</button>
  <div class="fsep"></div>
  <div id="activeChips"></div>
</div>
<div id="filterOverlay" onclick="closeFilterDropdown()"></div>
<div id="filterDropdown">
  <div class="fd-title">Filtrar por componente de rede</div>
  <div class="fd-grid" id="fchips"></div>
</div>
<button id="btnSubPanel" onclick="toggleSubPanel()">📋 Subscriptions</button>
```

A ordem dos elementos na barra é: **botão Filtros → OR/AND → X/Y subs → ✕ → separador → chips ativos**. Os controles ficam agrupados à esquerda (relacionados ao filtro), chips ativos à direita (feedback visual). O `#canvas` tem `top` ajustado dinamicamente via JS (`adjustLayout()`).

**IMPORTANTE**: O `transform` (translate + scale) é aplicado APENAS no `#world`. Como os SVGs estão dentro, eles herdam o transform automaticamente. **NÃO** aplicar transform separado nos SVGs — isso causa desalinhamento entre edges e nós ao fazer zoom ou pan.

### 2.2 Princípios de Layout

1. **Hubs na PARTE INFERIOR da sua região** — subscriptions com ExpressRoute ou VPN Gateway são posicionadas na **base da region box** da sua respectiva região Azure (pois se conectam para baixo ao On-Premises). Se houver mais de um hub na mesma região, distribuir horizontalmente na base. **NÃO** posicionar hubs numa faixa separada fora das region boxes.
2. **Spokes acima dos hubs** — subscriptions normais (spokes) são organizadas em grid **acima** dos hubs dentro da mesma region box.
3. **On-Premises** = posicionado na **base** do desenho (abaixo das regiões). A posição Y deve ser calculada **dinamicamente** a partir do `maxY` real de todas as region boxes (`max(rb.y + rb.h)`) + margem de 80px — **nunca usar offset fixo** (ex: `baseY + 500`) pois region boxes de tamanhos variáveis causam overlap. Centralizado horizontalmente entre `minRegX` e `maxRegX`.
3. **Internet** = **um nó por região Azure** que tem tráfego de internet significativo, posicionado **acima** de cada região. Cada nó Internet mostra o custo de egress daquela região e, no tooltip, lista as subscriptions, tráfego agregado, e o total global de Internet. Preço de egress varia por região (Brasil ~2x mais caro que EUA) — essa separação é essencial para otimização.
4. **Subscriptions normais (spokes)** = organizadas em grid acima dos hubs, dentro da mesma region box
5. **Regiões Azure** = caixas tracejadas agrupando **TODAS** as subscriptions da mesma região (hubs + spokes). Posicionadas **por custo total de rede (maior custo no centro)**:
   - Ordenar regiões por custo total de rede (soma de `total_net_cost` de todas as subs daquela região), decrescente
   - A região com **maior custo** fica na **posição central** do layout horizontal
   - Regiões menores são distribuídas alternadamente à esquerda e à direita do centro
   - Algoritmo: `regionOrder` = sorted desc por custo → `center = [0]`, `left = [3,1]` (prepend), `right = [2,4]` (append) → `orderedRegions = left + center + right`
   - Exemplo com 3 regiões (BrazilSouth R$120k, EastUS2 R$20k, EastUS R$5k): EastUS fica à esquerda, BrazilSouth no centro, EastUS2 à direita
   - **NÃO** usar posicionamento geográfico (latam=centro, US=direita, etc.) — a posição depende **exclusivamente do custo**
   - Todas as regiões ficam no mesmo `baseY` (sem stagger vertical por geografia)
6. **Top N global + Top M per-region** — dois níveis de agregação:
   - **Global**: Top 14-16 subscriptions por custo de rede são mostradas individualmente; restante agregadas em nó "Outros (X subs)" global com botão expandir/contrair
   - **Per-region**: Dentro de cada region box, se houver mais de **6 spokes** (excluindo hubs), mostrar apenas os **top 6 por custo** e agregar o restante em um nó **"Outros (RegionLabel: X subs)"** dentro da própria region box
   - O nó "Outros" per-region tem botão **expandir/contrair** que funciona independentemente do "Outros" global
   - Ao expandir um "Outros" regional, os nós individuais aparecem **dentro da mesma region box**, que se redimensiona automaticamente
   - Ao contrair, volta ao nó agregado sem afetar outras regiões
   - O nó "Outros" regional mostra no tooltip a lista de subs agregadas com custo individual
   - **Peering edges** das subs agregadas no "Outros" regional são somados no edge do nó agregado (como no "Outros" global)
   - Constante `MAX_SPOKES_PER_REGION = 6` configurável
7. **Collision avoidance em 4 fases** (ver seção 2.4)

### 2.4 Collision Avoidance — 4 Fases

**NUNCA** usar um loop global que empurra todos os nós indiscriminadamente. Isso causa drift de nós entre regiões. Usar **4 fases sequenciais**:

**Fase 1 — Intra-região**: Para cada região, resolver sobreposições apenas entre os nós daquela região. Nós de regiões diferentes **não interagem** nesta fase. Isso mantém cada cluster coeso.

**Fase 2 — Inter-região (box separation)**: Tratar cada region box como um retângulo e verificar sobreposição entre pares de region boxes. Se duas boxes se sobrepõem, empurrar **todas as suas nodes juntas** na direção de menor sobreposição (horizontal ou vertical). Recalcular os bounds da region box após cada empurrão. Iterar até convergir (~50 iterações).

**Fase 3 — Nós especiais**: Resolver sobreposições entre nós especiais (`__onprem__`, `__inet_*__`) e todos os nós regulares. Isso posiciona On-Premises e Internet sem conflito com as regiões.

**Fase 4 — Enforce On-Premises na base**: Após todas as fases de collision avoidance, **re-enforce** que o nó On-Premises fique **abaixo** de todas as region boxes:
1. Calcular `maxRegY` = maior `rb.y + rb.h` de todos os region boxes
2. Se `pos['__onprem__'].y < maxRegY + 60`, forçar `pos['__onprem__'].y = maxRegY + 80`
3. Centralizar horizontalmente: `pos['__onprem__'].x = (minRegX + maxRegX)/2 - width/2`

Isso é necessário porque a Fase 3 pode empurrar On-Premises para cima ou para os lados ao resolver colisões com outros nós especiais.

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
- **Containment automático**: ao arrastar um nó para fora da borda da sua region box, a region box **DEVE crescer automaticamente** para mantê-lo dentro. Implementação:
  1. Função utilitária `nodeRegion(id)` que percorre `regionBoxes` e retorna o `rk` cuja `.nodes[]` contém o id (ignora nós especiais `__onprem__`, `__inet_*__`).
  2. No handler de `mousemove` durante `dragState`, após atualizar `pos[id].x/y`, chamar `recalcRBBounds(ownerRk)` e atualizar `left/top/width/height` do `<div id="rb_{rk}">`.
  3. A region box nunca encolhe abaixo do bounding box dos seus nós, mas pode crescer indefinidamente. Nenhum nó pode "escapar" visualmente do seu container.
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
   - ☁️ Internet + Front Door: ⬇Bandwidth Egress (volume+custo) | ⬇Front Door DTO (volume+custo) | ⬆DTI
   - ↔ Inter-Region: tráfego cross-region Azure (volume+custo) — NÃO é internet
   - 🔗 Private Link — Dados: ⬆Ingress via PE (volume+custo) | ⬇Egress via PE (volume+custo) — flow de dados, não infra
   - Cada seção com **explicação contextual** (o que é, por que cobra, como otimizar)
6. **🛡️ Serviços de rede (infra)**: PE hourly, Firewall, Firewall Manager, vWAN Hub, NAT GW, App Gateway, Load Balancer, Front Door infra, DNS com custos separados

### 3.6 Hover/Tooltip nas Linhas (Edges)
Ao passar o mouse sobre uma linha de conexão, exibir tooltip com:
- Tipo de conexão
- **Custo total da conexão** (destaque) = soma de DTO + DTI + custos fixos de infraestrutura
- Cada componente de custo em **linha separada**: DTO (volume + custo), DTI (volume + custo ou GRÁTIS), Circuit (custo fixo), etc.

**REGRA FUNDAMENTAL DE EXIBIÇÃO DE CUSTOS**: Nunca somar custos de natureza diferente em uma única linha. Cada tipo de custo deve ser exibido **separadamente** com seu próprio label:
- **DTO (dados metered)**: custo por GB de saída — mostrar volume + custo
- **DTI (entrada)**: tipicamente grátis — mostrar volume + "GRÁTIS"
- **Circuito ER (fixo mensal)**: custo fixo do circuito — linha separada com ícone 🔌
- **Gateway ER (fixo)**: custo fixo do gateway — linha separada com ícone 🔌
- **VPN Gateway (fixo)**: custo fixo — linha separada

O `totalCost` no headline é a soma de todos (visão rápida), mas abaixo **cada componente aparece individualmente**.

#### 3.6.1 Edges para On-Premises — ExpressRoute, VPN ou Ambos

A linha para On-Premises existe para hubs com **ExpressRoute** e/ou **VPN Gateway** (incluindo Virtual WAN). **Cada par hub→on-prem gera no máximo UMA linha visual**, com tipo escolhido em função do que o hub possui:

**Edge tipo `onprem_er`** (hub somente com ExpressRoute):
- DTO/DTI do ExpressRoute metered (volume + custo)
- Custo fixo dos Circuitos ER (se > 0)
- **Estilo visual:** azul `#4aa3e8` dashed (`stroke-dasharray: 12,6`)

**Edge tipo `onprem_vpn`** (hub somente com VPN):
- Custo fixo do VPN Gateway ou vWAN VPN S2S Scale Unit
- Custo fixo do vWAN Hub (se aplicável)
- **NÃO tem DTO/DTI** — tráfego VPN transita pela internet pública e é cobrado como Bandwidth genérica na fatura EA, sem meter separado
- **Estilo visual:** cinza `#8b95ab` dotted (`stroke-dasharray: 6,4`)

**Edge tipo `onprem_mixed`** (hub com ExpressRoute E VPN — substitui os dois edges separados):
- **Motivação**: se um hub gerar simultaneamente `onprem_er` e `onprem_vpn`, as duas linhas se sobrepõem visualmente entre os mesmos pontos e a segunda (VPN) intercepta o hover, escondendo os detalhes ER. **NUNCA** emitir dois edges para o mesmo par hub→on-prem.
- **Conteúdo do edge** (todos os campos preservados):
  - ER: `dto_gb`, `dto_cost`, `dti_gb`, `dti_cost`, `circuit_cost`, `gateway_cost`
  - VPN: `vpn_cost`, `vwan_hub_cost`
- **`total`** = soma de TODOS os componentes (ER DTO + DTI + Circuit + Gateway + VPN + vWAN Hub) — usado para espessura, label e headline do tooltip
- **Estilo visual:** roxo `#a87de0` dashed (`stroke-dasharray: 10,5`) — distinto de ER e VPN puros
- **Tooltip** com **duas seções visuais separadas**:
  ```
  🔌 ExpressRoute
    ⬇ DTO (saída)         X GB · R$ Y
    ⬆ DTI (entrada)       X GB · GRÁTIS
    🔌 Circuito ER (fixo)  R$ Y
    🔌 Gateway ER (fixo)   R$ Y
  🔐 VPN
    🔐 VPN Gateway (fixo)  R$ Y
    🌐 vWAN Hub (fixo)     R$ Y
  ```
  Se VPN tiver custo fixo zero (gateway provisionado mas sem cobrança), mostrar linha `VPN sem custo fixo nesta linha` em itálico.
- **Nota contextual obrigatória** no tooltip: "Este hub mantém ExpressRoute e VPN IPSec simultaneamente para On-Premises. ER = caminho primário com circuito dedicado; VPN = backup ou conectividade legada via internet pública. Custos de dados VPN aparecem como Bandwidth genérica na fatura EA (sem meter separado), portanto estão somados ao nó Internet, não aqui."

O tooltip do edge VPN puro explica: "Túnel VPN IPSec — tráfego transita pela internet pública. O custo de dados VPN aparece como Bandwidth genérica na fatura EA, sem meter separado. O valor mostrado aqui é apenas a infraestrutura fixa do gateway."

**Nó On-Premises:** mostrado se existir pelo menos 1 hub com ExpressRoute OU VPN.

**Card do nó On-Premises:**
- **Headline**: custo total (ER DTO + Circuit + Gateway + VPN + vWAN Hub)
- **Chips separados** para cada componente:
  - `⬇DTO R$ X.XXX` (chip vermelho) — ER metered
  - `🔌Circuit R$ X.XXX` (chip azul) — ER circuit fixo
  - `🔌ER GW R$ X.XXX` (chip azul) — ER gateway fixo
  - `🔐VPN R$ X.XXX` (chip roxo) — VPN gateway fixo
  - `🌐vWAN R$ X.XXX` (chip azul) — vWAN hub fixo

**Tooltip do nó On-Premises:**
- Headline com custo total
- Resumo com cada componente discriminado
- Seções per-hub ER (DTO, DTI, Circuit, Gateway)
- Seções per-hub VPN (custo VPN, custo vWAN Hub)
- Nota ⚠️ (se houver VPN hubs): "Dados VPN aparecem como Bandwidth genérica na fatura EA (sem meter separado). O custo de dados VPN está embutido no nó Internet, não neste edge."

### 3.6.1.1 Limitação: Tráfego VPN não segregável na fatura EA

O Azure cobra dados que trafegam pelo túnel VPN IPSec como `MeterCategory = "Bandwidth"` + `MeterName = "Standard Data Transfer Out"` — **exatamente o mesmo meter** que qualquer outro egress para a internet pública. Não há como distinguir na fatura EA se o tráfego saiu para a internet ou passou pelo VPN.

**Impacto no diagrama**:
- O edge `onprem_vpn` mostra **apenas custos fixos** de infraestrutura (VPN Gateway + vWAN Hub)
- O custo de **dados** VPN está embutido no `internet_egress` e aparece no nó Internet
- O nó Internet pode estar **levemente inflado** com tráfego VPN

**Notas obrigatórias no diagrama** (apenas quando `vpnHubSubs.length > 0`):
1. **Tooltip do nó Internet**: `"⚠️ Pode incluir tráfego VPN não segregável. O Azure cobra dados VPN como Bandwidth genérica — não há meter separado na fatura EA."`
2. **Tooltip do nó On-Premises**: `"⚠️ Dados VPN aparecem como Bandwidth genérica na fatura EA (sem meter separado). O custo de dados VPN está embutido no nó Internet, não neste edge."`
3. **Tooltip do edge VPN**: Explicar que o valor mostrado é apenas infraestrutura fixa

#### 3.6.2 Edges de Peering/Internet/Inter-Region
- **Peering**: ⬇ DTO + ⬆ DTI com volumes e custos
- **Internet**: ⬇ DTO (Bandwidth egress + Front Door DTO) + ⬆ DTI. Se houver VPN hubs, tooltip inclui nota ⚠️ sobre possível tráfego VPN não segregável.
- **Inter-Region** (NOVO): ↔ tráfego cross-region Azure com volume + custo. Cor laranja, dashed (`stroke-dasharray: 8,4`). Conecta nó source ao hub em outra região (ou hub mais próximo). Não é internet.

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

### 3.11 Filtros por Componente de Rede — Dropdown/Popover

Botão "Filtros" na barra fixa abaixo do toolbar abre um **dropdown/popover** com chips de componentes em grid wrap. Essa abordagem escala para qualquer número de tipos de serviço sem quebrar o layout horizontal.

#### 3.11.1 Estrutura
- **Botão `#btnFilterOpen`**: texto "🔍 Filtros" (sem filtros ativos) ou "🔍 Filtros (N)" (com N filtros ativos). Borda azul quando há filtros ativos.
- **Controles inline** (sempre visíveis, à esquerda após o botão): `#filterMode` (OR/AND), `#filterCount` (X/Y subs), `#filterClear` (✕). Agrupados com o botão porque são parte da mesma funcionalidade de filtro.
- **Separador** (`.fsep`): divide controles dos chips ativos.
- **`#activeChips`**: container inline que mostra **apenas os chips ativos** (à direita do separador). Scroll horizontal se necessário.
- **`#filterDropdown`**: popover `position:fixed` abaixo da filter bar, com todos os chips em `flex-wrap:wrap`. Background `--sf`, border-radius 12px, box-shadow.
- **`#filterOverlay`**: overlay transparente `position:fixed` full-screen para fechar o dropdown ao clicar fora.
- Fecha com: click no overlay, tecla Escape, ou click no botão Filtros novamente.

#### 3.11.2 Chips de Componente (dentro do dropdown)
- Para cada tipo de recurso de rede que **existe nos dados** (count > 0), gerar um chip clicável
- Tipos possíveis (mesma lista da seção 1.2 — **excluindo `expressroute_data`**): `expressroute_circuit`, `expressroute_gateway`, `vpn_gateway`, `vwan_hub`, `vwan_er_gateway`, `vwan_vpn_gateway`, `firewall`, `firewall_manager`, `private_endpoint`, `private_link`, `nat_gateway`, `load_balancer`, `app_gateway`, `vnet_peering`, `public_ip`, `dns`, `bastion`, `front_door`, `network_watcher`
- Cada chip mostra: ícone + nome + `(N)` onde N = quantidade de subs que possuem esse recurso
- **Chips não presentes nos dados são omitidos** (não mostrar chip com count 0)
- Ao clicar, o chip alterna entre ativo (highlight azul) e inativo
- Chips ativos aparecem também inline na barra (`#activeChips`) para feedback visual sem abrir o dropdown
- Clicar num chip ativo na barra inline desativa o filtro

#### 3.11.3 Modo de Filtro (AND / OR)
- Toggle clicável que alterna entre `OR` e `AND` (na barra, sempre visível)
- **OR** (padrão): mostra subscriptions que possuem **qualquer um** dos componentes selecionados
- **AND**: mostra subscriptions que possuem **todos** os componentes selecionados simultaneamente
- Útil para investigação: "quais subs têm Firewall E Private Endpoint ao mesmo tempo?"

#### 3.11.4 Contador e Botão Limpar
- `#filterCount`: texto `X/Y subs` mostrando quantas subscriptions passam pelo filtro atual (na barra, sempre visível)
- `#filterClear`: botão "✕" que desativa todos os chips e restaura visão completa (na barra, sempre visível)

#### 3.11.5 Comportamento ao Filtrar
- Quando filtros estão ativos, `buildData()` filtra `DATA_ALL` **antes** de aplicar top-N e agregação
- Subscriptions que não passam no filtro **não aparecem** no diagrama (nem em nós "Outros")
- Regiões sem subscriptions visíveis não geram region box
- Internet nodes e On-Premises se adaptam automaticamente
- Ao ativar/desativar um filtro: `buildData() → applyRegionAgg() → computeLayout() → buildEdges() → render() → fitAll()`
- Estado de expansão ("Outros" global e per-region) é resetado ao filtrar

### 3.12 Painel de Subscriptions

Painel lateral retrátil à direita (`#subPanel`, `width:280px`, `transform:translateX(100%)` quando fechado).

#### 3.12.1 Estrutura
- **Botão toggle** (`#btnSubPanel`): fixo no canto superior direito, texto "📋 Subscriptions" / "✕ Fechar"
- **Header**: título + botões rápidos (All, None, PROD, DEV)
- **Campo de busca**: filtra a lista por texto (case-insensitive)
- **Lista de subscriptions** (`#subList`): scrollável, ordenada por custo de rede desc
- **Footer** (`#subFooter`): mostra custo total visível em tempo real

#### 3.12.2 Cada Linha da Lista
- Checkbox (checked = visível, unchecked = oculta)
- Badge de ambiente com cor (PROD verde, DEV laranja, UAT roxo)
- Nome da subscription
- Custo de rede formatado (R$ X.XXX)
- Quando desmarcada: nome riscado (`text-decoration:line-through`), opacidade reduzida

#### 3.12.3 Botões Rápidos
| Botão | Ação |
|---|---|
| **All** | Marca todas as subscriptions como visíveis |
| **None** | Desmarca todas |
| **PROD** | Marca apenas subs com `env === 'PROD'`, desmarca as demais |
| **DEV** | Marca apenas subs com `env === 'DEV'`, desmarca as demais |

#### 3.12.4 Comportamento
- Estado armazenado em `hiddenSubs = {}` (mapa `subLabel → true` para subs ocultas)
- Ao marcar/desmarcar: mesma pipeline de `buildData()` → render
- `buildData()` filtra `DATA_ALL` excluindo subs em `hiddenSubs` **antes** de aplicar filtros de componente e top-N
- O canvas se ajusta: `canvas.style.right = '280px'` quando o painel está aberto, `'0'` quando fechado
- Footer mostra soma de `total_net_cost` apenas das subs visíveis

#### 3.12.5 Interação entre Filtros
- Os dois filtros (componente + subscription) são **acumulativos**: uma sub precisa estar marcada no painel E passar no filtro de componente para aparecer no diagrama
- Ordem de aplicação em `buildData()`:
  1. Excluir subs em `hiddenSubs`
  2. Se há `activeFilters`, aplicar filtro por componente (AND/OR)
  3. Ordenar por custo, aplicar top-N, agregar "Outros"

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
- **Espessura** proporcional ao custo, **relativa ao máximo do dataset**: `EDGE_MIN_W + (EDGE_MAX_W - EDGE_MIN_W) * (cost / maxCost)` onde `maxCost` é o maior custo entre todos os edges. Isso garante que o edge mais caro sempre tenha espessura máxima e os demais se distribuem proporcionalmente, independente da magnitude absoluta dos custos. **NÃO usar fórmula fixa** como `cost/5000` — isso só funciona para um range específico de custos.
- **Opacidade**: 0.45 para edges > R$ 1.500, 0.18 para edges menores
- **Cores e estilos por tipo de edge**:
  - **ExpressRoute → On-Prem** (`onprem_er`): azul `#4aa3e8`, dashed (`stroke-dasharray: 12,6`)
  - **VPN → On-Prem** (`onprem_vpn`): cinza `#8b95ab`, dotted (`stroke-dasharray: 6,4`) — distinto do ER
  - **ER + VPN → On-Prem** (`onprem_mixed`): roxo `#a87de0`, dashed (`stroke-dasharray: 10,5`) — usado quando o mesmo hub tem ambos (substitui os dois edges)
  - **Internet**: vermelho `#f05555`, sólido
  - **Inter-Region**: laranja `#f0a030`, dashed (`stroke-dasharray: 8,4`)
  - **Peering**: roxo `#a87de0`, sólido
- **Labels**: Apenas em edges com custo > R$ 1.500, com fundo semi-transparente para legibilidade
- **Hit area**: Linha invisível de 24px de largura para hover
- **Anchor points de nós especiais**: As linhas de conexão devem se ancorar nos pontos lógicos de cada nó, não no centro:
  - **On-Premises** (base da tela): linhas chegam pela **parte superior** da caixa (`y = pt.y`)
  - **Internet** (topo da tela): linhas chegam pela **parte inferior** da caixa (`y = pt.y + pt.h`)
  - **Hub → On-Prem** (ER ou VPN): a linha sai da **base** do hub (`y = pf.y + pf.h`)
  - **Node → Internet**: a linha sai do **topo** do nó (`y = pf.y`)
  - **Peering/Inter-Region (node ↔ hub)**: usa o **centro** (`y = pos.y + pos.h/2`) em ambos os lados

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
| 12 | Region drag handles (borda + label) | auto | Arrastar regiões |
| 14 | Node cards (divs) | auto | Caixas de subscription |
| 20 | Edge labels (SVG separado) | none | DTO/DTI com fundo |
| 97 | Botão toggle sub panel | auto | Abrir/fechar painel |
| 98 | Sub panel lateral | auto | Lista de subscriptions |
| 99 | Filter bar | auto | Botão filtros + chips ativos |
| 100 | Toolbar | auto | Controles principais |
| 100 | Filter overlay | auto (transparent) | Fechar dropdown ao clicar fora |
| 101 | Filter dropdown popover | auto | Grid de chips de filtro |

**IMPORTANTE**: Linhas SEMPRE acima das region boxes para que hover funcione em qualquer lugar. Edge labels SEMPRE acima dos node cards para legibilidade.

### 4.7 Filter Bar e Dropdown (CSS)
```css
#filterBar {
  position:fixed; top:44px; left:0; right:0; z-index:99;
  display:flex; align-items:center; gap:6px;
  padding:4px 12px; background:var(--sf);
  border-bottom:1px solid var(--bd);
  font-size:12px; flex-wrap:nowrap; height:36px;
}
#btnFilterOpen {
  background:var(--cd); border:1px solid var(--bd);
  border-radius:8px; padding:3px 10px; cursor:pointer;
  font-size:11px; white-space:nowrap;
}
#btnFilterOpen.has-active { border-color:var(--bl); color:var(--bl); }
#activeChips {
  display:flex; gap:4px; flex:1; min-width:0;
  overflow-x:auto; scrollbar-width:none;
}
#filterDropdown {
  position:fixed; top:80px; left:12px; z-index:101;
  background:var(--sf); border:1px solid var(--bd);
  border-radius:12px; padding:12px;
  box-shadow:0 8px 32px rgba(0,0,0,.5);
  display:none; max-width:460px; min-width:280px;
}
#filterDropdown.open { display:block; }
#filterDropdown .fd-grid { display:flex; flex-wrap:wrap; gap:6px; }
#filterOverlay {
  position:fixed; top:0; left:0; right:0; bottom:0;
  z-index:100; display:none;
}
#filterOverlay.open { display:block; }
```
- Botão Filtros: muda para "🔍 Filtros (N)" quando N filtros ativos
- Chips ativos inline (`#activeChips`): scroll horizontal invisível, clicáveis para desativar
- Dropdown: grid wrap com todos os chips, abre/fecha com toggle
- Overlay: fecha dropdown ao clicar fora
- Escape: fecha dropdown via `document.addEventListener('keydown')`
- `adjustLayout()`: chamado no init e window.resize para ajustar canvas top dinamicamente

### 4.8 Subscription Panel (CSS)
```css
#subPanel {
  position:fixed; top:80px; right:0; width:280px; bottom:0; z-index:98;
  background:var(--sf); border-left:1px solid var(--bd);
  display:flex; flex-direction:column;
  transform:translateX(100%); transition:transform .2s;
}
#subPanel.open { transform:translateX(0); }
```
- Cada linha (`.sub-row`): flex layout com checkbox + badge env + nome + custo
- Badge de ambiente (`.sub-env`): cores por env (PROD=verde, DEV=laranja, UAT=roxo)
- Sub oculta (`.sub-row.unchecked .sub-name`): `opacity:.4; text-decoration:line-through`
- Botão toggle (`#btnSubPanel`): `position:fixed; top:82px; right:8px`, muda para `right:288px` quando painel aberto (`.shifted`)

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
| **Hub-spoke com ExpressRoute** | Subscription com `expressroute_circuit` ou `expressroute_gateway` | Hub na base da region box, edge ER (azul dashed) para On-Prem |
| **Hub-spoke com VPN** | Subscription com `vpn_gateway` ou `vwan_vpn_gateway` | Hub na base da region box, edge VPN (cinza dotted) para On-Prem |
| **Hub-spoke com Virtual WAN** | Subscription com `vwan_hub` + `vwan_er_gateway` e/ou `vwan_vpn_gateway` | Hub na base da region box, edges ER e/ou VPN para On-Prem |
| **Multi-hub** | Múltiplas subscriptions com ER ou VPN | Cada hub na base da sua region box; se na mesma região, distribuir horizontalmente |
| **Cloud-only (sem on-prem)** | Nenhuma subscription com ER/VPN/vWAN | Sem nó On-Prem; hub é a subscription com mais peering |
| **Multi-region** | Subscriptions em regiões diferentes | Agrupar por região com layout por custo |
| **Single-region** | Todas na mesma região | Layout simples em grid |

### Detecção automática de Hub
1. Se há subscription com `expressroute_circuit` → é hub
2. Se há subscription com `expressroute_gateway` → é hub
3. Se há subscription com `vpn_gateway` → é hub
4. Se há subscription com `vwan_hub`, `vwan_er_gateway` ou `vwan_vpn_gateway` → é hub
5. Se nenhum ER/VPN/vWAN, a subscription com mais `vnet_peering` ingress = hub
6. Se múltiplos hubs **na mesma região**, distribuir horizontalmente na base da region box
7. Hubs em **regiões diferentes** ficam cada um na base da sua respectiva region box

### Classificação de Hub para edges On-Premises
- **erHubSubs**: hubs com `expressroute_circuit` OU `expressroute_gateway` OU `vwan_er_gateway`
- **vpnHubSubs**: hubs com `vpn_gateway` OU `vwan_vpn_gateway`
- **Seleção do tipo de edge** (UM único edge por par hub→on-prem):
  - Hub apenas em `erHubSubs` → emitir edge `onprem_er`
  - Hub apenas em `vpnHubSubs` → emitir edge `onprem_vpn`
  - Hub em **ambas** as listas → emitir **um único edge `onprem_mixed`** com todos os campos ER + VPN (NUNCA dois edges separados — eles se sobrepõem e o segundo intercepta o hover)

### Detecção de On-Premises
- Se há **ExpressRoute** (circuit, gateway, vWAN ER) → mostrar nó On-Premises + edge ER ou mixed
- Se há **VPN** (gateway, vWAN VPN S2S) → mostrar nó On-Premises + edge VPN ou mixed
- Se há ER + VPN no mesmo hub → edge `onprem_mixed`
- Se há ER e VPN em hubs **diferentes** → cada hub gera seu próprio edge (ER de um, VPN do outro)
- Se não há ER nem VPN → omitir nó On-Premises

---

## 7. CHECKLIST DE QUALIDADE

- [ ] **Atribuição de região por linha**: cascade A1→A2→A3→A4 implementada (ResourceLocation → nome → `__global__` → `__shared__`)
- [ ] Acumulação usa chave composta `(sub, region_bucket)` — nunca apenas `sub`
- [ ] Merge threshold (`R$ 1.000` + sem recurso estrutural) funde buckets ruído no dominante
- [ ] Recursos estruturais (ER GW/Circuit, VPN GW, vWAN Hub/ER/VPN, Firewall, FW Mgr, App GW, NAT GW) SEMPRE preservam o split mesmo com custo baixo
- [ ] Labels de saída: `sub` (single), `sub@region` (multi), `sub 🌐 Global`, `sub ⚠ Shared`
- [ ] Region box `🌐 Global` renderizada sempre que houver custos geo-distribuídos (DNS, FrontDoor, TM, CDN)
- [ ] Region box `⚠ Shared` renderizada SOMENTE se houver custos não atribuíveis (com contador no toolbar)
- [ ] **Mapeamento autônomo**: linhas não cobertas pelos padrões geram novos acumuladores/recursos/filtros automaticamente (`other_network` descontinuado)
- [ ] Mapeamentos autônomos logados com `[AUTO-MAPPED]` e resumidos ao fim com alerta `⚠️ PROMPT UPDATE NEEDED`
- [ ] **Containment do drag**: arrastar nó para fora da region box faz a region crescer automaticamente (via `nodeRegion()` + `recalcRBBounds()`)
- [ ] **Edge `onprem_mixed`**: hub com ER + VPN gera UM único edge (nunca dois sobrepostos)
- [ ] Tooltip do `onprem_mixed` mostra duas seções visuais (🔌 ExpressRoute + 🔐 VPN) com todos os componentes discriminados
- [ ] `total` do edge mixed = DTO + DTI + Circuit + Gateway + VPN + vWAN Hub
- [ ] Edge mixed com estilo visual distinto: roxo `#a87de0` dashed `10,5`
- [ ] Todas as setas ⬇=DTO(cobra), ⬆=DTI(grátis) — **NUNCA inverter**
- [ ] Custos de natureza diferente NUNCA somados em uma única linha (DTO, Circuit, Gateway são linhas separadas)
- [ ] On-Premises card mostra chips separados para DTO, Circuit, Gateway (não um número único misturado)
- [ ] On-Premises tooltip mostra resumo com cada componente discriminado + detalhes per-hub
- [ ] Edge tooltip mostra totalCost no headline + componentes individuais abaixo (DTO, Circuit separados)
- [ ] Cada caixa é um div HTML independente, não Canvas
- [ ] Hover tooltip funciona em TODOS os nós E em TODAS as linhas
- [ ] Tooltip mostra inventário de recursos (ER Gateway, ER Circuit, VPN, Private Endpoint, etc.)
- [ ] Tooltip mostra **detalhes de SKU** de cada ER Gateway, ER Circuit e VPN Gateway (nome do recurso + SKU/tier + custo individual)
- [ ] Regiões são arrastáveis (movem todos os nós dentro)
- [ ] Nós individuais são arrastáveis (linhas acompanham)
- [ ] Collision avoidance evita sobreposição
- [ ] On-Premises na BASE, Internet **por região no TOPO**, Hub(s) **na base da sua region box**
- [ ] On-Premises posicionado dinamicamente via `maxY` das region boxes (nunca offset fixo)
- [ ] Collision avoidance Fase 4 re-enforça On-Premises abaixo de todas as regiões
- [ ] Subscriptions agrupadas por região com caixas tracejadas (hubs + spokes dentro da mesma box)
- [ ] Collision avoidance em 4 fases: intra-região → inter-região → especiais → enforce On-Prem base (NUNCA global indiscriminado)
- [ ] On-Premises renderizado por função dedicada `renderOnPrem()` (não por `renderSpecial()`) com chips de breakdown e tooltip
- [ ] Region boxes recalculadas pós-render com alturas reais do DOM
- [ ] Dark theme padrão com toggle para light
- [ ] Controles de fonte (A−/A+/A⟲)
- [ ] Fit e Reset layout
- [ ] Valores monetários em padrão brasileiro (R$ X.XXX,XX)
- [ ] Labels de edges só nos custos > R$ 1.500
- [ ] Explicações contextuais em cada seção do tooltip
- [ ] Funciona com qualquer número de subscriptions (1 a 100+)
- [ ] Funciona com ou sem ExpressRoute/VPN
- [ ] VPN Gateway gera edge para On-Premises (cinza dotted, distinto do ER azul dashed)
- [ ] Virtual WAN detectado como hub (vwan_hub, vwan_er_gateway, vwan_vpn_gateway)
- [ ] Virtual WAN ER Scale Unit acumulado em expressroute_gateway_cost
- [ ] Virtual WAN VPN S2S Scale Unit acumulado em vpn_cost
- [ ] Bandwidth Inter-Region separado de Internet Egress (interregion_egress, não internet_egress)
- [ ] Inter-Region edges com cor laranja e dash distinto
- [ ] Private Link split em 3: PE hourly (infra) + Ingress data (flow) + Egress data (flow)
- [ ] Private Link data processed mostrado como flow com volume no tooltip (não apenas custo fixo)
- [ ] Application Gateway separado de Load Balancer (appgw_cost ≠ lb_cost)
- [ ] Azure Front Door Service mapeado (com "Service" no nome)
- [ ] Front Door split: DTO/DTI (egress/ingress) + infra (Base Fees, Requests)
- [ ] Azure Firewall Manager separado de Azure Firewall
- [ ] DNS tem acumulador próprio (dns_cost)
- [ ] Espessura de edge relativa ao max cost do dataset (não fórmula fixa /5000)
- [ ] Internet separada por região (um nó por região com tráfego)
- [ ] Tooltip de Internet mostra tráfego agregado da região + total global
- [ ] Botão expandir/contrair "Outros" funciona em ciclos múltiplos
- [ ] Tooltip esconde durante drag (nó, região ou pan)
- [ ] Linhas (edges) sempre acima das region boxes (z-index 8 > 2)
- [ ] Region boxes transparentes a cliques no interior (pointer-events:none)
- [ ] Drag de região via borda/label — não bloqueia hover nas linhas
- [ ] Todos os scripts e arquivos de apoio usam prefixo `[CLIENTE]_` no nome (ex: `Renner_net_flows.json`)
- [ ] Barra de filtros por componente funcional com chips clicáveis (AND/OR)
- [ ] Chips mostram apenas tipos de recurso presentes nos dados (count > 0)
- [ ] Filtro AND mostra subs que têm TODOS os componentes selecionados
- [ ] Filtro OR mostra subs que têm QUALQUER componente selecionado
- [ ] Contador `X/Y subs` atualiza em tempo real ao filtrar
- [ ] Botão "Limpar" reseta todos os filtros de componente
- [ ] Painel lateral de subscriptions abre/fecha com toggle
- [ ] Lista de subs ordenada por custo desc com checkbox, badge env, custo
- [ ] Desmarcar sub remove nó, edges e custos do diagrama
- [ ] Botões rápidos (All/None/PROD/DEV) funcionam corretamente
- [ ] Busca textual filtra lista de subscriptions em tempo real
- [ ] Footer do painel mostra custo total visível atualizado
- [ ] Canvas ajusta `right` quando painel abre/fecha
- [ ] Filtros de componente e subscription são acumulativos
- [ ] Estado de expansão "Outros" reseta ao aplicar filtros
