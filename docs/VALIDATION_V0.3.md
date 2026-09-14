# Validação executada — v0.3

Data: 2026-09-13

## Executado neste ambiente
- parse sintático de todos os arquivos `.ts/.tsx` usando parser TypeScript global: **63 arquivos, 0 diagnósticos sintáticos** após correções;
- `node --check apps/presence-gateway/server.mjs`: aprovado;
- parse de todos os `package.json`: aprovado;
- revisão de idempotência/ledger e correção do ajuste administrativo para o novo formato de evidência;
- revisão de retenção: expurgo de selfie foi alterado para não modificar `selfieStorageKey`, que participa do hash histórico;
- Dockerfiles atualizados para disponibilizar `scripts/copy-human-models.mjs` durante `npm install`.

## Limitação do ambiente
`npm install --no-audit --no-fund` atingiu o timeout antes de baixar as dependências externas. Portanto não foi possível executar aqui:
- `prisma validate/generate`;
- typecheck semântico completo contra os tipos reais das dependências;
- build Vite;
- integração real com PostgreSQL/câmera/WebAuthn.

O `local-test.ps1` da entrega v0.3 agora executa todos esses passos, inclusive `npm run build`, e interrompe imediatamente em caso de erro. Se o teste local encontrar incompatibilidade, o erro completo deve ser usado para a correção antes de qualquer deploy.
