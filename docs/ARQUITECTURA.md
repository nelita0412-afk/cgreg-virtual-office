# Arquitectura

## Decisiones

| Necesidad | Elección | Motivo |
|---|---|---|
| Frontend | React 18 + TypeScript + Vite + Tailwind | SPA rápida; la oficina 3D no se beneficia de SSR |
| Oficina virtual | three.js + React Three Fiber + drei | Escena isométrica con componentes reales (no una imagen de fondo) |
| Backend | Fastify 5 + TypeScript | Rendimiento, WebSocket nativo, validación con zod |
| Persistencia | PostgreSQL (SQL plano + migraciones) | Restricciones de exclusión (`btree_gist`) para impedir choques de agenda en la propia base |
| Tiempo real | WebSocket propio + `LISTEN/NOTIFY` de PostgreSQL | Sin dependencia de terceros; solo se difunde lo que confirmó una transacción; funciona con varias instancias |
| Auth | Sesiones en servidor (cookie httpOnly, SameSite=Strict) + bcrypt | Revocables, auditables, sin tokens en el navegador |

Se evaluó Supabase (Auth + Realtime). Se optó por un backend propio porque la regla central —«no representar actividad que el backend no haya confirmado»— se garantiza emitiendo el evento **dentro de la misma transacción** que el cambio de estado (`pg_notify` solo se entrega al confirmar). Migrar a Supabase es viable: el esquema es PostgreSQL estándar.

## Estructura

```
shared/            Catálogos de dominio, permisos y motor de agenda/zonas horarias (usado por backend y frontend)
server/
  app.ts           Composición de Fastify (helmet/CSP, rate-limit, cookies, websocket, estáticos)
  auth.ts          Login, bloqueo por intentos, sesiones con caducidad por inactividad y absoluta, guardas por permiso
  presence.ts      Máquina de estados de presencia y zonas de la oficina
  realtime.ts      Canal WebSocket: heartbeat, gracia de reconexión, difusión de eventos
  events.ts        Bus de eventos persistido (ops.eventos) + LISTEN/NOTIFY
  agenda.ts        Disponibilidad efectiva = reglas semanales (zona de origen) + franjas confirmadas
  sheets/          Cliente de solo lectura y sincronización programada de la matriz
  routes/          Módulos HTTP (oficina, agenda, atenciones, servidores, derivaciones, solicitudes, actividades, dashboard, admin)
  cli/             migrate, create-user, sheets-check
db/migrations/     001_esquema.sql (esquema), 002_profesionales.sql (registro de los profesionales)
web/src/
  office/          Escena 3D (layout.ts, Scene.tsx, Avatar.tsx, Furniture.tsx)
  pages/           Módulos de la interfaz
  lib/             Cliente API, tiempo real, sesión, formato horario
tests/             Unitarias (zonas horarias, agenda, permisos) e integración (API + BD real)
e2e/               Prueba de humo con navegador
```

## Modelo de datos

Esquemas separados por naturaleza del dato:

- **core** — `profesionales`, `disponibilidad` (en zona de origen), `franjas_confirmadas`, `usuarios`, `sesiones`.
- **ops** — `servidores` + `registros_fuente` (relación estable con `ID_Valoracion` de la matriz), `asignaciones`, `consentimientos`, `contactos`, `atenciones` (+ historial), `derivaciones` (+ historial), `seguimientos`, `necesidades`, `solicitudes` + `solicitud_acciones`, `debriefings`, `capacitaciones`, `articulaciones`, `presencia` (+ historial), `eventos`, `notificaciones`, `sync_ejecuciones`.
- **clinical** — `notas_atencion`, `derivacion_detalle`: contenido **cifrado AES-256-GCM** a nivel de aplicación. Ninguna consulta de dashboard, feed o auditoría lo toca.
- **audit** — `registro`: solo inserción (disparadores impiden UPDATE/DELETE/TRUNCATE).

### Ampliación (migraciones 003 y 004)

