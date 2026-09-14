# QA v0.3 — biometria e integridade

## Smoke
- `npm install`
- `npm run db:generate`
- `npx prisma db push`
- `npm run db:seed`
- `npm run build`
- `npm run dev`
- `/health` retorna `version: 0.3.8`

## Cadastro
1. Tentar criar colaborador sem captura facial → deve falhar.
2. Capturar frontal válida → cria usuário/employee/ref e status ACTIVE se mínimo=1.
3. Capturar LEFT/RIGHT → referências aparecem ativas.
4. Recapturar FRONT → antiga fica revogada; auditoria registra troca.
5. Resetar face → colaborador não consegue iniciar novo challenge de ponto.

## Ciência
1. Conta sem acknowledgement → botões bloqueados/UI alerta.
2. Chamar challenge diretamente → API devolve `BIOMETRIC_NOTICE_REQUIRED`.
3. Reconhecer aviso → data/hash/versão registrados.
4. Revogar acknowledgement → marcação volta a ser bloqueada até nova ciência.

## Câmera
- zero rostos → captura desabilitada;
- dois rostos → captura desabilitada;
- baixa qualidade → desabilitada;
- desafio não realizado → desabilitada;
- liveness/antispoof abaixo do threshold → desabilitada e/ou servidor bloqueia;
- face de terceiro → servidor deve gerar baixo face match e bloquear.

## Eventos
Executar sequência:
`CLOCK_IN → PAUSE_START → PAUSE_END → BREAK_START → BREAK_END → CLOCK_OUT`.
Confirmar que todas exigem selfie e que pausas são removidas do tempo trabalhado.

## WebAuthn
- cadastrar Windows Hello/Touch ID/passkey;
- ativar `requirePlatformBiometric`;
- sem credencial: challenge pode iniciar, mas marcação não deve completar;
- com credencial: prova aceita;
- revogar credencial: próxima marcação exige novo cadastro.

## Presença
- geocerca dentro/fora;
- GPS sem precisão suficiente;
- QR válido/expirado/trocado de unidade;
- gateway válido com gatewayId correto/incorreto;
- beacon com prefixo correto/incorreto;
- NFC correto/incorreto;
- dispositivo trusted/untrusted.

## Lockout
- provocar N falhas biométricas consecutivas;
- API deve devolver 423 nos challenges seguintes;
- RH/Admin vê estado BLOQUEADA;
- desbloqueio administrativo restaura acesso e cria AuditEvent.

## Offline
- desligar rede antes de iniciar;
- coletar selfie/desafio local;
- confirmar fila cifrada;
- reativar rede;
- sincronizar uma vez sem duplicidade;
- decisão deve ser REVIEW quando `offlineRequiresReview=true`;
- score não pode ser 100.

## Ledger
- rodar `/integrity/verify/:employeeId` antes/depois de marcações;
- expurgar uma selfie pelo job de retenção (ou reduzir período em ambiente de QA);
- verificador deve continuar válido;
- alterar manualmente um campo hashed no banco de QA → verificador deve falhar.

## Revisão
- REVIEW mostra selfie + foto-base lado a lado;
- aprovação/rejeição exige justificativa;
- mudança de decisão gera AuditEvent;
- tentativa BLOCKED não vira ponto; correção legítima passa pelo fluxo Adjustment.
