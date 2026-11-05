# Seguridad, confidencialidad y protección de datos

> Este documento describe controles técnicos. No es una opinión jurídica: la conformidad con la Ley Orgánica de Protección de Datos Personales (LOPDP), la normativa sobre historia clínica y la de firmas electrónicas debe validarla el delegado de protección de datos y el área jurídica del CGREG.

## Roles (mínimo privilegio)

| Rol | Puede | No puede |
|---|---|---|
| Administrador institucional | Usuarios, sesiones, integración, auditoría, **aprobar formatos de consentimiento**, validar consentimientos | Leer contenido clínico, gestionar solicitudes |
| Coordinación General | Oficina, Centro de Comando, bandeja de solicitudes, asignaciones, agenda, cola prioritaria (dato operativo), atención abierta (verificación y asignación), metadatos de historias clínicas, consentimientos (gestión documental) | Leer notas clínicas, motivos, valoraciones ni el detalle de la clasificación de riesgo |
| Profesional clínico (Psicología, Medicina, Psiquiatría) | Su agenda, servidores con relación asistencial, historia clínica (continuidad), registrar y validar atenciones, derivar, clasificación de riesgo propia, consentimientos | Ver servidores sin relación asistencial, entradas «restringidas» de otros autores, escribir en el área de otra especialidad |
| Trabajo Social | Sus servidores asignados, intervenciones sociales (registro separado), necesidades, solicitudes a Coordinación | Notas clínicas, secciones clínicas, clasificación de riesgo |
| Colaborador territorial | Oficina, articulación territorial, solicitar apoyo | Servidores, atenciones, historias |
| Autoridad | Indicadores agregados y reportes CSV | Cualquier dato personal o clínico |
| Auditoría | Bitácora de auditoría | Contenido clínico |

El backend aplica la matriz (`shared/permissions.ts`) y, para la historia clínica, un **nivel de acceso por relación asistencial** (`server/hce.ts`).

## Historia clínica electrónica y continuidad asistencial

| Nivel | Quién | Qué ve |
|---|---|---|
| Clínico | Profesional clínico con asignación activa, derivación (derivante o especialista), atenciones o entradas propias con ese servidor | Secciones por área, entradas cronológicas con confidencialidad «equipo clínico», sus propias entradas «restringidas», adendas, valoraciones psiquiátricas, intervenciones sociales, seguimientos |
| Social | Trabajo Social asignado | Intervenciones sociales y datos operativos; **sin** notas clínicas |
| Administrativo | Coordinación General | Código, fechas, responsable, número de registros por área, consultas, estados de consentimiento y derivación; **sin** contenido |

- **Integridad:** cada guardado de una entrada crea una versión. La validación genera una huella SHA-256; desde ese momento la entrada es inmutable (disparador en la base de datos) y solo admite **adendas** fechadas y con su propia huella. Las secciones son versionadas (cada cambio exige un motivo y conserva la versión anterior).
- **Sin borrado:** disparadores impiden eliminar atenciones, expedientes, entradas, versiones, adendas, documentos, consentimientos, clasificaciones e intervenciones sociales, y cambiar el estado de atenciones cerradas.
- **Separación:** esquemas `clinical` (historia clínica, documentos), `social` (intervención social), `ops` (operación) y `audit`. Los indicadores ejecutivos solo usan conteos.
- **Sin decisiones automáticas:** la plataforma no diagnostica ni clasifica riesgo. Las clasificaciones de riesgo provienen de un registro profesional (matriz confirmada o registro en la plataforma por el profesional asignado, con su confirmación expresa).

## Consentimiento informado