- **ops.servidores** + `unidad`, `estado_servidor`, `en_base_maestra`, `en_santa_cruz`, `verificacion`, `origen` (`matriz_personal` | `matriz_valoraciones` | `solicitud_abierta`). `ops.registros_fuente` cubre ahora «Personal» y «Valoraciones» (`tipo`).
- **clinical.clasificaciones_riesgo**: solo de fuente profesional (matriz confirmada o registro en la plataforma); se retiran, no se borran.
- **ops.solicitudes_atencion** (+ historial): atención abierta; contacto y motivo cifrados.
- **clinical.expedientes** (uno por servidor), **expediente_secciones** (versionadas por área), **entradas** (una por atención; borrador → validada con huella), **entrada_versiones**, **adendas**. `clinical.notas_atencion` pasó a ser una vista de compatibilidad.
- **ops.consentimiento_plantillas** (formatos versionados con aprobación), **ops.consentimientos** + `modalidad`, `estado`, `plantilla_id`, `documento_id` y `evidencia`; **consentimiento_historial**, **consentimiento_tokens** (hash) y **clinical.documentos** (archivos cifrados en `bytea`).
- **social.intervenciones**: Trabajo Social, separado de lo clínico.
- Disparadores de inmutabilidad (`clinical.solo_insercion`, `proteger_entrada_validada`, `ops.proteger_atencion_cerrada`).

Servicios nuevos: `server/hce.ts` (nivel de acceso por relación asistencial, validez del consentimiento, apertura de expediente o entrada), `server/pdf.ts` (formatos PDF con pdf-lib y detección de tipo de archivo), y las rutas `routes/hce.ts`, `routes/consentimientos.ts` y `routes/rutas.ts` (atención prioritaria y abierta, formularios públicos).

Garantías en la base de datos: `atencion_sin_choque_profesional` y `atencion_sin_choque_servidor` son restricciones `EXCLUDE USING gist` sobre `tstzrange(inicio, fin)` para los estados que reservan agenda (programada, confirmada, en atención). Dos reservas simultáneas no pueden coexistir aunque lleguen en paralelo.

## Zonas horarias

Los profesionales trabajan en `America/Guayaquil`; la institución opera en `Pacific/Galapagos`. Las reglas semanales se guardan **en la zona de origen** y se expanden a instantes UTC con la base IANA (luxon), por lo que la conversión no supone una diferencia fija. La interfaz muestra siempre la hora de Galápagos. Las equivalencias del encargo están verificadas en `tests/schedule.test.ts`.

Psiquiatría (Dr. Diego Estrella) no tiene horario fijo: su agenda se habilita con **franjas confirmadas** que registra él o Coordinación.

## Presencia y avatares

```
WebSocket abierto ──► conectar(): «Disponible» en su estación (o recupera actividad en curso)
heartbeat cada 10 s ─► ultimo_heartbeat
cierre de pestaña ──► 12 s de gracia ► «Desconectado» (sale por la entrada)
sin heartbeat 45 s ─► barrido ► «Desconectado»
Iniciar atención ───► «En consulta» → consultorio (psicología / telemedicina / psiquiatría)
Finalizar ──────────► «En documentación» en su estación → al guardar la nota, «Disponible»
Iniciar debriefing / capacitación ► «En reunión» → sala correspondiente
Pausa (manual) ─────► «En pausa» → zona de pausa
```

- Si un profesional sin conexión inicia una actividad (p. ej. desde otro dispositivo sin la oficina abierta), la actividad se registra pero **no se dibuja presencia**.
- «Fuera de horario» y «Desconectado» se distinguen comparando la conexión real con la disponibilidad programada; quien se conecta fuera de horario aparece con su estado real y una advertencia.
- No hay GPS, cámaras ni capturas de pantalla.
- Al cargar la oficina se ubica a cada avatar directamente en su posición (recuperación de estado); solo los cambios posteriores se animan como desplazamientos por los pasillos.

## Oficina virtual 3D (rediseño visual)

