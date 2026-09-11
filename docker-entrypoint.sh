#!/bin/sh
set -e

# Solo migramos si el store es Postgres. Con STORE=memory no hay DB.
if [ "${STORE:-postgres}" = "postgres" ]; then
  echo "[entrypoint] aplicando migraciones..."
  node dist/db/migrate.js
else
  echo "[entrypoint] STORE=${STORE}, se saltean las migraciones"
fi

echo "[entrypoint] iniciando servidor..."
exec node dist/index.js
