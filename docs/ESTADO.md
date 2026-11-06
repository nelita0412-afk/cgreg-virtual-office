# Estado de la implementación

Verificación: `npm test` ejecuta **67 pruebas**: las 37 originales sin cambios, 26 de la ampliación y 4 de etiquetas, contra PostgreSQL real. `npm run e2e` hace **14 comprobaciones con navegador** (10 originales y 4 nuevas) más **10 comprobaciones de movimiento** (`npm run e2e:movimiento`).

> Las 37 pruebas originales registran el consentimiento con la «constancia profesional» anterior a la ampliación; su instancia de prueba la habilita (`CONSENTIMIENTO_CONSTANCIA_PROFESIONAL=true`). En la configuración por defecto, la constancia **no** habilita la atención; las pruebas nuevas y el E2E usan esa configuración y el consentimiento documentado.

## Ampliación funcional (noviembre 2026)

### Implementado y verificado

| Componente | Evidencia |
|---|---|
| Base maestra «Personal» (gid 1340025527) identificada por metadatos; solo `ID_Distributivo`, nombre, unidad, estado y `Contacto_Validado` (Sí/No) | `ampliacion.test.ts` §1 |
| Filtro de Santa Cruz por la unidad registrada; los registros de otras unidades no se almacenan | §1 |
| Lectura exclusiva de «Personal» y «Valoraciones»; las demás pestañas nunca se consultan | §1 |
| Valoraciones vinculadas por `ID_Distributivo` (no por nombre); sin respuestas ni datos sensibles | §1 |
| Riesgo alto desde la matriz solo con columna confirmada (coincidencia literal; retiro sin borrado si cambia) | §2 |
| Atención prioritaria: cola operativa para Coordinación sin detalle clínico; detalle solo para el profesional asignado; la autoridad solo ve conteos | §3A |
| Clasificación profesional registrada por el profesional asignado (con confirmación, sin algoritmos) y retirable con motivo | §3A |
| Atención abierta: formulario público sin cuenta, verificación contra la base maestra, «pendiente de verificación» sin rechazo, campo trampa, límite de frecuencia y respuesta idéntica | §3B, E2E |
| Asignación de solicitud abierta → registro provisional + atención pendiente → programación con la agenda existente → estados sincronizados | §3B |
| Consentimiento electrónico con enlace de un solo uso, verificación de identidad y evidencia | §6–8, E2E (firma en el navegador) |
| Consentimiento firmado a mano: carga cifrada, tipo de archivo por firma binaria, validación o corrección, versiones del documento, descarga autenticada y auditada | §6–8 |
| Formatos institucionales en PDF (3 servicios, v1.0 en borrador) con versiones, aprobación por un administrador y marca «NO VÁLIDO» en borradores | §6–8 |
| El aviso de privacidad de la matriz no cuenta como consentimiento; el retiro bloquea la atención ordinaria sin borrar; inicio por urgencia justificado, auditado y notificado | §6–8 |
| Historia clínica: expediente único por servidor (`HC-#####`), apertura automática en la primera atención, entrada cronológica por atención con versiones, validación con huella, adendas, áreas (Psicología, Medicina, Psiquiatría), secciones versionadas | §4–5, E2E |
| Inmutabilidad en la base de datos: entradas validadas, versiones, adendas, documentos, consentimientos y atenciones cerradas | §4–5 |
| Continuidad asistencial por relación asistencial; entradas «restringidas»; Coordinación administrativa sin notas; Trabajo Social con registros separados | §4–5, E2E |
| Auditoría de cada lectura, cambio y descarga | §4–5 |
| Centro de Comando: atención prioritaria, atención abierta, historias clínicas y consentimiento (solo agregados) + CSV | §9 |
| Rol Trabajo Social (fuera de la oficina virtual y de los 8 profesionales) | §4–5 |
| Notas clínicas anteriores migradas al expediente sin descifrarlas (vista de compatibilidad `clinical.notas_atencion`) | migración 003 |

### Depende de credenciales

- **Google Sheets:** sin la cuenta de servicio no se importa ningún servidor real. La integración está lista (`SHEETS_MAESTRA_GID=1340025527` en `.env.example`); ver `docs/GOOGLE_SHEETS.md` y `npm run sheets:check`.

### Requiere confirmación o aprobación institucional