- **Planta** de 64 × 40 m (`web/src/office/layout.ts`): fila posterior con Debriefing, Capacitación DECE y Psiquiatría; fila central con seis consultorios individuales de Psicología, Coordinación, Articulación Territorial y Telemedicina; fila frontal con las seis estaciones de Psicología (9 m entre centros) y zona de pausa. Las rutas recorren pasillos y entran por puertas (no atraviesan cristal).
- **Avatares articulados** (`Human.tsx`): caderas, rodillas, hombros, codos y cabeza; vestimenta por profesional (bata para Medicina y Psiquiatría). Posturas derivadas del estado real: trabajar o teclear (documentación), conversar (consulta o reunión), presentar (capacitación), relajado (pausa). Se levantan antes de caminar y se sientan al llegar. Bata blanca para todo el personal clínico (psicólogas/os y médicos; estetoscopio en Medicina).
- **Movimiento ambiental** (botón de huellas en la barra; activo por defecto, `?ambiente=0` lo desactiva): quien no está en consulta ni en reunión da paseos breves (dispensador de agua, impresora, tablero informativo o estirarse en el pasillo; como máximo 26 m de recorrido) y vuelve a su puesto. Es solo visual: **no cambia el estado real** (la etiqueta sigue mostrándolo) y cualquier evento real del backend lo interrumpe y tiene prioridad. Quien no está conectado no aparece.
- **Etiquetas inteligentes** (`labels.ts`, superposición HTML nítida): reparto sin solapes con líneas de referencia, modo abreviado según el zoom, prioridad del seleccionado y zonas reservadas (barra y panel). Función pura con pruebas (`tests/labels.test.ts`).
- **Calidad**: resolución nativa (DPR hasta 2), antialiasing, mapeo tonal ACES, sRGB, texturas procedurales con filtro anisotrópico máximo, sombras suaves y entorno de reflejos local (sin recursos externos). La geometría estática se fusiona por material (`Fusionar.tsx`): unas 320 llamadas de dibujo con la oficina completa en pantalla (80–170 en vistas de departamento) en lugar de más de 2.000.
- **Cámara**: zoom 1 encuadra la oficina completa (proyección isométrica de ~74 × 40 unidades). Cada departamento tiene su vista; al seleccionar a una persona la cámara se centra en ella dentro del área visible, descontando el panel lateral abierto.
- **Calidad adaptativa**: baja la resolución en pasos de 0,25 solo si los FPS caen de forma sostenida y, como último recurso, desactiva las sombras. `?calidad=baja` fuerza el modo liviano. El indicador inferior muestra FPS, calidad y DPR reales.
- **Prueba visual de movimiento**: `npm run e2e:movimiento` verifica en el navegador que los avatares se desplazan y adoptan la postura correcta ante eventos reales (consulta, telemedicina, debriefing), que las etiquetas no se superponen y que el movimiento ambiental hace pasear a quien está disponible sin levantar a quien atiende ni cambiar su estado.

## Rendimiento y accesibilidad

- `PerformanceMonitor` reduce resolución y desactiva sombras si los FPS caen; animaciones basadas en tiempo real.
- El paquete 3D se carga de forma diferida; si no hay WebGL o la pantalla es pequeña se usa la **vista en lista** (conmutable).
- `prefers-reduced-motion`: los avatares cambian de posición sin caminar.
- La escena tiene una lista equivalente accesible por teclado; navegación por departamentos con botones.

## App móvil 2.0 (PWA instalable)

