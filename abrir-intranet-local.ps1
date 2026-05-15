$Url = 'http://localhost:5001/menu_produto.html#inicio'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path

$PortOpen = Get-NetTCPConnection -LocalPort 5001 -State Listen -ErrorAction SilentlyContinue
if (-not $PortOpen) {
  Write-Host 'Servidor local nao encontrado na porta 5001.'
  Write-Host 'Iniciando Intranet local...'
  Start-Process powershell -ArgumentList '-NoExit', '-Command', "cd '$Root'; npm start"
  Write-Host 'Aguardando servidor iniciar...'
  $Started = $false
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 1
    $PortOpen = Get-NetTCPConnection -LocalPort 5001 -State Listen -ErrorAction SilentlyContinue
    if ($PortOpen) {
      $Started = $true
      break
    }
  }
  if (-not $Started) {
    Write-Host ''
    Write-Host 'ERRO: O servidor nao iniciou na porta 5001.'
    Write-Host 'Veja a janela do servidor para entender o erro.'
    Read-Host 'Pressione ENTER para fechar'
    exit 1
  }
}

Write-Host "Abrindo Intranet local:"
Write-Host $Url
Start-Process $Url
