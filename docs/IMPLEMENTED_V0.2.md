# PontoProof v0.2 — implementação

## Entidades adicionadas/expandidas

- `Department`
- `Worksite`
- `Shift`
- `TimeRuleSettings`
- `TimeBalanceLedger`
- `BankHourAdjustment`
- `PayrollPeriod`
- `PayrollPreview`
- `Alert`

`Employee` ganhou setor, local, supervisor, admissão, salário-base em centavos e escala. `Shift` ganhou dias da semana, jornada diária, intervalo, tolerância e status.

## Motor de jornada

O motor trabalha em uma camada derivada. Ele não altera `Punch`.

1. Busca marcações do colaborador.
2. Remove do cálculo somente registros que foram explicitamente substituídos por uma solicitação aprovada.
3. Mantém todos os registros no ledger imutável.
4. Agrupa por dia de trabalho e considera escala noturna simples.
5. Forma intervalos de trabalho entre entrada/retorno e intervalo/saída.
6. Calcula jornada prevista, trabalhada, regular, extra 50%, extra 100%, minutos noturnos e déficit.
7. Aplica a política de banco separadamente: extras podem ir para banco ou pagamento; déficits podem ou não afetar o banco.
8. Gera avisos de intervalo, jornada aberta, sequência incompleta e limite diário.
9. Pode persistir o resultado diário em `TimeBalanceLedger`.

## Banco de horas

O saldo combina:

- deltas calculados pelo motor (`TimeBalanceLedger`); e
- créditos/débitos manuais (`BankHourAdjustment`).

Ajuste manual é exclusivo de RH/Admin, exige motivo e gera auditoria. Isso evita alterar retroativamente o cálculo diário só para “forçar” um saldo.

## Jornada Espelho

`POST /payroll/generate` recalcula o período de todos os colaboradores ativos e cria uma prévia. O cálculo financeiro usa salário-base e divisor mensal configurável.

Se as horas extras estiverem configuradas para banco, elas não são somadas simultaneamente como pagamento na prévia. O adicional noturno continua separado.

Não há desconto automático de faltas/déficit e não há cálculo de encargos, DSR, INSS, FGTS, IRRF, férias ou 13º. O objetivo desta tela é detectar divergências antes de exportar para a folha oficial.

## Correções

Uma solicitação pode:

- adicionar uma marcação ausente; ou
- apontar para uma marcação existente (`targetPunchId`).

Ao aprovar uma correção, o sistema cria um novo `Punch`. O original permanece armazenado e verificável. O motor exclui o registro substituído do cálculo, sem excluí-lo do histórico.

## Concorrência da cadeia

A criação de marcação usa `pg_advisory_xact_lock(hashtext(employeeId))` dentro da transação. Assim, duas marcações simultâneas do mesmo colaborador são serializadas antes da leitura do `previousHash`, reduzindo o risco de bifurcação da cadeia.

A idempotência por `clientEventId` protege também o reenvio da fila offline quando o servidor gravou a marcação, mas o cliente perdeu a resposta.

## Segurança e privacidade já reforçadas

- fonte (`source`) da marcação é definida pelo servidor;
- navegador não pode autodeclarar liveness/rede/Bluetooth como evidência confiável;
- Supervisor vê somente a própria equipe nas rotas operacionais;
- salário-base não é retornado ao Supervisor na listagem administrativa;
- perfil Auditor é somente leitura;
- JSON de auditoria é redigido para Auditor em chaves sensíveis conhecidas;
- JWT de produção exige segredo com 32+ caracteres;
- colaborador inativo não pode marcar ponto;
- dispositivo confiável é administrado por RH/Admin.

## Segurança ainda pendente

- refresh token/rotação de sessão;
- MFA para perfis privilegiados;
- reset de senha e convite;
- RBAC granular por permissão;
- criptografia/gestão de chaves dedicada para dados sensíveis;
- rate limit distribuído para múltiplas réplicas;
- CSP específica do frontend;
- logs centralizados/SIEM;
- SAST/DAST e pentest;
- Play Integrity/App Attest e prova de vida real.