- **Instalación**: `web/public/manifest.webmanifest` (pantalla completa, accesos directos, íconos 192/512 y adaptable) e íconos de iPhone. En Android/Chrome la app ofrece el diálogo del sistema; en iPhone (Safari) muestra la guía «Compartir → Agregar a pantalla de inicio». **Requiere HTTPS** en producción (los navegadores solo habilitan service worker y push en `https://` o `localhost`).
- **Service worker** (`web/public/sw.js`): guarda solo la interfaz (HTML de arranque, JS/CSS con hash, íconos, fuentes y `offline.html`). **Nunca intercepta `/api` ni `/ws`**: ningún dato de servidores, atenciones, historias clínicas o consentimientos se guarda en el teléfono. Además todas las respuestas de `/api` llevan `Cache-Control: no-store`. Las versiones nuevas se ofrecen con «Actualizar»; en la primera visita no recarga la página.
- **Red inestable**: React Query reintenta con espera creciente solo ante cortes de red o errores 5xx (nunca 4xx), vuelve a consultar al recuperar la señal y mantiene la caché solo en memoria. Sin señal, la app lo indica (banda o pantalla «Sin conexión») y los formularios conservan lo escrito.
- **Navegación por perfil** (`components/AppMovil.tsx`): por debajo de 1024 px hay barra inferior con 4 destinos según el rol y el panel «Más» con el resto de módulos permitidos. Profesional: Mi día · Agenda · Atenciones · Solicitudes. Coordinación: Mi día · Solicitudes · Agenda · Derivaciones. Los permisos son los mismos del servidor.
- **«Mi día»** (`pages/Inicio.tsx`, `/inicio`): portada del teléfono, con datos reales: próxima atención, agenda de hoy, seguimientos (vencidos resaltados), solicitudes, derivaciones y cambio de estado de presencia (profesional); alertas operativas, bandeja e indicadores (Coordinación). En escritorio la portada sigue siendo la oficina 3D; en el teléfono la oficina está en `/oficina`.
- **Servidores institucionales (sin cuenta)**: `/servidor`, portal móvil con ECU 911, acceso al formulario de atención abierta y explicación del consentimiento por enlace.
- **Listas táctiles** (`components/Tarjetas.tsx`): atenciones, seguimientos, solicitudes, derivaciones y servidores se muestran como tarjetas en el teléfono y como tabla en escritorio.
- **Notificaciones push** (`server/push.ts`, migración `005_push.sql`): Web Push con claves VAPID (`npm run push:claves`). Sin claves, siguen las notificaciones dentro de la app. El aviso sale después del commit desde el bus de eventos y lleva solo el título breve y el enlace interno (nunca el cuerpo ni datos clínicos, porque puede verse en la pantalla bloqueada). Al cerrar sesión se anula la suscripción del dispositivo; las suscripciones caducadas (404/410) se eliminan solas.
- **Pruebas**: `tests/app-movil.test.ts` y `npm run e2e:movil` (iPhone emulado).

## Segunda evolución 2.0

- **Tema**: `tailwind.config.js` redefine las familias heredadas del tema oscuro (`white`, `slate`, `cyan`, `sky`, `blue`, colores de estado) hacia la paleta clara, y añade nombres semánticos (`salvia`, `eucalipto`, `marfil`, `arena`, `profundo`, `nieve`). Las variables de `web/src/styles.css` (`--bg`, `--ink`, `--accent`, `--sand`, `--ease-out`, `--ease-drawer`) son la fuente para estilos en línea.
- **Animaciones**: solo `transform`/`opacity`, curvas de salida fuertes, menos de 300 ms; las entradas usan `animation-fill-mode: backwards` para no dejar contextos de apilamiento que atrapen diálogos fijos.
- **Gestos**: `lib/gestos.ts` (`useDeslizarHorizontal`) toma el gesto solo si es claramente horizontal y deja libre el desplazamiento vertical; `components/HojaInferior.tsx` se monta en un portal, se cierra arrastrando, con Escape o tocando el fondo, y devuelve el foco.
- **Registro clínico por pasos**: usa el mismo `PUT /api/atenciones/:id/nota` (cifrado y versionado). El borrador vive solo en memoria.
- **Consulta pública del estado**: `POST /api/publico/solicitud-estado` (10 intentos/15 min por dirección). La clave (≈48 bits, alfabeto sin caracteres ambiguos) se guarda como HMAC-SHA256 con un secreto del servidor y se compara en tiempo constante; códigos inexistentes y claves erróneas dan la misma respuesta. Solo el formulario público entrega clave.
- **Push de prueba**: `POST /api/push/prueba` (5 cada 10 min) envía solo a las suscripciones de quien lo pide.
- **Pruebas E2E del push**: el modo *headless shell* de Playwright niega las notificaciones; `e2e/app-movil.mjs` usa Chromium completo sin ventana y entrega el mensaje al service worker por CDP.

