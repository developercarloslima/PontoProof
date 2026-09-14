# QA — PontoProof v0.2

Checklist mínimo para homologação interna antes de qualquer piloto real.

## Autenticação e RBAC
- [ ] login das cinco funções;
- [ ] colaborador não acessa `/admin/*`, folha ou auditoria;
- [ ] supervisor enxerga apenas própria equipe;
- [ ] supervisor não recebe salário-base pela API;
- [ ] auditor não altera dados e recebe campos sensíveis redigidos;
- [ ] colaborador inativo não consegue marcar ponto.

## Marcação
- [ ] entrada → intervalo → retorno → saída;
- [ ] sequência atípica é preservada e gera alerta;
- [ ] mesmo `clientEventId` não duplica registro;
- [ ] reenvio offline retorna o registro existente;
- [ ] duas marcações concorrentes do mesmo colaborador mantêm cadeia válida;
- [ ] geofence dentro/fora altera a explicação do ProofScore;
- [ ] dispositivo não confiável/confiável afeta a evidência conforme política.

## Correções
- [ ] inclusão de marcação ausente;
- [ ] correção apontando para marcação original;
- [ ] rejeição não altera cálculo;
- [ ] aprovação cria novo Punch e não apaga o anterior;
- [ ] cálculo ignora somente o registro explicitamente substituído;
- [ ] verificador de integridade continua válido após correção.

## Jornada e banco
- [ ] escala de segunda a sexta;
- [ ] folga não gera déficit;
- [ ] jornada atravessando meia-noite;
- [ ] tolerância de hora extra;
- [ ] extra destinada ao banco não é paga também na prévia;
- [ ] extra destinada a pagamento não aumenta banco;
- [ ] déficit configurado para banco reduz saldo;
- [ ] ajuste manual positivo/negativo aparece no saldo e na auditoria.

## Jornada Espelho
- [ ] geração mensal idempotente/atualizável conforme fluxo definido;
- [ ] salário/divisor produzem valor-hora esperado;
- [ ] 50% e 100% separados;
- [ ] adicional noturno separado;
- [ ] mudança de status do período é auditada;
- [ ] nenhum desconto de falta é aplicado silenciosamente.

## Deploy
- [ ] `.env.production` com segredos fortes;
- [ ] bootstrap cria o primeiro admin sem seed demo;
- [ ] healthcheck retorna `0.2.0`;
- [ ] frontend acessa API por `/api`;
- [ ] HTTPS externo ativo;
- [ ] backup e restauração testados.
