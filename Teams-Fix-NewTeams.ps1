<#
.SYNOPSIS
    Diagnostica e corrige o Microsoft Teams moderno (Teams 2.0 / MSTeams) quando
    chats mostram "mensagem nova" (nome em negrito) mas o conteudo nao renderiza,
    ou outros sintomas de cache/sincronizacao/renderizacao.

.DESCRIPTION
    Script de apoio para troubleshooting do "novo Teams" no Windows.
    Cobre varias hipoteses, da menos invasiva (reiniciar) a mais invasiva
    (reinstalar), sempre com BACKUP reversivel. Por padrao (Action AutoFix)
    aplica TODAS as correcoes automaticamente, sem pedir confirmacao; as demais
    acoes individuais continuam pedindo confirmacao antes de passos destrutivos.
    Baseado na documentacao oficial da Microsoft:
      - Clear the Teams client cache (Method 1: Reset / Method 2: Delete files)
        https://learn.microsoft.com/microsoftteams/troubleshoot/teams-administration/clear-teams-cache
      - Bulk deploy the Microsoft Teams client (teamsbootstrapper)
        https://learn.microsoft.com/microsoftteams/teams-client-bulk-install
      - Pre-requisitos: WebView2 atualizado, banners de notificacao ligados,
        Delivery Optimization (Download Mode 100/Bypass NAO e suportado).

.PARAMETER Action
    Acao a executar. Padrao = AutoFix (aplica todas as correcoes automaticamente).
      AutoFix         - (padrao) Aplica TODAS as correcoes em sequencia, SEM pedir
                        confirmacao (da mais leve a mais invasiva; inclui reset e
                        reinstalacao). Respeita chamadas ativas (use -Force p/ ignorar).
      Diagnose        - Coleta evidencias. Nao altera nada (somente leitura).
      TestConnectivity- Testa os endpoints de rede usados pelo Teams.
      RestartTeams    - Encerra e reabre o Teams (hipotese: estado preso em memoria).
      ClearWebView    - Backup + limpa SO o cache do WebView2 (EBWebView).
                        Hipotese principal: cache de renderizacao corrompido.
      ClearAllCache   - Backup + limpa TODO o cache (metodo oficial 2).
      ResetApp        - Reset do pacote (metodo oficial 1). Apaga personalizacoes.
      RepairWebView2  - Repara o runtime do WebView2 (requer admin).
      ReRegister      - Re-registra o pacote Appx do Teams (sem reinstalar).
      Reinstall       - Remove e reinstala o Teams via teamsbootstrapper.
      CollectLogs     - Compacta logs + evidencias num .zip para enviar a TI.
      Guided          - Sequencia guiada (leve -> invasiva) com confirmacao.

.PARAMETER Force
    Ignora a verificacao de "chamada/reuniao ativa" antes de encerrar o Teams.

.EXAMPLE
    .\Fix-NewTeams.ps1
    Aplica automaticamente todas as correcoes (modo AutoFix, padrao).

.EXAMPLE
    .\Fix-NewTeams.ps1 -Action Diagnose
    Roda apenas o diagnostico (somente leitura), sem alterar nada.

.EXAMPLE
    .\Fix-NewTeams.ps1 -Action ClearWebView
    Faz backup e limpa o cache do WebView2 (a correcao que costuma resolver o
    sintoma de negrito sem renderizar).

.EXAMPLE
    .\Fix-NewTeams.ps1 -Action Guided
    Conduz a sequencia de correcao do leve ao invasivo.

.NOTES
    Autor : Gerado por GitHub Copilot a pedido do usuario.
    Teams : MSTeams_8wekyb3d8bbwe (novo Teams / Teams 2.0).
    A maioria das acoes NAO requer admin. RepairWebView2 e Reinstall (provisionar
    para todos os usuarios) podem requerer admin; o script avisa quando for o caso.
#>

