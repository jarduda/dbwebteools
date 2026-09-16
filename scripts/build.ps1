$ErrorActionPreference = 'Stop'
Set-Location "$PSScriptRoot/.."
function Run { param([string]$Exe, [string[]]$Arguments) & $Exe @Arguments; if ($LASTEXITCODE -ne 0) { throw "$Exe failed: $LASTEXITCODE" } }
Run dotnet @('restore','--locked-mode')
Run dotnet @('build','--no-restore','-c','Release','-warnaserror')
Run dotnet @('test','--no-build','-c','Release','--logger','trx','--results-directory','artifacts/test-results')
Run npm @('--prefix','frontend','ci')
Run npm @('--prefix','tests/playwright','ci')
Run npm @('--prefix','frontend','test')
Run npm @('--prefix','frontend','run','build')
Run dotnet @('publish','backend/DbWeb.Api','--no-restore','-c','Release','-o','artifacts/api')
New-Item -ItemType Directory -Force artifacts/web | Out-Null
Copy-Item frontend/dist/* artifacts/web -Recurse -Force
