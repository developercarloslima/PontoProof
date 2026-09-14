# Implementado na v0.3 — mapa do escopo solicitado

## Os 20 pontos

1. **Política de integridade máxima:** implementada no `proof.service.ts`, com score explicável e núcleo obrigatório.
2. **Selfie em toda marcação:** implementada nos seis tipos de evento.
3. **Foto obrigatória no cadastro:** criação de colaborador exige captura frontal válida.
4. **Cadastro facial robusto:** frontal obrigatória; esquerda/direita disponíveis e recomendadas.
5. **Biometria digital do aparelho:** WebAuthn/platform authenticator, sem armazenar impressão digital.
6. **Fluxo completo:** challenge → câmera → face/liveness/antispoof → presença → servidor → decisão → ledger.
7. **Estados de decisão:** APPROVED / REVIEW / BLOCKED.
8. **Parâmetros de ProofScore:** implementados com pesos normalizados e evidências configuráveis.
9. **Thresholds faciais:** configuráveis por empresa e aplicados no cliente + servidor; decisão final é do servidor.
10. **Banco de dados:** FaceReference, PunchChallenge, PunchEvidence ampliado, PunchAttempt, WebAuthnCredential, security settings e acknowledgement biométrico.
11. **Telas Admin/RH:** cadastro facial, políticas, presença, revisão de segurança e imagens protegidas.
12. **Tela funcionário:** seis eventos, câmera obrigatória, ProofScore e Minha Segurança.
13. **Pausa/retorno:** `PAUSE_START` e `PAUSE_END` integrados ao motor de jornada.
14. **Exceções:** falha biométrica bloqueia; marcação legítima excepcional usa ajuste formal auditado. Offline vai à revisão, não vira bypass.
15. **Offline:** IndexedDB cifrado, idempotência e revisão obrigatória conforme política.
16. **Segurança/privacidade:** AES-256-GCM, acesso por perfil, retenção, ciência biométrica e trilha de auditoria.
17. **Web em vez de mobile:** Human + WebAuthn + APIs web; provedores nativos permanecem explicitamente indisponíveis.
18. **Regra de ativação/uso:** sem face ACTIVE não há challenge de ponto quando face match é exigido.
19. **Etapa 1:** foto, selfie, face match, revisão, bloqueio e auditoria implementados.
20. **Etapa 2 web:** liveness, WebAuthn, sinais antifraude, QR, gateway de rede, Bluetooth, NFC, armazenamento cifrado e retenção implementados dentro dos limites do navegador.

## Opção A — especificação

A especificação está materializada em:
- schema Prisma;
- rotas/API;
- componentes/telas;
- `SECURITY_BIOMETRICS.md`;
- `QA_V0.3.md`;
- este mapa de escopo.

## Opção B — implementação

A implementação foi aplicada nos arquivos reais do projeto, não apenas descrita. Serviços principais:
- `face-enrollment.service.ts`
- `face-verification.service.ts`
- `proof.service.ts`
- `presence.service.ts`
- `biometric-storage.service.ts`
- `biometric-notice.service.ts`
- `retention.service.ts`
- `punch.service.ts`
- `routes/punches.ts`
- `routes/security.ts`
- `routes/admin.ts`

Frontend principal:
- `BiometricCapture.tsx`
- `PunchPanel.tsx`
- `SecurityCenter.tsx`
- `FaceEnrollmentManager.tsx`
- `SecurityReviews.tsx`
- `PresenceCodes.tsx`
- `Worksites.tsx`
- `Settings.tsx`

## Regras obrigatórias

- Selfie/face/liveness/antispoof/cadastro prévio/bloqueio por falha são forçados por `getOrCreateSecuritySettings`; Admin não consegue desligá-los.
- Troca/reset facial é auditado.
- Marcações bloqueadas ficam em `PunchAttempt` e não entram no ledger.
- Ajuste retroativo nunca recebe score biométrico falso.
- Offline não pode receber integridade máxima automática.

### Primeiro acesso autogerido (v0.3.4)
O cadastro biométrico deixou de ser responsabilidade do ADM/RH. O gestor cria a conta com senha temporária e o próprio titular precisa trocar a senha, reconhecer o aviso biométrico, cadastrar o rosto com liveness/antispoof e cadastrar uma credencial WebAuthn do dispositivo. Até concluir as quatro etapas, a API bloqueia as rotas operacionais.
