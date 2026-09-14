# Changelog

## 0.4.5 — recuperação seletiva do onboarding facial

- Migração automática dos cadastros faciais iniciados nas versões que salvavam fotos em `/tmp`.
- Jobs legados `PENDING`, `PROCESSING` ou `FAILED` com evidência temporária são convertidos para `NEEDS_RETAKE`.
- A recuperação reinicia **somente a etapa das 3 fotos faciais**.
- Senha já alterada, ciência do uso biométrico e credenciais WebAuthn/passkey permanecem preservadas.
- O usuário recebe uma mensagem específica explicando que as fotos antigas expiraram por causa da atualização de armazenamento.
- O botão de retry também detecta jobs legados e encaminha para recaptura facial em vez de entrar em loop de `ENOENT`.
- Novas capturas continuam criptografadas e persistidas temporariamente no PostgreSQL até o worker concluir a análise.
- API health/version atualizada para `0.4.5`.

## 0.4.4 — Render biometric persistence fix

- Cadastro facial assíncrono não usa mais `/tmp` para fotos pendentes.
- As 3 capturas ficam temporariamente criptografadas com AES-256-GCM dentro do PostgreSQL até o worker concluir a análise.
- Sleep, restart e redeploy do Render não fazem mais o job perder as imagens.
- Fotos temporárias são removidas do banco após aprovação ou pedido de recaptura.
- O template facial aprovado permanece como embedding criptografado; a imagem bruta do onboarding não é mantida.
- Jobs antigos cujo arquivo `/tmp` já desapareceu passam para `NEEDS_RETAKE` com mensagem clara, em vez de entrar em loop de erro técnico.

# PontoProof v0.4.3

- Corrige WebAuthn no Render: RP ID e Origin são resolvidos em tempo de requisição.
- Impede `localhost` de ser usado como RP ID em produção quando `RENDER_EXTERNAL_HOSTNAME` estiver disponível.
- Mantém funcionamento local em `localhost`.
- Corrige cadastro de Windows Hello, impressão digital, Touch ID, Face ID e passkeys no domínio `*.onrender.com`.

# PontoProof v0.4.2

- Corrigido worker facial no Render/Node 22: não usa mais o subpath bloqueado `@vladmandic/human/dist/human.node-wasm.js`.
- O backend resolve a entrada pública de `@vladmandic/human`, localiza o bundle `human.node-wasm.js` pelo caminho absoluto instalado e o carrega diretamente.
- Mantido processamento facial assíncrono, WASM, três fotos, liveness, antispoof e embeddings.
- Adicionada validação explícita da existência do bundle WASM e dos modelos faciais para mensagens de erro mais claras.

# PontoProof v0.4.1

## Correção Render / worker facial

- Remove a dependência implícita de `@tensorflow/tfjs-node`, que derrubava a API no Render com `MODULE_NOT_FOUND`.
- Worker facial passa a carregar **sob demanda** o bundle `human.node-wasm`, compatível com container sem binários nativos do TensorFlow.
- Adiciona `@tensorflow/tfjs-core`, `@tensorflow/tfjs-converter` e `@tensorflow/tfjs-backend-wasm` 4.22.0.
- Falha ao inicializar o motor facial não impede mais o servidor HTTP de subir; o job fica como erro técnico e pode ser reprocessado.
- Corrige limpeza de JSON opcional do Prisma com `Prisma.DbNull`.
- Mantém o cadastro facial assíncrono: captura rápida no cliente e análise no backend.

# Changelog

## 0.4.0 - Cadastro facial assíncrono

- O primeiro cadastro facial não carrega mais IA antes de abrir a câmera.
- Captura rápida de 3 imagens: frontal, esquerda e direita.
- Fotos são criptografadas e enviadas ao backend imediatamente.
- Novo `FaceEnrollmentSubmission` persistente no PostgreSQL.
- Worker assíncrono processa qualidade, face única, liveness passivo, antispoof e embeddings.
- Validação cruzada garante que as 3 imagens pertencem à mesma identidade.
- Resultado `APPROVED`, `NEEDS_RETAKE` ou `FAILED` é consultado pelo frontend sem bloquear a tela.
- Popup informa aprovação ou quais imagens precisam ser refeitas.
- Erro técnico permite reprocessar as mesmas fotos sem obrigar nova captura.
- Fotos reprovadas são expurgadas após a decisão; fotos aprovadas viram as referências faciais ativas.
- O usuário pode cadastrar WebAuthn/passkey enquanto as fotos são processadas.
- Jobs em andamento são retomados após reinício do processo.
- Modelos Human deixaram de ser pré-carregados na tela de login/onboarding.
- A validação facial síncrona das marcações de ponto permanece separada e obrigatória.