- Dos modalidades: **aceptación electrónica** (enlace personal de un solo uso, de 72 horas, guardado como hash; verificación del identificador institucional y del nombre, con 5 intentos como máximo; evidencia de fecha y hora, IP, agente y hash del documento presentado) y **documento firmado manualmente** (PDF, JPEG o PNG validado por su firma binaria, hasta 10 MB, cifrado AES-256-GCM en la base, sin enlaces públicos, descarga autenticada con `no-store` y auditada).
- Estados: pendiente, cargado, pendiente de validación, validado, requiere corrección y revocado (más «no otorgado» para constancias previas). Todo cambio queda en `ops.consentimiento_historial`, que es inmutable; los documentos reemplazados se conservan.
- Solo cuentan los consentimientos basados en un **formato aprobado** por la institución (con referencia del acto de aprobación). Los borradores se descargan con la marca «BORRADOR — NO VÁLIDO».
- El aviso de privacidad de la matriz **no** equivale a consentimiento informado.
- **Firma electrónica:** el mecanismo implementado es una aceptación electrónica simple con evidencias. Si la institución exige firma electrónica con certificado (Ley de Comercio Electrónico, Firmas Electrónicas y Mensajes de Datos), el PDF firmado con certificado puede cargarse por la vía documental; la verificación criptográfica del certificado no está integrada.
- **Urgencias:** un profesional puede iniciar una atención sin consentimiento documentado solo con una justificación. Queda cifrada, auditada y notificada a Coordinación como pendiente de regularizar.
- **Retiro:** se registra sin borrar nada; impide nuevas atenciones ordinarias.

## Formulario público (atención abierta)

Sin cuenta. Límite de 5 envíos por hora por IP, campo trampa contra automatizaciones, respuesta idéntica exista o no la persona en la base (evita enumeración), aceptación explícita del aviso de privacidad solo para tramitar la solicitud, contacto y motivo cifrados, y la IP guardada solo como hash.

## Controles generales

- **Autenticación:** bcrypt (coste 12), bloqueo de 15 minutos tras 5 intentos fallidos, límite de frecuencia, contraseña temporal de cambio obligatorio y mínimo de 12 caracteres.
- **Sesiones:** token de 256 bits (en la base solo su SHA-256), cookie `httpOnly` + `SameSite=Strict` (+ `Secure` en producción), caducidad por inactividad (30 minutos) y absoluta (12 horas), revocación.
- **CSRF:** cabecera `x-cgreg: 1` en las mutaciones autenticadas; el WebSocket valida `Origin`.
- **Cifrado:** contenido clínico, motivos, adendas, intervenciones sociales, contactos declarados y documentos con AES-256-GCM (`DATA_ENCRYPTION_KEY`). En tránsito, HTTPS en el proxy.
- **Auditoría:** inicio de sesión, lecturas clínicas (incluida la continuidad), consultas administrativas, versiones, validaciones, adendas, documentos (carga y descarga), consentimientos, clasificaciones de riesgo, inicios urgentes y verificaciones de atención abierta. La bitácora es inmutable.

## Claves y copias de seguridad

- `DATA_ENCRYPTION_KEY`: guárdela en un gestor de secretos y en un respaldo fuera de línea. **Sin ella, las historias clínicas y los documentos son irrecuperables.**
- Respaldo diario recomendado (cifrado y fuera del servidor; incluye documentos, que están en la base):
  ```bash
  pg_dump --format=custom --file=cgreg-$(date +%F).dump "$DATABASE_URL"
  ```
  Pruebe la restauración periódicamente. Ejecute la aplicación con un usuario de base de datos sin privilegios de superusuario: un superusuario puede deshabilitar disparadores.

## Pendiente de validación institucional

- Texto jurídico de los tres formatos de consentimiento (v1.0 en borrador) y su aprobación formal.
- Suficiencia legal de la aceptación electrónica simple frente a la firma con certificado.
- Plazos de conservación de la historia clínica y de los documentos.
- Criterio de acceso de Coordinación a la condición de «seguimiento prioritario» (hoy la ve como dato operativo, sin el detalle clínico).
- Protocolo de urgencias que habilita el inicio sin consentimiento documentado.
- Segundo factor de autenticación (no implementado).
