#!/bin/sh
set -eu

docker compose -f docker-compose.prod.yml up -d --build postgres
until docker compose -f docker-compose.prod.yml exec -T postgres pg_isready -U "${POSTGRES_USER:-pontoproof}" >/dev/null 2>&1; do sleep 2; done

docker compose -f docker-compose.prod.yml build api
docker compose -f docker-compose.prod.yml run --rm api npx prisma db push
if [ -n "${BOOTSTRAP_ADMIN_EMAIL:-}" ]; then
  docker compose -f docker-compose.prod.yml run --rm api npx tsx prisma/bootstrap.ts
fi
if [ "${DEMO_SEED:-false}" = "true" ]; then
  docker compose -f docker-compose.prod.yml run --rm api npx tsx prisma/seed.ts
fi
docker compose -f docker-compose.prod.yml up -d --build

echo "PontoProof iniciado. Publique a porta ${WEB_PORT:-8080} atrás do seu proxy HTTPS."