| Tema | Qué se necesita |
|---|---|
| Clasificación de riesgo en la matriz | «Valoraciones» **no tiene** un campo explícito. Confirmar la columna, los valores de «riesgo alto», su validación profesional y la columna de seguimiento, o agregarlas. Hasta entonces, solo hay clasificación registrada por profesionales en la plataforma. |
| Ubicación laboral | «Personal» no tiene una columna de ubicación. Confirmar que `Unidad_Organica = DIRECCIÓN DISTRITAL SANTA CRUZ` equivale a «labora en Santa Cruz». |
| Datos de contacto | «Personal» no tiene teléfono ni correo. Hoy se usan `Canal_Contacto` (de «Valoraciones») y el contacto declarado en las solicitudes abiertas. |
| Formatos de consentimiento | Revisión jurídica y aprobación de la v1.0 de los tres servicios (Configuración → Formatos). **Sin aprobación no se puede iniciar ninguna atención ordinaria.** |
| Firma electrónica | Decidir si la aceptación electrónica simple es suficiente o si se exige firma con certificado. |
| Constancia profesional anterior | Decidir si se acepta durante una transición (`CONSENTIMIENTO_CONSTANCIA_PROFESIONAL`). |
| Visibilidad de la ruta prioritaria para Coordinación | Validar el criterio actual (dato operativo sin detalle clínico). |
| Conservación y LOPDP | Plazos de conservación, bases de legitimación y textos (delegado de protección de datos). |

### Parcial

- Notificaciones solo dentro de la plataforma (sin correo ni SMS). El enlace de consentimiento se copia y se comparte por un canal institucional.
- Sin verificación criptográfica de PDF firmados con certificado.
- Las intervenciones sociales no tienen adendas (cada corrección se hace con un nuevo registro).
- El horario semanal se edita por API (sin editor visual), igual que antes.

## Rediseño visual de la oficina 3D (noviembre 2026)

Sin cambios en el backend (Fastify/PostgreSQL), las migraciones ni los módulos funcionales.

### Implementado y verificado en navegador

- Planta premium con ventanal panorámico, mamparas de cristal, materiales y mobiliario detallados; seis consultorios individuales, Telemedicina y Psiquiatría separadas, seis estaciones de Psicología espaciadas.
- Avatares articulados con vestimenta profesional y posturas por estado; se levantan, recorren pasillos y puertas, y se sientan solo ante eventos reales del backend.
- Nitidez: DPR nativo hasta 2, antialiasing, ACES, sRGB, anisotropía; calidad adaptativa con indicador de FPS.
- Interfaz: el lienzo ocupa el 69 % de la ventana (antes, 29 %) y el 100 % en pantalla completa; KPI compactos; panel contextual superpuesto; vista general que encuadra toda la oficina.
- Etiquetas sin superposición con líneas de referencia, abreviadas según el zoom; clic en persona (resalta y centra) y en sala (ficha del departamento).
- `npm run e2e:movimiento`: 10 comprobaciones (Gabriel inicia y finaliza la consulta, Demetrio en teleconsulta, Betsabé en Debriefing, ningún avatar camina sin eventos, 0 solapes de etiquetas), con capturas de cada transición en `e2e/out/`.

### Limitaciones conocidas

- Los FPS medidos en este entorno (1–4 FPS) corresponden a renderizado por software sin GPU y no son representativos; el indicador de la propia oficina muestra los FPS reales en cada equipo.
- Las animaciones son procedurales (sin captura de movimiento); los rostros son estilizados, sin expresiones.
- Con la cámara en movimiento, las etiquetas se reacomodan cada 80 ms; durante una transición pueden cambiar de posición brevemente.
- Las texturas (ventanal, pisos, pantallas) se generan por código; no hay fotografías reales.

## Funcionalidad previa (se conserva)

Oficina virtual 3D con avatares por eventos reales, presencia por WebSocket, agenda con conversión horaria y bloqueo de choques, atenciones, derivaciones a Psiquiatría, Mis Solicitudes y Gestiones, Debriefing, Capacitación DECE, Articulación territorial, Reportes, Auditoría y roles. Verificado por las 37 pruebas y las 10 comprobaciones E2E originales.

## Fuera del alcance

- Herramienta de videollamada (la plataforma coordina y registra).
- Segundo factor de autenticación.
- Copias de seguridad automáticas (procedimiento documentado).
