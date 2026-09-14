# Deploy de teste — VPS

## Requisitos

- Ubuntu/Debian recente;
- Docker Engine + plugin Docker Compose;
- domínio apontando para a VPS;
- proxy reverso com HTTPS (Caddy, Nginx Proxy Manager, Traefik ou Nginx do host).

## Primeiro deploy

```bash
unzip pontoproof-v0.2.0.zip -d pontoproof
cd pontoproof
cp .env.production.example .env.production
nano .env.production
set -a
. ./.env.production
set +a
./deploy/first-deploy.sh
```

Preencha obrigatoriamente:

- `POSTGRES_PASSWORD`;
- `JWT_SECRET` com 32+ caracteres;
- `WEB_ORIGIN` com a URL HTTPS final;
- `BOOTSTRAP_TENANT_*`;
- `BOOTSTRAP_ADMIN_*`, com senha de 12+ caracteres.

O script:

1. inicia o PostgreSQL;
2. aguarda o banco ficar saudável;
3. constrói a API;
4. aplica o schema de teste com `prisma db push`;
5. cria/atualiza o primeiro administrador pelo bootstrap;
6. opcionalmente executa o seed demo quando `DEMO_SEED=true`;
7. inicia API e web.

Depois publique `127.0.0.1:${WEB_PORT}` (ou a porta escolhida) no domínio HTTPS. Após confirmar o primeiro login, remova `BOOTSTRAP_ADMIN_PASSWORD` do arquivo/ambiente.

## Atualização

Em ambiente de teste:

```bash
set -a
. ./.env.production
set +a
docker compose -f docker-compose.prod.yml up -d --build
```

Se o schema mudou, aplique a migration versionada antes de subir a nova aplicação. O `first-deploy.sh` usa `prisma db push` somente para facilitar a primeira validação do MVP.

## Backup

Exemplo de dump:

```bash
set -a
. ./.env.production
set +a
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > pontoproof-$(date +%F).sql
```

Teste restauração periodicamente. Não considere backup válido apenas porque o arquivo foi criado.

## Antes de produção real

- HTTPS obrigatório;
- segredos em cofre/secret manager, não em arquivo permanente;
- migrations versionadas (`prisma migrate deploy`);
- backup externo criptografado;
- observabilidade e alertas de indisponibilidade;
- rate limit compartilhado se houver múltiplas réplicas;
- política de retenção e descarte;
- revisão LGPD e segurança;
- homologação dos artefatos e requisitos de ponto eletrônico aplicáveis.
