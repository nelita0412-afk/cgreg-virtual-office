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

```bash
git clone -b app-movil-2.0 https://github.com/nelita0412-afk/cgreg-virtual-office.git
```

## 2. Abrir la app en la Mac

```bash
cd cgreg-virtual-office && ./scripts/demo/probar-en-mac.sh
```

Se abre sola en el navegador (normalmente `http://localhost:4000`). Ctrl + C para detener.
Para volver a abrirla otro día con la misma base:

```bash
./scripts/demo/probar-en-mac.sh --autorizo-reutilizar
```

## 3. Abrirla en el iPhone (HTTPS privado con Tailscale)

Una sola vez:
1. En la Mac: `brew install --cask tailscale-app`, abra **Tailscale** e inicie sesión.
2. En el iPhone: instale **Tailscale** desde el App Store e inicie sesión con **la misma cuenta**.
3. En la consola de Tailscale (login.tailscale.com → **DNS**): active **MagicDNS** y **HTTPS Certificates**.

Luego, en la Mac:

```bash
./scripts/demo/probar-en-mac.sh --autorizo-reutilizar --iphone
```

(Si es la primera vez y aún no creó la base, use solo `--iphone`.)

La Terminal muestra un enlace `https://<su-mac>.<su-tailnet>.ts.net`. Ábralo en Safari del iPhone con Tailscale conectado.
**QR**: abra ese enlace en Chrome de la Mac → ícono **Compartir** de la barra de direcciones → **Crear código QR**.

## 4. Instalar en la pantalla de inicio
- **iPhone (Safari)**: Compartir → **Agregar a inicio** → Agregar. Se abre a pantalla completa como una app.
- **Android (Chrome)**: botón **Instalar** en la app, o menú ⋮ → **Instalar aplicación**.

## Compatibilidad con macOS
El script funciona con el Bash que trae macOS (3.2) y con versiones nuevas. En el Bash de macOS, un texto como `«$BASE»` hacía que el `»` se leyera como parte del nombre de la variable (`BASE?: unbound variable`); por eso todas las variables del script van entre llaves (`${BASE}`). Una prueba automática (`tests/scripts-demo.test.ts`) impide que vuelva a ocurrir.

Para usar otro nombre de base (siempre nueva y con «demo» en el nombre):

```bash
BASE=cgreg_demo_prueba_20261108 ./scripts/demo/probar-en-mac.sh
```

## Usuarios de prueba (contraseña `Demo-CGREG-2026`)
| Perfil | Correo |
|---|---|
| Coordinadora (Coordinación General + Trabajo Social) | marianella.becerra@demo.cgreg |
| Coordinación General (cuenta genérica de demostración) | coordinacion@demo.cgreg |
| Salud Mental con atención en curso (registro por pasos) | hugo@demo.cgreg |
| Salud Mental | gabriel@demo.cgreg · sofia@demo.cgreg · betsabe@demo.cgreg · maria@demo.cgreg · sally@demo.cgreg |
| Salud Mental + función territorial | andrea@demo.cgreg |
| Psiquiatría | diego@demo.cgreg |
| Apoyo Epidemiológico y Territorial | demetrio@demo.cgreg |
| Autoridad · Auditoría · Administración | autoridad@demo.cgreg · auditoria@demo.cgreg · admin@demo.cgreg |

La primera vez la carga de datos tarda un par de minutos más: la plataforma limita los ingresos por minuto y el script lo respeta.
