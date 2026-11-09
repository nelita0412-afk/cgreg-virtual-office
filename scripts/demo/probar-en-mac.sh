#!/usr/bin/env bash
# CGREG Virtual Office — prueba local en una Mac con DATOS FICTICIOS (base «cgreg_demo»).
# No usa datos reales, no despliega nada y no toca la rama main.
#
#   ./scripts/demo/probar-en-mac.sh            → abre la app en http://localhost:4000
#   ./scripts/demo/probar-en-mac.sh --iphone   → además crea un enlace HTTPS temporal para el iPhone/Android
#                                                (requiere haber instalado cloudflared: brew install cloudflared)
set -euo pipefail
cd "$(dirname "$0")/../.."

PUERTO=${PUERTO:-4000}
BASE=${BASE:-cgreg_demo}
ENV_DEMO=${ENV_DEMO:-./.env.demo}
paso() { printf '\n\033[1;32m▸ %s\033[0m\n' "$1"; }
falta() { printf '\n\033[1;31m✗ %s\033[0m\n' "$1"; exit 1; }

command -v node >/dev/null || falta "Falta Node.js. Instálelo con:  brew install node"
command -v psql >/dev/null || falta "Falta PostgreSQL. Instálelo con:  brew install postgresql@16 && brew services start postgresql@16 && brew link postgresql@16 --force"
[ "$(git branch --show-current)" = "app-movil-2.0" ] || falta "Cambie a la rama de prueba:  git checkout app-movil-2.0"
pg_isready -q || falta "PostgreSQL no está en marcha. Ejecute:  brew services start postgresql@16"

paso "Base de datos de demostración ($BASE)"
psql -d postgres -tAc "select 1 from pg_database where datname='$BASE'" | grep -q 1 || createdb "$BASE"
psql -d "$BASE" -qc "create extension if not exists btree_gist" >/dev/null

if [ ! -f "$ENV_DEMO" ]; then
  paso "Configuración local (.env.demo, solo en esta Mac)"
  cat > "$ENV_DEMO" <<EOF
NODE_ENV=production
PORT=$PUERTO
HOST=127.0.0.1
DATABASE_URL=${DEMO_DATABASE_URL:-postgres://$(whoami)@localhost:5432/$BASE}
DATA_ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
COOKIE_SECURE=false
TRUST_PROXY=true
SHEETS_SYNC_ENABLED=false
EOF
fi
set -a; . "$ENV_DEMO"; set +a

paso "Dependencias y compilación (la primera vez tarda unos minutos)"
[ -d node_modules ] || npm ci
npx tsx server/cli/migrate.ts
npm run build >/dev/null

paso "Iniciando la app"
lsof -ti tcp:$PUERTO | xargs kill 2>/dev/null || true
node --env-file="$ENV_DEMO" dist/server/index.js > /tmp/cgreg-demo-servidor.log 2>&1 &
SERVIDOR=$!
TUNEL=""
trap 'kill $SERVIDOR $SEMILLA $TUNEL 2>/dev/null || true' EXIT
until curl -s -o /dev/null "http://localhost:$PUERTO/api/salud"; do sleep 0.5; done

paso "Datos ficticios y profesionales DEMO conectados"
node scripts/demo/sembrar-demo.mjs > /tmp/cgreg-demo-datos.log 2>&1 &
SEMILLA=$!
until grep -qE "conectados|Error|solo funciona" /tmp/cgreg-demo-datos.log 2>/dev/null; do sleep 1; done
grep -qE "Error|solo funciona" /tmp/cgreg-demo-datos.log && { cat /tmp/cgreg-demo-datos.log; falta "No se pudieron cargar los datos de demostración."; }

open "http://localhost:$PUERTO" 2>/dev/null || true
printf '\n\033[1m✔ App abierta en la computadora:\033[0m  http://localhost:%s\n' "$PUERTO"

if [ "${1:-}" = "--iphone" ]; then
  command -v cloudflared >/dev/null || falta "Para el iPhone, instale primero cloudflared (una sola vez):  brew install cloudflared"
  paso "Creando enlace HTTPS temporal para el teléfono"
  cloudflared tunnel --no-autoupdate --url "http://localhost:$PUERTO" > /tmp/cgreg-demo-tunel.log 2>&1 &
  TUNEL=$!
  until URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/cgreg-demo-tunel.log | head -1) && [ -n "$URL" ]; do sleep 1; done
  printf '\n\033[1m✔ Enlace para iPhone y Android:\033[0m  %s\n' "$URL"
  printf '   Código QR: abra ese enlace en Chrome de la Mac → ícono «Compartir» de la barra de direcciones → «Crear código QR».\n'
  printf '   O envíelo al iPhone por AirDrop / Mensajes. El enlace deja de funcionar al cerrar esta ventana.\n'
fi

printf '\nUsuarios de prueba (contraseña Demo-CGREG-2026): coordinacion@demo.cgreg · hugo@demo.cgreg · gabriel@demo.cgreg · autoridad@demo.cgreg\n'
printf 'Para detener todo: Ctrl + C\n'
wait $SERVIDOR
