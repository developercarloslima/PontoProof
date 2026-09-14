# Teste local — PontoProof v0.3.8

## Requisitos
- Windows 10/11
- Node.js 22+
- Docker Desktop aberto
- Chrome ou Edge atualizado (recomendado para câmera/WebAuthn; Web NFC/Bluetooth dependem de suporte do navegador/dispositivo)

## Iniciar
No PowerShell, dentro da pasta do projeto:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\local-test.ps1
```

O script instala dependências, copia os modelos do Human para o PWA, sobe PostgreSQL, gera Prisma, executa `db push`, carrega seed e roda `npm run build` antes de iniciar o modo dev.

## Acessos
- Web: http://localhost:5173
- API: http://localhost:3333
- Health: http://localhost:3333/health
- Admin 1: `admin@demo.com` / `Demo@123`
- Admin 2: `admin2@demo.com` / `Demo@123`
- RH 1: `rh@demo.com` / `Demo@123`
- RH 2: `rh2@demo.com` / `Demo@123`
- Colaborador 1: `colaborador@demo.com` / `Demo@123`
- Colaborador 2: `colaborador2@demo.com` / `Demo@123`

## Primeiro teste biométrico
O seed não inventa uma face real. Para testar corretamente, entre com qualquer uma das seis contas demo e conclua o onboarding obrigatório do próprio usuário:
1. trocar a senha temporária;
2. reconhecer o aviso biométrico;
3. cadastrar a própria leitura facial com liveness/antispoof;
4. cadastrar a biometria/passkey do dispositivo via WebAuthn;
5. somente depois acessar as funções liberadas para o perfil;
6. no perfil colaborador, registrar ponto > Iniciar jornada e cumprir a ação aleatória solicitada pela câmera.

## Integridade máxima
100/100 significa: todas as provas aplicáveis/configuradas para o modo web foram satisfeitas. Não significa fraude matematicamente impossível. Recursos exclusivos de attestation nativa (Play Integrity/App Attest, root/jailbreak) ficam explicitamente indisponíveis no PWA e não são simulados.

## Offline
Offline é permitido somente se a política permitir. O payload + selfie ficam criptografados no IndexedDB e, ao sincronizar, a marcação entra em revisão; offline não recebe integridade máxima automática.

## Parar
`Ctrl+C` e depois:

```powershell
.\local-stop.ps1
```


## Correção v0.3.2

O schema Prisma foi corrigido para enums multilinha. O teste local agora executa `prisma validate` antes de gerar o client.


## Correção v0.3.3

Se a v0.3.2 anterior parar no build da API com `Property role is missing` em `security.ts`, use esta versão. O token curto `PUNCH_BIOMETRIC` agora inclui o `role` exigido pela tipagem JWT e continua vinculado ao challenge da marcação.

## Fluxo novo da v0.3.4
Ao entrar com uma conta ainda não configurada (ex.: `colaborador@demo.com` / `Demo@123` em um banco novo), o sistema não abre o painel imediatamente. Ele exige, nesta ordem: troca da senha temporária, ciência do aviso biométrico, leitura facial e cadastro de biometria/passkey do dispositivo. Depois disso o painel é liberado.
