#!/usr/bin/env bash
# CGREG Virtual Office — prueba local en una Mac con DATOS FICTICIOS. No usa datos reales, no despliega nada,
# no toca la rama main y no se conecta a Google Sheets.
#
#   ./scripts/demo/probar-en-mac.sh                       Crea una base DEMO nueva y vacía y abre la app en la Mac.
#   ./scripts/demo/probar-en-mac.sh --iphone              Además la comparte por HTTPS privado con Tailscale Serve
#                                                         (solo dispositivos de su tailnet; nunca pública).
#   ./scripts/demo/probar-en-mac.sh --autorizo-reutilizar Usa una base DEMO creada antes por este script
#                                                         (se puede combinar con --iphone).
#
# Garantías:
#  - Nunca detiene procesos ajenos: si el puerto está ocupado, avisa y usa el siguiente libre.
#  - Nunca reutiliza ni borra una base existente sin su autorización explícita (y nunca la borra).
#  - DATABASE_URL debe ser PostgreSQL local (localhost / 127.0.0.1 / ::1 / socket) y apuntar a la base DEMO.
#  - Google Sheets queda desactivado y sin credenciales.
set -euo pipefail
cd "$(dirname "$0")/../.."

BASE=${BASE:-cgreg_demo}
ENV_DEMO=${ENV_DEMO:-./.env.demo}
PUERTO_INICIAL=${PUERTO:-4000}
IPHONE=false
REUTILIZAR=false
for a in ${@+"$@"}; do
  case "${a}" in
    --iphone) IPHONE=true ;;
    --autorizo-reutilizar) REUTILIZAR=true ;;
    *) echo "Opción desconocida: ${a}"; exit 2 ;;
  esac
done

paso() { printf '\n\033[1;32m▸ %s\033[0m\n' "$1"; }
aviso() { printf '\033[1;33m! %s\033[0m\n' "$1"; }
falta() { printf '\n\033[1;31m✗ %s\033[0m\n' "$1"; exit 1; }

# ------------------------------------------------ Requisitos ------------------------------------------------
command -v node >/dev/null || falta "Falta Node.js. Instálelo con:  brew install node"
command -v psql >/dev/null || falta "Falta PostgreSQL. Instálelo con:  brew install postgresql@16 && brew services start postgresql@16 && brew link postgresql@16 --force"
[ "$(git branch --show-current)" = "app-movil-2.0" ] || falta "Cambie a la rama de prueba:  git checkout app-movil-2.0"
[[ "${BASE}" =~ ^[a-z0-9_]*demo[a-z0-9_]*$ ]] || falta "El nombre de la base debe contener «demo» (minúsculas, números y _): ${BASE}"
pg_isready -q -h localhost || falta "PostgreSQL no está en marcha. Ejecute:  brew services start postgresql@16"

# ------------------------------------------ Base de datos DEMO ----------------------------------------------
MARCA="cgreg_demo_marca"
existe=$(psql -h localhost -d postgres -tAc "select 1 from pg_database where datname='${BASE}'")
if [ "${existe}" = "1" ]; then
  if [ "${REUTILIZAR}" != true ]; then
    falta "La base «${BASE}» ya existe y no se tocó.
   · Si es la base DEMO creada antes por este script y autoriza reutilizarla:
       ./scripts/demo/probar-en-mac.sh --autorizo-reutilizar
   · Si prefiere una base nueva, elija otro nombre (debe contener «demo»):
       BASE=cgreg_demo2 ./scripts/demo/probar-en-mac.sh"
  fi
  psql -h localhost -d "${BASE}" -tAc "select 1 from public.${MARCA}" 2>/dev/null | grep -q 1 \
    || falta "La base «${BASE}» no fue creada por este script de demostración. No se usará ni se modificará."
  [ -f "${ENV_DEMO}" ] || falta "Falta ${ENV_DEMO} (la configuración de esa base). No se reutiliza la base sin su configuración original."
  paso "Reutilizando la base DEMO «${BASE}» (autorizado)"
