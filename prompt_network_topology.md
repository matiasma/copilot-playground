# PROMPT — Gerador de Diagrama de Topologia de Custos de Rede Azure (HTML Interativo)

> **Versão**: 2.13 · **Última atualização**: 2026-05-25  
> **Compatibilidade**: Azure EA / MCA · CSV Detail Enrollment  
> **Stack alvo**: Python 3.10+ · HTML/CSS/JS vanilla (sem dependências em runtime)

> **Instruções**: Cole este prompt no GitHub Copilot Agent Mode.  
> Forneça o CSV de fatura Azure EA (`Detail_Enrollment_*.csv`).  
> O agente irá: (1) extrair dados de rede do CSV, (2) gerar diagrama HTML interativo com topologia de custos.

> **⚠ Proteção contra regressão**: Este prompt é coberto por testes automáticos em `tests/regression_test.py`. **Antes de alterar qualquer regra de classificação, threshold, ou estrutura de output**, rode `python tests/regression_test.py`. Se algum cliente baseline divergir, **pare e peça confirmação explícita ao usuário** antes de prosseguir. Ver seção 8 (Protocolo de Mudança).

---

## Índice

- [0. Contrato (Inputs / Outputs / Escopo)](#0-contrato)
- [1. Pipeline de Dados (Extrator)](#1-pipeline-de-dados)
- [2. Arquitetura do Diagrama HTML](#2-arquitetura-do-diagrama-html)
- [3. Interatividade](#3-interatividade)
- [4. Design Visual](#4-design-visual)
- [5. Geração — Dois Scripts](#5-geração--dois-scripts)
- [6. Adaptação a Topologias](#6-adaptação-para-diferentes-topologias)
- [7. Checklist de Qualidade](#7-checklist-de-qualidade)
- [8. Protocolo de Mudança (anti-regressão)](#8-protocolo-de-mudança-anti-regressão)
- [Apêndices](#apêndices)
  - [A. Armadilhas Conhecidas](#apêndice-a--armadilhas-conhecidas)
  - [B. Glossário](#apêndice-b--glossário)
  - [C. Como Debugar](#apêndice-c--como-debugar)
  - [D. Invariantes Bloqueadas](#apêndice-d--invariantes-bloqueadas)
- [Histórico de Versões](#histórico-de-versões)

---

## 0. Contrato

### 0.1 Inputs esperados

**CSV de fatura Azure EA / MCA** (`Detail_Enrollment_*.csv`):

| Coluna | Tipo | Obrigatória? | Uso |
|---|---|---|---|
| `BillingAccountId`, `BillingAccountName` | string | sim | Identificação do enrollment (escopo) |
| `SubscriptionId`, `SubscriptionName` | string | sim | Agrupamento e atribuição de fluxos |
| `Date` | string (MM/DD/YYYY) | sim | Período da linha (auditoria) |
| `MeterCategory`, `MeterSubCategory`, `MeterName` | string | sim | Classificação de fluxos e recursos |
| `Quantity` | float (GB / hora) | sim | Volume de dados ou tempo |
| `Cost` (ou `CostInBillingCurrency`) | float | sim | Custo em moeda da fatura |
| `BillingCurrency` | string | sim | Moeda (BRL, USD, EUR, ...) |
| `ResourceLocation` | string | recomendada | Região Azure (cascade A1) |
| `ResourceId`, `ResourceName` | string | recomendada | Inferência de região (A2), agrupamento de SKU, **extração do RP consumidor** (§1.10) |
| `ConsumedService` | string | recomendada | Desambiguação de tipos, RP consumidor |
| `MeterRegion` | string | recomendada | **Tier de pricing de bandwidth** (`Intercontinental`, `Sao Paulo State`, `South America`, `Zone N`) — distinto de `ResourceLocation` (§1.5.1) |
| `UnitOfMeasure` | string | recomendada | **Gate primário infra-vs-data** (`1 Hour`/`1/Hour`/`1/Month` ⇒ infra fixa; `1 GB` ⇒ flow; `1M`/`10K` ⇒ contável) — ver §1.1.0 |
| `ChargeType` | string | recomendada | Filtrar `!= "Usage"` (refunds, purchases, unused reservation tratados separadamente — §1.1.0) |
| `Frequency` | string | recomendada | `UsageBased` vs `OneTime` — útil para detectar IP reservado e similares |
| `PublisherType`, `PublisherName` | string | recomendada | `PublisherType != "Azure"` ⇒ **NVA de Marketplace** (Palo Alto, Fortinet etc., §1.2) |
| `ResourceGroup` | string | recomendada | Convenção de hub via token (§1.5.0) |
| `Tags` | string | opcional | Atribuição de workload-owner (informativo no tooltip — §1.10) |
| `AdditionalInfo` | string | opcional | JSON com `NodeIp`/`VmName`/`ClusterId` — informativo |
| `AvailabilityZone`, `ServiceInfo1`, `ServiceInfo2` | string | opcional | Não usado por enquanto |

**Encoding**: `utf-8-sig` (BOM presente em exports oficiais).

Se o CSV não tiver as colunas obrigatórias, o extrator deve falhar com mensagem clara apontando quais colunas faltam.

### 0.2 Outputs gerados

Três artefatos JSON + um HTML standalone. Todos com prefixo `[CLIENTE]_` (ver 5.1).

**`[CLIENTE]_net_flows.json`** — fluxos de rede por `(sub, region_bucket)`:
```json
{
  "<label>": {
    "_subscription": "string",
    "_bucket": "brazilsouth | eastus2 | ... | __global__ | __shared__",
    "_multi_region": "bool",
    "region": "string (=_bucket)",
    "env": "PROD | DEV | UAT | OTHER",
    "currency": "BRL | USD | ...",
    "total_net_cost": "float",
    "peering_egress_gb": "float", "peering_egress_cost": "float",
    "peering_ingress_gb": "float", "peering_ingress_cost": "float",
    "global_peering_egress_gb": "float", "global_peering_egress_cost": "float",
    "global_peering_ingress_gb": "float", "global_peering_ingress_cost": "float",
    "internet_egress_gb": "float", "internet_egress_cost": "float",
    "interregion_egress_gb": "float", "interregion_egress_cost": "float",
    "expressroute_out_gb": "float", "expressroute_out_cost": "float",
    "expressroute_in_gb": "float", "expressroute_in_cost": "float",
    "expressroute_circuit_cost": "float", "expressroute_gateway_cost": "float",
    "vpn_cost": "float", "vwan_hub_cost": "float",
    "private_endpoint_cost": "float",
    "private_link_ingress_gb": "float", "private_link_ingress_cost": "float",
    "private_link_egress_gb": "float", "private_link_egress_cost": "float",
    "firewall_cost": "float", "firewall_manager_cost": "float",
    "nat_cost": "float", "nat_gateway_cost": "float", "nat_data_gb": "float", "nat_data_cost": "float",
    "lb_cost": "float", "lb_rules_cost": "float", "lb_data_gb": "float", "lb_data_cost": "float",
    "appgw_cost": "float", "appgw_fixed_cost": "float", "appgw_cu_cost": "float",
    "frontdoor_egress_gb": "float", "frontdoor_egress_cost": "float",
    "frontdoor_ingress_gb": "float", "frontdoor_ingress_cost": "float",
    "frontdoor_infra_cost": "float",
    "frontdoor_classic_egress_gb": "float", "frontdoor_classic_egress_cost": "float",
    "frontdoor_classic_ingress_gb": "float", "frontdoor_classic_ingress_cost": "float",
    "frontdoor_classic_infra_cost": "float",
    "frontdoor_std_egress_gb": "float", "frontdoor_std_egress_cost": "float",
    "frontdoor_std_ingress_gb": "float", "frontdoor_std_ingress_cost": "float",
    "frontdoor_std_infra_cost": "float",
    "mgn_egress_gb": "float", "mgn_egress_cost": "float",
    "dns_cost": "float", "dns_private_zone_cost": "float", "dns_query_cost": "float",
    "bastion_cost": "float", "bastion_hourly_cost": "float", "bastion_egress_gb": "float", "bastion_egress_cost": "float",
    "connection_egress_gb": "float", "connection_egress_cost": "float",
    "connection_ingress_gb": "float", "connection_ingress_cost": "float",
    "_by_connection": {
      "<connection_name>": {
        "egress_gb": "float", "egress_cost": "float",
        "ingress_gb": "float", "ingress_cost": "float",
        "resource_id": "string (ARM path)",
        "parent_gateway_hint": "string | null"
      }
    },
    "<flow_or_infra_key>_hours": "float (v2.12+: opcional, capturado p/ meters com UoM '1 Hour' — exclui '1/Month'; permite render qty+unit+cost em hourly infra como ER Gateway, VPN GW, vWAN Hub, Public IP)",
    "_reconciliation": {
      "regional_peering | global_peering | private_link_data": {
        "eg_gb": "float", "in_gb": "float", "gap_pct": "float",
        "verdict": "MATCH | PARTIAL | GAP_EXTERNO | INFORMATIVO",
        "direction": "egress | ingress | balanced",
        "total_cost": "float", "bilateral": "bool"
      }
    }
  }
}
```

**`[CLIENTE]_net_resources.json`** — inventário de recursos por `(sub, region_bucket)`:
```json
{
  "<label>": {
    "<resource_type>": {"count": "int", "cost": "float", "resources": ["names"]},
    "_gateway_details": [
      {
        "type": "expressroute_circuit | expressroute_gateway | vpn_gateway | vwan_hub | vwan_er_gateway | vwan_vpn_gateway",
        "resource": "string (ResourceName)",
        "sku": "string (MeterName)",
        "cost": "float (custo base/infra)",
        "dto_gb":   "float (v2.12+: só para expressroute_circuit; volume out via meter)",
        "dto_cost": "float (v2.12+: idem; custo da DTO daquele circuito)",
        "dti_gb":   "float (v2.12+: idem para entrada — tipicamente GRÁTIS)",
        "dti_cost": "float (v2.12+: idem; tipicamente 0)"
      }
    ],
    "_consumer_breakdown": {
      "by_resource_provider": [{"rp": "Microsoft.MachineLearningServices/workspaces", "cost": 0.0, "rows": 0}],
      "by_consumed_service": [{"cs": "Microsoft.Databricks", "cost": 0.0, "rows": 0}]
    },
    "_hub_by_convention": "bool",
    "_subscription": "string", "_bucket": "string", "region": "string", "env": "string"
  }
}
```

**`[CLIENTE]_net_reconciliation.json`** — reconciliação enrollment-wide (ver 1.9.3 para schema completo).

**`[CLIENTE]_net_workloads.json`** — inventário de **workloads descobertos dinamicamente** via Tags + RP namespace + ConsumedService (§1.11). Sem hardcode de nome de serviço ou de cliente.

**`[CLIENTE]_net_peering_matrix.json`** — **matriz bipartida** de peering com pareamento estimado de egress↔ingress por par de subs (§1.12).

**`[CLIENTE]_net_insights.json`** — lista consolidada de **achados de otimização e anomalias** (§1.13–1.15): PE over-provisioning, LB-as-SNAT, MGN savings, ER circuit utilization, orphaned DNS zones, idle infra, hairpin inter-region, orphaned peering, sub-anomalies, eficiencia de pricing. Cada achado tem `category`, `severity`, `subject`, `evidence`, `estimated_savings_monthly`, `recommendation` — textos gerados a partir do que é observado, **sem referência a nome de cliente ou workload específico**.

**`[CLIENTE]_Network_Architecture_[YYYYMM].html`** — diagrama interativo standalone (consolida todos os JSONs anteriores).

> **Regra de chaves JSON**: sempre em **inglês** e `snake_case` (interoperabilidade com ferramentas downstream). UI/labels do diagrama em português.

### 0.3 Escopo

**Dentro do escopo:**
- Custos de rede Azure (Virtual Network, Bandwidth, ExpressRoute, VPN, Firewall, NAT, LB, App Gateway, PE, Private Link, Front Door, DNS, Bastion, Virtual WAN, Network Watcher)
- Topologia hub-spoke com agrupamento por região
- Reconciliação factual de fluxos bilaterais (peering)
- Análise de um único período (a fatura fornecida)

**Fora do escopo:**
- Custos não-rede (compute, storage, databases) — só rede
- Comparação multi-período / time-series
- Análise por tag de negócio (cost center, projeto, owner)
- Inferência de quem é a contraparte de peerings externos (apenas reporta o fato)
- Conformidade / segurança / compliance (apenas custo)
- Recomendações de otimização automática (apenas factual; exceto explicações contextuais nos tooltips)

---

## 1. Pipeline de Dados

### 1.1.0 Invariantes de pré-classificação (gates obrigatórios)

Antes de aplicar qualquer acumulador da §1.1, **toda linha** deve passar por dois gates determinísticos. Eles são mais robustos que parsing de substring em `MeterName` e protegem contra mudanças de naming pela Microsoft (ver Armadilha A.1).

**Gate 1 — Filtro de `ChargeType`**

O extrator processa apenas linhas com `ChargeType = "Usage"`. Os demais são tratados separadamente (não acumulados em flows nem em resources):

| `ChargeType` | Ação |
|---|---|
| `Usage` | Processar normalmente |
| `Purchase` | Logar e contabilizar em bloco separado `_one_time_purchases` (ex: IPs reservados, ER port pré-pago) |
| `Refund` | Logar e contabilizar em `_refunds` (custo negativo — desconto) |
| `UnusedReservation` | Logar em `_unused_reservation` (custo de reservas não consumidas) |
| `Adjustment` | Logar em `_adjustments` |

Isso evita que créditos negativos sejam somados ingenuamente aos flows e cause subnotificação de custo. Imprimir no console o resumo `=== NON-USAGE CHARGES === Purchase: R$ X | Refund: R$ Y | UnusedReservation: R$ Z`.

**Gate 2 — Discriminador infra-vs-data via `UnitOfMeasure`**

A UoM é o sinal canonônico de natureza do meter. Toda classificação do §1.1 deve respeitar:

| Padrão em `UnitOfMeasure` | Natureza | Acumuladores esperados |
|---|---|---|
| Contém `Hour` ou `Month` (`1 Hour`, `1/Hour`, `1/Month`) | **Infra fixa** | `*_cost` (sem `_gb`), `*_hourly_cost`, `*_fixed_cost`, `*_circuit_cost`, `*_gateway_cost`, `*_rules_cost` |
| = `1 GB` | **Flow / data transfer** | `*_gb` + `*_cost` pareados |
| = `1M` | **Queries** (milhões) | `dns_query_cost` (especial) |
| = `10K` | **Requests** (Front Door) | `frontdoor_*_requests_cost` (especial) |
| = `1` (contável) ou vazio com Quantity inteira | **Item enumerado** | `dns_private_zone_cost`, `network_logs_cost` |

**Regra-gate**: se um classificador tentar mapear uma linha com UoM `1 Hour` para um acumulador de flow (`*_gb`), o extrator deve **emitir warning `[UOM-MISMATCH]`** e não aceitar a classificação. O mesmo vale para o oposto. Esse gate teria pegado o bug A.1 antes do regression test.

### 1.1 Extração de Fluxos de Rede (CSV → JSON `_net_flows.json`)

Processar o CSV em streaming. Para cada linha com `MeterCategory` de rede (`Virtual Network`, `Bandwidth`, `ExpressRoute`, `Load Balancer`, `VPN Gateway`, `Azure Firewall`, `NAT Gateway`, `Azure DNS`, `CDN`, `Traffic Manager`, `Azure Front Door`, `Azure Front Door Service`, `Application Gateway`, `Virtual WAN`, `Azure Firewall Manager`, `Azure Bastion`, `Network Watcher`), acumular por `SubscriptionName`:

| Acumulador | Como calcular |
|---|---|
| `peering_egress_gb/cost` | `MeterSubCategory` contém "Peering" (não "Global") + `MeterName` contém "Egress" |
| `peering_ingress_gb/cost` | `MeterSubCategory` contém "Peering" (não "Global") + `MeterName` contém "Ingress" |
| `global_peering_egress_gb/cost` | `MeterSubCategory` contém "Global Peering" + `MeterName` contém "Egress" |
| `global_peering_ingress_gb/cost` | `MeterSubCategory` contém "Global Peering" + `MeterName` contém "Ingress" |
| `internet_egress_gb/cost` | `MeterCategory` = "Bandwidth" + `MeterSubCategory` NEM "Inter-Region" NEM contém "Rtn Preference" + `MeterName` contém "Transfer Out" ou "Egress". Assume rota ISP / default. |
| `mgn_egress_gb/cost` | `MeterCategory` = "Bandwidth" + `MeterSubCategory` contém "Rtn Preference: MGN" (Microsoft Global Network — cold potato routing). **Pricing tier distinto** de `internet_egress` — ver §1.1.4. |
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
| `nat_cost` | `MeterCategory` = "NAT Gateway" (somatório de tudo abaixo — mantido por retrocompatibilidade) |
| `nat_gateway_cost` | `MeterCategory` = "NAT Gateway" + UoM contém "Hour"/"Month" (infra fixa do gateway) |
| `nat_data_gb/cost` | `MeterCategory` = "NAT Gateway" + UoM = "1 GB" (Standard Data Processed — flow) |
| `lb_cost` | `MeterCategory` = "Load Balancer" (somatório — retrocompatibilidade) |
| `lb_rules_cost` | `MeterCategory` = "Load Balancer" + UoM contém "Hour" (Included LB Rules + Outbound Rules + Overage — infra) |
| `lb_data_gb/cost` | `MeterCategory` = "Load Balancer" + UoM = "1 GB" (Standard Data Processed — flow) |
| `appgw_cost` | `MeterCategory` = "Application Gateway" (somatório) |
| `appgw_fixed_cost` | `MeterCategory` = "Application Gateway" + `MeterName` contém "Fixed Cost" (base hourly) |
| `appgw_cu_cost` | `MeterCategory` = "Application Gateway" + `MeterName` contém "Capacity Units" (escala por throughput) |
| `frontdoor_egress_gb/cost` | `MeterCategory` in ("Azure Front Door", "Azure Front Door Service") + `MeterName` contém "Transfer Out" ou "Egress" (somatório classic+std) |
| `frontdoor_ingress_gb/cost` | idem + `MeterName` contém "Transfer In" ou "Ingress" (somatório) |
| `frontdoor_infra_cost` | idem + demais meters (Base Fees, Routing Rules, Requests etc.) — somatório |
| `frontdoor_classic_*` | **Split:** mesmas regras acima quando `MeterSubCategory` está vazio (Front Door **classic** — SKU descontinuada). Schema: routing rules hourly + DTO/DTI + Requests. |
| `frontdoor_std_*` | **Split:** mesmas regras quando `MeterSubCategory` contém "Azure Front Door" (Front Door **Standard/Premium**). Schema: Base Fees + Requests + DTO/DTI. |
| `dns_cost` | `MeterCategory` = "Azure DNS" (somatório — retrocompatibilidade) |
| `dns_private_zone_cost` | `MeterCategory` = "Azure DNS" + `MeterName` contém "Private Zone" + UoM = `1` (per-zone/mês, infra) |
| `dns_query_cost` | `MeterCategory` = "Azure DNS" + `MeterName` contém "Queries" + UoM = `1M` (por milhão de queries, flow-like) |
| `bastion_cost` | `MeterCategory` = "Azure Bastion" (somatório) |
| `bastion_hourly_cost` | `MeterCategory` = "Azure Bastion" + UoM contém "Hour" (Basic/Standard Gateway hourly — infra) |
| `bastion_egress_gb/cost` | `MeterCategory` = "Azure Bastion" + UoM = "1 GB" (Data Transfer Out — flow) |
| `connection_egress_gb/cost` | `MeterCategory` = "Bandwidth" + UoM = "1 GB" + **`ResourceId` casa `/providers/microsoft.network/connections/{name}`** + `MeterName` contém "Transfer Out" ou "Egress". Tráfego cross-cloud / on-prem **por connection nomeada** (VPN S2S, ER circuit-binding). Ver §1.1.5. |
| `connection_ingress_gb/cost` | idem com `MeterName` contém "Transfer In" ou "Ingress" (em geral grátis, mas o volume é informativo). |
| `_by_connection` (dict) | Detalhe por `connection_name` (último segmento do `ResourceId`): `{egress_gb, egress_cost, ingress_gb, ingress_cost, resource_id, parent_gateway_hint}`. Permite mostrar cada VPN/ER-connection individualmente no HTML em vez de agregar tudo em um bucket único. |
| `public_ip_cost` | `MeterCategory` = "Virtual Network" + (`MeterSubCategory` contém "IP Address" OU "Public IP Prefix" OU `MeterName` contém "Public IP"). Captura Standard/Basic IPv4 Static, Basic IPv4 Dynamic, Public IP Prefix. |
| `cdn_cost` | `MeterCategory` ∈ ("CDN", "Content Delivery Network"). Infra (Azure CDN, Verizon, Akamai etc). |
| `cdn_egress_gb/cost` | `MeterCategory` = "Content Delivery Network" + `MeterName` contém "Transfer Out" ou "Egress". Dados servidos pela CDN. |
| `traffic_manager_cost` | `MeterCategory` = "Traffic Manager". Inclui DNS queries, health checks, traffic view data points. |
| `ddos_cost` | `MeterCategory` = "Azure DDoS Protection" |
| `network_watcher_cost` | `MeterCategory` = "Network Watcher" |
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

### 1.1.4 Routing Preference — MGN vs Internet (ISP)

O Azure permite associar a Public IPs uma *Routing Preference*:

- **Microsoft Global Network (MGN)** — *cold potato routing*. Tráfego viaja na rede privada da Microsoft o máximo possível. **Preço premium**. É o default na maioria dos serviços.
- **Internet (ISP)** — *hot potato routing*. Tráfego sai pela rede do ISP local mais próximo. **Preço reduzido**. Suportado por VM, VMSS, AKS, public LB (NIC-based backend), Application Gateway, Azure Firewall, Storage (secondary endpoints).

Na fatura EA, a SKU MGN é sinalizada por `MeterSubCategory` contendo `Rtn Preference: MGN` (texto literal). Demais linhas de `Bandwidth` que não são nem "Inter-Region" nem "Rtn Preference" são egress padrão (ISP route por default).

**Acumuladores**:
- `mgn_egress_gb/cost` — cobranças MGN (cold potato, premium).
- `internet_egress_gb/cost` — demais (assume ISP route).

**Exibição no diagrama**: dentro do nó Internet regional, exibir as duas linhas separadas no tooltip ("via MGN" vs "via ISP") com seus próprios volumes e custos. Permite ao analista identificar workloads que pagam premium MGN sem necessidade funcional.

**Referência**: [Azure routing preference overview](https://learn.microsoft.com/azure/virtual-network/ip-services/routing-preference-overview).

### 1.1.5 Tráfego por VPN/ER Connection (split per-connection do Bandwidth)

O Azure modela **VPN site-to-site** e **ExpressRoute circuit-binding** como recursos `microsoft.network/connections/{name}` que **ligam** um `virtualNetworkGateway` (VPN ou ER) ao endpoint remoto (CPE on-prem, peer cross-cloud, outro VNet gateway). A taxa fixa horária fica no gateway (já capturada em `vpn_cost` / `expressroute_gateway_cost`), mas **quando há tráfego que atravessa fronteira de billing zone** (cross-cloud, cross-continent) o Azure **emite linhas de `MeterCategory = "Bandwidth"` com o `ResourceId` apontando para a connection específica** — não para o gateway, nem para a internet pública.

Esse é o único caminho da fatura EA em que o **nome da connection** vira pivô de billing. Sem split per-connection, esse custo cai em `internet_egress_*` ou `interregion_egress_*` por região e a granularidade da VPN/ER é perdida.

**Regra de classificação** (avaliada **ANTES** das demais regras de `Bandwidth` — internet_egress, mgn_egress, interregion_egress):

```python
# Gate primário: ResourceId aponta para uma connection ARM-typed?
rid_l = (row['ResourceId'] or '').lower()
m = re.search(r'/providers/microsoft\.network/connections/([^/]+)', rid_l)
if m and row['MeterCategory'] == 'Bandwidth' and '1 gb' in (row['UnitOfMeasure'] or '').lower():
    conn_name = m.group(1)
    name_l = (row['MeterName'] or '').lower()
    direction = 'egress' if ('out' in name_l or 'egress' in name_l) else 'ingress'
    flows[key][f'connection_{direction}_gb']   += qty
    flows[key][f'connection_{direction}_cost'] += cost
    flows[key]['_by_connection'].setdefault(conn_name, {
        'egress_gb': 0, 'egress_cost': 0, 'ingress_gb': 0, 'ingress_cost': 0,
        'resource_id': row['ResourceId'],
        'parent_gateway_hint': _infer_parent_gateway(conn_name, key)
    })
    bucket = flows[key]['_by_connection'][conn_name]
    bucket[f'{direction}_gb']   += qty
    bucket[f'{direction}_cost'] += cost
    continue  # NÃO cair em internet_egress / interregion_egress
```

**`_infer_parent_gateway` heurística** (best-effort, opcional): casar o nome da connection (`conn-xxx-to-aws-pmnt`) contra `_gateway_details` da mesma sub via tokens compartilhados (substring `vpn`, `er`, `vgw`, ou ResourceGroup compartilhado). Se nenhuma correspondência, `parent_gateway_hint = None`.

**Por que isto importa**:

- **Visibilidade de cross-cloud egress por par**: um meter de `Bandwidth` com `ResourceId` apontando para `connections/<conn-cross-cloud>` (~200 GB/mês é típico em um payment engine híbrido) tem semântica de negócio diferente de internet pública genérica (egress dirigido vs egress aberto). Sem split per-connection, vira ruído no nó Internet.
- **Detecção de growth**: rastrear `egress_gb` por connection ao longo do tempo (via `_by_connection`) revela quando um workload começa a vazar tráfego para fora do Azure — sinal precoce para avaliar peering privado AWS↔Azure ou consolidação.
- **Atribuição de custo a workload**: o `ResourceGroup` da connection (extraído do `ResourceId`) normalmente identifica o sistema dono (ex: padrões como `<rg-de-aplicacao>` ou `<rg-cross-cloud-bridge>`), permitindo chargeback per-business-unit.

**Renderização sugerida** (§2/§3): cada connection com `egress_gb > 1` vira um **sub-nó** ancorado ao gateway pai (badge `🔌 conn-name · X GB · R$ Y`); connection sem `parent_gateway_hint` resolvido aparece como nó flutuante no hub da região com badge `⚠ órfã`. Tooltip de cada connection mostra ResourceGroup + nome do gateway pai (se inferido) + volume mensal.

**Quando o split não dispara** (esperado, não é bug):
- Fatura **sem** linhas `microsoft.network/connections/` em ResourceId → `_by_connection` fica vazio, acumuladores ficam zerados. Comportamento padrão para enrollments puramente Azure-interno (ER doméstico, peering intra-Azure).
- Connection sem tráfego no mês → não aparece (a taxa fixa fica no gateway).

**Auditoria**: rodar `python -c "import json; d=json.load(open('<cliente>_net_flows.json'))['<sub@region>']; print(json.dumps(d['_by_connection'], indent=2))"` para inspecionar.

### 1.1.6 Tráfego DTO/DTI por ER Circuit (split per-circuit do `expressroute_out` / `expressroute_in`)

**(v2.12+)** Cada meter de DTO (`expressroute_out`) e DTI (`expressroute_in`) carrega no `ResourceId` o caminho ARM do circuito (`/providers/microsoft.network/expressroutecircuits/<name>`). Sem split por circuito, o custo se agrega na sub e não é possível responder "qual circuito específico está consumindo a maior parte do DTO?".

**Regra de classificação** (avaliada **APÓS** `classify_flow` já ter classificado a linha como `expressroute_out` ou `expressroute_in`, e somente quando `gb is not None`):

```python
# APÓS o flow accumulator padrão:
flows[key][f"{flow_key}_cost"] += cost
if gb is not None:
    flows[key][f"{flow_key}_gb"] += gb
elif "hour" in uom_l and "month" not in uom_l:
    # v2.12+: captura horas para meters horários puros (UoM "1 Hour"; ignora "1/Month")
    flows[key][f"{flow_key}_hours"] += qty

# v2.12+: per-circuit ER DTO/DTI from meter ResourceId
if flow_key in ("expressroute_out", "expressroute_in") and gb is not None:
    erc = re.search(r'/providers/microsoft\.network/expressroutecircuits/([^/]+)', rid_l)
    if erc:
        circ = erc.group(1)
        direction = 'dto' if flow_key == 'expressroute_out' else 'dti'
        er_circuit_flow[(sub_name, bucket, circ)][f'{direction}_gb']   += gb
        er_circuit_flow[(sub_name, bucket, circ)][f'{direction}_cost'] += cost
```

Pós-loop, fazer **merge em `_gateway_details`** (que já contém custo base e SKU do circuito):

```python
for (sub, bucket, circ), cf in er_circuit_flow.items():
    entry = next((g for g in gateway_details[(sub, bucket)] if g['resource'] == circ), None)
    if entry:
        entry.update(cf)  # adiciona dto_gb/dto_cost/dti_gb/dti_cost no entry existente
    else:
        # circuito visto só em meter, não no inventário (raro); stub mínimo
        gateway_details[(sub, bucket)].append({
            'type': 'expressroute_circuit', 'resource': circ, 'sku': '', 'cost': 0.0, **cf
        })
```

**Por que isto importa**:

- **Atribuíção cirúrgica de custo**: um hub típico com 3 circuitos ER (SKUs distintos: ex. Premium Metered 1 Gbps × 2 + Local Unlimited × 1) pode ter `expressroute_out_cost` agregado de R$ 10–20K/mês, sem revelar que **um único circuito** responde por ~100% da DTO faturada enquanto outro (geograficamente distinto) absorve a maior parte do tráfego de ingest (GRÁTIS). Sem split per-circuit, o analista não consegue mapear qual circuito reservar para upsizing/downsizing.
- **Circuitos `Local Unlimited`** não emitem meters por GB (flat-rate); ficam com `dto_gb = dti_gb = 0` e a UI mostra anotação explícita "Flat-rate (Unlimited) — sem meter por GB" no card.
- **Recomendação de SKU**: comparando DTO real vs limite da SKU (1 Gbps, 10 Gbps) por circuito é possível sugerir downgrade para tier mais barato quando subutilizado.

**Quando o split não dispara** (esperado, não é bug):
- Subscriptions sem ExpressRoute — `_gateway_details` não tem entries de circuit.
- Circuitos com SKU `Local Unlimited Data` ou `Premium Unlimited Data` — sem meter por GB; circuit aparece em `_gateway_details` com `cost > 0` mas sem campos dto/dti.

**Captura de horas** (v2.12+): meters com `UnitOfMeasure` contendo `"hour"` (e não `"month"`) acumulam `flows[key][f"{flow_key}_hours"] += qty`. Isso permite renderizar `720 h · R$ 1.728` para ER Gateway/VPN GW (que rodam o mês inteiro = 30×24 = 720h). ER Circuit usa UoM `"1/Month"` (não `"hour"`) e é corretamente excluído — a UI mostra apenas o custo nessas linhas.

### 1.2 Extração de Inventário de Recursos (CSV → JSON `_net_resources.json`)

Para cada subscription, contar **recursos únicos** (`ResourceName`) por tipo:

| Tipo de recurso | Padrões para detectar (em `MeterCategory + MeterSubCategory + MeterName + ConsumedService`) |
|---|---|
| `vwan_hub` | "Standard Hub Unit", "Standard Hub Data" — hub vWAN |
| `vwan_er_gateway` | "ExpressRoute Scale Unit", "ExpressRoute Connection Unit" — ER no vWAN |
| `vwan_vpn_gateway` | "VPN S2S Scale Unit" — VPN no vWAN |
| `expressroute_port` | `microsoft.network/expressroutePorts` no `ResourceId` OU `MeterName` contém "ExpressRoute Direct" ou "ExpressRoute Port". **ER Direct** — porta dedicada (10 Gbps / 100 Gbps) que hospeda 1+ circuits. Estrutural. |
| `expressroute_gateway` | "ErGw", "expressroute gateway" — **detectar antes de circuit**. SKUs ambíguos ("Standard Gateway", "High Performance Gateway", "Ultra Performance Gateway", "Ultra High Performance Gateway") são detectados via padrão **restrito a `MeterCategory = "ExpressRoute"`** porque colidem com nomes de meter de outras categorias (NAT Gateway tem `MeterName = "Standard Gateway Hours"`, VPN legado tem "High Performance Gateway", Bastion tem "Basic Gateway"). Ver subseção 1.2.1 abaixo (whitelist de categoria). |
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
| `cdn` | "Azure CDN", "Content Delivery Network" — Azure CDN (Microsoft / Verizon / Akamai). Tipo dedicado separado de `front_door`. |
| `traffic_manager` | "Traffic Manager" |
| `network_watcher` | "Network Watcher" |
| `ddos_protection` | "DDoS" |
| `nva_marketplace` | `PublisherType != "Azure"` em qualquer linha de rede (Marketplace appliance — ex: Palo Alto VM-Series, Fortinet FortiGate, Check Point CloudGuard, F5 BIG-IP). Captura via `PublisherName` (ex: `paloaltonetworks`, `fortinet`, `checkpoint`, `f5-networks`). Tipo estrutural. |
| `vpn_connection` | `ResourceId` casa `/providers/microsoft.network/connections/{name}` E a sub tem `vpn_gateway` ou `vwan_vpn_gateway`. Cada connection é um recurso gerenciável (autorização para o peer remoto). Detectado via **eixo ARM-path** (§1.4.2) — não via MeterName. Estrutural quando há tráfego per-connection associado (§1.1.5). |
| `er_connection` | `ResourceId` casa `/providers/microsoft.network/connections/{name}` E a sub tem `expressroute_gateway` ou `expressroute_circuit`. Idem `vpn_connection` mas para ER circuit-binding (autorização do peering ER). |

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

### 1.2.1 Whitelist de categoria (patterns ambíguos)

Alguns nomes de SKU/MeterName se repetem entre serviços diferentes — exemplos comprovados:

| String | Onde aparece (categoria) | Risco |
|---|---|---|
| `"Standard Gateway"` | `ExpressRoute` (SKU de gateway) **E** `NAT Gateway` (`MeterName = "Standard Gateway Hours"`) | NAT Gateway pode ser misclassificado como ER Gateway |
| `"High Performance Gateway"` | `ExpressRoute` **E** `VPN Gateway` (SKU legado) | VPN legado pode virar ER |
| `"Standard"` (subcat) | Quase todas as categorias | Não usável como pattern |

**Regra**: quando um pattern de string for ambíguo entre categorias, declarar uma **whitelist de `MeterCategory`** ao lado do pattern. O detector de recurso só aplica o pattern se a categoria da linha estiver na whitelist.

**Estrutura recomendada** para `RES_PATTERNS` (3-tupla):
```python
RES_PATTERNS = [
    ("vwan_hub", ["standard hub unit", "standard hub data"], None),                # sem restrição
    ("expressroute_gateway", ["ergw", "expressroute gateway"], None),              # patterns não-ambíguos
    ("expressroute_gateway",                                                       # patterns ambíguos
     ["standard gateway", "ultra performance gateway",
      "ultra high performance gateway", "high performance gateway"],
     {"expressroute"}),                                                            # restrito a MeterCategory=ExpressRoute
    ("nat_gateway", ["nat gateway"], None),
    # ...
]
```

O 3º elemento é `None` (qualquer categoria) ou `set` com MeterCategory(s) permitidos (lowercased).

**Verificação obrigatória ao adicionar novo pattern**: rodar `python tests/regression_test.py` antes/depois. Se a contagem de QUALQUER outro tipo de recurso mudar, o pattern é ambíguo e precisa de whitelist (ver Apêndice A.11).

### 1.3 Detalhes de SKU de Gateways e Circuitos

Para recursos do tipo `expressroute_gateway`, `expressroute_circuit`, `vpn_gateway`, `vwan_hub`, `vwan_er_gateway` e `vwan_vpn_gateway`, capturar **adicionalmente** o detalhe individual de cada recurso:

| Campo | Origem |
|---|---|
| `type` | Tipo do recurso (expressroute_circuit, expressroute_gateway, vpn_gateway, vwan_hub, vwan_er_gateway, vwan_vpn_gateway) |
| `resource` | `ResourceName` — nome ARM do recurso (ex: `<circuit-name>`, `<gateway-name>`) |
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

#### 1.4.1 Auto-mapeamento bilateral simétrico (flow ⟂ resource)

A detecção de **flow** (acumulador de custo) e a detecção de **resource** (item gerenciável com `ResourceName`) são **eixos independentes** — uma linha pode casar no flow mas falhar no resource, ou vice-versa, ou ambos. O sistema cobre **as 4 combinações possíveis** com lógica simétrica:

| flow_key | rtype | Cenário | Ação automática |
|---|---|---|---|
| OK | OK | Ambos casaram | Nenhuma — fluxo normal |
| OK | None | Flow capturou, resource pattern não | **Path B** — inferir rtype via `CATEGORY_FORCES_RESOURCE` ou `FLOW_TO_RESOURCE` + alerta `[AUTO-RESOURCE]` |
| None | OK | Resource capturou, flow accumulator ausente | **Path D** — inferir flow_key via `RESOURCE_TO_FLOW` + alerta `[AUTO-FLOW]` |
| None | None | Ambos falharam | **Path C** — alerta `[AUTO-MAPPED]`, custo vai para `other_network_cost` |

Esta simetria garante que **nenhum custo ou recurso seja perdido silenciosamente**, independente de qual eixo tenha pattern incompleto no prompt.

**Lookups usados** (definidos no extrator, mantenha sincronizados):

- **`CATEGORY_FORCES_RESOURCE`** (camada 1, Path B): `MeterCategory` dedicada → rtype determinístico.
  ```python
  {
      "Azure Firewall": "firewall", "Azure Firewall Manager": "firewall_manager",
      "NAT Gateway": "nat_gateway", "Application Gateway": "app_gateway",
      "Load Balancer": "load_balancer", "Azure Bastion": "bastion",
      "Azure DNS": "dns", "VPN Gateway": "vpn_gateway",
      "Azure Front Door": "front_door", "Azure Front Door Service": "front_door",
      "CDN": "front_door", "Network Watcher": "network_watcher",
  }
  ```

- **`FLOW_TO_RESOURCE`** (camada 2, Path B): acumulador de flow → rtype.
  ```python
  {
      "expressroute_gateway_cost": "expressroute_gateway",
      "expressroute_circuit_cost": "expressroute_circuit",
      "vpn_cost": "vpn_gateway", "vwan_hub_cost": "vwan_hub",
      "firewall_cost": "firewall", "firewall_manager_cost": "firewall_manager",
      "nat_cost": "nat_gateway", "nat_gateway_cost": "nat_gateway", "nat_data_cost": "nat_gateway",
      "appgw_cost": "app_gateway", "appgw_fixed_cost": "app_gateway", "appgw_cu_cost": "app_gateway",
      "lb_cost": "load_balancer", "lb_rules_cost": "load_balancer", "lb_data_cost": "load_balancer",
      "private_endpoint_cost": "private_endpoint",
      "bastion_cost": "bastion", "bastion_hourly_cost": "bastion", "bastion_egress_cost": "bastion",
      "dns_cost": "dns", "dns_private_zone_cost": "dns", "dns_query_cost": "dns",
      "frontdoor_infra_cost": "front_door",
      "frontdoor_classic_infra_cost": "front_door", "frontdoor_std_infra_cost": "front_door",
      "public_ip_cost": "public_ip", "traffic_manager_cost": "traffic_manager",
      "cdn_cost": "cdn", "cdn_egress_cost": "cdn", "ddos_cost": "ddos_protection",
      "network_watcher_cost": "network_watcher",
      "mgn_egress_cost": None,  # tráfego — sem resource estrutural (apenas no flow)
  }
  ```

- **`RESOURCE_TO_FLOW`** (Path D): rtype → acumulador de flow correspondente.
  ```python
  {
      "expressroute_gateway": "expressroute_gateway_cost",
      "expressroute_circuit": "expressroute_circuit_cost",
      "vpn_gateway": "vpn_cost", "vwan_hub": "vwan_hub_cost",
      "vwan_er_gateway": "expressroute_gateway_cost", "vwan_vpn_gateway": "vpn_cost",
      "firewall": "firewall_cost", "firewall_manager": "firewall_manager_cost",
      "nat_gateway": "nat_cost", "app_gateway": "appgw_cost",
      "load_balancer": "lb_cost", "private_endpoint": "private_endpoint_cost",
      "bastion": "bastion_cost", "dns": "dns_cost",
      "front_door": "frontdoor_infra_cost",
      "cdn": "cdn_cost",
      "public_ip": "public_ip_cost", "traffic_manager": "traffic_manager_cost",
      "network_watcher": "network_watcher_cost", "ddos_protection": "ddos_cost",
      # NOT mapped (multi-direction flows): private_link, vnet_peering
  }
  ```

**Importante**: tipos com fluxos `egress`/`ingress` separados (peering, private_link) **NÃO** entram em `RESOURCE_TO_FLOW` — atribuir custo a um único flow direcional seria errado. O classify_flow já trata esses com regras específicas de direção.

**Alertas no console**:

- `[AUTO-RESOURCE]` durante extração quando Path B dispara:
  ```
  [AUTO-RESOURCE] inferred rtype='expressroute_gateway' via=flow
      for: Cat='ExpressRoute' SubCat='Standard Gateway' Name='Standard Gateway'
      (example resource: <gateway-name>)
  ```
- `[AUTO-FLOW]` durante extração quando Path D dispara:
  ```
  [AUTO-FLOW] inferred flow_key='public_ip_cost' from rtype='public_ip'
      for: Cat='Virtual Network' SubCat='IP Addresses' Name='Standard IPv4 Static Public IP'
      (example resource: <public-ip-name>)
  ```
- `[AUTO-MAPPED]` (já existente) quando Path C dispara.

**Resumo ao final da execução**: três blocos separados, um por tipo de alerta, com instrução específica de qual seção do prompt atualizar (1.1 para `[AUTO-FLOW]`, 1.2 para `[AUTO-RESOURCE]`, 1.1 + 1.2 para `[AUTO-MAPPED]`).

**Comportamento desejado**: em produção, os 3 alertas devem ficar **silenciosos** — todo SKU/categoria conhecido tem pattern formal. Quando um alerta dispara, é sinal de:
- Microsoft lançou um SKU/categoria novo (mais comum); OU
- O prompt está incompleto e precisa de PR de atualização.

A regra geral: **quando alerta dispara, atualizar o prompt formal e re-rodar até ficar silencioso**. O fallback é uma rede de segurança, não a primeira linha de defesa.

### 1.4.2 Auto-mapeamento via eixo ARM-path no `ResourceId` (3º pivô)

Os dois eixos das seções 1.4 e 1.4.1 pivotam sobre **`MeterCategory + MeterSubCategory + MeterName`** (visão **billing**). Há um terceiro eixo independente, ortogonal a ambos: o **path ARM** dentro do `ResourceId` (visão **resource graph**). Esse eixo captura serviços onde a billing-row aparece sob uma categoria genérica (ex: `Bandwidth`) mas o `ResourceId` revela um RP/tipo específico que merece tratamento próprio (ex: `microsoft.network/connections/`, `microsoft.network/routeTables/`, `microsoft.network/virtualHubs/`).

O caso canônico que motivou esse eixo: **VPN Connection tráfego** (§1.1.5). A linha tem `MeterCategory = "Bandwidth"`, `MeterName = "Standard Data Transfer Out"` — indistinguível em billing de qualquer outro egress — mas o `ResourceId` aponta para `/providers/microsoft.network/connections/<connection-name>`. **Nenhum classifier baseado em MeterName conseguiria separar essa linha das demais**; só o path ARM revela a semântica.

#### 1.4.2.1 Extração canônica do path ARM

```python
import re
_ARM_RE = re.compile(r'/providers/([^/]+)/([^/]+)(?:/([^/]+))?', re.IGNORECASE)

def parse_arm_path(rid: str) -> dict | None:
    """Extrai o tipo ARM mais específico do ResourceId.
    Retorna {'rp': 'Microsoft.Network', 'type': 'connections', 'name': 'conn-...'}
    ou None se ResourceId não tem padrão /providers/.../.../.../
    """
    if not rid:
        return None
    # Captura o ÚLTIMO segmento /providers/<rp>/<type>/<name> — sub-resources 
    # (ex: networkWatchers/.../connectionMonitors/...) devem casar o mais profundo.
    matches = list(_ARM_RE.finditer(rid))
    if not matches:
        return None
    m = matches[-1]  # mais específico = mais profundo
    return {
        'rp': m.group(1),                    # 'Microsoft.Network'
        'type': (m.group(2) or '').lower(),  # 'connections'
        'name': m.group(3) or '',            # ex: '<connection-name>'
        'rp_type': f"{m.group(1).lower()}/{(m.group(2) or '').lower()}"
    }
```

#### 1.4.2.2 Tabela de lookup `ARM_TYPE_TO_RTYPE`

Mapeia `microsoft.network/<type>` para o `rtype` canônico do inventário. Sincronizada com §1.2.

```python
ARM_TYPE_TO_RTYPE = {
    # estruturais primários (rede)
    "microsoft.network/expressroutecircuits":        "expressroute_circuit",
    "microsoft.network/expressroutegateways":        "expressroute_gateway",   # vWAN
    "microsoft.network/expressrouteports":           "expressroute_port",
    "microsoft.network/virtualnetworkgateways":      "vpn_or_er_gateway",      # tipo decidido pelo SKU
    "microsoft.network/vpngateways":                 "vwan_vpn_gateway",       # vWAN
    "microsoft.network/virtualhubs":                 "vwan_hub",
    "microsoft.network/virtualwans":                 "vwan",
    "microsoft.network/connections":                 "connection",             # ver §1.4.2.3 (disambig)
    "microsoft.network/localnetworkgateways":        "local_network_gateway",  # CPE side
    # data path / runtime
    "microsoft.network/azurefirewalls":              "firewall",
    "microsoft.network/firewallpolicies":            "firewall_manager",
    "microsoft.network/applicationgateways":         "app_gateway",
    "microsoft.network/loadbalancers":               "load_balancer",
    "microsoft.network/natgateways":                 "nat_gateway",
    "microsoft.network/bastionhosts":                "bastion",
    "microsoft.network/privateendpoints":            "private_endpoint",
    "microsoft.network/privatednszones":             "dns",
    "microsoft.network/dnszones":                    "dns",
    "microsoft.network/frontdoors":                  "front_door",
    "microsoft.network/afdendpoints":                "front_door",
    "microsoft.network/profiles":                    "front_door",             # AFD Std/Premium
    "microsoft.network/trafficmanagerprofiles":      "traffic_manager",
    "microsoft.cdn/profiles":                        "cdn",
    "microsoft.network/ddosprotectionplans":         "ddos_protection",
    "microsoft.network/networkwatchers":             "network_watcher",
    "microsoft.network/publicipaddresses":           "public_ip",
    "microsoft.network/publicipprefixes":            "public_ip",
    # topologia (sem billing direto, mas inventáriavel)
    "microsoft.network/virtualnetworks":             "vnet",
    "microsoft.network/routetables":                 "route_table",
    "microsoft.network/networksecuritygroups":       "nsg",
    "microsoft.network/networkinterfaces":           "nic",
    "microsoft.network/routeservers":                "route_server",
}
```

#### 1.4.2.3 Disambiguação de `connection` (VPN vs ER)

O tipo ARM `microsoft.network/connections` cobre **tanto** VPN site-to-site **quanto** ExpressRoute circuit-binding. Para distinguir:

1. Se a mesma `(sub, region_bucket)` tem `vpn_gateway` ou `vwan_vpn_gateway` **e não tem** `expressroute_gateway` → `rtype = "vpn_connection"`.
2. Se tem `expressroute_gateway` ou `expressroute_circuit` **e não tem** VPN → `rtype = "er_connection"`.
3. Se tem **ambos** → tentar inferir pelo nome via tokens heurísticos no naming do cliente:
   - Indicadores prováveis de **VPN**: tokens `vpn`, `ipsec`, ou nomes de cloud providers terceiros (`aws`/`gcp`/`oci`) sugerindo túnel cross-cloud.
   - Indicadores prováveis de **ER**: nomes de ExpressRoute providers (carrier-neutral DC operators).
   
   Se inconclusivo → `rtype = "connection"` genérico + log `[CONNECTION-AMBIG]`. Esses tokens são **dicas heurísticas universais**, não regras hardcoded — clientes com naming conventions distintas podem precisar de ajuste.

A disambiguação roda **após** todas as flow accumulators e patterns padrão terem rodado (precisa do estado consolidado de gateways da sub).

#### 1.4.2.4 Quando o eixo ARM-path dispara

Algoritmo (executado **depois** dos Paths A/B/C/D de §1.4.1, **antes** de fechar a sub):

```python
for row in csv_rows_of(sub_bucket):
    arm = parse_arm_path(row['ResourceId'])
    if not arm:
        continue
    if not arm['rp_type'].startswith('microsoft.network/'):
        # MachineLearningServices/workspaces, Storage/storageAccounts, etc.
        # Estes ficam visíveis via _consumer_breakdown (§1.10), não viram rtype de rede.
        continue
    expected_rtype = ARM_TYPE_TO_RTYPE.get(arm['rp_type'])
    if expected_rtype is None:
        # Novo tipo de rede que o prompt ainda não conhece
        log.warning(f"[AUTO-ARM-PATH] unknown ARM type '{arm['rp_type']}' in ResourceId='{row['ResourceId']}'. "
                    f"Treating as rtype='{arm['rp_type'].split('/')[-1]}'. "
                    f"→ add to ARM_TYPE_TO_RTYPE in §1.4.2.2 + §1.2 pattern.")
        expected_rtype = arm['rp_type'].split('/')[-1]
    # se o resource já foi capturado por pattern MeterName → ok, nada a fazer
    if resource_already_counted(sub_bucket, expected_rtype, arm['name']):
        continue
    # senão: criar entry no inventário (count++) + alerta
    add_resource(sub_bucket, expected_rtype, arm['name'], row['Cost'])
    log.info(f"[AUTO-ARM-PATH] inferred rtype='{expected_rtype}' via ARM path for resource '{arm['name']}'. "
             f"MeterName='{row['MeterName']}' did not match any §1.2 pattern.")
```

#### 1.4.2.5 Diferença vs Paths B/C/D

| Eixo | Sinal usado | Quando dispara | Risco |
|---|---|---|---|
| Path B (§1.4.1) | `MeterCategory` casa flow mas pattern resource não → infere rtype via lookup | Pattern de §1.2 incompleto | Médio (depende de category-forces map) |
| Path C (§1.4.1) | Nem flow nem rtype casam | Categoria/SKU novo | Alto — pode ir pro `other_network` |
| Path D (§1.4.1) | Pattern resource casa mas sem flow → infere flow via lookup | Acumulador novo | Médio |
| **Path E** (§1.4.2, ARM) | **`ResourceId` tem tipo ARM conhecido mas billing-row genérica** | **Serviço com recursos identificáveis só pelo path** (connection, route_table, route_server, virtualHub sub-resources) | **Baixo** — path é determinístico |

O eixo ARM-path **complementa** (não substitui) os Paths B/C/D. É a única defesa contra **bills agregadas em categorias genéricas** (`Bandwidth`, `Virtual Network`) que escondem semântica de resource específica.

#### 1.4.2.6 Alertas e resumo

- `[AUTO-ARM-PATH]` durante extração quando tipo desconhecido aparece.
- Resumo ao final da execução, igual aos demais alertas:

```
⚠️  PROMPT UPDATE NEEDED — eixo ARM-path detectou tipos novos:
  • microsoft.network/routeServers          (4 recursos, R$ 312,40)
      → adicionar a ARM_TYPE_TO_RTYPE em §1.4.2.2 com rtype 'route_server'
      → adicionar pattern em §1.2 + flow accumulator em §1.1 se aplicável
Sugestão: atualizar prompt_network_topology.md e re-rodar até ficar silencioso.
```

#### 1.4.2.7 Recursos não-Microsoft.Network no ResourceId

Linhas onde `ResourceId` aponta para outros RPs (ex: `MachineLearningServices/workspaces`, `Storage/storageAccounts`, `Databricks/workspaces`) NÃO viram rtype de rede via esse eixo — elas já são reportadas no `_consumer_breakdown` (§1.10). A regra é: **o eixo ARM-path só cria rtype para `rp == 'Microsoft.Network'`**. Ver Apêndice A.14.

---

### 1.5 Atribuição de Região por Linha (Cascade A1→A2→A3→A4)

**Regra fundamental**: Todo recurso de rede DEVE ser representado dentro dos limites visuais da sua região real. Uma subscription não é uma unidade geográfica — ela apenas contém recursos. A chave de acumulação NÃO é mais `SubscriptionName`, e sim a **tupla composta `(SubscriptionName, region_bucket)`**.

#### 1.5.0 Sinal auxiliar — hub por convenção de `ResourceGroup`

Antes de aplicar o cascade, capturar um booleano auxiliar `_hub_by_convention` por sub: se **qualquer linha** da sub tem `ResourceGroup` contendo tokens `hub`, `network-hub` ou `core-network` (case-insensitive), marcar `_hub_by_convention = True` no JSON de resources. Não substitui a detecção oficial de hub (presença de ER/VPN gateway, §6), mas serve como **sanity check** — se a sub tem o token mas não tem gateway detectado, emitir warning `[HUB-MISMATCH] sub X tem RG com 'hub' mas nenhum ER/VPN/vWAN gateway` (possível detecção falhada de SKU).

Exemplos de convenções comumente observadas em enterprise: `rg-shd-network-hub-<region>`, `rg-<env>-network-hub-<purpose>-<region>`, `rg-hub-<region>`, `core-network-<region>`. A detecção é por **token genérico**, não por padrão completo de RG — funciona com qualquer convenção do cliente.

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

#### 1.5.1 `MeterRegion` como tier de pricing (ortogonal ao `region_bucket`)

Para `MeterCategory = "Bandwidth"` e `"Azure Front Door Service"`, a coluna `MeterRegion` carrega o **tier de pricing**, não a região do recurso. **Não confundir com `ResourceLocation`** — o `region_bucket` (§1.5) continua sendo derivado de `ResourceLocation`.

Valores observados em fatura real:

| `MeterRegion` | Tier de pricing |
|---|---|
| `Intercontinental` | Egress inter-continent (mais caro) |
| `South America`, `North America`, `Europe`, `Asia Pacific` | Intra-continent egress |
| `Sao Paulo State`, `Virginia`, `Iowa` (estados/regiões físicas) | Intra-region zone |
| `All Regions` | Pricing genérico |
| `Zone 1` … `Zone N` | Front Door geo tiers (preservação de pricing por destino do usuário) |

**Regras adicionais**:

1. Criar acumuladores **separados** por tier de pricing dentro de cada bucket regional, não apenas "Internet":
   - `internet_egress_isp_gb/cost` (default)
   - `internet_egress_intra_continent_gb/cost` (`MeterRegion` contém "South America", "North America", etc.)
   - `internet_egress_inter_continent_gb/cost` (`MeterRegion` = "Intercontinental" — oposto de hoje, que classifica via `MeterName`)
   - O acumulador agregado `internet_egress_gb/cost` continua existindo (somatório — retrocompatibilidade)

2. **Front Door**: registrar a distribuição de tier (`Zone N`) no tooltip do nó Front Door — mostra de onde vem o tráfego servido.

3. **Inter-Region** (§1.1, `interregion_egress`): continuar usando `MeterSubCategory = "Inter-Region"` como sinal primário, mas `MeterRegion = "Intercontinental"` em linhas de Bandwidth também deve ser considerada Inter-Region quando `ResourceLocation` está vazio (correção do A2).

4. **Sanity check**: para uma mesma sub, se `MeterRegion = "Intercontinental"` mas `ResourceLocation = "brazilsouth"`, isso é **esperado** (linha cobra egress de BR para outro continente) e não constitui mismatch — documentado em Apêndice A.15.

### 1.6 Merge Threshold (anti-fragmentação)

Após a acumulação, aplicar threshold para evitar que ruído crie nós espúrios:

- **Constante**: `MERGE_THRESHOLD = 1000.0` (em BRL ou moeda da fatura)
- **Recursos estruturais** (que SEMPRE justificam manter o split, mesmo com custo baixo):
  ```
  expressroute_circuit, expressroute_gateway, expressroute_port, vpn_gateway,
  vwan_hub, vwan_er_gateway, vwan_vpn_gateway,
  firewall, firewall_manager, app_gateway, nat_gateway, nva_marketplace
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

### 1.9 Reconciliação de Tráfego Privado (gap interno × externo)

Azure cobra os fluxos de **VNet Peering** (Regional e Global) em **ambos os lados** do link: a subscription origem paga `Egress` e a subscription destino paga `Ingress`. Portanto, **se as duas pontas do peer estiverem dentro do enrollment**, a soma do egress de um tipo deve ser aproximadamente igual à soma do ingress do mesmo tipo. Qualquer assimetria indica que **a contraparte do peer está fora do enrollment** (outro EA/MCA, outro tenant, parceiro, etc.).

Esta seção é **factual** — apenas reporta o que a fatura mostra. **Não emitir hipóteses sobre quem é a contraparte externa**; isso deve ser confirmado pelo cliente.

#### 1.9.1 Acumuladores e regras de bilateralidade

Para cada `(SubscriptionName, region_bucket)`, comparar pares egress/ingress dos seguintes tipos:

| Tipo | Acumuladores | Bilateral? | Asimetria = gap externo? |
|---|---|---|---|
| **Regional Peering** | `peering_egress_gb` ↔ `peering_ingress_gb` | ✅ Sim | ✅ Sim |
| **Global Peering** | `global_peering_egress_gb` ↔ `global_peering_ingress_gb` | ✅ Sim | ✅ Sim |
| **Private Link Data** | `private_link_egress_gb` ↔ `private_link_ingress_gb` | ❌ Não (unilateral) | ❌ Não — apenas padrão de upload/download |
| **ExpressRoute** | `expressroute_out_gb` ↔ `expressroute_in_gb` | ❌ Não (on-prem é externo por definição) | ❌ Não aplicável |
| **Internet** | `internet_egress_gb` ↔ `internet_ingress_gb` | ❌ Não (internet é externa) | ❌ Não aplicável |

**Apenas Regional Peering e Global Peering geram diagnóstico de gap externo.** Os demais tipos podem ser reportados, mas marcados explicitamente como "não bilateral — assimetria não indica peer externo".

#### 1.9.2 Verdict por (sub, região, tipo)

Para cada combinação `(sub, region, tipo bilateral)` com volume total ≥ 100 GB **ou** custo total ≥ R$ 50 (limite anti-ruído):

```
total_gb  = eg_gb + in_gb
gap_gb    = abs(eg_gb - in_gb)
gap_pct   = gap_gb / total_gb * 100

verdict = "MATCH"        se gap_pct < 30   (peer DENTRO do enrollment)
verdict = "PARTIAL"      se 30 <= gap_pct < 50
verdict = "GAP_EXTERNO"  se gap_pct >= 50  (peer FORA do enrollment)
```

Adicionar à entrada `flows[(sub, region)]` o sub-objeto:
```python
"_reconciliation": {
    "regional_peering": {
        "eg_gb": ..., "in_gb": ..., "gap_pct": ..., "verdict": "MATCH" | "PARTIAL" | "GAP_EXTERNO",
        "total_cost": ...
    },
    "global_peering": { ... },
    "private_link_data": { "eg_gb": ..., "in_gb": ..., "gap_pct": ..., "verdict": "INFORMATIVO" }
}
```

#### 1.9.3 Reconciliação no nível do enrollment

Emitir um JSON separado `_reconciliation.json` (ou seção no `_net_flows.json`) com:

```python
{
    "by_region": {
        "<region>": {
            "regional_peering": {"eg_gb": ..., "in_gb": ..., "gap_gb": ..., "gap_pct": ..., "verdict": "..."},
            "global_peering":   {"eg_gb": ..., "in_gb": ..., "gap_gb": ..., "gap_pct": ..., "verdict": "..."},
        }
    },
    "by_family_total": {
        "regional_peering": {...}, "global_peering": {...}, "private_link_data": {...}
    },
    "external_flows": [
        # apenas casos com verdict=GAP_EXTERNO e custo >= R$ 50, ordenado por custo desc
        {"sub": "...", "region": "...", "family": "regional_peering" | "global_peering",
         "eg_gb": ..., "in_gb": ..., "direction": "egress" | "ingress",
         "monthly_cost": ..., "annualized": ...}
    ],
    "summary": {
        "internal_cost": <R$ total dos MATCH>,
        "external_cost": <R$ total dos GAP_EXTERNO>,
        "external_cost_annualized": <external_cost * 12>,
        "external_pct_of_private": <external / (internal + external) * 100>
    }
}
```

#### 1.9.4 Direção do gap

Quando `verdict = GAP_EXTERNO`, registrar a **direção dominante** (informação factual da fatura):

- `direction = "egress"` se `eg_gb > in_gb` → "a sub envia mais do que recebe; destino está fora do enrollment"
- `direction = "ingress"` se `in_gb > eg_gb` → "a sub recebe mais do que envia; origem está fora do enrollment"

**NÃO** inferir o que está do outro lado nem porquê. Apenas direção do tráfego.

#### 1.9.5 Output em console (extrator)

Ao final da extração, imprimir tabela de reconciliação:

```
=== RECONCILIAÇÃO DE TRÁFEGO PRIVADO ===

Por tipo (enrollment):
  Regional Peering : eg=X,XXX GB  in=Y,YYY GB  gap=Z,ZZZ GB (NN%)  ALERTA: gap > 50%
  Global Peering   : eg=X,XXX GB  in=Y,YYY GB  gap=Z,ZZZ GB (NN%)  ALERTA: gap > 50%
  Private Link     : eg=X,XXX GB  in=Y,YYY GB  gap=Z,ZZZ GB (NN%)  (unilateral — informativo)

Fluxos com peer FORA do enrollment (verdict=GAP_EXTERNO, custo ≥ R$ 50):
  sub @ region              tipo               eg GB     in GB     gap %  R$/mês
  ───────────────────────────────────────────────────────────────────────────────
  ERP-PROD@eastus2          Global Peering    81.898       735     98.2%  15.866  ⚠ EGRESS para fora
  shared-PROD@brazilsouth   Regional Peering   3.033    65.714     91.2%   3.774  ⚠ INGRESS de fora
  ...

Resumo:
  Tráfego privado COM match interno: R$ X.XXX
  Tráfego privado SEM match (externo): R$ Y.YYY
  Anualizado:                          R$ ZZ.ZZZ/ano
  % do gasto privado que cruza fronteira: NN%
```

Se houver pelo menos 1 entrada com `verdict = GAP_EXTERNO`, imprimir cabeçalho de alerta:
```
⚠ ATENÇÃO — Foram detectados fluxos de peering cuja contraparte NÃO está neste enrollment.
   Isso é fato observado na fatura. NÃO assumir hipóteses sobre a origem/destino sem confirmação do cliente.
   Próximo passo sugerido: rodar `az network vnet peering list` na VNet implicada para identificar o peer.
```

#### 1.9.6 Exibição no diagrama (generator)

O generator deve:

1. **Badge no nó** (sub que tem ≥ 1 verdict=GAP_EXTERNO com custo ≥ R$ 50): chip vermelho pequeno "⚠ gap externo" no canto superior direito do card. Tooltip detalha tipo + direção + volume + custo.

2. **Painel/seção dedicada** "Reconciliação de Tráfego Privado" acessível via botão na toolbar (ex: 🔍 Reconciliação). Conteúdo:
   - Tabela por tipo bilateral (Regional Peering, Global Peering) com totais enrollment e verdict
   - Lista de fluxos externos (sub, tipo, direção, GB, R$, anualizado)
   - Resumo de custo interno × externo

3. **Edges com gap externo**: usar estilo visual distinto (ex: cor cinza com borda tracejada amarelo, ou label "⚠ peer externo") para sinalizar que a edge atual aponta para um hub interno mas o tráfego real cruza para fora. **Não criar nó "Externo" automaticamente** — só sinalizar visualmente o gap. O usuário pode então decidir como representar (consulta ao cliente, opção manual).

4. **Texto explicativo** no tooltip do edge afetado: `"⚠ <NN>% do tráfego deste peering não tem contraparte interna correspondente. A contraparte do peer pode estar em outro enrollment/tenant. Confirmar com `az network vnet peering list`."` — fato + ação recomendada, sem hipótese.

#### 1.9.7 Critérios de cálculo (precisão)

- Usar volume em GB (não custo) para calcular `gap_pct` — preço varia por região e tipo, GB é a métrica direta de bilateralidade
- Usar custo (R$) para ordenação e filtro de relevância (limite R$ 50)
- Threshold de ruído: ignorar combinações com `total_gb < 100` E `total_cost < 50` (ambos baixos)
- Limite de MATCH: 30% (asimetria normal por arredondamento, timing de medição, fluxos efêmeros)
- Limite de GAP_EXTERNO: 50% (a partir deste ponto, a explicação mais simples é peer externo)
- Faixa 30–50%: PARTIAL — não conclusivo; possível mix de peers internos e externos, ou janela de medição parcial

### 1.10 Consumer Breakdown — quem consome a rede

O `ResourceId` de cobranças de rede frequentemente aponta para o **resource provider consumidor** (serviço-pai que originou o tráfego), e não para o componente de rede gerenciável. Exemplos observados em fatura real:

- `MeterCategory = "Bandwidth"` cobrado em ResourceId de `Microsoft.MachineLearningServices/workspaces` (AML processa egress dos workspaces), `microsoft.compute/virtualmachines` (VMs), `Microsoft.Storage/storageAccounts` (egress de blobs), `microsoft.web/sites` (App Service)
- `MeterCategory = "Load Balancer"` cobrado em ResourceId de `Microsoft.MachineLearningServices/workspaces` (LBs internos do AML compute clusters) — NÃO em `microsoft.network/loadbalancers`
- `MeterCategory = "Azure DNS"` cobrado em ResourceId de AML workspaces (Private DNS zones criadas pelo AML para resolver PE de storage)

**Acumulador novo por `(sub, region_bucket)`**:

```python
_consumer_breakdown = {
    "by_resource_provider": Counter(),   # "Microsoft.MachineLearningServices/workspaces" -> cost
    "by_consumed_service":  Counter(),   # "Microsoft.Databricks"                          -> cost
    "rows_by_resource_provider": Counter()
}
```

**Cálculo**: para cada linha de rede com `ResourceId` não vazio:

```python
def parse_rp(resource_id: str) -> str:
    """/subscriptions/.../providers/Microsoft.X/yResources/... -> 'Microsoft.X/yResources' (case-preserving)."""
    if "/providers/" not in resource_id:
        return ""
    after = resource_id.split("/providers/", 1)[1]
    parts = after.split("/")
    return "/".join(parts[:2]) if len(parts) >= 2 else parts[0]
```

Acumular `cost` por `parse_rp(ResourceId)` e por `ConsumedService` (que costuma estar em case-insensitive variantes — normalizar para case original observado mais frequente).

**Output JSON** (em `_net_resources.json`): top 10 RPs e top 10 ConsumedServices por `(sub, bucket)`, ordenados por custo desc.

**Uso no diagrama**: nova seção no tooltip de cada nó (§3.5 item 7) — "Top consumidores de rede nesta sub/região". Permite responder "quanto cada serviço consome em rede" sem cruzar manualmente com outros relatórios.

**Limitação**: é informativo, não explica o **destino** do tráfego. O mesmo workload pode estar mandando egress para internet, para PE de storage ou inter-region. A atribuição ao destino exige cruzar com flow logs (fora do escopo deste prompt).

### 1.11 Workload Discovery dinâmico (sem hardcode de nome de workload)

A coluna `Tags` da fatura EA é uma string com pares `"key": "value"` separados por vírgula (formato não padronizado, parsing tolerante a erros é obrigatório). Quando preenchida, traz a identidade real do workload que originou cada cobrança de rede.

**Regra fundamental — zero hardcode**: o extrator **NÃO deve** referenciar nomes específicos (`"Databricks"`, `"AzureML"`, `"OpenAI"`, etc.) nem do cliente nem de produtos. Toda atribuição de workload deve emergir de heurísticas estatísticas aplicadas sobre os dados observados.

#### 1.11.1 Parser de Tags resiliente

```python
import re, json
def parse_tags(raw: str) -> dict:
    """Tolerant parser for EA Tags column. Returns {} on any failure."""
    if not raw or not raw.strip():
        return {}
    s = raw.strip()
    # EA often wraps the whole field in quotes that get doubled by CSV
    if not s.startswith("{"):
        s = "{" + s + "}"
    s = s.replace('""', '"')
    try:
        return json.loads(s)
    except Exception:
        # Last resort: regex extraction of "k":"v" pairs
        return dict(re.findall(r'"([^"]+)"\s*:\s*"([^"]*)"', s))
```

#### 1.11.2 Discovery de **dimensões de workload**

Para cada linha de rede com `Tags` preenchidas, acumular dois conjuntos:

1. **`tag_key_histogram`**: contagem por chave de tag → frequência e custo total observado.
2. **`tag_value_histogram[key]`**: para cada chave, contagem e custo por valor.

Ao final da extração, **classificar automaticamente** cada `tag_key` em uma das categorias abaixo via heurística (sem hardcode):

| Categoria | Heurística (data-driven) |
|---|---|
| **`workload_identifier`** | Cardinalidade alta (≥ 50 valores distintos) **e** custo distribuído (top-1 valor responde por < 60% do total da chave). Ex: `JobId`, `ClusterId`, `RunName`, `ContainerId`, `NodeId`. |
| **`workload_vendor`** | Cardinalidade baixa (1–10 valores distintos) com nomes em formato de marca/produto (regex `^[A-Z][a-zA-Z0-9_-]+$`, sem espaços). Ex: `Vendor`, `ManagedBy`. |
| **`environment`** | Valores no conjunto `{prod, prd, produtivo, production, dev, devel, qa, hml, hmg, uat, sbx, sandbox}` (case-insensitive). Ex: `ops-ambiente`, `Environment`, `env`, `tier`. |
| **`cost_center`** | Chave contém substring `cost`, `center`, `cc`, `bu`, `unit`, `ops-produto`, `ops-servico`. |
| **`platform_kind`** | Tag-key contém substring `platform`, `vendor`, `kind`, `app`, `service`. |
| **`generic`** | Resto. |

A categorização é **executada em runtime sobre as tags realmente presentes** — funciona para qualquer cliente sem ajuste. O resultado vai para `_net_workloads.json`:

```json
{
  "tag_keys_classified": {
    "JobId":          {"category": "workload_identifier", "n_distinct": 384, "total_cost": 12451.0},
    "Vendor":         {"category": "workload_vendor",     "n_distinct": 3,   "total_cost": 98765.0,
                       "top_values": [{"value": "<observed>", "cost": 88000.0, "rows": 134000}]},
    "ops-ambiente":   {"category": "environment",         "n_distinct": 2,   "top_values": [...]},
    "ops-produto":    {"category": "cost_center",         "n_distinct": 42,  "top_values": [...]}
  },
  "top_workloads_by_identifier": {
    "<key_classified_as_workload_identifier>": [
      {"value": "<job_or_cluster_id>", "cost": 1234.0, "rows": 567,
       "subscriptions": ["<sub>"], "primary_rp": "<RP_namespace>"}
    ]
  },
  "top_workloads_by_vendor":   [{"vendor": "<observed>", "cost": ..., "rps": ["..."]}],
  "_method": "heuristic_classification_v1"
}
```

#### 1.11.3 Pareto de consumidores

Após a classificação, para cada `tag_key` em `workload_identifier` ou `workload_vendor`, calcular o **Pareto** (top-N que respondem por 80% do custo):

```python
def pareto(items: list[tuple[str, float]], target_pct: float = 80.0):
    items = sorted(items, key=lambda x: -x[1])
    total = sum(c for _, c in items) or 1.0
    out, cum = [], 0.0
    for v, c in items:
        out.append({"value": v, "cost": c, "cum_pct": (cum + c) / total * 100})
        cum += c
        if (cum / total) * 100 >= target_pct:
            break
    return out
```

Exportar em `_net_workloads.json` como `pareto_80[tag_key]` — lista dos N valores responsáveis por 80% do custo agregado dessa dimensão.

**Critério de utilidade**: só vale a pena reportar Pareto para uma `tag_key` se a chave **cobre ao menos 30%** do `total_net_cost` do enrollment. Caso contrário, é dimensão minoritária e poluiria o relatório.

#### 1.11.4 Junção com Consumer Breakdown (§1.10)

Para cada workload top-N, anexar:

- **`primary_rp`**: RP namespace mais frequente em linhas que carregam aquela tag (descoberto, não hardcoded).
- **`primary_subs`**: subscriptions onde aquele workload aparece.
- **`primary_regions`**: regiões.
- **`traffic_mix`**: `{"egress_internet_gb": ..., "egress_inter_continent_gb": ..., "peering_gb": ..., "private_link_gb": ...}` — proporção dos tipos de flow associados.

Isso responde "para onde esse workload manda tráfego" usando exclusivamente o que está na fatura.

### 1.12 Matriz Bipartida de Peering

A reconciliação enrollment-wide (§1.9) responde "quanto egress total vs ingress total" mas não responde "**quem fala com quem**". O detalhamento bipartido produz uma matriz `(sub_A, sub_B) → volume estimado` mesmo sem acesso ao log de fluxos.

#### 1.12.1 Algoritmo de pareamento heurístico

Para cada par `(sub_A, region) → (sub_B, region)` candidato a peering (ambas as subs com `peering_egress_gb > 0` ou `peering_ingress_gb > 0` na mesma região e mesma família — Regional ou Global):

1. Tratar cada sub como **par de nós** (egress emitter, ingress receiver).
2. Construir grafo bipartido por região: arestas candidatas são `(sub_A.egress) → (sub_B.ingress)` se ambos têm volume > 0.
3. Aplicar **Hungarian-like balancing** simples por região:
   - Ordenar emitters e receivers por volume desc.
   - Atribuir greedy: o maior emitter parea com o maior receiver, drenando o menor dos dois volumes.
   - Repetir até esgotar.
4. Volume residual de qualquer lado fica como `unmatched_egress` ou `unmatched_ingress` — alimenta o `external_flows` da §1.9.

**Limitação documentada**: o pareamento é uma **estimativa**. Sem flow logs reais, não há garantia de que `sub_A` realmente conversa com `sub_B`. Mas para um enrollment com peering MATCH (gap < 30%), a soma dos pareamentos converge para a topologia real com erro típico < 15% no volume.

#### 1.12.2 Output `_net_peering_matrix.json`

```json
{
  "by_region": {
    "<region>": {
      "regional_peering": {
        "edges": [
          {"src": "<sub_A>", "dst": "<sub_B>",
           "matched_gb": 12345.0, "estimated_cost": 1234.0,
           "confidence": "high|medium|low"}
        ],
        "unmatched": {
          "egress_only": [{"sub": "...", "gb": ...}],
          "ingress_only": [{"sub": "...", "gb": ...}]
        }
      },
      "global_peering": { ... }
    }
  },
  "summary": {
    "total_matched_gb": ..., "total_unmatched_gb": ...,
    "matched_pairs": <int>,
    "method": "greedy_balancing_v1"
  }
}
```

**`confidence`** classificada por:
- `high`: emitter e receiver são o **único** par com volume > threshold na região para essa família
- `medium`: 2–4 candidatos, pareamento greedy
- `low`: ≥ 5 candidatos OU volume residual > 30% após pareamento

#### 1.12.3 Visualização no diagrama

Quando o usuário ativa "👁 Modo Pareamento" na toolbar:
- Edges de peering existentes são re-coloridos por confidence (`high`=verde sólido, `medium`=amarelo, `low`=cinza tracejado)
- Tooltip do edge mostra o pareamento estimado, com badge "⚠ estimativa" explicando o método
- Subs com `unmatched_egress > 0` ganham badge "🕳 destino externo" (linka com §1.9 GAP_EXTERNO)
- Subs com `unmatched_ingress > 0` mas zero `peering_egress` ganham badge "🕳 origem externa" (= **B3 órfão receptor**)

### 1.13 Auditorias e Findings de Otimização

Esta seção define as **regras determinísticas** que produzem o JSON `_net_insights.json`. Cada finding é gerado pela presença/ausência de padrões na fatura — sem dependência de catálogos de produtos do cliente.

Estrutura comum de cada finding:

```json
{
  "id": "FIND-XXXX",
  "category": "cost_optimization | architecture | data_quality",
  "severity": "high | medium | low | info",
  "subject": {"sub": "...", "bucket": "...", "resource": "..."},
  "evidence": { ...metrics... },
  "estimated_savings_monthly": <float | null>,
  "recommendation": "<text generated from observed pattern>",
  "confidence": "high | medium | low"
}
```

**Princípio**: o campo `recommendation` é **template-based**, derivado de placeholders preenchidos com dados observados. Exemplo: `"Considere migrar conexões SNAT do Load Balancer Standard para NAT Gateway. Atualmente {lb_data_gb} GB/mês processados via LB rules com custo R$ {lb_data_cost}."` — sem mencionar nome de produto/cliente.

#### 1.13.1 PE Over-Provisioning (A4)

Para cada `(sub, bucket)` com `private_endpoint_count > 0`:

```python
ratio = private_endpoint_cost / max(private_link_egress_cost + private_link_ingress_cost, 0.01)
if private_endpoint_cost >= 50 and ratio > 5.0:
    emit_finding(
        id="FIND-PE-OVERPROV",
        category="cost_optimization",
        severity="medium" if ratio < 20 else "high",
        subject={"sub": sub, "bucket": bucket},
        evidence={"pe_hourly_cost": ..., "pe_data_cost": ..., "ratio": ratio,
                  "pe_count": ..., "estimated_idle_pes": int(pe_count * (1 - 1/ratio))},
        estimated_savings_monthly=pe_hourly_cost * (1 - 1/ratio),
        recommendation=(
            f"{pe_count} Private Endpoints custam R$ {pe_hourly_cost:,.0f}/mês em infraestrutura fixa "
            f"mas processam apenas R$ {pe_data_cost:,.0f} em dados (razão {ratio:.1f}x). "
            f"Revisar PEs com baixo uso para consolidação ou desprovisionamento."
        ),
        confidence="medium"
    )
```

#### 1.13.2 LB Standard usado como SNAT → candidato a NAT Gateway (A3)

```python
if lb_data_gb > 500 and nat_data_gb == 0 and lb_rules_cost > 100:
    emit_finding(
        id="FIND-LB-AS-SNAT",
        category="architecture",
        severity="medium",
        ...
        estimated_savings_monthly=max(0, lb_data_cost * 0.4),  # NAT GW tipicamente 30-50% mais barato em escala
        recommendation=(
            f"Subscription processa {lb_data_gb:,.0f} GB via Load Balancer Standard sem NAT Gateway "
            f"associado. Em cargas com alto volume outbound, NAT Gateway oferece preço por GB inferior "
            f"e evita SNAT port exhaustion. Avaliar migração."
        ),
        confidence="low"  # sem flow logs, não temos certeza que é SNAT
    )
```

#### 1.13.3 MGN Savings Opportunity (A2)

```python
if mgn_egress_gb > 100:
    # Pricing diff ISP vs MGN varia por região; usar fator conservador 0.5
    isp_estimate = mgn_egress_cost * 0.5
    savings = mgn_egress_cost - isp_estimate
    emit_finding(
        id="FIND-MGN-SAVINGS",
        category="cost_optimization",
        severity="low" if savings < 500 else "medium",
        evidence={"mgn_egress_gb": ..., "mgn_egress_cost": ..., "estimated_isp_cost": isp_estimate},
        estimated_savings_monthly=savings,
        recommendation=(
            f"{mgn_egress_gb:,.0f} GB/mês saem pela rota MGN (Microsoft Global Network — premium routing). "
            f"Se os workloads tolerarem latência via ISP, configurar Routing Preference 'Internet' nas "
            f"Public IPs reduz custo de egress (~50% economia estimada). Aplicável a VM, VMSS, AKS, "
            f"Public LB com backend NIC, App Gateway, Azure Firewall, e Storage secondary endpoints."
        ),
        confidence="medium"
    )
```

#### 1.13.4 ER Circuit Utilization (A5)

Para cada `expressroute_circuit` em `_gateway_details`:

```python
# SKU: parse de "Standard Metered Data 2 Gbps Circuit", "Premium Unlimited Data 10 Gbps Circuit", etc.
sku_lower = circuit.sku.lower()
is_metered = "metered" in sku_lower
is_unlimited = "unlimited" in sku_lower
bandwidth_gbps = parse_bandwidth(circuit.sku)  # regex: r'(\d+)\s*gbps'

# DTO observado para essa região do hub
observed_dto_gb = expressroute_out_gb_for_this_sub_region
theoretical_max_gb = bandwidth_gbps * 86400 * 30 / 8  # GB/mês a 100% de uso

utilization_pct = observed_dto_gb / theoretical_max_gb * 100 if theoretical_max_gb else 0

if is_unlimited and utilization_pct < 5.0:
    emit_finding(
        id="FIND-ER-UNLIMITED-IDLE",
        severity="medium",
        evidence={"sku": circuit.sku, "circuit_cost": circuit.cost, "observed_dto_gb": ...,
                  "utilization_pct": utilization_pct},
        recommendation=(
            f"Circuito ExpressRoute em tier Unlimited com utilização estimada {utilization_pct:.1f}% "
            f"da banda contratada. Considere downgrade para tier Metered se o tráfego mensal projetado "
            f"continuar baixo (break-even típico: ~50% de uso)."
        )
    )

if is_metered and utilization_pct > 70.0:
    emit_finding(
        id="FIND-ER-METERED-SATURATING",
        severity="high",
        recommendation=(
            f"Circuito ExpressRoute em tier Metered com {utilization_pct:.1f}% de uso da banda. "
            f"Acima de 80% o custo per-GB do Metered ultrapassa o tier Unlimited equivalente. "
            f"Avaliar upgrade para Unlimited ou aumento de banda."
        )
    )
```

#### 1.13.5 Orphaned DNS Zones (A6)

```python
if dns_private_zone_cost > 100 and dns_query_cost < dns_private_zone_cost * 0.05:
    emit_finding(
        id="FIND-DNS-ORPHANED",
        category="cost_optimization",
        severity="low",
        evidence={"private_zone_cost": ..., "query_cost": ..., "estimated_idle_zones_pct": ...},
        recommendation=(
            f"Custo de Private DNS Zones (R$ {dns_private_zone_cost:,.0f}) é {dns_private_zone_cost/dns_query_cost:.0f}x "
            f"maior que o custo de queries. Zones criadas automaticamente por serviços PaaS (AML, Databricks, etc.) "
            f"frequentemente sobrevivem ao recurso original. Auditar via `az network private-dns zone list` e "
            f"remover zones com 0 queries."
        ),
        confidence="medium"
    )
```

#### 1.13.6 Idle Infrastructure (F4)

Para cada categoria com par `(hourly_cost, data_gb)`:

```python
checks = [
    ("nat_gateway",   nat_gateway_cost,   nat_data_gb,    100),  # threshold de custo R$
    ("appgw",         appgw_fixed_cost,   None,           200),  # AGW: sem data direto, usar capacity_units?
    ("bastion",       bastion_hourly_cost,bastion_egress_gb, 80),
    ("firewall",      firewall_cost,      None,           300),  # FW sem split data
]
for name, infra_cost, data_gb, threshold in checks:
    if infra_cost > threshold and (data_gb is None or data_gb < 10):
        emit_finding(
            id=f"FIND-IDLE-{name.upper()}",
            severity="low",
            evidence={"infra_cost": infra_cost, "data_gb": data_gb or 0},
            recommendation=(
                f"{name.replace('_', ' ').title()} custa R$ {infra_cost:,.0f}/mês em infraestrutura mas "
                f"processa volume de dados muito baixo. Validar se o recurso ainda é necessário."
            )
        )
```

#### 1.13.7 Hairpin Inter-Region (B1)

```python
for (sub, bucket), data in flows.items():
    if data["interregion_egress_gb"] < 100:
        continue
    # Esta sub envia tráfego cross-region. Tem peering interno?
    has_peering = data["peering_egress_gb"] > 0 or data["global_peering_egress_gb"] > 0
    if has_peering and data["interregion_egress_cost"] > 200:
        emit_finding(
            id="FIND-HAIRPIN-CANDIDATE",
            severity="medium",
            evidence={"interregion_gb": ..., "peering_gb": ..., "extra_cost_pct_total": ...},
            recommendation=(
                f"Sub gera {interregion_gb:,.0f} GB cross-region (R$ {interregion_cost:,.0f}) E mantém peering "
                f"ativo. Possível hairpin: tráfego viajando ao hub remoto para retornar ao destino. "
                f"Validar topologia: peering direto entre VNets nas duas regiões pode eliminar parte do custo."
            ),
            confidence="low"
        )
```

#### 1.13.8 Front Door Classic Migration (F9)

```python
if frontdoor_classic_egress_cost + frontdoor_classic_infra_cost > 50:
    emit_finding(
        id="FIND-FD-CLASSIC",
        severity="medium",
        category="architecture",
        recommendation=(
            "Detectada cobrança em Front Door Classic (SKU em descontinuação). Avaliar migração para "
            "Front Door Standard ou Premium antes do EOL anunciado pela Microsoft. Features novas (WAF v2, "
            "regras avançadas, melhor pricing) só estão disponíveis nos novos tiers."
        )
    )
```

#### 1.13.9 NVA Marketplace inventory

```python
if nva_marketplace_count > 0:
    emit_finding(
        id="FIND-NVA-INVENTORY",
        category="architecture",
        severity="info",
        evidence={"nva_count": ..., "nva_cost": ..., "publishers": [...]},  # publishers descobertos da fatura
        recommendation=(
            f"Detectados {nva_count} appliances de rede Marketplace ({', '.join(publishers)}). "
            f"Validar versão das imagens, suporte ativo do fornecedor, e licenciamento bring-your-own-license vs PAYG."
        )
    )
```

#### 1.13.10 Reservation / OneTime Charges audit (do gate §1.1.0)

Se `_one_time_purchases.total > 100` ou `_unused_reservation.total > 100`:

```python
emit_finding(
    id="FIND-RESERVATIONS-AUDIT",
    category="data_quality",
    severity="info",
    evidence={"one_time_total": ..., "unused_reservation_total": ..., "refunds_total": ...},
    recommendation=(
        "Fatura contém custos não-`Usage` relevantes (compras únicas, reservas não consumidas, refunds). "
        "Auditar separadamente em `_one_time_purchases` e `_unused_reservation` — não estão somados nos "
        "fluxos principais por design (§1.1.0)."
    )
)
```

### 1.14 Anomalias e Métricas de Saúde

#### 1.14.1 Spoke sem hub com inter-continent egress alto (D2)

```python
if not is_hub(sub) and interregion_egress_gb > 1000 and "inter_continent" in interregion_breakdown:
    emit_finding(
        id="FIND-SPOKE-INTERCONTINENT",
        category="architecture",
        severity="medium",
        recommendation=(
            f"Spoke (sem ExpressRoute/VPN próprios) gera {interregion_gb:,.0f} GB de tráfego inter-continent. "
            f"Pode ser legítimo (workload com público global), mas vale validar se não há misconfiguração "
            f"de backup/replicação cross-region ou log sink remoto inadvertido."
        )
    )
```

#### 1.14.2 Heavy Consumer (E3)

```python
top_rp = consumer_breakdown.by_resource_provider[0]
if top_rp.cost / total_net_cost > 0.6 and total_net_cost > 1000:
    flag_node_badge(
        sub=sub, bucket=bucket,
        badge=f"🔝 {pct:.0f}% de {short_label(top_rp.rp)}"
    )
```

`short_label()` é um **dicionário de mapeamento Azure RP namespace → label curto e ícone** (universal, sem cliente-específico):

```python
RP_LABELS = {
    "Microsoft.MachineLearningServices/workspaces": ("🤖", "AML Workspaces"),
    "Microsoft.Databricks/workspaces":              ("⚡", "Databricks"),
    "microsoft.compute/virtualmachines":            ("🖥️", "VMs"),
    "microsoft.compute/virtualmachinescalesets":    ("🧱", "VMSS"),
    "Microsoft.Storage/storageAccounts":            ("🗄️", "Storage"),
    "microsoft.web/sites":                          ("🌐", "App Service"),
    "Microsoft.Kusto/Clusters":                     ("📊", "Data Explorer"),
    "Microsoft.Search/searchServices":              ("🔎", "AI Search"),
    "Microsoft.ContainerService/managedClusters":   ("🚢", "AKS"),
    "microsoft.network/privateendpoints":           ("🔗", "Private Endpoints"),
    "microsoft.network/azurefirewalls":             ("🔥", "Firewall"),
    "microsoft.cdn/profiles":                       ("📡", "CDN/FD"),
}
def short_label(rp: str) -> tuple[str, str]:
    return RP_LABELS.get(rp, ("📦", rp.split("/")[-1] or rp))
```

Esses são **nomes oficiais Azure**, não nomes de cliente. Se a Microsoft introduzir um RP novo, o fallback `("📦", rp.split("/")[-1])` cobre. **Nunca** adicionar entradas com nomes específicos de cliente.

#### 1.14.3 Métricas de qualidade da extração

Emitir no `_net_insights.json → quality_metrics`:

```json
{
  "rows_total": <int>,
  "rows_net": <int>,
  "rows_skipped_non_usage": <int>,
  "auto_mapped_count": <int>,        // [AUTO-MAPPED] disparos
  "auto_resource_count": <int>,      // [AUTO-RESOURCE]
  "auto_flow_count": <int>,          // [AUTO-FLOW]
  "uom_mismatch_count": <int>,       // [UOM-MISMATCH]
  "hub_mismatch_count": <int>,       // [HUB-MISMATCH]
  "shared_bucket_cost": <float>,     // custo no __shared__ — quanto mais alto, pior a atribuição A1→A3
  "tags_coverage_pct": <float>,      // % de linhas com Tags não vazias
  "tags_workload_identifier_keys": <int>  // n de chaves classificadas como workload_identifier
}
```

Toda execução em produção saudável deve ter os 5 contadores `*_count` em 0. Subida = sinal de novo SKU/categoria a documentar no prompt.

### 1.15 Análise de Eficiência de Pricing

Aproveita as colunas `EffectivePrice`, `UnitPrice`, `Quantity` para análises que o pipeline atual ignora.

#### 1.15.1 Discount drift (F2)

Para cada `MeterId`, comparar `EffectivePrice` com `UnitPrice`:

```python
discount_pct = (1 - EffectivePrice / UnitPrice) * 100  if UnitPrice else 0
```

Agregar por `(MeterCategory, MeterSubCategory)` e expor em `_net_insights.json → pricing_summary`:

```json
{
  "by_meter_family": [
    {"category": "Bandwidth", "subcategory": "Inter-Region",
     "avg_discount_pct": 12.5, "sample_size": 32044, "total_cost": ...}
  ]
}
```

Permite identificar onde o cliente tem desconto EA negociado e onde está pagando full price (oportunidade de renegociação).

#### 1.15.2 Effective rate leaderboard (F3)

Top 20 meters por **custo por GB efetivo** (`Cost / Quantity` quando UoM = `1 GB`):

```json
{
  "expensive_meters": [
    {"meter_name": "Inter Continent Data Transfer Out", "effective_brl_per_gb": 0.55,
     "total_gb": 90205, "total_cost": 49612}
  ]
}
```

Útil para conversa de otimização: "estes meters são 10x mais caros que a média do enrollment".

#### 1.15.3 Bandwidth ratio per sub (F5)

```python
ratio = (internet_egress_gb + interregion_egress_gb) / max(internet_ingress_gb + 1, 1)
```

- `ratio < 0.5` → workload heavy-receiver (ex: data lake destino, log sink)
- `0.5 ≤ ratio ≤ 5` → balanceado (API típica)
- `ratio > 5` → emitter heavy (telemetria, replicação, backup egress, scraping)
- `ratio > 50` → outlier — vale investigar

Exportar como atributo de cada `(sub, bucket)`: `traffic_symmetry = "receiver | balanced | emitter | outlier_emitter"`.

### 1.16 Carbon Footprint Proxy (opcional — flag `--with-carbon`)

Cálculo informativo (alta variância científica):

```python
KWH_PER_GB_EGRESS = 0.06  # consumo médio rede backbone (estimate from open research; document the source)
GCO2_PER_KWH = {
    "brazilsouth": 95,        # matriz BR predominantemente hídrica
    "eastus": 380,             # mix fóssil EUA
    # ... emitir warning para regiões sem dado e usar fallback 500
}
carbon_kg = (egress_gb_total * KWH_PER_GB_EGRESS * factor) / 1000
```

Emitir como **finding informativo** apenas se o flag estiver ativo, com aviso explícito: "Estimativa indicativa; emission factors variam por fonte e atualizam-se anualmente".

### 1.17 Time-series readiness

Embora a comparação multi-período esteja fora do escopo (§0.3), o extrator deve emitir `_period_metadata.json` para facilitar comparação iterativa:

```json
{
  "client": "__CLIENT__",
  "period": "YYYYMM",
  "billing_account_id": "<from CSV>",
  "currency": "<BillingCurrency>",
  "row_count_total": <int>,
  "row_count_net": <int>,
  "total_net_cost": <float>,
  "extractor_version": "2.6",
  "tag_keys_seen": [...],     // permite cross-period diff de tag coverage
  "rp_namespaces_seen": [...]
}
```

Quando rodar múltiplos períodos no mesmo cliente, um script trivial cruza esses metadados para gerar MoM/YoY.

### 1.18 Timeline diária e detecção de anomalias

A coluna `Date` (formato `MM/DD/YYYY`) permite reagregar por dia dentro do período. Para cada `(sub, bucket, flow_family)` com `total_gb > 100`, calcular:

```python
daily = group_by(Date)[gb].sum()
mean, std = daily.mean(), daily.std()
anomalies = [d for d, v in daily.items() if abs(v - mean) > 3 * std]
```

Emitir como finding `FIND-DAILY-SPIKE` quando há ≥ 1 dia outlier com `v > mean + 3σ` e `v_extra_cost > R$ 200`. Recomendação: investigar batch jobs ou incidentes não planejados. Exportar série diária em `_period_metadata.json → daily_series[<sub>][<family>]`.

### 1.19 Agregação por prefixo de IP (proxy de VNet attribution)

`AdditionalInfo` traz `NodeIp` para certas categorias (Bandwidth, Virtual Network — tipicamente serviços PaaS gerenciados). Quando presente, calcular `/16` e `/24` do IP e acumular:

```python
def cidr_prefix(ip: str, mask: int) -> str:
    octets = ip.split(".")
    return ".".join(octets[:mask // 8]) + ".0" * (4 - mask // 8) + f"/{mask}"
```

Output em `_net_resources.json[<sub>][<bucket>]["_ip_prefix_breakdown"]`:

```json
{"by_/16": [{"prefix": "10.162.0.0/16", "cost": 1234.0, "gb": 5678.0}],
 "by_/24": [{"prefix": "10.162.89.0/24", "cost": 234.0, "gb": 1078.0}]}
```

Útil quando o cliente não nomeia VNets de forma consistente — o CIDR é a única âncora estável. **Privacidade**: a flag `--redact-additional-info` substitui IPs por seu hash SHA-1 de 6 chars (`hash:abc123`) preservando agrupamento mas removendo PII.

### 1.20 Reservation Utilization

Para cada `ReservationId` não vazio em linhas de rede, calcular:

```python
reserved_used = sum(Cost) where ReservationId == X
reserved_listed = sum(Cost) where ReservationName == X and ChargeType == 'UnusedReservation'
utilization_pct = reserved_used / (reserved_used + reserved_listed) * 100
```

Finding `FIND-RESERVATION-IDLE` quando `utilization_pct < 70 and reserved_listed > 100`. Aplicável especialmente a IP Reservations e ER Port reservations.

### 1.21 Fingerprint via `PartNumber` + `MeterId`

`PartNumber` é um identificador estável global Azure (não muda com renames de `MeterName`). Catalogar `partnumber_inventory`:

```json
{
  "<PartNumber>": {"meter_category": "...", "meter_subcategory": "...",
                    "meter_name_observed": "...", "rows": 0, "cost": 0.0}
}
```

Quando `MeterName` aparece com naming diferente do baseline mas `PartNumber` é conhecido, o classificador pode usar fallback via `PartNumber`. Permite resistir a renames silenciosos da Microsoft (que já aconteceram historicamente). Tabela exportada em `_period_metadata.json`.

### 1.22 Latency Premium Ratio (G6)

Para cada sub com `internet_egress_gb > 0`:

```python
latency_premium_pct = mgn_egress_gb / (mgn_egress_gb + internet_egress_gb) * 100
inter_continent_pct = internet_egress_inter_continent_gb / total_internet_egress_gb * 100
```

Exportar como `traffic_profile`:

```json
{"latency_premium_pct": 18.4, "inter_continent_pct": 62.3,
 "interpretation": "long-distance + latency-sensitive"}
```

Interpretação derivada de combinações (sem hardcode de cliente):

| `latency_premium_pct` | `inter_continent_pct` | Label |
|---|---|---|
| > 30 | > 30 | `long-distance + latency-sensitive` |
| > 30 | ≤ 30 | `latency-optimized` |
| ≤ 5 | > 50 | `cost-optimized cross-region` |
| ≤ 5 | ≤ 5 | `regional workload` |

### 1.23 Detecção de perfil heurístico do enrollment (sem hardcode)

Após `_consumer_breakdown` agregado enrollment-wide, calcular percentual por **substring no RP namespace oficial Azure** (a substring vem do nome oficial Azure, **não do cliente**):

```python
PROFILE_HEURISTICS = [
    ("ai_ml_heavy",     ["machinelearning", "cognitive", "openai", "search/searchservices"], 0.30),
    ("data_heavy",      ["databricks", "kusto", "datafactory", "synapse", "purview"],        0.30),
    ("paas_heavy",      ["web/sites", "logic", "containerinstance", "containerservice"],     0.30),
    ("iaas_heavy",      ["compute/virtualmachines", "compute/virtualmachinescalesets"],      0.40),
    ("storage_heavy",   ["storage/storageaccounts", "documentdb", "sql/servers"],            0.25),
]
for profile, substrings, threshold in PROFILE_HEURISTICS:
    pct = sum(cost for rp, cost in consumer_breakdown.items()
              if any(s in rp.lower() for s in substrings)) / total_net_cost
    if pct >= threshold:
        emit_finding(id=f"FIND-PROFILE-{profile.upper()}",
                     category="architecture", severity="info",
                     evidence={"pct": pct, "matched_rps": [...]},
                     recommendation=f"Perfil {profile.replace('_', ' ')} detectado ({pct:.0%}). "
                                    f"Considerações específicas de otimização aplicam-se a este padrão.")
```

Cliente pode ter múltiplos perfis ativos. As substrings são **nomes Azure** universais (não há "Databricks Inc." sendo classificado — é o RP namespace `Microsoft.Databricks/workspaces`).

#### 1.23.1 DNS Amplification Factor (J2)

Para perfil `ai_ml_heavy` ou `data_heavy`, calcular:

```python
amplification = dns_private_zone_count / max(private_endpoint_count, 1)
```

Se `> 3`, finding `FIND-DNS-AMPLIFICATION` recomendando consolidação via DNS Forwarder centralizado.

### 1.24 Deprecation audits

Catálogo de SKUs em fim-de-vida anunciado pela Microsoft (atualizar conforme anúncios):

```python
DEPRECATED_SKUS = [
    {"id": "ipv4_basic",       "match": "Basic IPv4 Static Public IP",
     "deadline": "2025-09-30",
     "msg": "Azure Basic Public IP SKU será descontinuada. Migrar para Standard SKU."},
    {"id": "frontdoor_classic", "match_subcat": "", "match_cat": "Azure Front Door Service",
     "deadline": "TBD",
     "msg": "Azure Front Door (classic) está em descontinuação. Migrar para Standard/Premium."},
    {"id": "lb_basic",         "match": "Basic Load Balancer",
     "deadline": "2025-09-30",
     "msg": "Azure Basic Load Balancer SKU será retirada. Migrar para Standard."},
    {"id": "vpn_gw_basic",     "match": "Basic Gateway", "match_cat": "VPN Gateway",
     "deadline": "TBD",
     "msg": "VPN Gateway Basic SKU é legado. Considerar VpnGw1AZ ou superior."},
]
```

Para cada match, emitir `FIND-DEPRECATED-<id>` com data limite e ação. **Os deadlines devem ser revisados em cada release deste prompt** — a lista é declarativa, não orientada a cliente.

### 1.25 Multi-enrollment cross-check hint

Quando `_net_reconciliation.json.summary.external_pct_of_private > 30%`, anexar campo informativo:

```json
"_multi_enrollment_hint": {
  "billing_account_id": "<from CSV>",
  "external_cost_monthly": ...,
  "next_step": "Se o cliente roda outros enrollments (outro BillingAccountId), validar se a contraparte do peer está lá. A reconciliação multi-enrollment exige cruzamento manual dos JSONs de cada enrollment."
}
```

Não tenta resolver — apenas sinaliza. Sem hardcode de números de enrollment.

### 1.26 Sankey export (G3)

Emitir `_net_sankey.json` com flows estruturados para visualização Sankey (alternativa executiva ao diagrama interativo). Schema:

```json
{
  "nodes": [{"id": "sub:AZR-X",          "type": "sub"},
            {"id": "region:brazilsouth", "type": "region"},
            {"id": "class:internet_isp", "type": "traffic_class"},
            {"id": "dest:external",      "type": "destination"}],
  "links": [{"source": "sub:AZR-X", "target": "region:brazilsouth", "value": 12345.0},
            {"source": "region:brazilsouth", "target": "class:internet_isp", "value": 8000.0},
            ...]
}
```

Renderizado em HTML alternativo `[CLIENTE]_Network_Sankey_[PERIODO].html` (D3 standalone, sem dependências runtime). Útil para apresentações C-level — menos detalhe, mais storytelling de "para onde vai o dinheiro".

### 1.27 Reconciliação de custo total (gate de integridade)

Soma de **todos** os acumuladores de flow + infra por `(sub, bucket)` deve igualar `total_net_cost` (tolerância < 0.1%). Caso contrário, há double-counting ou linhas perdidas:

```python
sum_check = (
    peering_egress_cost + peering_ingress_cost +
    global_peering_egress_cost + global_peering_ingress_cost +
    internet_egress_cost + mgn_egress_cost + internet_ingress_cost +
    interregion_egress_cost +
    expressroute_out_cost + expressroute_in_cost +
    expressroute_circuit_cost + expressroute_gateway_cost +
    vpn_cost + vwan_hub_cost +
    private_endpoint_cost + private_link_ingress_cost + private_link_egress_cost +
    firewall_cost + firewall_manager_cost +
    nat_gateway_cost + nat_data_cost +
    lb_rules_cost + lb_data_cost +
    appgw_fixed_cost + appgw_cu_cost +
    frontdoor_classic_infra_cost + frontdoor_classic_egress_cost + frontdoor_classic_ingress_cost +
    frontdoor_std_infra_cost + frontdoor_std_egress_cost + frontdoor_std_ingress_cost +
    dns_private_zone_cost + dns_query_cost +
    bastion_hourly_cost + bastion_egress_cost +
    public_ip_cost + traffic_manager_cost +
    cdn_cost + cdn_egress_cost +
    ddos_cost + network_watcher_cost +
    other_network_cost
)
drift_pct = abs(sum_check - total_net_cost) / max(total_net_cost, 0.01) * 100
```

Se `drift_pct > 0.1`, emitir warning `[COST-DRIFT] sub @ bucket: drift X%` e finding `FIND-COST-DRIFT` (data_quality). Salvar `reconciliation_drift_pct` em `quality_metrics`.

> **NÃO** somar `*_cost` legados (`nat_cost`, `lb_cost`, `appgw_cost`, `frontdoor_*` agregados, `bastion_cost`, `dns_cost`) pois esses são **somatórios** de retrocompatibilidade dos seus splits — somá-los junto causaria double-counting.

### 1.28 VPN data bounds (estimativa por contexto)

Para subs com `vpn_gateway` mas sem `expressroute_circuit` na mesma `(sub, bucket)`:

```python
vpn_data_lower_bound_gb = 0
vpn_data_upper_bound_gb = internet_egress_gb  # cenário: todo egress da sub foi via VPN
```

Adicionar como atributo informativo em `flows[(sub, bucket)]`:

```json
"_vpn_data_estimate": {
  "lower_gb": 0, "upper_gb": ...,
  "note": "Tráfego VPN não tem meter dedicado na fatura EA. Faixa expressa o limite teórico, não medição."
}
```

UI: tooltip do edge VPN mostra "Dados VPN: entre 0 e X GB (sem meter dedicado)".

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

### 2.3 Collision Avoidance — 4 Fases

**NUNCA** usar um loop global que empurra todos os nós indiscriminadamente. Isso causa drift de nós entre regiões. Usar **4 fases sequenciais**:

**Fase 1 — Intra-região**: Para cada região, resolver sobreposições apenas entre os nós daquela região. Nós de regiões diferentes **não interagem** nesta fase. Isso mantém cada cluster coeso.

**Fase 2 — Inter-região (box separation)**: Tratar cada region box como um retângulo e verificar sobreposição entre pares de region boxes. Se duas boxes se sobrepõem, empurrar **todas as suas nodes juntas** na direção de menor sobreposição (horizontal ou vertical). Recalcular os bounds da region box após cada empurrão. Iterar até convergir (~50 iterações).

**Fase 3 — Nós especiais**: Resolver sobreposições entre nós especiais (`__onprem__`, `__inet_*__`) e todos os nós regulares. Isso posiciona On-Premises e Internet sem conflito com as regiões.

**Fase 4 — Enforce On-Premises na base**: Após todas as fases de collision avoidance, **re-enforce** que o nó On-Premises fique **abaixo** de todas as region boxes:
1. Calcular `maxRegY` = maior `rb.y + rb.h` de todos os region boxes
2. Se `pos['__onprem__'].y < maxRegY + 60`, forçar `pos['__onprem__'].y = maxRegY + 80`
3. Centralizar horizontalmente: `pos['__onprem__'].x = (minRegX + maxRegX)/2 - width/2`

Isso é necessário porque a Fase 3 pode empurrar On-Premises para cima ou para os lados ao resolver colisões com outros nós especiais.

### 2.4 Recálculo de Region Boxes Pós-Render

As region boxes devem ser **recalculadas após o rendering dos nós no DOM**, porque a altura real de cada nó depende do conteúdo (chips, nome, etc.) e pode ser maior que a estimativa usada no layout (ex: 120px estimado vs 160px real). O fluxo correto no `render()` é:

1. Desenhar region boxes com dimensões estimadas
2. Desenhar todos os nós (atualiza `pos[id].h = el.offsetHeight`)
3. Recalcular region boxes com as alturas reais (`recalcRB()`)
4. Atualizar o DOM das region boxes com as novas dimensões

A função `recalcRB()` percorre `regionBoxes[rk].nodes`, lê `pos[id]` com `w` e `h` atualizados, e recalcula `x, y, w, h` do box com padding de 20px lateral e 28px topo.

### 2.5 Setas e Direção — REGRA FUNDAMENTAL

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
- **Containment automático bidirecional**: ao arrastar um nó dentro de uma region box, a region box **DEVE se redimensionar automaticamente para acompanhar o bounding box atual dos seus nós** — cresce quando um nó é arrastado para fora, **encolhe** quando os nós são reposicionados para mais próximos uns dos outros. O contorno é sempre `bounds_atuais_dos_nós + padding_fixo`. Implementação:
  1. Função utilitária `nodeRegion(id)` que percorre `regionBoxes` e retorna o `rk` cuja `.nodes[]` contém o id (ignora nós especiais `__onprem__`, `__inet_*__`).
  2. No handler de `mousemove` durante `dragState`, após atualizar `pos[id].x/y`, chamar `recalcRBBounds(ownerRk)` e atualizar `left/top/width/height` do `<div id="rb_{rk}">`.
  3. **`recalcRBBounds(r)` calcula bounds tight a partir das posições atuais de todos os nós da região** (`min/max x/y` dos nós + `NW`/`NH`) e aplica `padding = (20px lateral, 40px topo/base)`. O resultado é absoluto, não monotônico — a box pode tanto crescer quanto encolher para acompanhar os nós. Nenhum nó pode "escapar" visualmente do seu container, e a box nunca tem espaço morto além do padding.
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

### 3.5 Hover/Tooltip nos Nós — Light + Click-to-Drawer (Pattern A, v2.12+)

**Princípio (v2.12)**: o tooltip ao passar o mouse é **leve** (5–7 linhas) — só KPIs principais. Detalhe completo se abre em **drawer com tabs** ao clicar no card. Padrão de mercado em ops dashboards (Datadog, Grafana, Azure Portal): hover dá contexto rápido, click revela profundidade. Evita sobrecarga cognitiva de tooltip de 30+ linhas.

#### 3.5.1 Conteúdo do hover (light)

1. **Cabeçalho**: Nome da sub, região, ambiente (PROD/DEV/UAT).
2. **Custo total de rede** (destaque).
3. **Percentil custo** (`p{0..100}` dentro do enrollment).
4. **📦 Top 5 recursos por custo** (com `R$ X (×N)`).
5. **💡 Findings** — contador + severity badges (`12H 5M 1L` em chips coloridos).
6. **Hint de click** em itálico/azul: *"🔍 Clique no card para abrir detalhes · Circuitos & Conexões · Fluxos · Findings…"*.

Não incluir no hover: lista completa de gateways/circuitos, breakdown completo de fluxos, lista completa de findings, reconciliação, consumer breakdown — esses migram para o drawer.

#### 3.5.2 Drawer de detalhes (`#subDrawer`)

**Trigger**: click no card (mousedown + click com movimento < 3px para distinguir de drag).

**Layout**: painel fixo no lado direito, 460px de largura, slide-in (`transform:translateX(100%)` → `0`). Mutuamente exclusivo com `#subPanel` (sub-list panel) — abrir um fecha o outro. Canvas ganha classe `.shifted-drawer` (`right: 460px`).

**Header**: `<b>{sub}</b> @ {region} · {env}` + botão `✕` (ESC também fecha).

**5 tabs** com renderers dedicados:

| Tab | Conteúdo |
|---|---|
| **📊 Overview** | 3 KPIs em destaque (custo total, percentil, findings com severity). Top 5 fluxos. Top 5 recursos. “+N a mais” quando truncar. |
| **📦 Recursos** | Inventário completo de tipos de recurso, ordenado por custo desc. Sem truncamento. |
| **🔧 Circuitos & Conexões** | **Estrela do release v2.12**: Card por entry de `_gateway_details` (circuitos ER, ER gateways, VPN gateways, vWAN hubs) com `⬇ DTO` + `⬆ DTI` quando presentes (vêm de §1.1.6). Card por entry de `_by_connection` (VPN/ER connections) com `⬆ egress` + `⬇ ingress`. Cada card mostra: nome do recurso, SKU, custo base, qty+unit+custo por direção. Circuitos `Local Unlimited` mostram nota "Flat-rate (Unlimited) — sem meter por GB". Conexões exibem `parent_gateway_hint`. |
| **☁️ Fluxos** | Lista completa de fluxos com `qty + unit + custo` padronizados (vêm de §3.6). Auto-scaling GB → TB → PB via `fmtBytes`. Inclui RP consumer breakdown (top 15). |
| **💡 Findings & Recon** | Lista completa de findings com descrição expandida + estimated savings. Reconciliação por família com verdict + gap %. |

**Click guard**: o handler de click no card verifica `Math.abs(e.clientX-mdX)>3 || Math.abs(e.clientY-mdY)>3` (foi drag, ignora) e `e.target.closest('.chip')` (chips têm handlers próprios, não abrir drawer).

**Trocar de sub sem fechar**: clicar em outro card substitui o conteúdo do drawer (mantém tab ativo).

#### 3.5.3 Migração desde v2.11

Até v2.11, todo conteúdo vivia no tooltip de hover (Þ ≈30 linhas, cobrindo Recursos / Gateways / Fluxos / Top consumidores / Findings / Reconciliação). A partir de v2.12, hover é leve e drawer é onde mora o detalhe. Mantenha o hover com no máximo 7 linhas + hint de click.

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

**REGRA DE FORMATAÇÃO DE LINHA (v2.12+)** — **toda linha do tooltip de edge** deve seguir o padrão `quantidade · unidade · custo`, não apenas custo:

- Onde existir `_gb` no acumulador: mostrar `{fmtBytes(gb)} · R$ {cost}` (ex: `16.54 TB · R$ 11.344`).
- Onde existir `_hours` (v2.12+): mostrar `{qty} h · R$ {cost}` (ex: `720 h · R$ 1.728`). Horas NÃO auto-escalam (sempre em horas, não convertem para dias).
- Onde não houver qty capturada (ex: ER Circuit com UoM `1/Month`): mostrar apenas `R$ {cost}` — o sufixo `(hora)` antigo foi removido, pois esses meters não são necessariamente horários.
- DTI gratuito mas com volume relevante: exibir `{fmtBytes(gb)} · GRÁTIS` (volume **não se esconde** só porque o custo é zero).

**Helper `fmtBytes` (auto-scale)** — GB é a unidade base; threshold decimal 1000 (convenção Azure billing):

```js
const fmtG = (n) => {
  const v = Number(n)||0;
  if (v >= 1e6) return (v/1e6).toFixed(2).replace(/\.?0+$/,"") + " PB";
  if (v >= 1e3) return (v/1e3).toFixed(2).replace(/\.?0+$/,"") + " TB";
  if (v >= 10)  return Math.round(v).toLocaleString("pt-BR") + " GB";
  if (v >= 1)   return v.toFixed(1) + " GB";
  return v.toFixed(2) + " GB";
};
```

Aplica globalmente (tooltips de nó, tooltips de edge, chips de fluxo, Sankey, drawer). Hours mantidas em horas (não convertem para dias/semanas).

**Cobertura por tipo de edge**:

| Tipo | Linhas no tooltip (formato qty+unit+cost) |
|---|---|
| `internet` / `mgn` | `via ISP {gb} · R$ {c}` · `via MGN (premium) {gb} · R$ {c}` · `via Front Door {gb} · R$ {c}` |
| `er` / `mixed` | `⬇ ER DTO {gb} · R$ {c}` · `⬆ ER DTI {gb} · GRÁTIS` · `🔌 Circuit R$ {c}` · `🔌 Gateway {hours} h · R$ {c}` |
| `vpn` / `mixed` | `🔐 VPN GW {hours} h · R$ {c}` · `🌐 vWAN Hub {hours} h · R$ {c}` |
| `peering` / `gpeering` | `⬆ egress {gb} · R$ {c}` · `⬇ ingress {gb} · GRÁTIS` |
| `interregion` | `volume {gb} · R$ {c}` · origem/destino estimado |

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

#### 3.6.1.1 Limitação: Tráfego VPN não segregável na fatura EA

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

**Invariante (v2.12+)** — **o custo exibido no nó Internet de uma região deve refletir a soma absoluta da fatura para `_bucket === r`**, não o subconjunto visível no layout. É frequente o layout esconder subs em agregados (`__globalagg__` top-N ou `__regagg_<r>`); essas subs continuam pertencendo à região no plano de dados, mesmo não aparecendo como cards individuais. O nó Internet não pode "perder" tráfego só porque a UI agregou:

```js
for (const r in layout){
  if (r === '__others__') continue;
  // CERTO: iterar DATA.flows filtrando por _bucket (verdade do dado)
  let tEg = 0;
  for (const lbl of visibleLabels()){
    const rr = DATA.flows[lbl];
    if (!rr || rr._bucket !== r) continue;
    tEg += (rr.internet_egress_cost||0) + (rr.mgn_egress_cost||0)
         + (rr.frontdoor_classic_egress_cost||0) + (rr.frontdoor_std_egress_cost||0);
  }
  if (tEg > 50) internetNodes[r] = { ..., cost: tEg };
}
```

NÃO somar via `layout[r].subs.reduce(...)` — isso subnotifica quando subs caem em agregado fora da região (caso canônico: subs do bucket `eastus2` que entram no `__globalagg__` na região sintética `__others__` aparecem fora do escopo da redução). A regra acima garante consistência entre o label do nó e o tooltip (que já usa `visibleLabels()`).

O filtro de `hiddenSubs` (controle do `#subPanel`) **continua respeitado** (via `visibleLabels()`): se o usuário explicitamente esconde uma sub, ela não conta. A regra elimina apenas a regressão causada pelo agregado de UI.

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

### 3.13 Painel de Insights (achados de otimização e anomalias)

Painel lateral retrátil à esquerda (`#insightsPanel`, `width:340px`, espelha `#subPanel` mas posicionado no lado oposto). Acessado via botão `💡 Insights` na toolbar.

#### 3.13.1 Estrutura

- **Header**: título + filtros rápidos por categoria (`Cost Optimization`, `Architecture`, `Data Quality`) e por severidade (`high`, `medium`, `low`, `info`)
- **Lista de findings** (`#insightsList`): cada finding renderizado como card colapsável
  - Header do card: severidade (badge colorido) + `id` + `subject` (sub @ region)
  - Body: `recommendation` em texto + `evidence` em grid de KPIs + `estimated_savings_monthly` em destaque
  - Footer: `confidence` + botão "Localizar no diagrama" que dá focus na sub/bucket
- **Totalizador no header**: `R$ X savings/mês estão em findings com severity ≥ medium`
- **Toggle no card de cada sub**: chip `💡 N` que ao clicar abre o painel filtrado por aquele subject

#### 3.13.2 Renderização dos findings

Card generico (template):

```html
<div class="finding sev-medium">
  <div class="f-head">
    <span class="sev-badge">MEDIUM</span>
    <span class="f-id">FIND-PE-OVERPROV</span>
    <span class="f-subject">AZR-XXX @ brazilsouth</span>
  </div>
  <div class="f-recommendation">[texto do recommendation]</div>
  <div class="f-evidence">
    <span><b>R$ X.XXX</b> infra fixa</span>
    <span><b>R$ Y.YYY</b> em dados</span>
    <span><b>5.2x</b> ratio</span>
  </div>
  <div class="f-savings">💰 R$ Z.ZZZ economia estimada/mês</div>
  <div class="f-foot">Confidence: medium · <button>Localizar</button></div>
</div>
```

#### 3.13.3 Cores de severidade

- `high`: borda + fundo do badge `--rd` (vermelho)
- `medium`: `--or` (laranja)
- `low`: `--bl` (azul)
- `info`: `--mt` (cinza neutro)

#### 3.13.4 Anchor no diagrama

Quando o usuário clica "Localizar", o canvas faz pan/zoom para centralizar o nó `subject` e o ilumina por 2s com pulse animation. Implementação reusa `fitAll()` mas com `bounds` restrito ao nó.

### 3.14 Modo Pareamento de Peering (tri-state, v2.12+)

Botão `🔗 Pareamento: {state}` na toolbar **cicla** entre três estados: `off` → `smart` → `all` → `off`.

| Estado | Comportamento | Quando usar |
|---|---|---|
| **off** (default) | Edges agregados por região (spoke → hub). Comportamento conservador. | Visão limpa quando os pares não são confiáveis. |
| **smart** | Agregado regional **MAIS** sobrepõe pares HIGH/MEDIUM do matcher (§1.12). Pares LOW ficam absorvidos no agregado. | Visão híbrida: peering confiável vira linha explícita; ruído fica oculto. |
| **all** | Só os pares do matcher (qualquer confidence). | Investigação profunda — pode virar "spaghetti" se a maioria for LOW. |

Em **smart** e **all**, edges são coloridos por confidence:
- `high` → verde sólido (`var(--gn)`)
- `medium` → amarelo (`var(--ye)`)
- `low` → cinza tracejado (gradient)

**Legenda flutuante** (`#pairingLegend`) aparece no canto inferior direito quando `pairingState !== 'off'`, com swatches HIGH/MEDIUM/LOW para referência rápida.

**Comparação de confidence case-insensitive**: dados de `_net_peering_matrix.json` têm confidence em **minúsculas** (`"low"`, `"medium"`, `"high"`). Toda comparação no JS deve normalizar: `String(e.confidence||'').toUpperCase() === 'HIGH'`. Não assumir maiúsculas.

Cost-labels em pares: mostrar label de custo na linha quando `e.cost > 1500 && (HIGH || MEDIUM)`. Pares LOW > R$ 1500 ainda mostram label se não estiverem em pairingMode (— ou seja, na visão agregada não-pareada).

**Compatibilidade `pairingMode`**: variável boolean legada `pairingMode = (pairingState !== 'off')` continua disponível para qualquer código que ainda a consulte.

### 3.15 What-if Calculator (I1)

Para cada finding com `estimated_savings_monthly > 0`, o card no Painel de Insights (§3.13) inclui um **slider 0–100%** "Quanto da oportunidade você acha aplicável?". O `savings_realized` recalcula em tempo real e atualiza:
- Total no header do painel (`R$ X economia projetada/mês`)
- KPI no rodapé do canvas (`💰 Projetado: R$ X/mês · R$ Y/ano`)

Estado dos sliders é persistido em `localStorage` por `(client, period)` para que o usuário retome análises entre sessões. **Não** envia dados ao servidor (HTML é standalone).

### 3.16 Benchmark percentile no card de cada sub (I2)

No header do tooltip de cada sub, adicionar mini-chips com percentil dentro do enrollment para 3 métricas:

- `📊 custo: p{pct}` (percentil de `total_net_cost`)
- `📊 egress: p{pct}` (percentil de `internet_egress_gb + interregion_egress_gb`)
- `📊 PEs: p{pct}` (percentil de `private_endpoint_count`)

Fórmula: `pct = (rank_of_this_sub / total_subs) * 100`, arredondado para o múltiplo de 5 mais próximo. Chip ganha background `--rd` se `pct >= 90` (top 10% — outlier). Permite identificar subs anômalas com 1 olhada.

### 3.17 Top-3 levers per region (I3)

No header de cada region box, adicionar botão `🎯 Top 3` que abre popover com os 3 findings de maior `estimated_savings_monthly` cujo `subject.bucket` está nessa região. Atalho executivo para "em que mexer primeiro nesta região".

Cálculo: filtrar `_net_insights.json.findings` por `subject.bucket == region`, ordenar por `estimated_savings_monthly desc`, pegar top 3. Se nenhum finding na região, ocultar botão.

### 3.18 Botões de controle de layout (v2.12+)

Toolbar tem 4 botões além de Fit/Reset para reorganizar a tela sem perder zoom/pan:

| Botão | Função |
|---|---|
| **⊞ Fit** | (já existia) Enquadra todo o canvas no viewport. |
| **↹ Re-arranjar** | Re-roda `buildLayout()` + `render()` preservando `panX`, `panY`, `scale`. Útil após muitos drags manuais para "limpar" e voltar ao grid. |
| **⊞ Cols: {auto/2/3/4/5}** | Cycla `colsMode` por: `auto` → `2` → `3` → `4` → `5` → `auto`. `auto` adapta colunas por número de subs visíveis (≤4 → 2 cols, ≤12 → 3, ≤24 → 4, >24 → 5). Manual força valor uniforme em todas as regiões. Texto do botão e classe `.active` refletem estado atual. |
| **📦 Expandir Tudo / 📦 Recolher Tudo** | Itera `aggData` e flipa **global + todos os regionais** num único click. Texto alterna conforme `anyCollapsed` em `aggData`. Antes do v2.12, expandia só o global. |

**Dynamic cols rationale**: em datasets com regiões muito desiguais (ex: uma região com 37 subs e outras com 3), forçar 2 colunas em toda a tela gerava region box com 19 linhas (h ≈ 2.973 px). Com `colsFor(37) = 5`, a mesma região cai para 8 linhas (h ≈ 1.433 px = −52%). A função:

```js
function colsFor(numSubs){
  if (colsMode !== 'auto') return Math.max(1, parseInt(colsMode, 10) || COLS);
  if (numSubs <= 4)  return 2;
  if (numSubs <= 12) return 3;
  if (numSubs <= 24) return 4;
  return 5;
}
```

E em `buildLayout()` por região:

```js
const colsTarget = (r === '__others__') ? 1 : colsFor(toShow.length);
const cols = Math.min(colsTarget, Math.max(1, Math.max(spokesRows.length, hubsRow.length, 1)));
```

Region `__others__` sempre 1 coluna (vertical) por convenção visual.

`rebuildAll()` (chamado por filtros, visibility toggle, cycleCols) faz `buildLayout(); render(); updateKpis(); updateSubFooter();` — não preserva zoom/pan (intencional). `rearrangeLayout()` faz só `buildLayout(); render();` (preserva).

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

**Egress chip strip (v2.13+) — zero zona cinzenta**: cada sub renderiza chips para cada canal de egress não-trivial (9 categorias). Threshold por canal: `gb >= 1` OU `cost >= 5`. Auto-escala GB → TB → PB via `fmtBytes`. Prefixo `↗` indica direção egress. Cores semânticas:

| Canal | Field | Emoji | Cor (chip cls) | Semântica |
|---|---|---|---|---|
| ISP | `internet_egress` | 🌐 | `r` (vermelho) | Internet pública genuína |
| MGN | `mgn_egress` | 🛣 | `y` (amarelo) | Microsoft Global Network (premium routing) |
| FD classic | `frontdoor_classic_egress` | 🚀 | `o` (laranja) | Front Door Classic |
| FD std | `frontdoor_std_egress` | 🚀 | `o` (laranja) | Front Door Standard/Premium |
| ER OUT | `expressroute_out` | 🔌 | `b` (azul) | ExpressRoute privado para on-prem |
| IRR | `interregion_egress` | ↔ | `o` (laranja) | Cross-region pela Azure backbone |
| Peering | `peering_egress` | 🔗 | `g` (verde) | VNet peering intra-region |
| GPeering | `global_peering_egress` | 🌍 | `g` (verde) | Global VNet peering cross-region |
| Conn | `connection_egress` | 🔐 | `p` (roxo) | VPN/ER Connection (§1.1.5) |
| PL OUT | `private_link_egress` | 🛡 | `b` (azul) | Private Link (sub hospeda serviço via PE) |

**Ingress chip strip (v2.13+) — apenas vol > 500 GB**: ingress frequentemente é GRÁTIS, mas volumes grandes contam história operacional ("esta sub é receptora de 308 TB via ER"). Prefixo `↘`. Canais cobertos: `expressroute_in` (🔌), `peering_ingress` (🔗), `global_peering_ingress` (🌍), `private_link_ingress` (🛡), `connection_ingress` (🔐). Threshold `gb > 500` evita ruído.

**Chips de infraestrutura** (mantidos): `⭐ HUB`, `🏛️ hub by RG`, `🔝 {pct}% {top-rp}`, `🔗PE×N`, `🔥FW`, `🔌ER×N` (count, não flow), `⚙️ER Direct×N`, `🔐VPN×N`. 

**Chips de qualidade**: `💡 N findings`, `📊 p{X} custo` (p90+), `📊 p{X} egress` (p90+), `⬆️ outlier emitter` / `📤 emitter` / `📥 receiver`, `⚠ gap externo`.

**Distinção visual entre chip de fluxo vs chip de contagem**: 
- Flow: `🔌16T` (volume) ou `🔌R$ 1.7K` (custo)
- Count: `🔌ER×2` (`×N` após o emoji)

**Tooltip de cada chip**: contém label completo + qty + custo (ex: `title="↗ ER: 16.54 TB · R$ 11.344"`).

> **Histórico**: até v2.12 o card mostrava apenas dois chips de fluxo: `⬇ {gb}` (somando `internet_egress + interregion_egress`) e `⬆Peer {gb}` (peering ingress). Os 7 canais restantes (MGN, FD, ER OUT separadamente, GPEER, CONN, PL) ficavam invisíveis no card — o usuário precisava abrir tooltip ou drawer para vê-los. v2.13 promove todos a chips de primeira classe.

### 2.6 Z-Index — Camadas (regra arquitetural)

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

### 4.6 Filter Bar e Dropdown (CSS)
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

### 4.7 Subscription Panel (CSS)
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

## 5. GERAÇÃO — TRÊS SCRIPTS (extract → analyze → generate)

A partir de v2.8, o pipeline está dividido em **três fases** para permitir re-análise sem re-processar o CSV (compatibilidade com CSVs > 5 GB). Versões ≤ v2.7 usavam dois scripts — a combinação `extract + analyze` em um único script ainda é válida em projetos legacy, mas não em novos.

### 5.0.A Fases

| Fase | Script | Input | Output | Cobertura |
|---|---|---|---|---|
| 1. **Extract** | `[CLIENTE]_extract_network_data.py` | CSV de fatura EA/MCA | `_net_flows.json`, `_net_resources.json`, `_net_reconciliation.json`, `_period_metadata.json` | §1.1–1.10, §1.14.3, §1.17, §1.27 |
| 2. **Analyze** | `[CLIENTE]_analyze.py` | JSONs da fase 1 | `_net_workloads.json`, `_net_peering_matrix.json`, `_net_insights.json`, `_net_sankey.json` | §1.11–1.13, §1.18–1.26, §1.28 |
| 3. **Generate** | `[CLIENTE]_gen_network_diagram.py` | JSONs das fases 1+2 | `Network_Architecture_[PERIODO].html`, `Network_Sankey_[PERIODO].html` | §2–§4 |

**Por que separar**: a fase 1 é a mais cara (streaming de CSV 10 GB → ~5 min). A fase 2 roda em segundos sobre os JSONs. Isso permite iterar análises (§1.13 findings, thresholds) sem re-extração.

**Backward-compat**: o script `_extract_network_data.py` pode opcionalmente embutir a fase 2 quando rodado com flag `--all-in-one`. Default: apenas extração.

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

### 5.1 Nome do cliente em strings/labels (template HTML)

**Regra crítica**: além dos nomes de arquivo, o nome do cliente também aparece em **strings dentro do HTML gerado** (título da página, label do nó On-Premises, headings de tooltip, headers, etc.). Esses pontos NÃO podem ser hardcoded com o nome de um cliente específico — devem usar o placeholder `__CLIENT__` (substituído em runtime).

| Local no template | Anti-padrão (hardcoded) | Padrão correto |
|---|---|---|
| `<title>` da página | `<title>Renner — Network Cost Topology</title>` | `<title>__TITLE__</title>` (com `__CLIENT__` no python) |
| Header/toolbar | `<h1>Renner Network Cost Topology</h1>` | `<h1>__CLIENT__ Network Cost Topology · __PERIOD__ · __CURRENCY__</h1>` |
| Label do nó On-Premises | `<div class="nm">🏢 On-Premises (Renner)</div>` | `<div class="nm">🏢 On-Premises (__CLIENT__)</div>` |
| Heading do tooltip On-Prem | `html.push('<h4>🏢 On-Premises (Renner)</h4>')` | `html.push('<h4>🏢 On-Premises (__CLIENT__)</h4>')` |
| Qualquer texto contextual visível | "rede da Renner", "CMDB Renner" | usar `__CLIENT__` ou genérico ("rede do cliente") |

**Substituição em runtime**: no `render_html()`, fazer:
```python
return TEMPLATE \
    .replace("__TITLE__", f"{CLIENT} — Network Cost Topology ({PERIOD})") \
    .replace("__CLIENT__", CLIENT) \
    .replace("__PERIOD__", PERIOD) \
    .replace("__CURRENCY__", currency) \
    .replace("__DATA_JSON__", data_json) \
    .replace("__RECON_JSON__", recon_json)
```

**Checklist anti-hardcode** (rodar mentalmente antes de finalizar o gerador):
1. Buscar no template (`grep -i "<nome do cliente>"`) — não pode aparecer
2. Buscar em strings JavaScript inline (`'Cliente X'`, `"Cliente X"`) — não pode
3. Buscar em `html.push(\`...\`)` ou template literals com nome embutido — substituir por `${CLIENT_VAR}` ou placeholder

**Por que isso importa**: copiar o script de um cliente para outro (workflow comum quando um analista atende múltiplas contas) deve funcionar com **apenas duas mudanças**: `CLIENT = "..."` e `CSV_PATH = "..."`. Se houver strings hardcoded espalhadas pelo template, cada novo cliente exige busca manual e correção — fonte de bugs silenciosos (ex: diagrama do cliente A com label "On-Premises (cliente B)").

---


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

### Script 2: `[CLIENTE]_analyze.py` (FASE 2 — Análise)

```
Entrada: [CLIENTE]_net_flows.json + _net_resources.json + _net_reconciliation.json + _period_metadata.json
Saída:   [CLIENTE]_net_workloads.json + _net_peering_matrix.json + _net_insights.json + _net_sankey.json
```
- Lê os JSONs da fase 1 (instantâneo, ~MB não GB).
- Executa workload discovery (§1.11), peering matrix (§1.12), findings (§1.13), profile detection (§1.23), deprecation audits (§1.24), Sankey export (§1.26).
- Independente do CSV — pode rodar offline em outra máquina.

### Script 3: `[CLIENTE]_gen_network_diagram.py` (FASE 3 — Visualização)
```
Entrada: [CLIENTE]_net_flows.json + [CLIENTE]_net_resources.json
Saída: [CLIENTE]_Network_Architecture_[PERIODO].html
```
- Lê JSONs, calcula layout, gera HTML standalone
- Todo CSS/JS inline
- Dados hardcoded no JavaScript

### Fluxo de uso
```
1. python [CLIENTE]_extract_network_data.py [CSV]   # FASE 1: CSV → JSONs core
2. python [CLIENTE]_analyze.py                       # FASE 2: JSONs → JSONs analíticos
3. python [CLIENTE]_gen_network_diagram.py           # FASE 3: JSONs → HTML
4. Abrir HTML no navegador
```

### 5.6 Robustez Operacional

#### 5.6.1 Idempotência via hash do CSV (H1)

O extrator calcula `sha256` do CSV de entrada e grava em `_period_metadata.json.csv_sha256`. Antes de processar, verifica se os outputs existem e o hash bate — se sim, no-op com log `[CACHE-HIT] outputs já existem para CSV sha256:X`. Flag `--force` ignora cache. Útil em pipelines CI/CD.

#### 5.6.2 JSON Schema validation (H2)

O repo deve manter `schemas/net_flows.schema.json`, `net_resources.schema.json`, `net_reconciliation.schema.json`, `net_insights.schema.json`, `net_workloads.schema.json`, `net_peering_matrix.schema.json`. Antes de escrever cada arquivo, validar com `jsonschema.validate()`. Falha aborta a execução com mensagem clara — evita corrupção silenciosa do contrato downstream (vinculado a §D.1).

#### 5.6.3 Paralelismo opcional (H3)

Para CSVs > 2 GB, flag `--parallel N` (default `1`):
1. Particionar o CSV em N chunks por offset de bytes alinhado a `\n` (cuidado para não quebrar linha).
2. Cada worker processa seu chunk em memória, emite parciais.
3. Reducer concatena `flows[(sub, bucket)]`, `resources[(sub, bucket)]`, etc.
4. Reconciliação (§1.9) executa apenas no reducer, após merge.

Ganho típico: 4–6x em CSVs > 5 GB com `N=4`.

#### 5.6.4 Verificação de integridade do CSV (H4)

Ao final da extração, comparar:
- `subscriptions_in_csv` (set de `SubscriptionId` únicos no CSV inteiro) vs `subscriptions_in_outputs` (chaves em `_net_flows.json`). Diff > 0 é esperado (subs sem rede), mas log `[INTEGRITY] subs sem network spend: N`.
- `row_count_total` registrado vs contagem real — deve bater.
- `total_cost_in_csv` (soma de `Cost` para todas as linhas, não só rede) vs `_period_metadata.json.total_billing_cost` para contexto (razão net/total).

Reporta em `quality_metrics`.

#### 5.6.5 Redaction de PII opcional (G1 extension)

Flag `--redact-additional-info` substitui IPs, VmName, NodeId, ContainerId em `AdditionalInfo` por hash SHA-1 de 6 chars antes de salvar nos JSONs. Preserva agrupamento por valor mas remove rastreabilidade direta. Necessário em ambientes com políticas estritas de data minimization.

#### 5.6.6 Wall-clock e proveniência

`_period_metadata.json` deve incluir:
```json
{
  "extraction_started_utc": "2026-05-25T14:32:11Z",
  "extraction_duration_sec": 67.3,
  "csv_path": "<absolute path>",
  "csv_sha256": "...",
  "csv_size_bytes": ...,
  "extractor_version": "2.7",
  "prompt_version": "2.7",
  "host": "<short hostname (no domain)>",
  "flags": ["--parallel=4", ...]
}
```

Útil para auditoria quando output parece estranho meses depois.

---

## 6. ADAPTAÇÃO PARA DIFERENTES TOPOLOGIAS

### 6.1 Topologias suportadas automáticamente

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

### 6.2 Annotation automática de tier de pricing por região

Preço de internet egress varia significativamente entre regiões (BrazilSouth, AustraliaEast, SouthAfricaNorth, JapanEast e similares custam aproximadamente 2x o preço de regiões nos EUA/Europa). O gerador deve **descobrir dinamicamente** o tier de cada região presente na fatura usando o próprio dado, sem hardcode:

```python
# Para cada região com internet_egress_gb > 100, calcular o preço efetivo por GB
rate_per_region = {
    region: sum_internet_egress_cost / sum_internet_egress_gb
    for region in regions if sum_internet_egress_gb > 100
}
min_rate = min(rate_per_region.values())
for region, rate in rate_per_region.items():
    multiplier = rate / min_rate
    if multiplier >= 1.5:
        annotate_region(region, badge=f"💰 egress {multiplier:.1f}x")
```

Dessa forma, qualquer região nova que a Microsoft lançar com pricing diferente será anotada corretamente sem mudança no código. O badge é exibido no header da region box e tem tooltip explicando "preço efetivo Nx em relação à região mais barata observada na fatura".

**Robustez**: se a fatura tem apenas uma região com tráfego significativo, não emitir badges (não há base de comparação).

### 6.3 Adaptação ao perfil de tags

O discovery de workloads (§1.11) é 100% data-driven:
- Cliente sem tags → `_net_workloads.json` fica vazio, painel de workloads não aparece, demais funcionalidades continuam.
- Cliente com tags ricas → painel mostra automaticamente as chaves descobertas com nomes do **próprio cliente**.
- Não há lista pré-definida de tag keys "esperadas" — a heurística de §1.11.2 classifica o que está lá.

---

## 7. CHECKLIST DE QUALIDADE

### 7.1 Pipeline & Classificação

- [ ] **Gate de `ChargeType`** (§1.1.0): apenas `Usage` entra nos acumuladores principais; `Purchase`/`Refund`/`UnusedReservation`/`Adjustment` vão para blocos separados
- [ ] **Gate de `UnitOfMeasure`** (§1.1.0): UoM contém `Hour`/`Month` ⇒ infra (`*_cost`); UoM = `1 GB` ⇒ flow (`*_gb`+`*_cost`); UoM = `1M`/`10K`/`1` ⇒ contável. Mismatch dispara warning `[UOM-MISMATCH]`
- [ ] **Workload discovery dinâmico** (§1.11): tag keys classificadas via heurística em `workload_identifier`/`vendor`/`environment`/`cost_center`/`platform_kind`/`generic`. **Zero hardcode de nomes de cliente ou workload específico**.
- [ ] **Parser de Tags resiliente** (§1.11.1): falha silenciosa em linha mal-formada não derruba o extrator
- [ ] **Pareto 80%** computado para cada `workload_identifier`/`vendor` que cobre ≥ 30% do `total_net_cost`
- [ ] **Matriz bipartida de peering** (§1.12): `_net_peering_matrix.json` emitido com `edges`, `unmatched`, `confidence` por região e família
- [ ] **Findings de otimização** (§1.13): `_net_insights.json` contendo PE over-prov, LB-as-SNAT, MGN savings, ER utilização, DNS órfão, infra idle, hairpin, FD classic, NVA inventory, reservations audit — todos com `recommendation` template-based
- [ ] **Anomalias** (§1.14): spoke inter-continent, heavy consumer, traffic_symmetry
- [ ] **Quality metrics** (§1.14.3): contadores `*_count` devem estar em 0 em produção saudável; subida implica novo SKU a documentar
- [ ] **Pricing efficiency** (§1.15): discount drift, effective rate leaderboard, bandwidth ratio por sub
- [ ] **Carbon footprint** (§1.16) emitido **apenas** com flag `--with-carbon`
- [ ] **`_period_metadata.json`** (§1.17) emitido para facilitar comparação multi-período
- [ ] **MGN vs Internet** (§1.1.4): `MeterSubCategory` contém `"Rtn Preference: MGN"` acumula em `mgn_egress_gb/cost`, não em `internet_egress`
- [ ] **Splits infra-vs-data** (§1.1): LB (`lb_rules_cost`+`lb_data_cost`), NAT (`nat_gateway_cost`+`nat_data_cost`), Bastion (`bastion_hourly_cost`+`bastion_egress_cost`), DNS (`dns_private_zone_cost`+`dns_query_cost`), AGW (`appgw_fixed_cost`+`appgw_cu_cost`)
- [ ] **Front Door split** (§1.1): `MeterSubCategory=""` ⇒ `frontdoor_classic_*`; `MeterSubCategory="Azure Front Door"` ⇒ `frontdoor_std_*`
- [ ] **ER Direct ports** (§1.2): `microsoft.network/expressroutePorts` detectado como `expressroute_port` (estrutural)
- [ ] **NVA Marketplace** (§1.2): `PublisherType != "Azure"` em linhas de rede ⇒ rtype `nva_marketplace`
- [ ] **Hub por convenção** (§1.5.0): RG contém `hub`/`network-hub`/`core-network` define `_hub_by_convention=True`; warning `[HUB-MISMATCH]` se convenção sem ER/VPN/vWAN detectado
- [ ] **`MeterRegion` como tier de pricing** (§1.5.1): `Intercontinental` → `internet_egress_inter_continent`; `South America`/etc → `internet_egress_intra_continent`; default → `internet_egress_isp`. `region_bucket` continua via `ResourceLocation`
- [ ] **Consumer Breakdown** (§1.10): top 10 RPs e ConsumedServices exportados em `_consumer_breakdown` no `_net_resources.json`
- [ ] **Tier de pricing dinâmico por região** (§6.2): badge `💰 egress Nx` calculado das próprias taxas observadas, sem lista hardcoded de regiões caras
- [ ] **`RP_LABELS`** (§1.14.2): contém **apenas** RP namespaces oficiais da Azure, nunca nomes de cliente ou workload específico
- [ ] **Atribuição de região por linha**: cascade A1→A2→A3→A4 implementada (ResourceLocation → nome → `__global__` → `__shared__`)
- [ ] Acumulação usa chave composta `(sub, region_bucket)` — nunca apenas `sub`
- [ ] Merge threshold (`R$ 1.000` + sem recurso estrutural) funde buckets ruído no dominante
- [ ] Recursos estruturais (ER GW/Circuit, VPN GW, vWAN Hub/ER/VPN, Firewall, FW Mgr, App GW, NAT GW) SEMPRE preservam o split mesmo com custo baixo
- [ ] Labels de saída: `sub` (single), `sub@region` (multi), `sub 🌐 Global`, `sub ⚠ Shared`
- [ ] **Mapeamento autônomo**: linhas não cobertas pelos padrões geram novos acumuladores/recursos/filtros automaticamente (`other_network` descontinuado)
- [ ] Mapeamentos autônomos logados com `[AUTO-MAPPED]` e resumidos ao fim com alerta `⚠️ PROMPT UPDATE NEEDED`
- [ ] **Auto-mapeamento bilateral** (seção 1.4.1): se `flow_key` casou mas `rtype is None` e há `ResourceName`, aplicar fallback via `CATEGORY_FORCES_RESOURCE` ou `FLOW_TO_RESOURCE`. Log `[AUTO-RESOURCE]` ao final.
- [ ] **Eixo ARM-path (§1.4.2)**: `ResourceId` parsed via regex; tipos `microsoft.network/*` desconhecidos disparam `[AUTO-ARM-PATH]`. Tabela `ARM_TYPE_TO_RTYPE` sincronizada com `RES_PATTERNS`.
- [ ] **VPN/ER Connection split (§1.1.5)**: linhas `Bandwidth` com `ResourceId` casando `/providers/microsoft.network/connections/` vão para `connection_egress_*` / `connection_ingress_*` **antes** de internet/MGN/inter-region. `_by_connection` populado com nome+ResourceGroup. Connection sem tráfego ⇒ acumulador zerado (esperado).
- [ ] **Disambiguação `vpn_connection` × `er_connection` (§1.4.2.3)**: rtype derivado dos gateways existentes na sub. Casos ambíguos logam `[CONNECTION-AMBIG]`.
- [ ] Virtual WAN detectado como hub (vwan_hub, vwan_er_gateway, vwan_vpn_gateway)
- [ ] Virtual WAN ER Scale Unit acumulado em expressroute_gateway_cost
- [ ] Virtual WAN VPN S2S Scale Unit acumulado em vpn_cost
- [ ] Bandwidth Inter-Region separado de Internet Egress (interregion_egress, não internet_egress)
- [ ] Private Link split em 3: PE hourly (infra) + Ingress data (flow) + Egress data (flow)
- [ ] Application Gateway separado de Load Balancer (appgw_cost ≠ lb_cost)
- [ ] Azure Front Door Service mapeado (com "Service" no nome) + split DTO/DTI/infra
- [ ] Azure Firewall Manager separado de Azure Firewall
- [ ] DNS tem acumulador próprio (dns_cost)
- [ ] **Armadilha ER Circuit/Metered**: regra "Circuit" avaliada ANTES de "Metered Data" e sem excluir nomes que contenham "metered" (ver Apêndice A)

### 7.2 Reconciliação

- [ ] Reconciliação de peering executada para Regional + Global (bilaterais)
- [ ] Private Link Data reportado como INFORMATIVO (unilateral)
- [ ] Verdict por (sub, região): MATCH < 30%, PARTIAL 30–50%, GAP_EXTERNO ≥ 50%
- [ ] Limite de ruído: total_gb < 100 E total_cost < R$ 50 → ignorar
- [ ] JSON `_reconciliation.json` emitido com `by_family_total`, `by_region`, `external_flows`, `summary`
- [ ] Console do extrator imprime alerta `⚠ ATENÇÃO` quando há ao menos 1 GAP_EXTERNO
- [ ] Texto da reconciliação é **factual** — nenhuma hipótese sobre a contraparte externa
- [ ] Badge "⚠ peer externo" no nó afetado e painel dedicado no diagrama com botão na toolbar

### 7.3 Visual & Layout

- [ ] Region box `🌐 Global` renderizada sempre que houver custos geo-distribuídos
- [ ] Region box `⚠ Shared` renderizada SOMENTE se houver custos não atribuíveis (com contador no toolbar)
- [ ] Cada caixa é um div HTML independente, não Canvas
- [ ] On-Premises na BASE, Internet **por região no TOPO**, Hub(s) **na base da sua region box**
- [ ] On-Premises posicionado dinamicamente via `maxY` das region boxes (nunca offset fixo)
- [ ] Subscriptions agrupadas por região com caixas tracejadas (hubs + spokes dentro da mesma box)
- [ ] Collision avoidance em 4 fases: intra-região → inter-região → especiais → enforce On-Prem base
- [ ] Collision avoidance Fase 4 re-enforça On-Premises abaixo de todas as regiões
- [ ] On-Premises renderizado por função dedicada `renderOnPrem()` com chips de breakdown e tooltip
- [ ] Region boxes recalculadas pós-render com alturas reais do DOM
- [ ] Dark theme padrão com toggle para light
- [ ] Valores monetários em padrão brasileiro (R$ X.XXX,XX) — ou da moeda da fatura
- [ ] Labels de edges só nos custos > R$ 1.500
- [ ] Espessura de edge relativa ao max cost do dataset (não fórmula fixa /5000)
- [ ] Internet separada por região (um nó por região com tráfego)
- [ ] Linhas (edges) sempre acima das region boxes (z-index 8 > 2)
- [ ] Region boxes transparentes a cliques no interior (pointer-events:none)
- [ ] Edge labels SEMPRE acima dos node cards (z-index 20 > 14) para legibilidade

### 7.4 Edges & Direção (DTO/DTI)

- [ ] Todas as setas ⬇=DTO(cobra), ⬆=DTI(grátis) — **NUNCA inverter**
- [ ] Custos de natureza diferente NUNCA somados em uma única linha (DTO, Circuit, Gateway são linhas separadas)
- [ ] **Edge `onprem_mixed`**: hub com ER + VPN gera UM único edge (nunca dois sobrepostos)
- [ ] Tooltip do `onprem_mixed` mostra duas seções visuais (🔌 ExpressRoute + 🔐 VPN) com todos os componentes discriminados
- [ ] `total` do edge mixed = DTO + DTI + Circuit + Gateway + VPN + vWAN Hub
- [ ] Edge mixed com estilo visual distinto: roxo `#a87de0` dashed `10,5`
- [ ] On-Premises card mostra chips separados para DTO, Circuit, Gateway (não um número único misturado)
- [ ] Edge tooltip mostra totalCost no headline + componentes individuais abaixo
- [ ] VPN Gateway gera edge para On-Premises (cinza dotted, distinto do ER azul dashed)
- [ ] Inter-Region edges com cor laranja e dash distinto

### 7.5 Interatividade

- [ ] Hover tooltip funciona em TODOS os nós E em TODAS as linhas
- [ ] Tooltip mostra inventário de recursos (ER Gateway, ER Circuit, VPN, PE, etc.)
- [ ] Tooltip mostra **detalhes de SKU** de cada ER Gateway, ER Circuit e VPN Gateway
- [ ] Regiões são arrastáveis (movem todos os nós dentro)
- [ ] Nós individuais são arrastáveis (linhas acompanham)
- [ ] **Containment do drag**: arrastar nó para fora da region box faz a region crescer automaticamente
- [ ] Drag de região via borda/label — não bloqueia hover nas linhas
- [ ] Controles de fonte (A−/A+/A⟲), Fit e Reset layout
- [ ] Botão expandir/contrair "Outros" funciona em ciclos múltiplos (global + per-region independentes)
- [ ] Tooltip esconde durante drag (nó, região ou pan)
- [ ] Barra de filtros por componente funcional com chips clicáveis (AND/OR)
- [ ] Chips mostram apenas tipos de recurso presentes nos dados (count > 0)
- [ ] Contador `X/Y subs` atualiza em tempo real ao filtrar; botão Limpar reseta filtros
- [ ] Painel lateral de subscriptions abre/fecha com toggle; busca textual filtra em tempo real
- [ ] Botões rápidos (All/None/PROD/DEV) funcionam corretamente
- [ ] Footer do painel mostra custo total visível atualizado
- [ ] Filtros de componente e subscription são acumulativos
- [ ] Estado de expansão "Outros" reseta ao aplicar filtros

### 7.6 Portabilidade entre clientes

- [ ] Todos os scripts e arquivos de apoio usam prefixo `[CLIENTE]_` no nome
- [ ] **Nenhum nome de cliente hardcoded em strings/labels do HTML** — usar placeholder `__CLIENT__`
- [ ] Locais críticos verificados: `<title>`, header, label do nó On-Premises, heading do tooltip On-Prem
- [ ] Copiar o script de um cliente para outro deve funcionar com apenas 2 mudanças: `CLIENT = "..."` e `CSV_PATH = "..."`
- [ ] JSON keys sempre em **inglês** e snake_case (interoperabilidade)
- [ ] Funciona com qualquer número de subscriptions (1 a 100+)
- [ ] Funciona com ou sem ExpressRoute/VPN
- [ ] Moeda detectada da fatura (`BillingCurrency`) — não hardcoded como BRL

### 7.7 Regressão (anti-bugs)

- [ ] `python tests/regression_test.py` passa sem deltas após qualquer mudança
- [ ] Se houver delta, foi confirmado explicitamente com o usuário antes de rodar `--update`
- [ ] Novos clientes adicionados ao baseline via `--update --client <nome>` apenas após validação manual


---

## 8. Protocolo de Mudança (anti-regressão)

Este prompt e seus scripts derivados (`<CLIENTE>_extract_network_data.py`, `<CLIENTE>_gen_network_diagram.py`) estão sob **proteção de regressão automática**. Esta seção define o protocolo que o agente (e qualquer humano) deve seguir ao modificar regras de classificação, thresholds, schemas de output, ou comportamento visual.

### 8.1 Antes de qualquer mudança

1. Rodar `python tests/regression_test.py` no estado atual. **Deve passar.** Se já estiver falhando, isso é um bug pré-existente — investigar antes.
2. Identificar a categoria da mudança:
   - **Estrutural-only** (renomeação de seção, melhoria de redação, novo apêndice): não afeta scripts → pode prosseguir
   - **Comportamental** (nova regra de classificação, novo threshold, mudança de schema): pode mudar métricas → seguir 8.2
3. **Hardcode audit (v2.13+, §D.7.1)** — antes de commitar qualquer mudança no prompt, rodar:
   ```bash
   grep -iE '(raizen|petrobras|riachuelo|renner|<outros-clientes>)|SUB_[A-Z]|TI-Infra|virtualgw-|erc-[a-z]+-|connection-infra-|expressroute-infra-' prompt_network_topology.md
   ```
   Resultado deve ser **vazio**. Qualquer match precisa ser sanitizado com placeholders genéricos (`<sub-name>`, `<circuit-name>`, etc.) antes de prosseguir.

### 8.2 Para mudanças comportamentais

1. **Aplicar a mudança** em código (ou prompt, se for normativa).
2. **Rodar `python tests/regression_test.py`**.
3. Se passa: ✅ a mudança é compatível com baselines existentes.
4. **Se falha**: o agente deve **PARAR** e apresentar ao usuário:
   - Quais clientes baseline divergiram
   - Diff completo das métricas (output do test runner já mostra)
   - Justificativa de por que a métrica mudou
   - Pergunta explícita: **"Esta mudança é intencional? Confirme antes que eu atualize o baseline."**
5. Apenas com **confirmação explícita do usuário** ("sim", "pode atualizar", "confirmo"), rodar `python tests/regression_test.py --update`.
6. Nunca rodar `--update` proativamente sem pedir.

### 8.3 Ao adicionar novo cliente

```bash
# 1. Criar scripts <NovoCliente>_*
# 2. Validar manualmente o diagrama no browser
# 3. Adicionar ao baseline:
python tests/regression_test.py --update --client NovoCliente
```

### 8.4 Invariantes bloqueadas

Algumas decisões estruturais não devem ser alteradas sem revisão explícita. Ver **Apêndice D — Invariantes Bloqueadas**.

### 8.5 Sinais que exigem atenção redobrada

Mudanças nestas áreas têm **alto risco de regressão silenciosa** e requerem leitura cuidadosa do Apêndice A antes de prosseguir:

- Ordem de classificação em `MeterCategory = "ExpressRoute"` (Circuit vs Metered Data)
- Ordem de patterns em `RES_PATTERNS` (mais específico primeiro)
- Cascade A1→A4 de atribuição de região
- Algoritmo de merge threshold
- Thresholds de reconciliação (30%, 50%, 100 GB, R$ 50)
- Schema de chaves dos JSONs (qualquer rename quebra ferramentas downstream)
- Layout em 4 fases de collision avoidance

---

## Apêndices

### Apêndice A — Armadilhas Conhecidas

Bugs já encontrados e suas causas raiz. **Consultar antes de editar regras de classificação.**

#### A.1 ER Circuit classificado como Metered Data

- **Sintoma**: custo de circuito ER aparece como R$ 0; DTO inflado em 10–80×.
- **Causa**: `MeterName` como `Premium Metered Data 10 Gbps Circuit` contém simultaneamente "Metered Data" e "Circuit". Condição incorreta: `"circuit" in nl and "metered" not in nl`.
- **Fix correto**: avaliar "Circuit" ANTES de "Metered Data", SEM excluir nomes que contenham "metered". A regra "Circuit" tem precedência absoluta.
- **Onde**: seção 1.1, regra 2 da ordem de classificação ExpressRoute.

#### A.2 SVGs fora do `#world` causam drift no zoom

- **Sintoma**: edges desalinham dos nós ao fazer pan/zoom; visualmente as linhas "voam" em outra direção.
- **Causa**: `svgEdges` e `svgLabels` como irmãos do `#world` dentro do `#canvas`. O `transform` aplica só no `#world`, mas os SVGs ficam parados.
- **Fix correto**: SVGs ficam **DENTRO** de `#world`. Apenas UMA transform (no `#world`) — SVGs herdam.
- **Onde**: seção 2.1.

#### A.3 Nome de cliente hardcoded em strings do template

- **Sintoma**: diagrama do cliente B mostra "On-Premises (Cliente A)".
- **Causa**: strings com nome literal do cliente no template HTML/JS.
- **Fix correto**: placeholder `__CLIENT__`, substituído em `render_html()`. Ver seção 5.1.

#### A.4 Edge `onprem_mixed` duplicado

- **Sintoma**: hub com ER + VPN gera 2 edges sobrepostos; o segundo intercepta o hover do primeiro, escondendo detalhes ER.
- **Causa**: emitir `onprem_er` E `onprem_vpn` independentes para o mesmo par.
- **Fix correto**: emitir UM único edge `onprem_mixed` com todos os campos ER + VPN combinados. Ver seção 3.6.1.

#### A.5 On-Premises sobreposto a region box

- **Sintoma**: nó On-Premises aparece dentro ou em cima de uma region box no rodapé.
- **Causa**: posição Y fixa (ex: `baseY + 500`) sem considerar a altura real das region boxes.
- **Fix correto**: Fase 4 do collision avoidance — calcular `maxY = max(rb.y + rb.h)` e forçar `pos['__onprem__'].y = maxY + 80`. Ver seção 2.3.

#### A.6 Internet inflada por tráfego Inter-Region

- **Sintoma**: custo de Internet 3–5× maior que o esperado; pouco/nada de "Inter-Region" aparece.
- **Causa**: `MeterSubCategory = "Inter-Region"` agregado em `internet_egress` em vez de `interregion_egress`.
- **Fix correto**: filtrar "Inter-Region" e "Inter/Intra Continent Data Transfer" em campo separado. Ver seção 1.1, nota "Separação Bandwidth vs Inter-Region".

#### A.7 Filter count desconta agregados

- **Sintoma**: contador mostra "65/60 subs" quando há nós `__regagg_*`.
- **Causa**: `Object.keys(DATA).length` incluí nós agregados.
- **Fix correto**: `Object.keys(DATA).filter(k => !k.startsWith('__regagg_')).length`.

#### A.8 Region box não cresce ao arrastar nó para fora

- **Sintoma**: nó arrastado "escapa" visualmente do container; region box fica fixa.
- **Causa**: handler de drag não chama `recalcRBBounds()` após mover o nó.
- **Fix correto**: chamar `nodeRegion(id)` no `mousemove` do drag e atualizar `left/top/width/height` do `<div id="rb_{rk}">`. Ver seção 3.1.

#### A.9 Reconciliation interpretada erroneamente em Private Link

- **Sintoma**: agente menciona "peer externo" para Private Link com alto gap.
- **Causa**: tratar PL como bilateral. Mas PL é **unilateral** — só o dono do PE é cobrado.
- **Fix correto**: PL gera apenas verdict `INFORMATIVO`. Asimetria = padrão de workload, não peer externo.
- **Onde**: seção 1.9.1.

#### A.10 ER Gateway com SKU "Standard Gateway" não inventariado

- **Sintoma**: subscription tem custo de ER Gateway nos flows (`expressroute_gateway_cost > 0`) mas o inventário mostra `expressroute_gateway` count = 0. Chip `🔌ER GW×N` ausente do nó. `_gateway_details` não lista o recurso.
- **Causa**: pattern `RES_PATTERNS["expressroute_gateway"] = ["ergw", "expressroute gateway"]` não casa com SKUs antigos/genéricos onde `MeterName = "Standard Gateway"`, `"High Performance Gateway"` ou `"Ultra Performance Gateway"`. O acumulador de FLOW capturava corretamente (via `MeterSubCategory contém "Gateway"`), mas a detecção de resource era independente e falhava silenciosamente — o auto-mapeamento original (seção 1.4) só disparava quando AMBOS flow E resource falhavam (condição AND).
- **Caso real**: enrollment com 3 ER Gateways com SKU `Standard Gateway` em nomes ARM genéricos do tipo `<vng-hub-name>` ou `<vnet-gw-migrated-name>`.
- **Fix correto**: auto-mapeamento bilateral (seção 1.4.1) com fallback via `CATEGORY_FORCES_RESOURCE` (camada 1, determinística) e `FLOW_TO_RESOURCE` (camada 2, via flow). Alerta `[AUTO-RESOURCE]` ao final da execução sugere atualizar prompt.
- **Status atual** (v2.2): SKUs "Standard Gateway", "Ultra Performance Gateway" e "Ultra High Performance Gateway" foram adicionadas ao pattern formal de `expressroute_gateway` na seção 1.2 — essas não disparam mais o fallback. O fallback fica reservado para SKUs realmente desconhecidas que surjam no futuro.
- **Status atual** (v2.3): os mesmos patterns foram **restritos por whitelist de categoria** (`{"expressroute"}`) após bug colateral detectado pelo regression test — ver Apêndice A.11. Sem a restrição, NAT Gateway (que tem `MeterName = "Standard Gateway Hours"`) era misclassificado como ER Gateway.
- **Generalização**: esta armadilha vale para QUALQUER serviço onde o pattern de resource é mais restritivo que o flow accumulator. Em vez de corrigir caso a caso, a regra 1.4.1 cobre tudo de forma sistêmica.

#### A.11 Pattern ambíguo entre categorias causa misclassificação

- **Sintoma**: ao adicionar SKU "Standard Gateway" ao pattern de `expressroute_gateway` (sem whitelist), a contagem de **NAT Gateway** despencou em todos os 3 clientes baseline e a contagem de **ER Gateway** subiu na mesma proporção.
- **Causa**: o `MeterName` de NAT Gateway é `"Standard Gateway Hours"`. Substring `"standard gateway"` casa, e como ER Gateway aparece ANTES de NAT Gateway na ordem do `RES_PATTERNS`, o NAT é misclassificado.
- **Outros patterns ambíguos detectáveis pelo mesmo padrão**:
  - `"High Performance Gateway"` → ER **ou** VPN legado
  - `"Standard"` (sub) → praticamente todas categorias
- **Fix correto** (seção 1.2.1): trocar tupla `(rtype, patterns)` por tupla `(rtype, patterns, cat_whitelist)`. Quando whitelist é definida, o pattern só dispara se `MeterCategory` estiver na whitelist. Patterns não-ambíguos continuam com whitelist `None`.
- **Detecção automática**: o regression test (`tests/regression_test.py`) detectou os deltas em todos os clientes simultaneamente — a soma `+ER_GW ≈ −NAT_GW` é a assinatura clara de pattern ambíguo. Validação manual via test runner é o único modo confiável de pegar isso antes de quebrar produção.
- **Lição arquitetural**: substring matching simples é frágil para SKUs com nomes genéricos. Sempre que adicionar pattern, rodar regression test. Se mudar contagem de outro tipo de recurso → o pattern é ambíguo → precisa de whitelist.

#### A.12 Recurso com pattern mas sem flow accumulator (assimetria oposta)

- **Sintoma**: subscription mostra recurso correto no inventário (`public_ip` count > 0 e `_gateway_details` populado), mas o custo correspondente fica diluído em `total_net_cost` sem campo dedicado. Tooltip não mostra "🌐 Public IP R$ X" como item individual.
- **Causa**: o pattern `RES_PATTERNS["public_ip"]` casava (substring "public ip"), mas em `classify_flow()` não havia bloco específico para `MeterCategory = "Virtual Network" + MeterSubCategory = "IP Addresses"`. O `else` final retornava `None`, o cost ia para o total agregado sem categoria.
- **Caso real**: detectado em todos os 3 clientes baseline — montantes na ordem de R$ 500 a R$ 5.000/mês de Public IPs sem flow acumulator dedicado.
- **Outros casos identificados pela mesma auditoria**: Traffic Manager (sem pattern de resource), CDN data transfer (sem flow accumulator).
- **Fix correto**: lógica simétrica bilateral (seção 1.4.1, **Path D**). Se `rtype` casou mas `flow_key` é None, inferir via `RESOURCE_TO_FLOW` e logar `[AUTO-FLOW]`. Também adicionar explicitamente os patterns + flows formais (`public_ip_cost`, `traffic_manager`, `cdn_egress_gb/cost`) ao prompt.
- **Lição arquitetural**: a auditoria original do auto-mapping (v2.1) só cobria uma direção (Path B — flow OK, rtype miss). A simetria completa (Paths B + D) garante que **nenhum dos eixos pode falhar silenciosamente**.
- **Auditoria recomendada**: rodar `python _coverage_audit.py` periodicamente. Se mostrar gaps em "Flow MISS" ou "Resource MISS legítimo" (com ResourceName), aplicar Path D ou pattern formal.

#### A.13 "Basic Gateway" em Azure Bastion — confirma necessidade da whitelist (A.11)

- **Sintoma potencial**: ao adicionar SKUs genéricos como `"basic gateway"` ao pattern de `vpn_gateway` (VPN tier legado "Basic Gateway") sem whitelist, recursos do Azure Bastion seriam contados como VPN Gateway. Bastion tier Básico tem `MeterName = "Basic Gateway"` (UoM `1 Hour`) e `MeterName = "Basic Data Transfer Out"` (UoM `1 GB`).
- **Causa**: substring `"basic gateway"` colide entre `MeterCategory = "VPN Gateway"` (SKU legado VPN Basic) e `MeterCategory = "Azure Bastion"`.
- **Fix correto**: o pattern para VPN Basic Gateway DEVE ter whitelist `{"vpn gateway"}`; o pattern para Bastion (que hoje detecta apenas via `MeterCategory = "Azure Bastion"`) já é categoria-restrito por design. Validar com regression test ao mover qualquer pattern para `bastion` ou `vpn_gateway` se vier por `MeterName`.
- **Caso real**: fatura observada em campo — dezenas de linhas com `MeterCategory = "Azure Bastion"`, `MeterName = "Basic Gateway"`.
- **Lição**: qualquer adição de SKU genérico ("Basic", "Standard", "Premium", "Gateway", "Hub") a um pattern DEVE vir com whitelist de categoria. Apenas tokens muito específicos ("ErGw", "VpnGw", "Standard Hub Unit", "expressrouteports") podem ficar sem whitelist.

#### A.14 ResourceId aponta para serviço-pai (PaaS managed services) — não para componente de rede

- **Sintoma**: ao inspecionar o JSON, parece que a sub não tem Load Balancers ou DNS, mas o custo dessas categorias é alto. O `ResourceId` das linhas aponta para `Microsoft.MachineLearningServices/workspaces` ou `Microsoft.Databricks/workspaces` em vez de `microsoft.network/loadbalancers` ou `Microsoft.Network/privateDnsZones`.
- **Causa**: serviços PaaS gerenciados (AML, Databricks, AKS, Synapse) **provisionam recursos de rede internamente** (LBs, Private DNS Zones, Private Endpoints) cujo billing aparece sob o ResourceId do workspace-pai, não sob um resource de `Microsoft.Network/*` separado.
- **Caso real** (padrão observado em enrollment brasileiro):
  - `Load Balancer / Standard Data Processed` — 46.373 linhas com ResourceId em AML workspaces vs 587 em LBs reais.
  - `Azure DNS / Private Zone` — 15.777 linhas em AML workspaces (zones criadas para PE resolution).
  - `Virtual Network / Private Link Data Processed` — majoritariamente em AML/Databricks/Storage workspaces.
- **Fix correto**: não tentar "corrigir" o ResourceId. Em vez disso, expor `_consumer_breakdown` (§1.10) para que o usuário entenda que o custo de rede pertence ao serviço-pai. O tipo de recurso (`load_balancer`, `dns`, `private_link`) continua correto — é o **owner que muda**.
- **Lição**: rede em ambiente moderno (PaaS-heavy) frequentemente é cobrada via outros RPs. "Quem consome" é tão importante quanto "quanto custa".

#### A.15 `MeterRegion = "Intercontinental"` com `ResourceLocation = "brazilsouth"` não é mismatch

- **Sintoma**: ao validar consistência, parecem haver milhares de linhas com `MeterRegion != ResourceLocation`. Ex: `MeterRegion = "Intercontinental"`, `ResourceLocation = "brazilsouth"`.
- **Causa**: `MeterRegion` para `MeterCategory = "Bandwidth"` (e `Azure Front Door Service`) é o **tier de pricing** (Inter Continent, Intra Continent, Zone N), não a região do recurso. `ResourceLocation` continua sendo a região real do recurso. As duas são ortogonais.
- **Fix correto**: usar `ResourceLocation` para `region_bucket` (§1.5) e `MeterRegion` para **tier-split do pricing de bandwidth** (§1.5.1). Não tentar reconciliar.
- **Caso real** (padrão observado em enrollment grande): ordem de ~90k linhas com `MeterRegion = "Intercontinental"` e `ResourceLocation = "brazilsouth"` — representa egressess de BR para outros continentes, comportamento esperado.

#### A.16 Workload discovery NUNCA deve hardcodear nomes de produto ou cliente

- **Sintoma potencial**: extrator/gerador trata especificamente uma vendor tag (`Vendor: Databricks`, `Vendor: Snowflake`, etc.) ou um RP namespace específico com lógica de negócio em vez de classificação heurística generalizada.
- **Causa**: copy-paste de análises de clientes anteriores que mencionavam workloads por nome.
- **Fix correto** (§1.11): o pipeline classifica tag keys em categorias heurísticas (`workload_identifier`, `vendor`, `environment`, etc.) e expõe o que descobriu — nunca declara antecipadamente que "se vier produto X, faça Y". O único mapeamento "hardcoded" permitido é `RP_LABELS` em §1.14.2, que contém **somente** namespaces oficiais Azure (universal taxonomy). Para qualquer cliente cujas tags ainda não foram analisadas, o pipeline funciona sem ajuste.
- **Checklist de revisão**: ao adicionar código de análise novo, grep por nomes de empresa/produto popular (`databricks`, `snowflake`, `openai`, `salesforce`, etc.) — não pode aparecer em nenhum lugar fora de `_net_insights.json` (onde é derivado dos dados observados).

#### A.18 Tráfego per-VPN-Connection invisível em bandwidth genérico

- **Sintoma**: subscription tem VPN Gateway (`vpn_cost > 0`) e tráfego egress significativo, mas o usuário pergunta "quanto desse egress passa pela VPN vs internet pública?" e o JSON não responde — tudo está agregado em `internet_egress_*` ou `interregion_egress_*` por região, sem granularidade por connection.
- **Causa**: o classifier de `MeterCategory = "Bandwidth"` em §1.1 (anterior a v2.11) pivotava só em `MeterSubCategory`/`MeterName`. Linhas com `MeterName = "Standard Data Transfer Out"` e `ResourceId` apontando para `/providers/microsoft.network/connections/{name}` eram indistinguíveis em billing das demais linhas de egress genérico — caíam no internet_egress.
- **Padrão observado em campo**: ordem de dezenas de linhas `Bandwidth / Standard Data Transfer Out` com `ResourceId = /...providers/microsoft.network/connections/<conn-cross-cloud>`, ~R$ 90 / 210 GB egress + ~R$ 0 / 160 GB ingress (escala típica de payment engine híbrido Azure DB ↔ outra cloud via VPN S2S). Cenário oposto em enrollments com ER doméstico: zero linhas com esse padrão (ER doméstico não emite billing per-connection).
- **Fix correto** (§1.1.5 + §1.4.2): roteador especial **antes** de internet_egress/MGN/interregion. Gate: `MeterCategory == 'Bandwidth' AND UoM == '1 GB' AND ResourceId casa /microsoft.network/connections/`. Acumula em `connection_{egress,ingress}_{gb,cost}` no nível (sub, bucket) E também no `_by_connection[name]` para granularidade individual. O rtype `vpn_connection`/`er_connection` é criado via eixo ARM-path (§1.4.2) — o nome da connection vira recurso gerenciável no inventário.
- **Insight de negócio**: nome da connection e ResourceGroup (extraídos do `ResourceId`) frequentemente identificam o sistema dono e o destino remoto. Permite chargeback per-workload e detecção precoce de growth cross-cloud (custo unitário baixo — ~R$ 0,43/GB típico em regiões brasileiras — mas escala linear com volume).
- **Lição arquitetural**: billing pivotada por `MeterName` é o pivô padrão da fatura EA, mas é **incompleta**. Para serviços onde o nome do recurso é mais específico que o nome do meter (connection, virtualHub sub-resources, route_table), o eixo ARM-path (§1.4.2) é a única fonte da granularidade. Sempre que vier billing-row em `Bandwidth`/`Virtual Network` com `ResourceId` apontando para `microsoft.network/<algo específico>`, suspeitar.

#### A.17 Pareamento bipartido de peering é estimativa, não medida

- **Sintoma**: usuário confunde `matched_gb` da `_net_peering_matrix.json` com volume real medido em flow logs e usa para SLA/billing interno.
- **Causa**: o pareamento é calculado por algoritmo greedy balancing (§1.12.1) sem referência a flow logs reais.
- **Fix correto**: cada edge da matriz tem `confidence` (`high`/`medium`/`low`) e o `summary.method` declara o algoritmo. UI mostra badge "⚠ estimativa" no tooltip de cada edge no modo Pareamento (§3.14). Não usar para chargeback exato — apenas como pista de topologia.
- **Quando é confiável**: regiões onde só há 1 emitter e 1 receiver para a família (`high` confidence) — a união de pareamento é única e exata.

### Apêndice B — Glossário

| Termo | Significado |
|---|---|
| **DTO** (Data Transfer Out) | Tráfego saindo do Azure — **cobrado** por GB |
| **DTI** (Data Transfer In) | Tráfego entrando no Azure — **grátis** na maioria dos cenários |
| **Hub-Spoke** | Topologia em que VNets spoke (workloads) se conectam a uma VNet hub (com gateways e serviços compartilhados) |
| **Hub** | Subscription com ER Gateway, VPN Gateway ou Virtual WAN Hub |
| **Spoke** | Subscription comum, peerada ao hub |
| **Region Bucket** | Chave de agrupamento `__global__` / `__shared__` ou nome de região Azure direta (após cascade A1→A4) |
| **GAP_EXTERNO** | Verdict da reconciliação: ≥ 50 % de asimetria egress/ingress indica que a contraparte do peer está fora do enrollment |
| **MATCH** | Verdict da reconciliação: < 30 % de asimetria — contraparte interna |
| **PARTIAL** | Verdict da reconciliação: 30–50 % de asimetria — não conclusivo |
| **INFORMATIVO** | Verdict para tipos unilaterais (Private Link Data) — não diagnostica peer externo |
| **Bilateral** | Tipo de fluxo onde ambos os lados do link geram meters (Regional/Global Peering) |
| **Unilateral** | Apenas um lado gera meter (Private Link, ExpressRoute, Internet) |
| **`__global__`** | Bucket sintético para recursos geo-distribuídos (DNS público, Front Door, Traffic Manager, CDN) |
| **`__shared__`** | Bucket sintético de fallback quando A1–A3 falham — gera alerta no toolbar |
| **Merge Threshold** | `R$ 1.000` por padrão — buckets secundários abaixo disso (sem recurso estrutural) são fundidos no dominante |
| **Recurso estrutural** | Recursos que sempre preservam o split mesmo com custo baixo (ER GW/Circuit, VPN GW, vWAN Hub, Firewall, NAT GW, App GW) |
| **Cascade A1→A4** | Sequência de tentativas para inferir região de uma linha CSV (ResourceLocation → nome → global → shared) |
| **`onprem_mixed`** | Tipo de edge usado quando o mesmo hub tem ER E VPN — substitui os 2 edges separados |
| **Baseline / Golden Snapshot** | Métricas locked em `tests/expected.json`; qualquer diff vs baseline = regressão até prova contrária |

### Apêndice C — Como Debugar

Passo-a-passo quando o diagrama sai errado.

#### C.1 Custos visivelmente errados

1. Rodar `python <CLIENTE>_extract_network_data.py` e observar:
   - Total network cost no console
   - Alertas `[AUTO-MAPPED]` ou `⚠️ PROMPT UPDATE NEEDED`
   - Bloco RECONCILIAÇÃO (gaps esperados? inesperados?)
2. Abrir `<CLIENTE>_net_flows.json` e procurar pela sub problemática:
   - Os campos `_*_cost` somam ao `total_net_cost`?
   - Algum campo zerado que deveria ter valor?
3. Cross-check com a CSV original via PowerShell:
   ```pwsh
   Import-Csv .\Detail_*.csv |
     Where-Object { $_.SubscriptionName -eq 'X' -and $_.MeterCategory -eq 'ExpressRoute' } |
     Group-Object MeterName | Select Name, Count, @{n='Cost';e={($_.Group | Measure-Object Cost -Sum).Sum}}
   ```

#### C.2 Edges em lugares errados ou hub não detectado

1. Abrir `<CLIENTE>_net_resources.json` e ver se a sub tem `expressroute_circuit`, `expressroute_gateway`, `vpn_gateway` ou variantes vWAN com `count > 0`.
2. Se sim mas não vira hub: ver função `isHub()` no generator.
3. Edge sumindo: console do browser (DevTools) — buscar erros JS em `buildEdges()` e `renderEdges()`.

#### C.3 Diagrama vazio / nó sumido

1. DevTools → Console: erros JavaScript?
2. DevTools → Elements: `#world` tem children? Quantos `.node`?
3. `console.log(Object.keys(DATA))` no console do browser.
4. Verificar `hiddenSubs`: a sub está oculta no painel?
5. Verificar `activeFilters`: filtro AND com componentes incompatíveis?

#### C.4 Performance ruim com muitas subs

- `MAX_GLOBAL_TOP = 14`, `MAX_SPOKES_PER_REGION = 6` controlam agregação. Aumentar gradualmente.
- Edges com hit area de 24px × N nós × N hubs pode pesar. Considerar simplificar para hover-only via overlay invisível único.

#### C.5 Teste de regressão falhou

1. Ler diff exato do test runner — quais métricas mudaram.
2. Decidir natureza:
   - **Bug introduzido**: reverter ou corrigir, rodar teste de novo.
   - **Mudança intencional**: documentar o "porquê" e pedir confirmação ao usuário (ver 8.2).
3. **Nunca** rodar `--update` sem autorização.

### Apêndice D — Invariantes Bloqueadas

Decisões cuja alteração **quebra ferramentas downstream** ou **invalida análises anteriores**. Mudar qualquer destas requer aprovação explícita do usuário **e** atualização do baseline.

#### D.1 Schema de chaves JSON

Os nomes de campos em `_net_flows.json`, `_net_resources.json` e `_net_reconciliation.json` são **contrato público**. Renomear `peering_egress_gb` → `vnet_peering_egress_gb`, por exemplo, quebra todo consumidor existente. Adicionar novos campos é OK; remover ou renomear não é.

#### D.2 Thresholds da reconciliação

- `RECON_GAP_MATCH_PCT = 30.0`
- `RECON_GAP_EXTERNAL_PCT = 50.0`
- `RECON_MIN_GB = 100.0`
- `RECON_MIN_COST = 50.0`

Mudar qualquer um destes muda `verdict` retroativamente. Análises feitas em períodos anteriores podem mudar de conclusão. Requer registro no changelog.

#### D.3 Ordem da cascade A1→A4

A ordem `ResourceLocation → nome → __global__ → __shared__` é determinística. Trocar a ordem (ex: tentar nome antes de ResourceLocation) muda a atribuição de centenas de linhas.

#### D.4 Lista de tipos bilaterais para reconciliação

Apenas Regional Peering e Global Peering são bilaterais. Adicionar outros tipos como bilateral é uma decisão técnica que precisa de fundamentação (e teste).

#### D.5 Nomenclatura `[CLIENTE]_` e `__CLIENT__`

A convenção de prefixo de arquivo e placeholder no template é o que permite portabilidade entre clientes. Quebrar essa convenção (ex: nomear `flows.json` sem prefixo) força conflitos em uso multi-cliente.

#### D.6 Estrutura HTML do `#world`

`#canvas > #world > {svgEdges, svgLabels, divs}`. SVGs **dentro** do `#world`. Mudar essa estrutura quebra o sistema de pan/zoom (ver A.2).

#### D.7 Permitido vs Proibido em hardcoded strings

**Permitido** (taxonomy oficial Microsoft Azure, documentada publicamente):
- `MeterCategory`, `MeterSubCategory`, `MeterName` literais observados na fatura EA
- RP namespaces (`Microsoft.MachineLearningServices/workspaces`, etc.)
- `PartNumber` codes
- SKU names (`Standard`, `Premium`, `ErGw1AZ`, `VpnGw2`, etc.)
- Region codes (`brazilsouth`, `eastus2`, etc.) e tier names (`Intercontinental`, `Zone N`)
- Tabelas `RP_LABELS`, `PROFILE_HEURISTICS`, `DEPRECATED_SKUS`

**Proibido** (especificidade de cliente):
- Nomes próprios de empresas/clientes em código (exceto via placeholder `__CLIENT__`)
- IDs de subscription, billing account ou tenant em código
- Nomes próprios de workloads/produtos internos do cliente (ex: "sistema XPTO da empresa Y")
- Padrões de naming particulares do cliente (ex: "se a sub começa com `AZR-`, faça X")
- Valores de tags específicos do cliente em condições (ex: `if tag['Vendor'] == 'Foo'`)

Quando em dúvida: a string vem de [docs.microsoft.com](https://learn.microsoft.com)? Permitida. Vem do CMDB do cliente ou de uma fatura específica? Proibida em código — deve ser descoberta em runtime.

#### D.7.1 Hardcode-free no próprio prompt (v2.13+)

A regra D.7 **estende-se à própria documentação do prompt** — exemplos, apêndices, changelog e textos explicativos NUNCA devem referenciar:

- **Nomes próprios** de cliente (`Acme`, `EmpresaXPTO`, etc.).
- **Nomes de subscriptions** (`SUB_*`, `<Cliente>_<workload>_<env>`, etc.).
- **Nomes de recursos** (`erc-vendor-prd-regiao-NNN`, `virtualgw-infra-*`, `connection-*-prd-*`, etc.).
- **Valores monetários específicos** observados em uma fatura particular (`R$ 11.344`, `R$ 38.367`) — use ordens de grandeza (`~R$ 10K`, `dezenas de TB`) ou descreva o cenário sem o valor exato.
- **Períodos específicos** (`Raizen 2026-04`, `Petrobras 2026-03`).

**Placeholders permitidos** (use sempre que precisar exemplificar):
- `<sub-name>`, `<sub-hub>`, `<sub-spoke>`
- `<circuit-name>`, `<gateway-name>`, `<connection-name>`, `<conn-cross-cloud>`
- `<region>`, `<bucket>`
- `<CLIENTE>` ou `[CLIENTE]` em paths e templates

**Por que essa regra existe**: o prompt é portado entre clientes; referências hardcoded vazam contexto inadvertidamente (NDA breach risk), criam impressão de "lógica especializada" para clientes específicos (não é — toda lógica é client-agnostic) e envelhecem mal quando o cliente muda topologia.

**Checklist antes de cada commit do prompt**:
```bash
# Substitua a lista abaixo pelos nomes que você sabe que existem no seu ambiente:
grep -iE '(raizen|petrobras|riachuelo|renner|<outros-clientes>)|SUB_[A-Z]|TI-Infra|virtualgw-|erc-[a-z]+-|connection-infra' prompt_network_topology.md
# Resultado deve ser VAZIO. Qualquer match precisa ser sanitizado.
```

**Exceções explícitas e justificáveis** (raras):
- Tabelas "Exemplo de mapeamento" onde um nome fictício universal (`Acme`) ilustra a convenção de prefixo de arquivo (§5.0). Nesse caso, deixar claro que é fictício.
- Referências a vendor names universalmente conhecidos do ecossistema Azure (`Microsoft.Databricks`, `Megaport`, `Equinix`, `AWS`, `GCP`) — esses são nomes industry-wide, não nomes do cliente.

Qualquer outro nome próprio que apareça no diff de uma alteração do prompt deve ser rejeitado em revisão.

#### D.8 Limites epistemólogicos dos findings

Todo finding em `_net_insights.json` representa um **padrão observado**, não uma medição causal. Implicações:
- `recommendation` usa modal: "Considere", "Avaliar", "Validar", "Investigar" — nunca "Migre", "Corrija", "Substitua" como ordem.
- `estimated_savings_monthly` SEMPRE acompanhado de `confidence`. Findings com `confidence == "low"` não devem ser somados no "total economia projetada" do painel sem alerta visual.
- HTML gerado exibe **disclaimer perene** no header: "Findings são estimativas baseadas em padrões da fatura, não medições. Validar em ambiente controlado antes de executar mudanças."
- A fatura EA **não contém**: volume real de tráfego VPN, topologia exata de peering (apenas volume), latência/perda/performance, configuração de NSG/firewall rules, conteúdo do tráfego, BGP path. Findings sobre esses domínios são **inferenciais** e devem documentar o método.

#### D.9 Schemas reservados para trabalho futuro

Os seguintes nomes de arquivo estão **reservados** — não usar para outros propósitos:

| Nome reservado | Propósito futuro |
|---|---|
| `[CLIENTE]_net_trend.json` | Comparação multi-período MoM/YoY (§0.3 atualmente fora do escopo) |
| `[CLIENTE]_Network_Trend_[FROM]_[TO].html` | Visualização de tendência |
| `[CLIENTE]_net_diff.json` | Diff entre dois períodos consecutivos |
| `[CLIENTE]_net_partnumber_catalog.json` | Inventory persistente de PartNumber → meaning (§1.21) atualizável entre execuções |

Shape canonônico provisório de `_net_trend.json`:

```json
{
  "metric": "<flow_or_resource_key>",
  "by_period": [{"period": "YYYYMM", "value": <float>}],
  "delta_pct_mom": <float>, "delta_pct_yoy": <float>,
  "trend": "up|down|stable",
  "anomaly": <bool>  // 3σ vs base de 12 meses
}
```

#### D.10 Modularização futura do prompt

Quando o prompt ultrapassar 3.000 linhas, dividir em módulos:

| Arquivo | Conteúdo |
|---|---|
| `prompt_core.md` | §0 (Contrato) + §1.1–1.10 (pipeline base) + §2 (arquitetura) |
| `prompt_analytics.md` | §1.11–1.28 (análise avançada) |
| `prompt_ui.md` | §3 (interatividade) + §4 (design) |
| `prompt_ops.md` | §5 (scripts) + §6 (topologias) + §7 (checklist) + §8 (protocolo) |
| `prompt_reference.md` | Apêndices A–D + Histórico |

Entry point `prompt_network_topology.md` vira índice + Inclusion directives. **Não implementar até 3.000 linhas**.

---

## Histórico de Versões

| Versão | Data | Mudanças principais |
|---|---|---|
| 2.13 | 2026-05-25 | **Visibilidade total dos canais de egress (zero zona cinzenta)**. Antes desta versão, o card de cada sub mostrava um único chip `⬇ {gb}` somando ingenuamente `internet_egress + interregion_egress`, e um chip `⬆Peer {gb}` somando peering ingress — colapsando 9 categorias distíntas (ISP/MGN/FD/ER OUT/IRR/PEER/GPEER/CONN/PL) em apenas duas. Bandwidth via VPN connection (frequentemente R$ 10K+/mês em hubs cross-cloud) ficava invisível em qualquer superfície no nivel de card. Mudanças: (1) **Strip de egress completo** em `renderSubNode` — array `EGRESS_CHANS` itera 9 canais (`internet_egress`, `mgn_egress`, `frontdoor_classic_egress`, `frontdoor_std_egress`, `expressroute_out`, `interregion_egress`, `peering_egress`, `global_peering_egress`, `connection_egress`, `private_link_egress`) emitindo 1 chip por canal com volume auto-escalado (`fmtBytes`) quando `gb ≥ 1` OU `cost ≥ 5`. Cada chip carrega prefixo `↗` + emoji do canal + valor compacto. Cor da chip por semântica (vermelho=ISP risco; azul=ER privado; verde=peering intra; roxo=VPN connection; etc.). Tooltip mostra `qty · unit · custo`. (2) **Strip de ingress paralelo** com 5 canais (ER DTI, Peering, GPeering, PL, Conn) renderizados apenas quando `gb > 500 GB` — ingress é mais barato (frequentemente GRÁTIS), mas volumes grandes contam história operacional (ex: ER DTI típico de hub central pode chegar a centenas de TB de ingestão); chip prefixado com `↘`. (3) **Connection egress/ingress no edge ER/VPN/mixed**: custo total do edge passa a incluir `connection_egress_cost + connection_ingress_cost` (antes excluso). Tooltip ganha duas linhas novas "⬆ Conn egress {gb} · {cost}" e "⬇ Conn ingress {gb} · GRÁTIS" (ou cost se >0). Para hubs com VPN ativa o edge ER+VPN sobe substancialmente — a diferença é o tráfego efetivo pelo túnel VPN, antes invisível no edge. (4) **Conversão semântica de "egress"**: documenta que o nó Internet representa **apenas saida pública genuína** (ISP+MGN+FD); todo outro egress tem canal próprio. Regiões sem nó Internet não significam "sem tráfego de saída" — significam "sem tráfego público para ISP". O usuário vê cada canal direto no card via chips. (5) **Pre-flight check**: nenhum acumulador novo no extractor; mudança 100% no generator (UI layer). Zero regressão no dado. (6) **Sanitização**: remoção de todas as referências hardcoded de cliente/sub/recurso no próprio prompt (§D.7.1 nova regra) — exemplos passam a usar placeholders genéricos. |
| 2.12 | 2026-05-25 | **Drill-down via drawer + per-circuit ER DTO/DTI + tooltip qty+unit+cost universal + tri-state pairing + fix Internet node**. (1) **Per-circuit ER DTO/DTI (§1.1.6)**: novo accumulator `er_circuit_flow` keyed por `(sub, bucket, circuit_name)` extraído via regex no `ResourceId` dos meters `expressroute_out`/`expressroute_in`; pós-loop, merge em `_gateway_details` adicionando `dto_gb/dto_cost/dti_gb/dti_cost` por entry de circuito. Permite identificar qual circuito específico está sendo subutilizado/saturado (cenário comum em hubs com múltiplos circuitos ER: 1 único circuito absorve a maior parte da DTO faturada, outros ficam idle ou só com ingestão gratuita). Circuitos com SKU `Local Unlimited` (UoM `1/Month`) ficam corretamente sem `dto/dti` — UI exibe nota "Flat-rate (Unlimited) — sem meter por GB". (2) **Captura de horas em hourly meters**: `flows[f"{flow_key}_hours"]` populado quando `UnitOfMeasure` contém `"hour"` e **não** contém `"month"`. ER Gateway e VPN Gateway agora exibem `720 h · R$ 1.728` (= 30d × 24h) em vez de só custo. ER Circuit segue só com custo (UoM `1/Month` é mensal flat-rate, não horário). (3) **Padrão UX: hover light + click-to-drawer (§3.5)**: tooltip de sub passou de ~30 linhas para ≤7 (KPIs + top 5 recursos + findings badge + hint). Click no card abre `#subDrawer` (460px, right-side, slide-in) com 5 tabs (Overview · Recursos · Circuitos & Conexões · Fluxos · Findings & Recon). Tab "Circuitos & Conexões" é o destaque: card por entry de `_gateway_details` (com DTO/DTI per-circuit) + card por entry de `_by_connection` (com egress/ingress per-connection). Click guard via movement < 3px distingue de drag. ESC fecha drawer. (4) **Tooltip de edges padronizado (§3.6)**: toda linha agora `quantidade · unidade · custo` em vez de só custo. Internet/MGN/FD ganham GB por canal. ER OUT/IN ganham TB. ER Circuit fica só com custo (sem hours captured). Hourly infra (ER Gateway, VPN GW, vWAN Hub) ganham `X h · R$ Y`. (5) **`fmtBytes` auto-escala GB → TB → PB** (threshold 1000 decimal, conforme convenção Azure billing). `999 GB` mantém, `1000 GB → 1 TB`, `1.000.000 GB → 1 PB`. Aplica globalmente (tooltips, chips, sankey). Horas **não** escalam. (6) **Pairing tri-state (§3.14)**: botão cycla OFF → SMART → ALL → OFF. SMART = agregado por região PLUS sobrepõe pares HIGH/MEDIUM (LOW absorvido no agregado). Resolve "spaghetti" do modo ALL anterior em datasets com peering dominado por LOW. Confidence comparison normalizado com `toUpperCase()` (dados vêm em minúsculas do JSON). Legenda flutuante `#pairingLegend` aparece quando ON. (7) **Fix invariant Internet node (§3.10)**: custo no nó Internet agora **sempre** soma direto de `DATA.flows` filtrando por `_bucket === r`, NÃO via `layout[r].subs.reduce(...)`. Bug latente: quando subs caíam em `__globalagg__` (top-N) ou `__regagg_*`, sumiam do escopo do nó Internet original, mas continuavam no dado real. Em datasets com top-N agregando subs contínuas, o nó mostrava valor reduzido em modo recolhido vs expandido (chegando a variações de 7% a 30% no custo exibido) — agora sempre reflete a verdade do dado, independente de UI state. (8) **Layout dinâmico (§3.18)**: 4 novos botões na toolbar — `↹ Re-arranjar` (re-roda layout sem reset zoom), `⊞ Cols: auto/2/3/4/5` (cycla; auto escolhe por número de subs), `📦 Expandir Tudo` (flipa global + todos regionais num click), exposição explícita do `⊞ Fit` existente. `colsFor(n)` retorna 2/3/4/5 por threshold. Reduz altura de regiões grandes em até −52% (ex: região com 37 subs em layout antigo: 2.973 px → 1.433 px com 5 cols). (9) **Schema estendido**: §0.2 documenta `_hours` opcional em todos os flow keys; `_gateway_details` documenta novos campos `dto_gb/dto_cost/dti_gb/dti_cost` para `expressroute_circuit`. (10) **Zero regressão**: pipeline mantém Total net cost / # findings / # subs idênticos entre v2.11 e v2.12 — todas as adições são aditivas no dado e na UI. |
| 2.11 | 2026-05-25 | **Eixo ARM-path para mapeamento dinâmico (§1.4.2) + VPN/ER Connection split (§1.1.5)**. (1) Novo 3º eixo de detecção de recursos pivotando em `ResourceId` (regex `/providers/<rp>/<type>/<name>`), complementando os Paths A/B/C/D do §1.4.1 (que pivotam só em `MeterCategory + MeterName`). Tabela `ARM_TYPE_TO_RTYPE` mapeia 25+ tipos `microsoft.network/*` para `rtype` canônico. Tipos desconhecidos disparam alerta `[AUTO-ARM-PATH]` (mesma semântica dos demais auto-mappings). Cobre serviços cuja billing-row vem em categoria genérica (`Bandwidth`, `Virtual Network`) mas o ResourceId revela um RP-type específico — caso canônico: VPN Connection. (2) Novo classifier `connection_{egress,ingress}_{gb,cost}` + dict `_by_connection` populado por nome da connection. Gate: `Bandwidth + 1 GB UoM + ResourceId casa /microsoft.network/connections/{name}`, avaliado **antes** de internet/MGN/inter-region. (3) Novos rtypes `vpn_connection` e `er_connection` com disambiguação automática via gateways existentes na sub (§1.4.2.3); fallback `connection` genérico + log `[CONNECTION-AMBIG]`. (4) §0.2 schema estendido com `connection_*` + `_by_connection`. (5) Apêndice A.18 documenta padrão observado em enrollments com workload cross-cloud (ordem de ~R$ 90 / 210 GB egress, payment engine híbrido) vs enrollments puramente Azure-interno (zero linhas com esse padrão). (6) Checklist §7.1 ganha 4 itens (eixo ARM, connection split, by_connection populated, disambiguation). |
| 2.10 | 2026-05-25 | **Azure Firewall split infra-vs-data (§1.1)**. Bucket único `firewall_cost` substituído por `firewall_hourly_cost` (Deployment meters, R$/h fixo) + `firewall_data_gb`/`firewall_data_cost` (Data Processed, R$/GB). Permite calcular taxa efetiva real (~R$ 0,07/GB Premium em enrollments reais) sem misturar fixo + variável, e ativar detecção idle-infra com volume real de dados. Conformidade com regra geral §1.1 "serviços com Hour + GB têm acumuladores separados" — agora cobre Firewall (que estava como exceção). Mantém retrocompatibilidade via somatório no tooltip. |
| 2.9 | 2026-05-26 | **Hardening da implementação de referência** (`Petro_gen.py`) — fechamento de 6 gaps detectados em auditoria sistemática contra a especificação v2.8. Sem mudanças de spec, sem novos acumuladores, sem novos JSONs — somente conformidade do generator com regras já documentadas: (1) **§2.2.1 — hubs no fundo da região**: `buildLayout()` agora separa `hubsRow` de `spokesRows` e posiciona spokes nas rows superiores + hubs nas rows inferiores (com centralização horizontal quando hubs < cols); evita edges Hub→OnPrem cruzarem nós spoke. (2) **§2.2.6 — Global Top-14 com nó agregado real**: nova região sintética `__others__` (REGION_CFG `📦 Outros (não top-14 global)`) com um único nó `__globalagg__` consolidando subs abaixo do ranking global; botão `📦 Expandir Outros (global)` agora controla `globalExpanded` independentemente de `regionExpanded[r]`. `toggleRegionExpand` e `toggleGlobalOthers` ficam **semanticamente independentes**. (3) **§2.3 — collision avoidance 4-fase defensivo**: nova função `resolveRegionOverlap()` itera até 20 vezes empurrando regiões sobrepostas no eixo de menor overlap; Fase 4 garante On-Premises sempre abaixo de todas as regiões reais. (4) **§2.4 — recalc pós-render com `offsetHeight`**: cada `renderSubNode`/`renderAggNode` captura `ent.h = div.offsetHeight`; `recalcRBBounds(r)` agora usa `s.h || NH`; `render()` chama `recalcRBBounds` para todas regiões + `resolveRegionOverlap` + `syncDOMFromLayout` após `wireDrag`. (5) **§2.6 — z-index explícito por camada**: CSS agora declara `svg{z-index:8}`, `svg#svgLabels{z-index:20}` (labels sobre nós), `.region .rdrag{z-index:12}` (handle acima de bordas de região mas abaixo de labels). (6) **§4.5 — chip ⬆Peer DTI verde**: `renderSubNode` emite `<span class="chip g">⬆Peer Nx</span>` quando `peering_ingress_gb + global_peering_ingress_gb > 50`. Região sintética `__others__` excluída de `internetNodes` e do cálculo de `onPremPos` (não polui topologia hub-spoke real). |
| 2.8 | 2026-05-25 | **Maturidade arquitetural**: pipeline dividido em **três fases** (extract → analyze → generate, §5.0.A) permitindo re-análise sem reprocessar CSV. Novas invariantes: §D.7 (permitido vs proibido em hardcoded strings — taxonomy oficial Azure OK, especificidade de cliente proibida), §D.8 (limites epistemológicos dos findings — modal "Considere"/"Avaliar" obrigatório, disclaimer perene no HTML, declaração explícita do que a fatura EA **não contém**), §D.9 (schemas reservados para trabalho futuro: `_net_trend.json`, `_net_diff.json`, `_net_partnumber_catalog.json` com shape canonônico de trend), §D.10 (plano de modularização quando o prompt passar de 3000 linhas). Atualização operacional sem novos acumuladores ou findings. |
| 2.7 | 2026-05-25 | **Expansão para análise avançada + robustez operacional**. 11 novas seções no pipeline: (§1.18) Timeline diária + detecção de anomalias 3σ; (§1.19) Agregação por prefixo IP `/16`-`/24` via `AdditionalInfo.NodeIp` + flag `--redact-additional-info`; (§1.20) Reservation utilization audit; (§1.21) Fingerprint via `PartNumber` (resistência a renames Microsoft); (§1.22) Latency premium ratio + classificação de `traffic_profile` (long-distance+latency / latency-optimized / cost-optimized / regional); (§1.23) Detecção heurística de perfil do enrollment (`ai_ml_heavy`/`data_heavy`/`paas_heavy`/`iaas_heavy`/`storage_heavy`) via substring em **RP namespace Azure oficial** — zero referência a nome de produto vendor; (§1.23.1) DNS amplification factor; (§1.24) Deprecation audits (Basic IPs/LB/VPN GW, FD classic); (§1.25) Multi-enrollment hint; (§1.26) Sankey export para apresentações executivas; (§1.27) **Gate de integridade de custo** — reconciliação soma-de-acumuladores vs `total_net_cost` com tolerance 0.1%; (§1.28) Estimativa de bounds de dados VPN. UI: (§3.15) What-if calculator com sliders persistidos em localStorage; (§3.16) Benchmark percentile (p90+ destacado) por sub; (§3.17) "Top 3 levers" por região. Robustez §5.6: idempotência via SHA-256 do CSV, JSON Schema validation antes de escrever outputs, paralelismo `--parallel N` para CSVs grandes, verificação de integridade (count + total_cost cross-check), provênancia (wall-clock + host + flags). Invariante reforçada: tabelas `PROFILE_HEURISTICS` e `DEPRECATED_SKUS` contêm apenas referências a SKUs/RPs **oficiais Azure**, nunca nomes de cliente. |
| 2.6 | 2026-05-25 | **Camada de análise contextual data-driven** (análise de rede vai muito além de classificar custos). 7 novas seções no pipeline (todas client-agnósticas e workload-agnósticas): (§1.11) **Workload Discovery** — parser tolerante de `Tags` + classificação heurística de tag keys em `workload_identifier`/`vendor`/`environment`/`cost_center`/`platform_kind`, com Pareto 80% sobre os valores observados; (§1.12) **Matriz bipartida de peering** — algoritmo greedy balancing por região, output com `confidence`, edges `unmatched` alimentam `external_flows`; (§1.13) **10 audit findings determinísticos**: PE over-prov, LB-as-SNAT → NAT GW, MGN savings, ER circuit utilization (metered vs unlimited), DNS zones órfãs, infra idle (NAT/FW/Bastion/AGW), hairpin inter-region, Front Door classic migration, NVA marketplace inventory, reservations audit — todos com `recommendation` template-based gerado a partir dos próprios dados observados; (§1.14) **anomalias + heavy consumer + quality metrics** com tabela `RP_LABELS` contendo apenas namespaces oficiais Azure; (§1.15) **pricing efficiency** — discount drift (`EffectivePrice` vs `UnitPrice`), effective rate leaderboard, traffic symmetry per sub; (§1.16) carbon footprint opcional (flag `--with-carbon`); (§1.17) `_period_metadata.json` para comparação multi-período. Novos JSONs declarados em §0.2: `_net_workloads.json`, `_net_peering_matrix.json`, `_net_insights.json`. UI ganhou (§3.13) **Painel de Insights** lateral com filtros por categoria/severidade + botão "Localizar no diagrama"; (§3.14) **Modo Pareamento de Peering** com edges coloridos por confidence; novos badges (§4.5): heavy consumer dinâmico, traffic symmetry, contador de findings, `egress Nx`, `hub by RG`. §6.2 **tier de pricing dinâmico** — badge `💰 egress Nx` calculado das próprias taxas observadas (sem lista hardcoded de regiões caras). §6.3 explica adaptação automática ao perfil de tags do cliente. Novas armadilhas A.16 (não hardcodar nomes de produto/cliente em discovery) e A.17 (matriz bipartida é estimativa, não medida). **Invariante**: zero referência a nome de cliente ou de workload específico (ex: Databricks, AML, OpenAI) no código — tudo descoberto em runtime. |
| 2.5 | 2026-05-25 | **Enriquecimento contextual via entorno do `ResourceId`** (análise de fatura grande, ~344k linhas de rede). 15 mudanças: (1) UoM como gate primário infra-vs-data (§1.1.0) com warning `[UOM-MISMATCH]`; (2) Filtro `ChargeType = "Usage"` obrigatório com tratamento separado de `Purchase`/`Refund`/`UnusedReservation`/`Adjustment`; (3) Novo acumulador `mgn_egress_gb/cost` para `Rtn Preference: MGN` (§1.1.4) — Microsoft Global Network vs ISP routing têm pricing distintos; (4) Splits infra-vs-data: `lb_rules_cost`+`lb_data_gb/cost`, `nat_gateway_cost`+`nat_data_gb/cost`, `bastion_hourly_cost`+`bastion_egress_gb/cost`, `dns_private_zone_cost`+`dns_query_cost`, `appgw_fixed_cost`+`appgw_cu_cost`; (5) Split Front Door classic (`MeterSubCategory=""`) vs Standard/Premium (`= "Azure Front Door"`); (6) Novo rtype `expressroute_port` (ER Direct — `microsoft.network/expressroutePorts`); (7) Novo rtype `nva_marketplace` para `PublisherType != "Azure"`; (8) Convenção de hub por `ResourceGroup` (token `hub`/`network-hub`/`core-network`) com flag `_hub_by_convention` e warning `[HUB-MISMATCH]` (§1.5.0); (9) `MeterRegion` como tier de pricing de Bandwidth/FD (§1.5.1) com splits `internet_egress_isp/intra_continent/inter_continent`; (10) Novo §1.10 "Consumer Breakdown" — exporta top RPs e ConsumedServices por `(sub, bucket)` (revelou que servi\u00e7os PaaS Microsoft.MachineLearningServices/Microsoft.Databricks dominam Bandwidth+VNet+LB+DNS em enrollments AI-heavy); (11) Nova seção no tooltip dos nós (§3.5 item 7) "Top consumidores de rede"; (12) Colunas `MeterRegion`/`UnitOfMeasure`/`ChargeType`/`Frequency`/`PublisherType`/`ResourceGroup` promovidas a recomendadas (§0.1); (13) Apendêndices A.13 (Basic Gateway Bastion confirma whitelist), A.14 (ResourceId aponta para serviço-pai, não componente de rede), A.15 (`MeterRegion != ResourceLocation` não é mismatch); (14) Schema dos JSONs estendido (§0.2); (15) `expressroute_port` e `nva_marketplace` adicionados à lista de recursos estruturais no merge threshold (§1.6). Referência Microsoft Learn: [routing-preference-overview](https://learn.microsoft.com/azure/virtual-network/ip-services/routing-preference-overview). |
| 2.4 | 2026-05-22 | **Auto-mapeamento simetricamente bilateral** (seção 1.4.1 refatorada). Adicionado `RESOURCE_TO_FLOW` lookup + lógica **Path D** que dispara `[AUTO-FLOW]` quando resource pattern casa mas flow accumulator está ausente. Cobre os 4 cenários completos (flow x rtype). Adicionados acumuladores formais `public_ip_cost`, `cdn_egress_gb/cost`, `traffic_manager_cost`, `ddos_cost`, `network_watcher_cost` na seção 1.1. Pattern `traffic_manager` adicionado em RES_PATTERNS. "content delivery network" adicionado a `NET_CATS`. Resolve gap detectado por `_coverage_audit.py` em todos os 3 clientes (Public IPs R$ 7.5k/mês sem flow dedicado). Documentado em Apêndice A.12. |
| 2.3 | 2026-05-22 | Whitelist de categoria para patterns ambíguos (seção 1.2.1). `RES_PATTERNS` agora suporta tupla `(rtype, patterns, cat_whitelist)` — quando whitelist é definida, pattern só dispara se `MeterCategory` estiver nela. SKUs ambíguos de ER Gateway ("Standard Gateway", etc.) restritos a `{"expressroute"}`. Resolve bug colateral detectado pelo regression test em v2.2 (NAT Gateway misclassificado como ER porque `MeterName = "Standard Gateway Hours"` casava por substring). Documentado em Apêndice A.11. |
| 2.2 | 2026-05-22 | Promoção dos SKUs detectados pelo fallback em v2.1 para patterns formais em `RES_PATTERNS`: "Standard Gateway", "Ultra Performance Gateway", "Ultra High Performance Gateway" adicionadas ao `expressroute_gateway` (seção 1.2). Comportamento idêntico (regressión test passa 3/3), mas o alerta `[AUTO-RESOURCE]` deixa de disparar para esses casos e fica reservado para SKUs realmente novas. Nota sobre "High Performance Gateway" — ambíguo com VPN legado, mantido sob fallback. |
| 2.1 | 2026-05-22 | Auto-mapeamento bilateral (seção 1.4.1). Resource detection ganha fallback de 2 camadas: `CATEGORY_FORCES_RESOURCE` (determinístico por MeterCategory) + `FLOW_TO_RESOURCE` (via acumulador). Alerta `[AUTO-RESOURCE]` ao final. Resolve caso ER Gateway com SKU "Standard Gateway" (Apêndice A.10). Generaliza para qualquer serviço futuro. |
| 2.0 | 2026-05-22 | Refatoração estrutural completa. Adicionada seção 0 (Contrato), seção 8 (Protocolo de Mudança), 4 apêndices (Armadilhas, Glossário, Debug, Invariantes), TOC, changelog. Numeração corrigida (2.3 antes faltava; 3.6.1.1 hierarquia; 5.0.1 → 5.1; 4.6 Z-Index → 2.6). Checklist categorizado em 7 grupos. Infraestrutura de regressão (`tests/regression_test.py`) integrada. |
| 1.9 | 2026-05-22 | Adicionada seção 1.9 (Reconciliação de Tráfego Privado). Placeholder `__CLIENT__` (5.0.1). |
| 1.8 | anterior | Cascade A1→A4 de atribuição de região (1.5), merge threshold (1.6), labels de saída (1.7), regiões sintéticas (1.8). |
| 1.0–1.7 | anterior | Pipeline base, classificação de fluxos/recursos, layout hub-spoke, interatividade, design visual, edges, On-Premises, filtros, painel de subs. |