# PontoProof v0.3.9

- Câmera biométrica abre imediatamente, sem aguardar modelos de IA.
- Modelos começam a carregar já na tela de login.
- `modelBasePath` corrigido para `/models/human/`, usando os modelos locais do próprio app.
- Cache de modelos em IndexedDB habilitado explicitamente.
- Validação de modelos desativada no cliente para reduzir o startup, sem desativar liveness/antispoof.
- Análise facial passa a usar frame interno 320x240; captura final continua em resolução maior.
- Primeiro carregamento fica oculto atrás do login/onboarding; usos seguintes aproveitam cache.

# v0.3.8

- Otimiza o início do reconhecimento facial no navegador.
- Modelos biométricos começam a carregar em segundo plano imediatamente após o login/onboarding.
- A câmera só é aberta depois que o motor facial está pronto, evitando ficar parada em “Preparando reconhecimento facial”.
- Reduz a captura padrão para 640x480/24fps, diminuindo bastante o custo da inferência local.
- Desativa somente o modelo de íris, que não é necessário para os desafios atuais (piscar, virar o rosto e mover a cabeça). Face mesh, embedding, liveness e antispoof permanecem obrigatórios.
- Adiciona cache-first dos modelos Human no Service Worker e Cache-Control de 7 dias no deploy Render.
- Exibe estado do motor facial (CARREGANDO/OTIMIZANDO/PRONTO) antes de abrir a câmera.
- Permite nova tentativa real se o carregamento dos modelos falhar.

# v0.3.7

- Render: BIOMETRIC_ENCRYPTION_KEY gerada automaticamente agora e derivada com SHA-256 quando o segredo não estiver em hex/base64 exatos.
- Mantém compatibilidade com chaves AES-256 explícitas em hex/base64.

# PontoProof v0.3.6

- Deploy de teste preparado para Render via Blueprint (`render.yaml`).
- Frontend e API agora podem rodar no mesmo domínio HTTPS usando `Dockerfile.render`.
- WebAuthn/WEB_ORIGIN podem ser derivados automaticamente de `RENDER_EXTERNAL_HOSTNAME`.
- API respeita `PORT` do provedor de hospedagem.
- Health check atualizado para v0.3.6.
- Blueprint cria serviço web e PostgreSQL gratuitos para teste.
- Evidências em filesystem continuam efêmeras no plano gratuito; produção requer persistent disk/object storage.

# v0.3.5

- Seed local agora cria 2 contas ADM, 2 contas RH e 2 contas de colaborador.
- Mantidos os logins originais como perfil 1 e adicionados `admin2@demo.com`, `rh2@demo.com` e `colaborador2@demo.com`.
- Todas as seis contas usam senha temporária `Demo@123` e entram no onboarding obrigatório de primeiro acesso.
- O papel Supervisor continua suportado pelo sistema, mas deixou de ser criado como usuário demo padrão.

# Changelog

## 0.3.3 - 2026-09-13

- Corrige o build TypeScript da rota WebAuthn: o token curto `PUNCH_BIOMETRIC` agora inclui `role` (e `employeeId`) para respeitar o contrato tipado do JWT.
- Mantém o token biométrico vinculado ao usuário, tenant e `punchChallengeId`; não altera as regras de validação da marcação.
- Atualiza banner de teste local e versão da API para 0.3.3.

## 0.3.2 - 2026-09-13

- Corrige 7 erros de TypeScript encontrados no primeiro build local da v0.3.1.
- Corrige checks de permissão com `Role[]` em ajustes, punches e segurança.
- Atualiza `AuthenticatorTransportFuture` para `AuthenticatorTransport` no SimpleWebAuthn v14.
- Expande a tipagem do JWT para o token curto `PUNCH_BIOMETRIC`, vinculado ao challenge da marcação.
- Corrige o tratamento de erro `unknown` no error handler do Fastify.
- Atualiza a versão reportada pela API para 0.3.2.
- Mantém intactas as regras de biometria facial, liveness, anti-spoof, WebAuthn, ProofScore e ledger.

## 0.3.1 - correção do teste local

