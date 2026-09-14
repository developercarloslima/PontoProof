# Arquitetura

## Visão lógica

```text
[PWA / Mobile / Kiosk / REP-C]
            |
        API Gateway
            |
   +--------+---------+
   |                  |
Identity          Punch API
   |                  |
RBAC          Proof Engine
                      |
              Immutable Ledger
                      |
              PostgreSQL + WORM*
                      |
       +--------------+--------------+
       |              |              |
   Journey Engine  Risk Engine   Export Engine
       |              |              |
       +---------- Event Bus --------+
                      |
             Notifications/ERP/BI
```

`*` Em produção, recomenda-se armazenamento adicional imutável/WORM ou object lock para snapshots/exportações críticas.

## Serviços de produção sugeridos

1. **identity-service** — auth, MFA, SSO, RBAC, tenant.
2. **punch-service** — recebe marcações e garante idempotência.
3. **proof-service** — normaliza evidências e gera ProofScore.
4. **ledger-service** — hash chain/assinaturas, jamais altera eventos.
5. **journey-service** — pareamento, horas, adicionais, intervalos, tolerâncias.
6. **rules-service** — CCT/acordos/políticas versionadas.
7. **adjustment-service** — workflow de correção.
8. **risk-service** — anomalias e alertas.
9. **export-service** — AFD/AEJ/espelhos/relatórios.
10. **integration-service** — folha/ERP/webhooks.
11. **assistant-service** — IA somente sobre fatos calculados/referenciados.

O MVP deste repositório concentra esses domínios numa API modular para reduzir complexidade inicial.

## Integridade

Cada punch guarda:
- `recordNumber` autoincremental;
- `previousHash`;
- payload normalizado;
- evidências capturadas;
- `integrityHash = SHA256(canonical(payload))`.

A cadeia deve ser ordenada pelo número de registro/ordem de ingestão, não pelo horário declarado da marcação. Assim ajustes retroativos continuam auditáveis.

## Idempotência — requisito para produção

Todo coletor deverá enviar `clientEventId` UUID. O backend deve impor `UNIQUE(tenantId, clientEventId)`. Reenvios offline devolvem o mesmo resultado sem duplicar ponto.

## Offline

Produção móvel:
1. gera `clientEventId`;
2. captura evidências;
3. assina payload com chave do dispositivo em secure enclave/keystore;
4. salva fila local criptografada;
5. sincroniza;
6. servidor registra `occurredAt` e `receivedAt` separadamente;
7. políticas avaliam atraso e integridade do relógio.

O PWA atual implementa fila local simplificada para demonstração.

## Privacidade

Separar:
- dado necessário ao registro;
- evidência antifraude;
- biometria;
- telemetria operacional.

Biometria deve ter storage segregado, criptografia, chave própria, retenção definida e acesso extremamente limitado. Sempre que possível, armazenar template/resultado de verificação em vez de imagem bruta permanente, sujeito à avaliação jurídica/técnica.

## Escala

- PostgreSQL primário + réplicas;
- Redis para sessões/locks/rate limit;
- Kafka/PubSub para eventos;
- object storage com versionamento/object lock;
- OpenTelemetry;
- KMS/HSM para chaves;
- CDN/WAF;
- particionamento de punches por tenant/data em grande escala.
