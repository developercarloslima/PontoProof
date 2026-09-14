$ErrorActionPreference = 'Stop'
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectDir

Write-Host 'Encerrando o PostgreSQL local do PontoProof...' -ForegroundColor Cyan
docker compose down
Write-Host 'Concluido.' -ForegroundColor Green
