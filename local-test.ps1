$ErrorActionPreference = 'Stop'

function Require-Command([string]$Name, [string]$Help) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    Write-Host "ERRO: '$Name' nao foi encontrado." -ForegroundColor Red
    Write-Host $Help -ForegroundColor Yellow
    exit 1
  }
}

Write-Host ""
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host " PontoProof v0.3.8 - Teste Local Biometrico" -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host ""

Require-Command 'node' 'Instale o Node.js 22 LTS ou superior e abra um novo PowerShell.'
Require-Command 'npm' 'O npm deve vir junto com o Node.js.'
Require-Command 'docker' 'Instale e abra o Docker Desktop antes de continuar.'

$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectDir
Write-Host "Node:   $(node -v)" -ForegroundColor DarkGray
Write-Host "npm:    $(npm -v)" -ForegroundColor DarkGray
Write-Host "Docker: $(docker --version)" -ForegroundColor DarkGray
Write-Host ""

if (-not (Test-Path '.env')) {
  Copy-Item '.env.example' '.env'
  Write-Host '[1/7] .env criado a partir de .env.example' -ForegroundColor Green
} else { Write-Host '[1/7] .env ja existe' -ForegroundColor Green }
# npm workspaces executam a API/Web dentro das pastas dos pacotes; copie o env local para ambos.
Copy-Item '.env' 'apps/api/.env' -Force
Copy-Item '.env' 'apps/web/.env.local' -Force

Write-Host '[2/7] Iniciando PostgreSQL...' -ForegroundColor Cyan
docker compose up -d postgres

Write-Host '[3/7] Aguardando PostgreSQL...' -ForegroundColor Cyan
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
  docker compose exec -T postgres pg_isready -U pontoproof -d pontoproof *> $null
  if ($LASTEXITCODE -eq 0) { $ready = $true; break }
  Start-Sleep -Seconds 2
}
if (-not $ready) { throw 'PostgreSQL nao ficou pronto. Verifique: docker compose logs postgres' }
Write-Host 'PostgreSQL OK.' -ForegroundColor Green

Write-Host '[4/7] Instalando dependencias e modelos de reconhecimento facial...' -ForegroundColor Cyan
npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'npm install falhou.' }

Write-Host '[5/7] Validando Prisma e preparando banco...' -ForegroundColor Cyan
npm run db:validate
if ($LASTEXITCODE -ne 0) { throw 'prisma validate falhou.' }
npm run db:generate
if ($LASTEXITCODE -ne 0) { throw 'prisma generate falhou.' }
npx prisma db push
if ($LASTEXITCODE -ne 0) { throw 'prisma db push falhou.' }
npm run db:seed
if ($LASTEXITCODE -ne 0) { throw 'seed falhou.' }

Write-Host '[6/7] Validando build TypeScript + frontend...' -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { throw 'O build falhou. Copie o erro completo e envie no chat.' }

Write-Host ""
Write-Host 'Banco, modelos faciais e build prontos.' -ForegroundColor Green
Write-Host 'Web:    http://localhost:5173' -ForegroundColor White
Write-Host 'API:    http://localhost:3333' -ForegroundColor White
Write-Host 'Health: http://localhost:3333/health' -ForegroundColor White
Write-Host ""
Write-Host 'Logins demo: admin@demo.com | admin2@demo.com | rh@demo.com | rh2@demo.com | colaborador@demo.com | colaborador2@demo.com' -ForegroundColor Yellow
Write-Host 'Senha temporaria: Demo@123' -ForegroundColor Yellow
Write-Host 'IMPORTANTE: as contas demo nao possuem biometria pre-cadastrada.' -ForegroundColor Yellow
Write-Host 'Cada usuario deve concluir o proprio primeiro acesso: trocar senha, reconhecer o aviso, cadastrar face e biometria/passkey.' -ForegroundColor Yellow
Write-Host ""
Write-Host '[7/7] Iniciando API + frontend. Ctrl+C encerra.' -ForegroundColor Cyan
Write-Host ""
npm run dev
