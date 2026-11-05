# CGREG Virtual Office

**Centro Digital de Operaciones de Atención Interdisciplinaria** — Consejo de Gobierno del Régimen Especial de Galápagos (Santa Cruz).

Plataforma institucional para coordinar y monitorear la respuesta psicosocial y de salud a los servidores del CGREG afectados por el fenómeno de El Niño. Su núcleo es una **oficina virtual isométrica 3D** donde los avatares de los ocho profesionales se mueven **solo en respuesta a eventos reales confirmados por el backend** (conexión, inicio/fin de consulta, debriefing, capacitación, pausa), acompañada de agenda con conversión horaria, atenciones con documentación clínica cifrada, derivaciones a Psiquiatría, la bandeja **«Mis Solicitudes y Gestiones»** de Coordinación General, indicadores ejecutivos y auditoría.

> No hay datos de demostración: la plataforma arranca solo con los ocho profesionales (y la colaboradora territorial) del encargo. Todo lo demás —servidores, citas, atenciones, solicitudes— se genera por uso real o por la sincronización con la matriz institucional.

## Inicio rápido (desarrollo)

Requisitos: Node.js ≥ 20 y PostgreSQL ≥ 14 (con la extensión `btree_gist`, incluida en `postgresql-contrib`).

```bash
npm install
cp .env.example .env    # complete DATABASE_URL y DATA_ENCRYPTION_KEY (openssl rand -base64 32)
npm run db:migrate
npm run user:create -- --email coordinacion@cgreg.gob.ec --nombre "Nombre de la Coordinadora" --rol coordinacion
npm run dev             # API en :4000, web en http://localhost:5173
```

Cada profesional necesita una cuenta vinculada a su registro (los identificadores están en `db/migrations/002_profesionales.sql`):

```bash
npm run user:create -- --email gabriel@... --nombre "Gabriel Ordóñez" --rol profesional --profesional gabriel-ordonez
```

O desde **Configuración → Usuarios y roles** con una cuenta `admin`. Las contraseñas temporales se cambian obligatoriamente en el primer ingreso.

## Producción

```bash
npm run build      # typecheck + frontend (dist/web) + servidor (dist/server)
npm start          # aplica migraciones pendientes y sirve API + frontend en PORT
```

Detrás de un proxy HTTPS: `COOKIE_SECURE=true`, `TRUST_PROXY=true` y soporte de WebSocket en `/ws`. Ver [docs/SEGURIDAD.md](docs/SEGURIDAD.md) (copias de seguridad, claves).

## Pruebas

```bash
npm test           # 63 pruebas unitarias y de integración contra PostgreSQL real (BD cgreg_test)
npm run build && npm run e2e   # 14 comprobaciones E2E con navegador: WebSocket, avatares, consentimiento, atención abierta, historia clínica
```

`TEST_DATABASE_URL` controla la base de pruebas (se **borra** en cada ejecución; nunca apunte a producción). El E2E requiere Playwright (`npm i -D playwright && npx playwright install chromium`).

## Páginas públicas (sin cuenta)

- `/solicitar-atencion`: atención abierta para cualquier servidor del CGREG en Santa Cruz (sin valoración previa).
- `/consentimiento/<enlace>`: aceptación electrónica del consentimiento informado (enlace personal de un solo uso).

> Antes de atender: un administrador debe **aprobar los formatos de consentimiento** (Configuración → Formatos de consentimiento) tras la revisión jurídica. Sin un formato aprobado no se puede registrar consentimiento ni iniciar atención ordinaria.

## Documentación

| Documento | Contenido |
|---|---|
| [docs/ESTADO.md](docs/ESTADO.md) | Qué está terminado, parcial o pendiente de credenciales |
| [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) | Arquitectura, modelo de datos, tiempo real, oficina 3D |
| [docs/GOOGLE_SHEETS.md](docs/GOOGLE_SHEETS.md) | Cómo autorizar la integración de solo lectura con la matriz |
| [docs/SEGURIDAD.md](docs/SEGURIDAD.md) | Roles, LOPDP, cifrado, auditoría, copias de seguridad |
