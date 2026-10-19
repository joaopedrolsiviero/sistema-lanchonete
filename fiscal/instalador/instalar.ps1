# =====================================================================================
#  Instalador / atualizador do Emissor NFC-e do Recanto do Café (Windows 10/11, 64 bits)
#
#  Como usar: abra o PowerShell (menu Iniciar → digite "PowerShell") e cole:
#     irm https://raw.githubusercontent.com/joaopedrolsiviero/sistema-lanchonete/main/fiscal/instalador/instalar.ps1 | iex
#
#  O que ele faz:
#   - instala o PHP (portátil) e o programa do emissor em C:\RecantoFiscal
#   - na primeira vez, cria C:\RecantoFiscal\config.json com um token aleatório e abre no Bloco de Notas
#   - faz o emissor iniciar sozinho quando o Windows liga e cria atalhos na Área de Trabalho
#  Rodar de novo ATUALIZA o programa sem mexer em config.json, certificado, notas ou XMLs.
# =====================================================================================

& {   # tudo dentro de um bloco: não altera as configurações da janela do PowerShell
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # deixa os downloads muito mais rápidos
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Pasta     = 'C:\RecantoFiscal'
$PastaPhp  = Join-Path $Pasta 'php'
$PastaApp  = Join-Path $Pasta 'app'
$Config    = Join-Path $Pasta 'config.json'
$Repo      = 'joaopedrolsiviero/sistema-lanchonete'
$Porta     = 8765
$PhpZipUrl = 'https://windows.php.net/downloads/releases/latest/php-8.3-nts-Win32-vs16-x64-latest.zip'
$VcRedist  = 'https://aka.ms/vs/17/release/vc_redist.x64.exe'
$Composer  = 'https://getcomposer.org/download/latest-stable/composer.phar'
$Temp      = Join-Path $env:TEMP ("recanto-fiscal-" + [guid]::NewGuid().ToString('N'))

function Passo($texto) { Write-Host "`n==> $texto" -ForegroundColor Cyan }
function Ok($texto)    { Write-Host "    $texto" -ForegroundColor Green }
function Aviso($texto) { Write-Host "    $texto" -ForegroundColor Yellow }
function Baixar($url, $destino) {
    try { Invoke-WebRequest -Uri $url -OutFile $destino -UseBasicParsing }
    catch { throw "Não foi possível baixar $url. Confira a internet e tente de novo. ($($_.Exception.Message))" }
}
function GravarUtf8($caminho, $texto) {
    # UTF-8 sem BOM (o PowerShell 5 grava com BOM por padrão)
    [IO.File]::WriteAllText($caminho, $texto, (New-Object Text.UTF8Encoding $false))
}
function Aspas($texto) { '"' + $texto + '"' }
function Executar($programa, $argumentos, $pasta = $Pasta, $saida = $null) {
    # Roda programas externos com Start-Process, e não com "& programa": no PowerShell 5 do Windows,
    # o "&" tira as aspas dos argumentos e transforma qualquer texto do programa em stderr num erro fatal.
    $opcoes = @{ FilePath = $programa; ArgumentList = $argumentos; WorkingDirectory = $pasta
                 NoNewWindow = $true; Wait = $true; PassThru = $true }
    if ($saida) { $opcoes.RedirectStandardOutput = $saida; $opcoes.RedirectStandardError = "$saida.err" }
    $p = Start-Process @opcoes
    return $p.ExitCode
}

try {
    if (-not [Environment]::Is64BitOperatingSystem) { throw 'Este instalador precisa do Windows 64 bits.' }
    New-Item -ItemType Directory -Force -Path $Pasta, $Temp, (Join-Path $Pasta 'dados') | Out-Null

    # ---------------------------------------------------------------- para o emissor se já estiver rodando
    Get-Process -Name 'php-win', 'php' -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -like "$PastaPhp*" } | Stop-Process -Force -ErrorAction SilentlyContinue

    # ---------------------------------------------------------------- PHP
    Passo 'Instalando o PHP...'
    $zipPhp = Join-Path $Temp 'php.zip'
    Baixar $PhpZipUrl $zipPhp
    if (Test-Path $PastaPhp) { Remove-Item -Recurse -Force $PastaPhp }
    Expand-Archive -Path $zipPhp -DestinationPath $PastaPhp -Force

    $ini = Get-Content (Join-Path $PastaPhp 'php.ini-production') -Raw
    $ini = $ini -replace '(?m)^;\s*extension_dir\s*=\s*"ext"', 'extension_dir = "ext"'
    foreach ($ext in 'curl', 'fileinfo', 'mbstring', 'openssl', 'pdo_sqlite', 'soap', 'sqlite3', 'zip') {
        $ini = $ini -replace "(?m)^;extension=$ext\s*$", "extension=$ext"
    }
    $ini = $ini -replace '(?m)^;date\.timezone\s*=.*$', 'date.timezone = America/Sao_Paulo'
    $ini = $ini -replace '(?m)^memory_limit\s*=.*$', 'memory_limit = 512M'
    GravarUtf8 (Join-Path $PastaPhp 'php.ini') $ini
    $php = Join-Path $PastaPhp 'php.exe'

    # O PHP para Windows precisa do "Visual C++ Redistributable" 2015-2022 (x64). Confere no registro ANTES de
    # rodar o PHP (sem ele, o Windows mostraria uma janela de erro que trava o instalador).
    $vcChave = 'HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64'
    $vcInfo = Get-ItemProperty -Path $vcChave -ErrorAction SilentlyContinue
    if (-not $vcInfo -or $vcInfo.Installed -ne 1 -or $vcInfo.Minor -lt 29) {
        Aviso 'Instalando o Microsoft Visual C++ (o Windows vai pedir permissão de administrador)...'
        $vc = Join-Path $Temp 'vc_redist.x64.exe'
        Baixar $VcRedist $vc
        Start-Process -FilePath $vc -ArgumentList '/install', '/quiet', '/norestart' -Verb RunAs -Wait
    }
    $verificar = Join-Path $Temp 'verificar.php'
    GravarUtf8 $verificar @'
<?php
$faltando = array_filter(['curl', 'openssl', 'pdo_sqlite', 'soap', 'zip', 'dom', 'mbstring'], fn($e) => !extension_loaded($e));
echo $faltando ? 'Extensões do PHP faltando: ' . implode(', ', $faltando) : 'PHP ' . PHP_VERSION . ' instalado.';
exit($faltando ? 2 : 0);
'@
    $resultado = Join-Path $Temp 'verificar.txt'
    $codigo = Executar $php @((Aspas $verificar)) $Temp $resultado
    $texto = if (Test-Path $resultado) { (Get-Content $resultado -Raw -Encoding UTF8) } else { '' }
    if ($codigo -eq 2) { throw $texto }
    if ($codigo -ne 0) { throw 'O PHP não conseguiu iniciar. Reinicie o computador e rode o instalador de novo.' }
    Ok $texto

    # ---------------------------------------------------------------- programa do emissor
    Passo 'Baixando o programa do emissor...'
    $zipApp = Join-Path $Temp 'app.zip'
    Baixar "https://codeload.github.com/$Repo/zip/refs/heads/main" $zipApp
    Expand-Archive -Path $zipApp -DestinationPath (Join-Path $Temp 'app') -Force
    $origem = Get-ChildItem (Join-Path $Temp 'app') -Directory | Select-Object -First 1
    $origemFiscal = Join-Path $origem.FullName 'fiscal'
    if (-not (Test-Path (Join-Path $origemFiscal 'public\index.php'))) { throw 'O pacote baixado não tem a pasta "fiscal".' }
    if (Test-Path $PastaApp) { Remove-Item -Recurse -Force $PastaApp }
    Copy-Item -Recurse -Path $origemFiscal -Destination $PastaApp

    Passo 'Instalando as bibliotecas (sped-nfe)...'
    $composerPhar = Join-Path $Temp 'composer.phar'
    Baixar $Composer $composerPhar
    $codigo = Executar $php @((Aspas $composerPhar), 'install', '--no-dev', '--no-interaction', '--no-progress',
                              '--optimize-autoloader') $PastaApp
    if ($codigo -ne 0) { throw 'Falha ao instalar as bibliotecas com o Composer.' }
    Ok 'Programa instalado.'

    # ---------------------------------------------------------------- configuração (só na primeira vez)
    $primeiraVez = -not (Test-Path $Config)
    if ($primeiraVez) {
        Passo 'Criando a configuração...'
        $bytes = New-Object byte[] 32
        [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
        $token = ([BitConverter]::ToString($bytes) -replace '-', '').ToLower()
        $pastaXml = if ($env:OneDrive) { Join-Path $env:OneDrive 'Recanto do Cafe\NFC-e' } else { Join-Path $Pasta 'xml' }
        $c = Get-Content (Join-Path $PastaApp 'config\config.exemplo.json') -Raw | ConvertFrom-Json
        $c.token = $token
        $c.certificado.arquivo = ($Pasta + '\certificado.pfx') -replace '\\', '/'
        $c.pastaXml = $pastaXml -replace '\\', '/'
        $c.pastaDados = ($Pasta + '\dados') -replace '\\', '/'
        GravarUtf8 $Config ($c | ConvertTo-Json -Depth 10)
        Ok "Configuração criada em $Config"
    }

    # Só o usuário atual (e o sistema) podem ler a pasta: ela guarda a senha do certificado.
    # SIDs fixos (*S-1-5-18 = Sistema, *S-1-5-32-544 = Administradores) funcionam em Windows de qualquer idioma.
    $usuario = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $codigo = Executar 'icacls.exe' @((Aspas $Pasta), '/inheritance:r', '/grant:r', "*$($usuario):(OI)(CI)F",
                                      '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F') $Pasta (Join-Path $Temp 'icacls.txt')
    if ($codigo -ne 0) { Aviso 'Não foi possível restringir as permissões da pasta (o emissor funciona mesmo assim).' }

    # ---------------------------------------------------------------- iniciar com o Windows + atalhos
    Passo 'Iniciando o emissor...'
    $argumentos = "-S 127.0.0.1:$Porta public\index.php"
    function Respondendo {
        try { Invoke-WebRequest -Uri "http://127.0.0.1:$Porta/" -UseBasicParsing -TimeoutSec 5 | Out-Null; return $true }
        catch { return [bool]$_.Exception.Response }   # qualquer resposta HTTP (até 401/404) = servidor no ar
    }
    # Preferência: php-win.exe (roda sem janela). Se não funcionar, usa php.exe com a janela minimizada.
    $executavel = Join-Path $PastaPhp 'php-win.exe'
    $estiloJanela = 1
    Start-Process -FilePath $executavel -ArgumentList $argumentos -WorkingDirectory $PastaApp -WindowStyle Hidden
    Start-Sleep -Seconds 2
    if (-not (Respondendo)) {
        Get-Process -Name 'php-win' -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$PastaPhp*" } | Stop-Process -Force
        $executavel = $php
        $estiloJanela = 7   # minimizada
        Start-Process -FilePath $executavel -ArgumentList $argumentos -WorkingDirectory $PastaApp -WindowStyle Minimized
        Start-Sleep -Seconds 2
        if (-not (Respondendo)) { throw "O emissor não iniciou na porta $Porta. Outra aplicação pode estar usando essa porta." }
    }
    Ok 'Emissor no ar.'

    Passo 'Configurando para iniciar com o Windows...'
    $shell = New-Object -ComObject WScript.Shell
    $atalhos = @(
        @{ Caminho = Join-Path ([Environment]::GetFolderPath('Startup')) 'Emissor NFC-e.lnk'; Nome = 'inicialização' },
        @{ Caminho = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Iniciar Emissor NFC-e.lnk'; Nome = 'Área de Trabalho' }
    )
    foreach ($a in $atalhos) {
        $lnk = $shell.CreateShortcut($a.Caminho)
        $lnk.TargetPath = $executavel
        $lnk.Arguments = $argumentos
        $lnk.WorkingDirectory = $PastaApp
        $lnk.WindowStyle = $estiloJanela
        $lnk.Description = 'Emissor de NFC-e do Recanto do Café'
        $lnk.Save()
    }
    $lnk = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Configuração do Emissor NFC-e.lnk'))
    $lnk.TargetPath = 'notepad.exe'
    $lnk.Arguments = "`"$Config`""
    $lnk.Save()
    Ok 'Atalhos criados.'

    $token = (Get-Content $Config -Raw | ConvertFrom-Json).token
    try {
        $s = Invoke-RestMethod -Uri "http://127.0.0.1:$Porta/situacao" -Headers @{ 'X-Token' = $token } -TimeoutSec 15
        Ok "Emissor funcionando: ambiente $($s.ambiente), certificado de $($s.certificado.titular), válido até $($s.certificado.validoAte)."
    } catch {
        $msg = $_.ErrorDetails.Message
        if ($msg) { try { $msg = ($msg | ConvertFrom-Json).erro } catch {} } else { $msg = $_.Exception.Message }
        Aviso "O emissor está rodando, mas ainda não está pronto: $msg"
    }

    Write-Host ''
    Write-Host '=================================================================' -ForegroundColor Green
    if ($primeiraVez) {
        Write-Host ' Instalação concluída. Próximos passos:' -ForegroundColor Green
        Write-Host "  1. Copie o certificado A1 para $Pasta\certificado.pfx"
        Write-Host "  2. Preencha $Config (vai abrir no Bloco de Notas agora)"
        Write-Host '  3. Clique duas vezes em "Iniciar Emissor NFC-e" na Área de Trabalho'
        Write-Host '  4. No caixa: Ajustes > Nota fiscal > cole o token abaixo e clique em Testar conexão'
        Write-Host ''
        Write-Host "  TOKEN: $token" -ForegroundColor Yellow
        Start-Process notepad.exe -ArgumentList "`"$Config`""
    } else {
        Write-Host ' Emissor atualizado. Sua configuração, certificado e notas foram mantidos.' -ForegroundColor Green
    }
    Write-Host '=================================================================' -ForegroundColor Green
}
catch {
    Write-Host "`nERRO: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'Nada foi apagado da sua configuração. Corrija o problema e rode o instalador de novo.' -ForegroundColor Red
}
finally {
    Remove-Item -Recurse -Force $Temp -ErrorAction SilentlyContinue
}
}
