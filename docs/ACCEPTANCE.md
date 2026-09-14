# Critérios de aceite do MVP

## Registro
- [ ] colaborador autentica;
- [ ] registra os quatro tipos de marcação;
- [ ] recebe número sequencial, hash e ProofScore;
- [ ] pode registrar sem geolocalização se a permissão for negada, com confiança reduzida;
- [ ] marcação não é bloqueada por estar fora de geocerca;
- [ ] offline entra em fila e sincroniza sem duplicar pelo `clientEventId`.

## Integridade
- [ ] registro original não possui endpoint de update/delete;
- [ ] cadeia usa `recordNumber`, não `occurredAt`;
- [ ] verificador recalcula hash e previousHash;
- [ ] ajuste aprovado cria novo registro e preserva original.

## Gestão
- [ ] Admin/RH/Supervisor vê dashboard;
- [ ] colaborador vê apenas seus ajustes;
- [ ] gestor aprova/rejeita ajustes;
- [ ] auditoria registra ações críticas.

## Produção (bloqueadores)
- [ ] motor de apuração completo;
- [ ] AFD/AEJ vigentes;
- [ ] comprovante legal;
- [ ] assinatura eletrônica requerida;
- [ ] políticas/CCT versionadas;
- [ ] biometria/liveness homologados;
- [ ] MFA/RBAC granular;
- [ ] idempotência testada sob concorrência;
- [ ] locking/transação serial para encadeamento de hash;
- [ ] suíte de segurança e compliance.
