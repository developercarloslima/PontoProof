# PontoProof v0.3.4 — Primeiro acesso biométrico

**Sistema operacional de jornada com prova digital de identidade, presença e integridade.**

A v0.3 transforma a marcação em uma cerimônia verificável: o colaborador inicia/encerra jornada, intervalo ou pausa, realiza selfie ao vivo com desafio aleatório, o servidor compara o rosto com as referências cadastradas, cruza as provas de presença configuradas e só então grava o evento no ledger encadeado por hash.

> **Status:** MVP avançado para teste/piloto controlado. Não declare este projeto como REP-P homologado/pronto para produção trabalhista sem completar AFD/AEJ, requisitos formais aplicáveis, testes de segurança, revisão jurídica/LGPD e validação operacional.

## Regras obrigatórias da v0.3

Estas camadas não podem ser desligadas pelo Admin/RH:
- selfie em toda marcação;
- exatamente um rosto;
- cadastro facial prévio;
- face match no servidor;
- liveness + ação guiada;
- antispoof;
- bloqueio quando o núcleo biométrico falha;
- registro da tentativa bloqueada sem transformá-la em ponto;
- ledger imutável para marcações aceitas/revisadas.

Eventos cobertos: `CLOCK_IN`, `BREAK_START`, `BREAK_END`, `PAUSE_START`, `PAUSE_END`, `CLOCK_OUT`.

## Cadastro do colaborador

Admin/RH não consegue criar um colaborador sem uma captura facial frontal válida. Depois do cadastro é possível adicionar esquerda e direita. A captura valida qualidade, liveness, antispoof e gesto guiado; o servidor guarda a imagem e o embedding criptografados. Trocas revogam a referência anterior e geram auditoria.

## Marcação

1. Sessão autenticada e colaborador ativo.
2. Ciência do aviso biométrico vigente.
3. Challenge/nonce único e expiração curta quando online.
4. Câmera frontal e ação aleatória: piscar/virar/olhar para cima ou baixo.
5. Exatamente um rosto, qualidade mínima, liveness e antispoof.
6. Face match calculado no servidor contra embeddings criptografados que não são devolvidos ao colaborador.
7. GPS/precisão/geocerca e telemetria de plausibilidade.
8. Dispositivo lógico e, se exigido, dispositivo previamente confiável.
9. Opcionalmente WebAuthn com Windows Hello/Touch ID/Face ID/passkey, QR dinâmico, gateway de rede local, Bluetooth beacon e NFC.
10. ProofScore explicável + decisão `APPROVED`, `REVIEW` ou `BLOCKED`.
11. Marcações aceitas/revisadas entram no ledger SHA-256 encadeado; tentativa bloqueada fica em trilha separada.

## ProofScore

`100/100 — INTEGRIDADE_MÁXIMA` significa que **todas as provas aplicáveis/configuradas para o modo web foram satisfeitas**. Não significa fraude matematicamente impossível.

O PWA não finge possuir capacidades nativas. Play Integrity/App Attest, detecção forte de root/jailbreak e leitura confiável de SSID ficam explicitamente fora do modo web. Em compensação, esta versão usa HTTPS/localhost, WebAuthn, biometria facial, liveness, antispoof, geolocalização, challenge, provas ambientais e ledger.

## Proteções extras

- bloqueio biométrico temporário após N falhas consecutivas;
- alerta para RH quando o bloqueio é acionado;
- plausibilidade de deslocamento entre marcações;
- sinalização de GPS com precisão inválida, posição antiga ou velocidade reportada extrema;
- `clientEventId` idempotente;
- fila offline cifrada em IndexedDB com chave não extraível;
- offline nunca recebe integridade máxima automática e vai para revisão quando configurado;
- selfies armazenadas cifradas em AES-256-GCM;
- retenção automática de selfie, tentativas bloqueadas e referências faciais revogadas;
- expurgo de selfie oficial sem alterar campos que participam do hash do ledger;
- dados de auditoria de IP/User-Agent armazenados somente como hash quando usados no aviso biométrico;
- imagens biométricas disponíveis somente para Admin/RH nos fluxos de revisão.

## Provas ambientais opcionais

### QR dinâmico
Admin/RH gera um QR HMAC de curta duração por unidade. O token contém unidade, expiração e nonce.

### Gateway da rede local
`apps/presence-gateway` é um serviço opcional que roda dentro da LAN/VLAN da unidade e emite token HMAC de 60 segundos contendo `worksiteId` + `gatewayId`. Use HTTPS/reverse proxy local em produção.

