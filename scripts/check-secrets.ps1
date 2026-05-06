param(
  [switch]$StagedOnly
)

$ErrorActionPreference = "Stop"

function Get-GitFiles {
  $tracked = git ls-files
  $staged = git diff --cached --name-only --diff-filter=ACMRT
  if ($StagedOnly) {
    return $staged | Sort-Object -Unique
  }
  return @($tracked + $staged) | Where-Object { $_ } | Sort-Object -Unique
}

function Test-SensitivePath([string]$Path) {
  $p = $Path -replace "\\", "/"
  return (
    $p -match '(^|/)\.env$' -or
    $p -match '(^|/)\.env\.local$' -or
    $p -match '(^|/)\.env\.production$' -or
    $p -match '(^|/)\.env\..*\.local$' -or
    $p -match '(^|/)config\.server\.js$' -or
    $p -match '(^|/)cookies\.txt$' -or
    $p -match '(^|/)_local_private(/|$)' -or
    $p -match '(^|/)(logs|backups|backup)(/|$)' -or
    $p -match '\.(sql|tar\.gz|db|db-shm|db-wal)$'
  )
}

function Test-SkipContent([string]$Path) {
  $p = $Path -replace "\\", "/"
  return (
    $p -match '(^|/)node_modules(/|$)' -or
    $p -match '(^|/)\.git(/|$)' -or
    $p -match '\.(png|jpg|jpeg|gif|webp|ico|pdf|xlsx|zip|tar\.gz|db|db-shm|db-wal)$'
  )
}

$patterns = @(
  @{ Type = "database url"; Regex = '(?i)\b(DATABASE_URL|POSTGRES_URL|POSTGRES_INTERNAL_URL)\b\s*[:=]\s*[''"]?[^''"\s]+' },
  @{ Type = "api key"; Regex = '(?i)\b([A-Z0-9_]*(API_KEY|APP_KEY|ACCESS_KEY)[A-Z0-9_]*)\b\s*[:=]\s*[''"]?[A-Za-z0-9_\-]{10,}' },
  @{ Type = "secret"; Regex = '(?i)\b([A-Z0-9_]*(SECRET|APP_SECRET|CLIENT_SECRET)[A-Z0-9_]*)\b\s*[:=]\s*[''"]?[^''"\s]{8,}' },
  @{ Type = "token"; Regex = '(?i)\b([A-Z0-9_]*(TOKEN|ACCESS_TOKEN|VERIFY_TOKEN)[A-Z0-9_]*)\b\s*[:=]\s*[''"]?[^''"\s]{8,}' },
  @{ Type = "password"; Regex = '(?i)\b(PASSWORD|PASSWD|PWD|SENHA|PGPASSWORD)\b\s*[:=]\s*[''"]?[^''"\s]{6,}' },
  @{ Type = "private key"; Regex = '-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----' }
)

$findings = New-Object System.Collections.Generic.List[object]
$files = Get-GitFiles

foreach ($file in $files) {
  try {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { continue }
    $resolvedPath = Resolve-Path -LiteralPath $file -ErrorAction Stop
  } catch {
    continue
  }

  if (Test-SensitivePath $file) {
    $findings.Add([pscustomobject]@{
      File = $file
      Line = "-"
      Type = "sensitive file is tracked/staged"
    })
  }

  if (Test-SkipContent $file) { continue }

  $item = Get-Item -LiteralPath $file -ErrorAction SilentlyContinue
  if ($null -eq $item -or $item.Length -gt 2MB) { continue }

  $lineNo = 0
  foreach ($line in [System.IO.File]::ReadLines($resolvedPath)) {
    $lineNo++
    foreach ($pattern in $patterns) {
      if ($line -match $pattern.Regex) {
        $findings.Add([pscustomobject]@{
          File = $file
          Line = $lineNo
          Type = $pattern.Type
        })
        break
      }
    }
  }
}

if ($findings.Count -gt 0) {
  Write-Host "Possible secret-safety issues found. Values are intentionally hidden."
  $findings | Sort-Object File, Line, Type | Format-Table -AutoSize
  exit 1
}

Write-Host "No obvious tracked or staged secret-safety issues found."