- Corrige os 10 enums do `prisma/schema.prisma` para a sintaxe multilinha aceita pelo Prisma 6.19.x.
- Adiciona `npm run db:validate` antes de `prisma generate` no teste local.
- Registra aprovações `allowScripts` para Prisma/esbuild usadas no projeto, evitando os avisos de dependências pendentes do npm 11.
- Mantém todas as funcionalidades biométricas e de integridade da v0.3.0.

## 0.3.0 — 2026-09-13

### Identidade biométrica
- Foto frontal obrigatória na criação de colaborador.
- Referências FRONT/LEFT/RIGHT com revogação auditável.
- Captura de selfie em entrada, saída, intervalo, retorno, pausa e retorno.
- Detecção de exatamente um rosto, qualidade, liveness, desafio aleatório e antispoof.
- Embeddings de referência criptografados; face match calculado pelo servidor.
- Bloqueio temporário após falhas biométricas repetidas e desbloqueio administrativo auditado.

### WebAuthn
- Cadastro e revogação de biometria/passkey da plataforma.
- `userVerification: required` para prova adicional da marcação quando configurada.
- Credencial pública/counter armazenados; biometria bruta do dispositivo não é recebida.

### Proof Engine
- ProofScore normalizado por provas aplicáveis/configuradas.
- Núcleo obrigatório não pode ser desligado por Admin/RH.
- `APPROVED`, `REVIEW` e `BLOCKED`.
- Tentativa bloqueada não entra no ledger oficial.
- Offline com revisão obrigatória e teto de score quando configurado.
- Correção administrativa identificada como `AJUSTE_ADMINISTRATIVO`, sem fingir prova biométrica retroativa.

### Presença
- GPS + precisão + geocerca.
- Sinais de posição antiga, precisão inválida, velocidade extrema e deslocamento implausível.
- QR dinâmico HMAC.
- Web Bluetooth e Web NFC quando suportados.
- Presence Gateway opcional para rede local, com `worksiteId`, `gatewayId`, expiração e nonce assinados.

### Privacidade
- Aviso biométrico versionado e ciência registrada antes da marcação.
- Selfies e referências armazenadas cifradas em AES-256-GCM.
- Volume biométrico persistente separado no deploy.
- Retenção automática de selfies oficiais sem quebrar o hash do ledger.
- Retenção de tentativas bloqueadas e expurgo de referências revogadas.
- Hash de IP/User-Agent no registro de ciência, sem persistência em texto claro nesse evento.

### Gestão e revisão
- Fila de revisão com selfie da tentativa e foto-base lado a lado.
- Política de integridade configurável para camadas adicionais.
- Locais com geocerca, prefixo beacon, NFC e gateway de rede.
- Painel de colaborador mostra status facial e bloqueio biométrico.

### Operação
- `local-test.ps1` agora executa build completo antes de iniciar.
- Dockerfiles corrigidos para postinstall/modelos faciais.
- `docker-compose.prod.yml` com chaves/variáveis WebAuthn e volume biométrico.
- Serviço `apps/presence-gateway` incluído.

## 0.2.0 — 2026-09-13
- Central de gestão, motor de jornada, banco de horas, Jornada Espelho, ledger SHA-256, auditoria, idempotência offline e deploy Docker inicial.

## 0.3.4 - Primeiro acesso biométrico por usuário

- Removida a obrigação de o ADM/RH capturar a foto facial durante o cadastro do colaborador.
- Todo novo usuário recebe senha temporária e `mustChangePassword=true`.
- Primeiro login agora é bloqueado por onboarding obrigatório para ADMIN, HR, SUPERVISOR, EMPLOYEE e AUDITOR.
- Etapas obrigatórias: troca da senha temporária, ciência do aviso biométrico, cadastro facial próprio e cadastro de biometria/passkey do dispositivo via WebAuthn.
- Backend bloqueia todas as rotas operacionais enquanto o onboarding estiver incompleto; somente as rotas necessárias para concluir o primeiro acesso permanecem disponíveis.
- Cadastro facial próprio usa challenge de prova de vida, antispoof e armazenamento criptografado já existente.
- Cadastro WebAuthn usa autenticador de plataforma (Windows Hello, impressão digital, Touch ID, Face ID ou passkey compatível), sem armazenar a impressão digital bruta.
- Painel de equipe passa a exibir status de primeiro acesso, face e biometria digital.
- ADM/RH pode revogar a referência facial, mas não cadastrar o rosto em nome do usuário.
- Seed local deixa de sobrescrever a senha depois que o usuário já fez a troca no primeiro acesso.