### Bluetooth/NFC
Podem ser exigidos por política quando navegador e dispositivo suportarem. São sinais complementares, não substituem o núcleo facial.

## Biometria do dispositivo

WebAuthn usa o autenticador da plataforma (por exemplo, Windows Hello, Touch ID ou Face ID) com verificação do usuário. O PontoProof armazena a chave pública/contador da credencial, não a impressão digital bruta.

## Privacidade

Antes da primeira marcação o colaborador precisa reconhecer o aviso de tratamento biométrico vigente. O sistema registra versão + hash do aviso + data/hora. Isso é evidência de ciência do produto e **não substitui a definição da base legal e demais obrigações da organização**.

## Stack

- Web/PWA: React 19 + TypeScript + Vite
- ML facial web: `@vladmandic/human`
- WebAuthn: `@simplewebauthn/browser` + `@simplewebauthn/server`
- API: Fastify + TypeScript
- Banco: PostgreSQL 16 + Prisma
- Integridade: SHA-256 + payload canônico + advisory lock PostgreSQL
- Biometria em repouso: AES-256-GCM
- Deploy: Docker Compose + Nginx

## Teste local no Windows

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\local-test.ps1
```

O script executa `npm install`, copia os modelos faciais para o PWA, sobe PostgreSQL, gera Prisma, faz `db push`, seed e **executa o build completo antes de iniciar**.

Acesse:
- Web: `http://localhost:5173`
- API: `http://localhost:3333`
- Health: `http://localhost:3333/health`

Contas demo: `admin@demo.com`, `admin2@demo.com`, `rh@demo.com`, `rh2@demo.com`, `colaborador@demo.com`, `colaborador2@demo.com` — senha temporária `Demo@123`.

O seed não cria rosto fictício. Cada conta faz o próprio onboarding no primeiro login: troca a senha temporária, reconhece o aviso biométrico, cadastra a própria leitura facial e registra a biometria/passkey do dispositivo.

Veja `TESTE-LOCAL-V0.3.md` e `docs/QA_V0.3.md`.

## Deploy

Produção exige HTTPS para câmera/WebAuthn e uma chave própria `BIOMETRIC_ENCRYPTION_KEY`. O `docker-compose.prod.yml` usa volume persistente separado para evidências biométricas.

```bash
cp .env.production.example .env.production
# configure os segredos/domínio
set -a
. ./.env.production
set +a
./deploy/first-deploy.sh
```

> O deploy de teste ainda usa `prisma db push`. Antes de produção formal, gere migrations versionadas e troque o fluxo para `prisma migrate deploy`.

## Documentação

- `docs/IMPLEMENTED_V0.3.md`: matriz dos 20 pontos + etapas A/B.
- `docs/SECURITY_BIOMETRICS.md`: modelo de segurança e limitações honestas do PWA.
- `docs/QA_V0.3.md`: roteiro de teste funcional/antifraude.
- `docs/VALIDATION_V0.3.md`: validações executadas nesta entrega.
- `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/COMPLIANCE.md`: documentação anterior + base arquitetural.


## Correção v0.3.2

O schema Prisma foi corrigido para enums multilinha. O teste local agora executa `prisma validate` antes de gerar o client.

## Primeiro acesso obrigatório (v0.3.4)
O ADM/RH cria a conta com uma senha temporária, mas não cadastra a foto do usuário. No primeiro login, qualquer perfil (Administrador, RH, Supervisor, Auditor ou Colaborador) precisa concluir: (1) troca de senha, (2) ciência do aviso biométrico, (3) leitura facial própria com prova de vida/antispoof e (4) biometria/passkey do dispositivo via WebAuthn. Enquanto o onboarding estiver incompleto, as rotas operacionais ficam bloqueadas no backend.


## Contas demo v0.3.5

Para testes locais, o seed cria seis contas ativas, todas com senha temporária `Demo@123` e onboarding obrigatório no primeiro acesso:

| Perfil | Login 1 | Login 2 |
|---|---|---|
| ADM | `admin@demo.com` | `admin2@demo.com` |
| RH | `rh@demo.com` | `rh2@demo.com` |
| Colaborador | `colaborador@demo.com` | `colaborador2@demo.com` |

O papel Supervisor continua disponível no produto, mas não é criado como conta demo neste seed.