else
  paso "Creando base DEMO nueva y vacía «${BASE}»"
  createdb -h localhost "${BASE}"
  psql -h localhost -d "${BASE}" -qc "create extension if not exists btree_gist; create table public.${MARCA} (creada timestamptz default now(), nota text); insert into public.${MARCA} (nota) values ('Base de DEMOSTRACIÓN con datos ficticios creada por scripts/demo/probar-en-mac.sh');" >/dev/null
  # Configuración solo de esta Mac (ignorada por git). La clave de cifrado se genera aquí y no sale de la Mac.
  cat > "${ENV_DEMO}" <<EOF
# Generado por scripts/demo/probar-en-mac.sh para la base DEMO «${BASE}». Datos ficticios.
NODE_ENV=production
HOST=127.0.0.1
DATABASE_URL=${DEMO_DATABASE_URL:-postgres://$(whoami)@localhost:5432/${BASE}}
DATA_ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
COOKIE_SECURE=false
TRUST_PROXY=true
SHEETS_SYNC_ENABLED=false
EOF
fi

set -a; . "${ENV_DEMO}"; set +a
# Google Sheets: siempre desactivado y sin credenciales en este proceso.
export SHEETS_SYNC_ENABLED=false
unset GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 GOOGLE_APPLICATION_CREDENTIALS

# DATABASE_URL: solo PostgreSQL local y exactamente la base DEMO.
DATABASE_URL="${DATABASE_URL}" BASE="${BASE}" node -e '
  const u = new URL(process.env.DATABASE_URL);
  const local = ["localhost", "127.0.0.1", "[::1]", ""].includes(u.hostname);
  const base = decodeURIComponent(u.pathname.slice(1));
  const hostQuery = u.searchParams.get("host");
  const ok = ["postgres:", "postgresql:"].includes(u.protocol) && local && base === process.env.BASE && /demo/.test(base) && (!hostQuery || hostQuery.startsWith("/"));
  if (!ok) { console.error("DATABASE_URL no es PostgreSQL local con la base DEMO: " + u.protocol + "//" + u.hostname + "/" + base); process.exit(1); }
' || falta "Por seguridad no se continúa."

# ------------------------------------------------ Puerto ----------------------------------------------------
ocupado() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }
PUERTO=${PUERTO_INICIAL}
while ocupado "${PUERTO}"; do
  aviso "El puerto ${PUERTO} está en uso por otro programa; no se toca. Probando el $((PUERTO + 1))."
  PUERTO=$((PUERTO + 1))
  [ "${PUERTO}" -le $((PUERTO_INICIAL + 50)) ] || falta "No hay puertos libres entre ${PUERTO_INICIAL} y $((PUERTO_INICIAL + 50))."
done
export PORT=${PUERTO}

# -------------------------------------------- Compilar y arrancar -------------------------------------------
paso "Dependencias, estructura de la base y compilación (la primera vez tarda unos minutos)"
[ -d node_modules ] || npm ci
npx tsx server/cli/migrate.ts
npm run build >/dev/null 2>&1 || { npm run build; falta "La compilación falló."; }

SERVIDOR=""; SEMILLA=""; SERVE_CMD=""
limpiar() {
  [ -n "${SERVE_CMD}" ] && ${SERVE_CMD} off >/dev/null 2>&1 || true
  [ -n "${SEMILLA}" ] && kill "${SEMILLA}" 2>/dev/null || true
  [ -n "${SERVIDOR}" ] && kill "${SERVIDOR}" 2>/dev/null || true
}
trap limpiar EXIT

paso "Iniciando la app en el puerto ${PUERTO} (solo esta Mac: 127.0.0.1)"
node dist/server/index.js > /tmp/cgreg-demo-servidor.log 2>&1 &
SERVIDOR=$!
for _ in $(seq 1 60); do curl -s -o /dev/null "http://127.0.0.1:${PUERTO}/api/salud" && break; kill -0 "${SERVIDOR}" 2>/dev/null || break; sleep 0.5; done
curl -s -o /dev/null "http://127.0.0.1:${PUERTO}/api/salud" || { tail -20 /tmp/cgreg-demo-servidor.log; falta "La app no arrancó."; }