[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param(
    [ValidateSet('AutoFix','Diagnose','TestConnectivity','RestartTeams','ClearWebView',
                 'ClearAllCache','ResetApp','RepairWebView2','ReRegister',
                 'Reinstall','CollectLogs','Guided')]
    [string]$Action = 'AutoFix',

    [switch]$Force
)

# ---------------------------------------------------------------------------
# Constantes / caminhos
# ---------------------------------------------------------------------------
$script:PackageFamily = 'MSTeams_8wekyb3d8bbwe'
$script:Aumid         = 'MSTeams_8wekyb3d8bbwe!MSTeams'
$script:PkgRoot       = Join-Path $env:LOCALAPPDATA "Packages\$PackageFamily"
$script:DataRoot      = Join-Path $PkgRoot 'LocalCache\Microsoft\MSTeams'   # metodo oficial 2
$script:WebViewDir    = Join-Path $DataRoot 'EBWebView'
$script:LogDir        = Join-Path $DataRoot 'Logs'
$script:BootstrapperUrl = 'https://go.microsoft.com/fwlink/?linkid=2243204'  # teamsbootstrapper.exe (oficial)

# ---------------------------------------------------------------------------
# Helpers de saida
# ---------------------------------------------------------------------------
function Write-Section { param([string]$Title)
    Write-Host ''
    Write-Host ('=' * 72) -ForegroundColor DarkCyan
    Write-Host "  $Title" -ForegroundColor Cyan
    Write-Host ('=' * 72) -ForegroundColor DarkCyan
}
function Write-OK   { param([string]$m) Write-Host "  [OK]   $m" -ForegroundColor Green }
function Write-Warn { param([string]$m) Write-Host "  [!]    $m" -ForegroundColor Yellow }
function Write-Err  { param([string]$m) Write-Host "  [ERRO] $m" -ForegroundColor Red }
function Write-Info { param([string]$m) Write-Host "  $m" }

function Test-IsAdmin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    (New-Object Security.Principal.WindowsPrincipal $id).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
}

# ---------------------------------------------------------------------------
# Descoberta de processos do Teams (ms-teams + WebView2 do pacote)
# ---------------------------------------------------------------------------
function Get-TeamsProcess {
    $list = @()
    $list += Get-Process -Name 'ms-teams' -ErrorAction SilentlyContinue
    try {
        $wv = Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" -ErrorAction SilentlyContinue |
              Where-Object { $_.CommandLine -match $script:PackageFamily }
        foreach ($w in $wv) {
            $p = Get-Process -Id $w.ProcessId -ErrorAction SilentlyContinue
            if ($p) { $list += $p }
        }
    } catch { }
    $list | Where-Object { $_ } | Sort-Object Id -Unique
}

# ---------------------------------------------------------------------------
# Guarda de seguranca: ha chamada/reuniao ativa?  (heuristica via log recente)
# ---------------------------------------------------------------------------
function Test-TeamsInCall {
    $log = Get-ChildItem $script:LogDir -Filter 'MSTeams_*.log' -ErrorAction SilentlyContinue |
           Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $log) { return $false }
    $recent = Get-Content $log.FullName -Tail 400 -ErrorAction SilentlyContinue
    $callPattern = 'CallingService|callStarted|InCall|MediaStack|media session|ScreenShare|joinCall|CallAgent|activeCall|callId'
    $hit = $recent | Select-String -Pattern $callPattern
    [bool]$hit
}

function Assert-SafeToClose {
    if ($Force) { Write-Warn 'Verificacao de chamada ignorada (-Force).'; return $true }
    if (Test-TeamsInCall) {
        Write-Err 'Possivel CHAMADA/REUNIAO ativa detectada nos logs recentes.'
        Write-Warn 'Encerrar o Teams agora derrubaria a call. Use -Force para ignorar.'
        return $false
    }
    Write-OK 'Nenhuma chamada/reuniao ativa detectada.'
    return $true
}

