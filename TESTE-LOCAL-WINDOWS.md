# Teste local no Windows

## Requisitos
- Docker Desktop aberto
- Node.js 22 LTS ou superior
- PowerShell

## Forma mais simples
Abra o PowerShell na pasta do projeto e execute:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\local-test.ps1
```

O script:
1. cria `.env` se necessario;
2. inicia PostgreSQL 16 no Docker;
3. espera o banco responder;
4. executa `npm install`;
5. gera o Prisma Client;
6. aplica o schema com `prisma db push`;
7. carrega os dados demo;
8. inicia API e frontend.

Depois acesse:
- Web: http://localhost:5173
- API: http://localhost:3333
- Health: http://localhost:3333/health

Conta principal de teste:
- `admin@demo.com`
- `admin2@demo.com`
- `rh@demo.com`
- `rh2@demo.com`
- `colaborador@demo.com`
- `colaborador2@demo.com`
- senha `Demo@123`

Para encerrar API e Web, use `Ctrl+C` no terminal.
Para parar o banco:

```powershell
.\local-stop.ps1
```

## Se o npm install falhar
Confira a internet e rode:

```powershell
npm cache verify
npm install --no-audit --no-fund
```

## Se a porta 5432 estiver ocupada
Verifique quem esta usando:

```powershell
netstat -ano | findstr :5432
```

Se voce ja tiver PostgreSQL local nessa porta, pare-o temporariamente ou altere a porta do servico `postgres` em `docker-compose.yml` e atualize `DATABASE_URL` no `.env`.


## Correção v0.3.2

O schema Prisma foi corrigido para enums multilinha. O teste local agora executa `prisma validate` antes de gerar o client.