paso "Datos ficticios y profesionales DEMO conectados"
DEMO_URL="http://127.0.0.1:${PUERTO}" node scripts/demo/sembrar-demo.mjs > /tmp/cgreg-demo-datos.log 2>&1 &
SEMILLA=$!
until grep -qE "conectados|Error|solo funciona" /tmp/cgreg-demo-datos.log 2>/dev/null; do kill -0 "${SEMILLA}" 2>/dev/null || break; sleep 1; done
grep -q "conectados" /tmp/cgreg-demo-datos.log || { cat /tmp/cgreg-demo-datos.log; falta "No se pudieron cargar los datos de demostración."; }

open "http://localhost:${PUERTO}" 2>/dev/null || true
printf '\n\033[1m✔ En esta Mac:\033[0m  http://localhost:%s\n' "${PUERTO}"

# -------------------------------------- iPhone / Android: Tailscale Serve -------------------------------------
if [ "${IPHONE}" = true ]; then
  paso "Compartiendo por HTTPS privado con Tailscale Serve (solo sus dispositivos)"
  TS=$(command -v tailscale || true)
  [ -z "${TS}" ] && [ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ] && TS=/Applications/Tailscale.app/Contents/MacOS/Tailscale
  [ -n "${TS}" ] || falta "No se encontró Tailscale. Instálelo con:  brew install --cask tailscale-app   y abra la app para iniciar sesión."
  "${TS}" status >/dev/null 2>&1 || falta "Tailscale no está conectado. Abra la app Tailscale en la Mac e inicie sesión."
  NOMBRE=$("${TS}" status --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);process.stdout.write((j.Self&&j.Self.DNSName||"").replace(/\.$/,""))})')
  [ -n "${NOMBRE}" ] || falta "Active MagicDNS en la consola de Tailscale (DNS → MagicDNS) y vuelva a intentarlo."
  if "${TS}" serve status 2>/dev/null | grep -q "https://"; then
    "${TS}" serve status
    falta "Tailscale Serve ya está compartiendo otra cosa en esta Mac; no se modifica. Revise «tailscale serve status»."
  fi
  SERVE_CMD="${TS} serve --bg --https=443 http://127.0.0.1:${PUERTO}"
  ${SERVE_CMD} >/dev/null || falta "No se pudo activar Tailscale Serve. Active «HTTPS Certificates» en la consola de Tailscale (DNS) y vuelva a intentarlo."
  URL="https://${NOMBRE}"
  for _ in $(seq 1 30); do curl -s -o /dev/null "${URL}/api/salud" && break; sleep 1; done
  curl -s -o /dev/null "${URL}/api/salud" || falta "El enlace ${URL} no responde todavía. Espere un minuto (el certificado se emite la primera vez) y vuelva a ejecutar."
  # La PWA necesita HTTPS válido, el manifest y el service worker accesibles por esa dirección.
  for r in /manifest.webmanifest /sw.js /icons/icono-192.png /icons/apple-touch-icon.png; do
    [ "$(curl -s -o /dev/null -w '%{http_code}' "${URL}${r}")" = "200" ] || falta "La PWA no está completa por HTTPS (${r})."
  done
  printf '\n\033[1m✔ En el iPhone / Android (con la app Tailscale conectada a su cuenta):\033[0m  %s\n' "${URL}"
  printf '   Solo lo abren dispositivos de su tailnet. Se deja de compartir al cerrar esta ventana.\n'
  printf '   QR: abra el enlace en Chrome de la Mac → ícono «Compartir» de la barra de direcciones → «Crear código QR».\n'
fi

printf '\nUsuarios de prueba (contraseña Demo-CGREG-2026): marianella.becerra@demo.cgreg (Coordinación + Trabajo Social) · hugo@demo.cgreg · andrea@demo.cgreg · diego@demo.cgreg · demetrio@demo.cgreg · autoridad@demo.cgreg\n'
printf 'Para detener todo: Ctrl + C\n'
wait "${SERVIDOR}"
