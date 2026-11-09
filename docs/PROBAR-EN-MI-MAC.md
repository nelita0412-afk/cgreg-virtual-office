# Probar CGREG Virtual Office en su Mac (datos ficticios)

Todo ocurre en su computadora, con una base de datos de demostración llamada `cgreg_demo`. No usa datos reales ni publica nada.

## Una sola vez: preparar la Mac

Abra la app **Terminal** y pegue, una por una:

```bash
brew install node postgresql@16 git
```

```bash
brew services start postgresql@16 && brew link postgresql@16 --force
```

```bash
git clone -b app-movil-2.0 https://github.com/nelita0412-afk/cgreg-virtual-office.git && cd cgreg-virtual-office
```

(Si no tiene Homebrew, instálelo antes desde https://brew.sh.)

## Abrir la app en la computadora

```bash
./scripts/demo/probar-en-mac.sh
```

Se abre sola en el navegador: **http://localhost:4000**. La primera vez tarda unos minutos.

## Abrirla en el iPhone o Android (HTTPS temporal + QR)

Una sola vez, instale el túnel temporal de Cloudflare (gratuito, sin cuenta):

```bash
brew install cloudflared
```

Luego, en lugar del comando anterior:

```bash
./scripts/demo/probar-en-mac.sh --iphone
```

La Terminal muestra un enlace `https://….trycloudflare.com`.
- **QR**: abra ese enlace en Chrome de la Mac → ícono **Compartir** en la barra de direcciones → **Crear código QR** → escanéelo con la cámara del teléfono.
- O envíe el enlace al iPhone por AirDrop o Mensajes.

El enlace deja de funcionar al cerrar la Terminal (Ctrl + C). Cualquiera con el enlace podría ver la pantalla de ingreso mientras esté abierto: no lo comparta.

## Instalar en la pantalla de inicio
- **iPhone (Safari)**: Compartir → **Agregar a inicio** → Agregar.
- **Android (Chrome)**: botón **Instalar** en la app, o menú ⋮ → **Instalar aplicación**.

## Usuarios de prueba (contraseña `Demo-CGREG-2026`)
| Perfil | Correo |
|---|---|
| Coordinación | coordinacion@demo.cgreg |
| Profesional con atención en curso (registro por pasos) | hugo@demo.cgreg |
| Profesional con borrador por validar | demetrio@demo.cgreg |
| Profesional | gabriel@demo.cgreg |
| Autoridad | autoridad@demo.cgreg |
| Administración | admin@demo.cgreg |
