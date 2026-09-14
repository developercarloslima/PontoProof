# API — PontoProof v0.2

Todas as rotas, exceto health/login, usam `Authorization: Bearer <JWT>`.

## Público
- `GET /health`
- `POST /auth/login`

## Colaborador
- `GET /me`
- `POST /devices/register`
- `POST /punches`
- `GET /punches/me`
- `GET /punches/:id/proof`
- `GET /integrity/verify/:employeeId`
- `POST /adjustments`
- `GET /adjustments`
- `GET /assistant/explain-my-day`
- `GET /time/me?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `GET /bank/me`

## Supervisor / RH / Admin
- `GET /dashboard/overview`
- `POST /alerts/:id/resolve`
- `GET /admin/employees`
- `GET /admin/departments`
- `GET /admin/worksites`
- `GET /admin/shifts`
- `GET /time/employees/:id`
- `POST /time/recalculate`
- `GET /bank/overview`
- `POST /adjustments/:id/approve`
- `POST /adjustments/:id/reject`

Supervisor é restrito à própria equipe nas rotas de equipe, jornada, banco, alertas e ajustes. Salário-base não é retornado pela listagem de equipe para o perfil Supervisor.

## RH / Admin
- `GET /admin/company`
- `PATCH /admin/company`
- `PATCH /admin/rules`
- `POST /admin/departments`
- `PATCH /admin/departments/:id`
- `POST /admin/worksites`
- `PATCH /admin/worksites/:id`
- `POST /admin/shifts`
- `PATCH /admin/shifts/:id`
- `POST /admin/employees`
- `PATCH /admin/employees/:id`
- `GET /admin/devices`
- `POST /admin/devices/:id/trust`
- `POST /bank/adjustments`
- `GET /payroll/periods`
- `POST /payroll/generate`
- `GET /payroll/periods/:id`
- `POST /payroll/periods/:id/status`

## Auditor / RH / Admin
- `GET /audit/events`
- `GET /audit/employees`
- `GET /integrity/verify/:employeeId`

O perfil Auditor é somente leitura. Campos sensíveis conhecidos nos JSONs de auditoria, como salário, e-mail e CPF, são redigidos para esse perfil.

## Exemplo de marcação

```json
{
  "type": "CLOCK_IN",
  "clientEventId": "4c823799-e528-40e8-ad3c-af65fd260934",
  "occurredAt": "2026-09-13T11:00:00.000Z",
  "timezone": "America/Maceio",
  "offline": false,
  "latitude": -9.6498,
  "longitude": -35.7089,
  "accuracyM": 18,
  "deviceFingerprint": "web:uuid:Win32"
}
```

O backend define o `source`; não confia em liveness, rede, Bluetooth ou fonte da marcação enviados diretamente pelo navegador. Essas evidências devem entrar futuramente por integrações/SDKs atestados.

## Exemplo de correção

```json
{
  "targetPunchId": "cm...",
  "requestedTime": "2026-09-13T20:10:00.000Z",
  "requestedType": "CLOCK_OUT",
  "reason": "Registrei a saída antes do encerramento real do atendimento."
}
```

Ao aprovar, o registro original continua no ledger e o novo evento passa a substituí-lo apenas na camada de cálculo.

## Exemplo de ajuste manual de banco

```json
{
  "employeeId": "cm...",
  "minutes": 60,
  "reason": "Crédito validado pelo RH conforme acordo interno."
}
```

`minutes` positivo credita e negativo debita. Todo ajuste manual gera evento de auditoria.

## Ainda pendente para REP-P/produção oficial
- exportações AFD/AEJ finais;
- artefatos/assinaturas exigidos;
- CCT/ACT e feriados completos;
- biometria/liveness e attestation nativa;
- integrações oficiais de folha/ERP;
- webhooks e notificações;
- endpoint público de verificação de recibo assinado.
