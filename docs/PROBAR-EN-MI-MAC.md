# Probar CGREG Virtual Office en su Mac (datos ficticios)

Todo ocurre en su Mac, con una base de datos de demostración **nueva y vacía** que el script crea y llena con datos ficticios. No usa datos reales, no se conecta a Google Sheets y no publica nada.

Qué garantiza `scripts/demo/probar-en-mac.sh`:
- **Puerto**: si el 4000 está ocupado, no detiene nada; avisa y usa el siguiente libre.
- **Base de datos**: crea `cgreg_demo`. Si ya existe, se detiene sin tocarla. Solo la reutiliza con `--autorizo-reutilizar` y únicamente si la creó este mismo script. Nunca borra bases.
- **DATABASE_URL**: solo PostgreSQL local (localhost) y exactamente la base DEMO; si no, no continúa.
- **Google Sheets**: desactivado y sin credenciales.
- **iPhone/Android**: HTTPS privado con **Tailscale Serve**, visible solo para los dispositivos conectados a su cuenta de Tailscale. Se deja de compartir al cerrar la Terminal.

## 1. Preparar la Mac (una sola vez)

```bash
brew install node postgresql@16 git
```

```bash
brew services start postgresql@16 && brew link postgresql@16 --force
```

## 2. Descargar esta versión en una carpeta nueva

Se usa una carpeta independiente (`~/cgreg-brigada`): no depende de pruebas anteriores ni las modifica.

```bash
git clone -b brigada-teleatencion https://github.com/nelita0412-afk/cgreg-virtual-office.git ~/cgreg-brigada
```

## 3. Abrir la app en la Mac

```bash
cd ~/cgreg-brigada && ./scripts/demo/probar-en-mac.sh
```

Crea la base DEMO nueva `cgreg_demo_brigada` y abre la app (normalmente `http://localhost:4000`). Las bases `cgreg_demo` y `cgreg_demo_prueba_20261108` están protegidas: el script nunca las usa ni las modifica. Para volver otro día:

```bash
cd ~/cgreg-brigada && ./scripts/demo/probar-en-mac.sh --autorizo-reutilizar
```

## 4. Abrirla en el iPhone (HTTPS privado con Tailscale)

Una sola vez: `brew install --cask tailscale-app`; abra Tailscale en la Mac e inicie sesión; instale Tailscale en el iPhone con la misma cuenta; en login.tailscale.com → DNS active **MagicDNS** y **HTTPS Certificates**. Luego:

```bash
cd ~/cgreg-brigada && ./scripts/demo/probar-en-mac.sh --autorizo-reutilizar --iphone
```

Abra en Safari del iPhone el enlace `https://….ts.net` que muestra la Terminal. **QR**: ese enlace en Chrome de la Mac → Compartir → Crear código QR.

## Probar la teleatención por WhatsApp
La demostración no trae números (podrían pertenecer a personas reales). Para probar: ingrese como `marianella.becerra@demo.cgreg`, abra un caso de demostración asignado a Hugo, registre **su propio** celular en «WhatsApp para teleatención» marcando la autorización, y luego ingrese como `hugo@demo.cgreg`: en la cita verá «Contactar por WhatsApp» e «Iniciar teleatención».

## 5. Instalar en la pantalla de inicio
- **iPhone (Safari)**: Compartir → **Agregar a inicio** → Agregar. Se abre a pantalla completa como una app.
- **Android (Chrome)**: botón **Instalar** en la app, o menú ⋮ → **Instalar aplicación**.

## Compatibilidad con macOS
Funciona con el Bash que trae macOS (3.2). Todas las variables del script van entre llaves (`${BASE}`); `tests/scripts-demo.test.ts` lo verifica.

## Usuarios de prueba (contraseña FICTICIA `Demo-CGREG-2026`)

Esta contraseña solo funciona en el entorno de demostración (`MODO_DEMO=true`): la plataforma la rechaza como contraseña nueva y no permite ingresar con ella fuera de la demostración.

| Perfil | Correo |
|---|---|
| Coordinadora (Coordinación General + Trabajo Social) | marianella.becerra@demo.cgreg |
| Coordinación General (cuenta genérica de demostración) | coordinacion@demo.cgreg |
| Salud Mental con atención en curso (registro por pasos) | hugo@demo.cgreg |
| Salud Mental | gabriel@demo.cgreg · sofia@demo.cgreg · betsabe@demo.cgreg · maria@demo.cgreg · sally@demo.cgreg (Sally Tinizaray Soriano) |
| Salud Mental + función territorial | andrea@demo.cgreg |
| Psiquiatría | diego@demo.cgreg |
| Apoyo Epidemiológico y Territorial | demetrio@demo.cgreg |
| Autoridad · Auditoría · Administración | autoridad@demo.cgreg · auditoria@demo.cgreg · admin@demo.cgreg |

La primera vez la carga de datos tarda un par de minutos más: la plataforma limita los ingresos por minuto y el script lo respeta.