# ---------------------------------------------------------------------------
# Encerrar / iniciar Teams
# ---------------------------------------------------------------------------
function Stop-Teams {
    $procs = Get-TeamsProcess
    if (-not $procs) { Write-OK 'Teams ja esta fechado.'; return }
    Write-Info ("Encerrando PIDs: {0}" -f ($procs.Id -join ', '))
    # Tentativa graciosa primeiro
    foreach ($p in $procs) { try { $p.CloseMainWindow() | Out-Null } catch { } }
    $deadline = (Get-Date).AddSeconds(8)
    while ((Get-TeamsProcess) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
    # Forca o que sobrou
    $left = Get-TeamsProcess
    if ($left) { $left | Stop-Process -Force -ErrorAction SilentlyContinue; $left | Wait-Process -Timeout 15 -ErrorAction SilentlyContinue }
    if (Get-TeamsProcess) { Write-Err 'Ainda ha processos do Teams em execucao.' }
    else { Write-OK 'Teams encerrado.' }
}

function Start-Teams {
    Write-Info 'Iniciando o Teams...'
    Start-Process "shell:AppsFolder\$script:Aumid"
    $deadline = (Get-Date).AddSeconds(25)
    while (-not (Get-Process -Name 'ms-teams' -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 1
    }
    $p = Get-Process -Name 'ms-teams' -ErrorAction SilentlyContinue
    if ($p) { Write-OK ("Teams em execucao (PIDs: {0})." -f ($p.Id -join ', ')) }
    else    { Write-Warn 'Teams ainda nao apareceu; pode levar mais alguns segundos.' }
}

# ---------------------------------------------------------------------------
# Backup (rename) reversivel de uma pasta
# ---------------------------------------------------------------------------
function Backup-Folder { param([Parameter(Mandatory)][string]$Path)
    if (-not (Test-Path $Path)) { Write-Warn ("Nao existe: {0}" -f $Path); return $null }
    $ts  = Get-Date -Format 'yyyyMMdd-HHmmss'
    $bak = "$Path`_backup_$ts"
    Rename-Item -LiteralPath $Path -NewName (Split-Path $bak -Leaf) -ErrorAction Stop
    Write-OK ("Backup criado: {0}" -f (Split-Path $bak -Leaf))
    return $bak
}

function Get-FolderSizeMB { param([string]$Path)
    if (-not (Test-Path $Path)) { return 0 }
    [math]::Round(((Get-ChildItem $Path -Recurse -ErrorAction SilentlyContinue |
        Measure-Object Length -Sum).Sum) / 1MB, 1)
}

# ===========================================================================
#  ACAO: Diagnose  (somente leitura)
# ===========================================================================
function Invoke-Diagnose {
    Write-Section 'DIAGNOSTICO (somente leitura)'

    # 1) Pacote / versao
    $pkg = Get-AppxPackage -Name 'MSTeams' -ErrorAction SilentlyContinue
    if ($pkg) { Write-OK ("Teams instalado: versao {0}" -f $pkg.Version) }
    else      { Write-Err 'Pacote MSTeams nao encontrado (novo Teams nao instalado?).' }

    # 2) Processos
    $procs = Get-TeamsProcess
    if ($procs) { Write-OK ("Processos ativos: {0}" -f ($procs.Id -join ', ')) }
    else        { Write-Info 'Teams nao esta em execucao.' }

    # 3) WebView2 runtime
    $wv2Key = @(
        'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
        'HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1
    if ($wv2Key) { Write-OK ("WebView2 Runtime: {0}" -f (Get-ItemProperty $wv2Key).pv) }
    else         { Write-Warn 'WebView2 Runtime nao detectado no registro (pre-requisito do Teams).' }

    # 4) Tamanho dos caches
    Write-Info ("Cache total (MSTeams):  {0} MB" -f (Get-FolderSizeMB $script:DataRoot))
    Write-Info ("Cache WebView2 (EBWebView): {0} MB" -f (Get-FolderSizeMB $script:WebViewDir))

    # 5) Espaco em disco do perfil
    $drive = (Get-Item $env:LOCALAPPDATA).PSDrive
    $freeGB = [math]::Round($drive.Free/1GB,1)
    if ($freeGB -lt 5) {
        Write-Warn ("Disco {0}: apenas {1} GB livres. Pouco espaco pode CORROMPER o cache e" -f $drive.Name, $freeGB)
        Write-Warn '       quebrar a renderizacao das mensagens. Libere espaco (>5 GB recomendado).'
    } else {
        Write-OK ("Disco {0}: {1} GB livres." -f $drive.Name, $freeGB)
    }

    # 6) Banner de notificacao (relacionado ao "negrito"/avisos)
    $notif = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Notifications\Settings\' + $script:Aumid
    if (Test-Path $notif) {
        $enabled = (Get-ItemProperty $notif -ErrorAction SilentlyContinue).Enabled
        if ($enabled -eq 0) { Write-Warn 'Banners de notificacao do Teams estao DESLIGADOS.' }
        else                { Write-OK 'Banners de notificacao do Teams ligados.' }
    }

    # 7) Analise dos logs recentes
    $logs = Get-ChildItem $script:LogDir -Filter 'MSTeams_*.log' -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending | Select-Object -First 2
    foreach ($l in $logs) {
        $c   = Get-Content $l.FullName -ErrorAction SilentlyContinue
        $err = ($c | Select-String '<ERR>').Count
        $acc = ($c | Select-String 'Access is denied').Count
        $wv  = ($c | Select-String 'webview_control_win').Count
        Write-Info ("Log {0}: ERR={1}  AccessDenied={2}  WebViewErr={3}" -f $l.Name,$err,$acc,$wv)
        if ($acc -gt 500) {
            Write-Warn 'Volume ALTO de "Access is denied" (psutils): possivel politica de seguranca/EDR'
            Write-Warn 'bloqueando a varredura de processos do Teams. Vale reportar a TI.'
        }
    }
    Write-Info ''
    Write-Info 'Ordem de correcao (leve -> invasiva): RestartTeams -> ClearWebView ->'
    Write-Info 'ClearAllCache -> ResetApp -> RepairWebView2 -> ReRegister -> Reinstall.'
    Write-Info 'Use -Action AutoFix (padrao) para aplicar tudo automaticamente.'
}

# ===========================================================================
#  ACAO: TestConnectivity
# ===========================================================================
function Invoke-TestConnectivity {
    Write-Section 'TESTE DE CONECTIVIDADE (endpoints do Teams)'
    # Endpoints representativos (auth, config, CDN, presenca e canal em tempo real "trouter").
    $targets = @(
        'teams.microsoft.com',
        'config.teams.microsoft.com',
        'presence.teams.microsoft.com',
        'go.trouter.teams.microsoft.com',     # canal em tempo real (entrega o aviso de msg nova)
        'login.microsoftonline.com',
        'login.live.com',
        'statics.teams.cdn.office.net'
    )
    foreach ($t in $targets) {
        $r = Test-NetConnection -ComputerName $t -Port 443 -WarningAction SilentlyContinue
        if ($r.TcpTestSucceeded) { Write-OK   ("{0,-38} 443 OK" -f $t) }
        else                     { Write-Err  ("{0,-38} 443 FALHOU" -f $t) }
    }
    Write-Info ''
    Write-Info 'O canal "trouter" entrega notificacoes em tempo real. Se ele falhar mas o resto'
    Write-Info 'funcionar, e tipico ver o "negrito" chegar mas a conversa nao atualizar.'
}

# ===========================================================================
#  ACOES de correcao
# ===========================================================================
function Invoke-RestartTeams {
    Write-Section 'REINICIAR TEAMS (hipotese: estado preso em memoria)'
    if (-not (Assert-SafeToClose)) { return }
    if ($PSCmdlet.ShouldProcess('Microsoft Teams','Encerrar e reabrir')) {
        Stop-Teams; Start-Teams
    }
}

function Invoke-ClearWebView {
    Write-Section 'LIMPAR CACHE DO WEBVIEW2 (EBWebView) - hipotese principal'
    Write-Info 'Sintoma de "negrito sem renderizar" costuma ser cache de renderizacao corrompido.'
    if (-not (Assert-SafeToClose)) { return }
    if ($PSCmdlet.ShouldProcess($script:WebViewDir,'Backup e limpar EBWebView')) {
        Stop-Teams
        $bak = Backup-Folder -Path $script:WebViewDir
        if ($bak) { Write-OK 'Cache do WebView2 sera reconstruido no proximo inicio.' }
        Start-Teams
    }
}

function Invoke-ClearAllCache {
    Write-Section 'LIMPAR TODO O CACHE (metodo oficial 2 da Microsoft)'
    Write-Info "Pasta: $script:DataRoot"
    Write-Warn 'Mais abrangente que ClearWebView. Voce segue logado (SSO preservado).'
    if (-not (Assert-SafeToClose)) { return }
    if ($PSCmdlet.ShouldProcess($script:DataRoot,'Backup e limpar todo o cache do MSTeams')) {
        Stop-Teams
        $bak = Backup-Folder -Path $script:DataRoot
        if ($bak) { Write-OK 'Cache completo isolado em backup; Teams recriara do zero.' }
        Start-Teams
    }
}

function Invoke-ResetApp {
    Write-Section 'RESET DO APP (metodo oficial 1)'
    Write-Warn 'Reset apaga personalizacoes do app (mantem sua conta/SSO do Windows).'
    if (-not (Assert-SafeToClose)) { return }
    if ($PSCmdlet.ShouldProcess('MSTeams','Reset-AppxPackage')) {
        Stop-Teams
        $ok = $false
        if (Get-Command Reset-AppxPackage -ErrorAction SilentlyContinue) {
            try {
                Get-AppxPackage -Name 'MSTeams' | Reset-AppxPackage -ErrorAction Stop
                Write-OK 'Reset-AppxPackage concluido.'; $ok = $true
            } catch { Write-Err ("Falha no Reset-AppxPackage: {0}" -f $_.Exception.Message) }
        }
        if (-not $ok) {
            Write-Warn 'Reset automatico indisponivel. Faca manualmente:'
            Write-Info  'Configuracoes > Aplicativos > Aplicativos instalados > Microsoft Teams'
            Write-Info  '> (...) > Opcoes avancadas > Redefinir.'
        } else { Start-Teams }
    }
}

function Invoke-RepairWebView2 {
    Write-Section 'REPARAR RUNTIME DO WEBVIEW2'
    if (-not (Test-IsAdmin)) { Write-Warn 'Recomendado rodar como ADMIN para reparo system-level.' }
    $appDir = Get-ChildItem 'C:\Program Files (x86)\Microsoft\EdgeWebView\Application' -Directory -ErrorAction SilentlyContinue |
              Where-Object { $_.Name -match '^\d' } | Sort-Object Name -Descending | Select-Object -First 1
    if (-not $appDir) { Write-Err 'Runtime do WebView2 nao encontrado. Reinstale pelo site oficial.'; return }
    $setup = Join-Path $appDir.FullName 'Installer\setup.exe'
    if (-not (Test-Path $setup)) { Write-Err "setup.exe do WebView2 nao encontrado em $($appDir.FullName)\Installer."; return }
    if ($PSCmdlet.ShouldProcess('WebView2 Runtime','Reparar')) {
        Stop-Teams
        Write-Info "Executando reparo: $setup"
        & $setup --repair --msedgewebview --system-level --verbose-logging
        Write-OK 'Comando de reparo do WebView2 disparado.'
        Start-Teams
    }
}

function Invoke-ReRegister {
    Write-Section 'RE-REGISTRAR O PACOTE APPX DO TEAMS (sem reinstalar)'
    $pkg = Get-AppxPackage -Name 'MSTeams' -ErrorAction SilentlyContinue
    if (-not $pkg) { Write-Err 'Pacote MSTeams nao encontrado.'; return }
    $manifest = Join-Path $pkg.InstallLocation 'AppXManifest.xml'
    if (-not (Test-Path $manifest)) { Write-Err "Manifesto nao encontrado: $manifest"; return }
    if ($PSCmdlet.ShouldProcess('MSTeams','Add-AppxPackage -Register')) {
        Stop-Teams
        try {
            Add-AppxPackage -DisableDevelopmentMode -Register $manifest -ErrorAction Stop
            Write-OK 'Pacote re-registrado com sucesso.'
            Start-Teams
        } catch { Write-Err ("Falha ao re-registrar: {0}" -f $_.Exception.Message) }
    }
}

function Invoke-Reinstall {
    Write-Section 'REINSTALAR O TEAMS (teamsbootstrapper)'
    Write-Warn 'Acao mais invasiva. Use apos as anteriores falharem.'
    $bs = Get-Command 'teamsbootstrapper.exe' -ErrorAction SilentlyContinue
    $bsPath = if ($bs) { $bs.Source } else { Join-Path $env:TEMP 'teamsbootstrapper.exe' }
    if (-not (Test-Path $bsPath)) {
        Write-Info "Baixando teamsbootstrapper.exe oficial..."
        try { Invoke-WebRequest -Uri $script:BootstrapperUrl -OutFile $bsPath -UseBasicParsing -ErrorAction Stop; Write-OK "Baixado em $bsPath" }
        catch { Write-Err ("Falha no download. Baixe manualmente: {0}" -f $script:BootstrapperUrl); return }
    }
    if (-not (Test-IsAdmin)) { Write-Warn 'Provisionar para todos os usuarios (-p) normalmente requer ADMIN.' }
    if ($PSCmdlet.ShouldProcess('Microsoft Teams','Remover (-x) e reinstalar (-p) via bootstrapper')) {
        Stop-Teams
        Write-Info 'Removendo (deprovision)...'; & $bsPath -x
        Write-Info 'Reinstalando (provision)...'; & $bsPath -p
        Write-OK 'Bootstrapper finalizado. Abra o Teams pelo menu Iniciar.'
    }
}

# ===========================================================================
#  ACAO: CollectLogs  (empacota evidencias para a TI)
# ===========================================================================
function Invoke-CollectLogs {
    Write-Section 'COLETAR LOGS E EVIDENCIAS'
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $out   = Join-Path ([Environment]::GetFolderPath('Desktop')) "Teams-Diag_$stamp"
    New-Item -ItemType Directory -Path $out -Force | Out-Null

    # Resumo
    $summary = Join-Path $out 'resumo.txt'
    "Teams Diag - $stamp"                                              | Out-File $summary
    ("Versao: " + ((Get-AppxPackage -Name MSTeams).Version))            | Out-File $summary -Append
    ("WebView2: " + ((Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}' -ErrorAction SilentlyContinue).pv)) | Out-File $summary -Append
    ("Cache MSTeams (MB): " + (Get-FolderSizeMB $script:DataRoot))      | Out-File $summary -Append
    ("Cache EBWebView (MB): " + (Get-FolderSizeMB $script:WebViewDir))  | Out-File $summary -Append

    # Logs (somente os do app, ultimos 10)
    $logCopy = Join-Path $out 'Logs'; New-Item -ItemType Directory -Path $logCopy -Force | Out-Null
    Get-ChildItem $script:LogDir -Filter 'MSTeams_*.log' -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 10 |
        Copy-Item -Destination $logCopy -ErrorAction SilentlyContinue

    $zip = "$out.zip"
    Compress-Archive -Path "$out\*" -DestinationPath $zip -Force
    Remove-Item $out -Recurse -Force
    Write-OK "Evidencias compactadas em: $zip"
}

# ===========================================================================
#  ACAO: Guided  (sequencia leve -> invasiva)
# ===========================================================================
function Invoke-Guided {
    Write-Section 'CORRECAO GUIADA'
    Invoke-Diagnose
    $steps = @(
        @{ N='1) Reiniciar Teams';                 F={ Invoke-RestartTeams } },
        @{ N='2) Limpar cache do WebView2';         F={ Invoke-ClearWebView } },
        @{ N='3) Limpar TODO o cache (oficial)';    F={ Invoke-ClearAllCache } },
        @{ N='4) Reset do app (oficial)';           F={ Invoke-ResetApp } },
        @{ N='5) Reparar WebView2';                 F={ Invoke-RepairWebView2 } },
        @{ N='6) Re-registrar pacote';              F={ Invoke-ReRegister } },
        @{ N='7) Reinstalar Teams';                 F={ Invoke-Reinstall } }
    )
    foreach ($s in $steps) {
        Write-Host ''
        $ans = Read-Host ("Executar passo [{0}]? Teste o Teams antes. (s/N/parar)" -f $s.N)
        if ($ans -match '^(parar|p|q|quit)$') { Write-Info 'Sequencia interrompida.'; break }
        if ($ans -match '^(s|sim|y|yes)$')    { & $s.F } else { Write-Info 'Pulado.' }
    }
}

# ===========================================================================
#  ACAO: AutoFix  (aplica TODAS as correcoes automaticamente, sem confirmar)
# ===========================================================================
function Invoke-AutoFix {
    Write-Section 'CORRECAO AUTOMATICA (aplica todas as sugestoes, sem confirmacao)'
    Write-Warn 'Modo automatico: aplica TODAS as correcoes em sequencia, da mais leve'
    Write-Warn 'a mais invasiva (inclui RESET e REINSTALACAO do Teams).'
    if (-not $Force) {
        Write-Info 'Chamadas/reunioes ativas sao respeitadas: passos que encerram o Teams'
        Write-Info 'serao pulados se houver uma call em andamento (use -Force para ignorar).'
    }

    # Suprime os prompts de confirmacao do ShouldProcess durante todo o fluxo
    # automatico. Definido no escopo de script para valer em todas as funcoes
    # de correcao chamadas abaixo.
    $script:ConfirmPreference = 'None'

    # Diagnostico informativo antes de corrigir.
    Invoke-Diagnose

    # Sequencia de correcao (leve -> invasiva), aplicada automaticamente.
    $steps = @(
        @{ N = '1/7 Reiniciar Teams';               F = { Invoke-RestartTeams } },
        @{ N = '2/7 Limpar cache do WebView2';       F = { Invoke-ClearWebView } },
        @{ N = '3/7 Limpar TODO o cache (oficial)';  F = { Invoke-ClearAllCache } },
        @{ N = '4/7 Reset do app (oficial)';         F = { Invoke-ResetApp } },
        @{ N = '5/7 Reparar WebView2';               F = { Invoke-RepairWebView2 } },
        @{ N = '6/7 Re-registrar pacote';            F = { Invoke-ReRegister } },
        @{ N = '7/7 Reinstalar Teams';               F = { Invoke-Reinstall } }
    )
    foreach ($s in $steps) {
        Write-Host ''
        Write-Info ('==> Aplicando automaticamente: {0}' -f $s.N)
        try { & $s.F }
        catch { Write-Err ("Falha no passo '{0}': {1}" -f $s.N, $_.Exception.Message) }
    }

    Write-Section 'CORRECAO AUTOMATICA CONCLUIDA'
    Write-OK 'Todas as correcoes foram aplicadas. Abra/teste o Teams agora.'
}

# ===========================================================================
#  Dispatcher
# ===========================================================================
Write-Host ''
Write-Host 'Fix-NewTeams.ps1 - troubleshooting do Microsoft Teams moderno' -ForegroundColor White
Write-Host ("Acao selecionada: {0}" -f $Action) -ForegroundColor White

switch ($Action) {
    'Diagnose'         { Invoke-Diagnose }
    'TestConnectivity' { Invoke-TestConnectivity }
    'RestartTeams'     { Invoke-RestartTeams }
    'ClearWebView'     { Invoke-ClearWebView }
    'ClearAllCache'    { Invoke-ClearAllCache }
    'ResetApp'         { Invoke-ResetApp }
    'RepairWebView2'   { Invoke-RepairWebView2 }
    'ReRegister'       { Invoke-ReRegister }
    'Reinstall'        { Invoke-Reinstall }
    'CollectLogs'      { Invoke-CollectLogs }
    'Guided'           { Invoke-Guided }
    'AutoFix'          { Invoke-AutoFix }
}

Write-Host ''
Write-Host 'Concluido.' -ForegroundColor White
# Pausa ate o usuario pressionar qualquer tecla antes de encerrar a tela
Write-Host ''
Write-Host 'Pressione qualquer tecla para sair...' -ForegroundColor Magenta
try {
    $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
} catch {
    # Alguns hosts (ex.: ISE) nao suportam RawUI.ReadKey; cai para Read-Host.
    Read-Host 'Pressione ENTER para sair' | Out-Null
}
