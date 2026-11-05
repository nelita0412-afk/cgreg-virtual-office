# Integración con la matriz institucional (Google Sheets)

Estado actual: **implementada y probada con una API simulada; sin credenciales reales.** Mientras no se configuren, la plataforma muestra «no configurado», no importa servidores y no simula ninguna conexión.

Documento: `1hsrY0A8tqXUUDLuNK4Y3Sr_BFFhUjt5Hfw9kEo8DguE`. Garantías comunes:

1. **Ámbito OAuth `spreadsheets.readonly`**: la credencial no puede escribir aunque se intentara.
2. Solo solicitudes `GET`: metadatos (`sheetId`, `title`), la fila 1 de cada pestaña autorizada y `values:batchGet` de las columnas mapeadas.
3. **Pestañas autorizadas: «Personal» y «Valoraciones».** «Seguimiento», «Dashboard» y «Catalogos» nunca se leen (verificado en `tests/ampliacion.test.ts`).
4. Si falta un encabezado obligatorio, la sincronización falla con un mensaje claro y no importa nada.
5. Los registros que desaparecen se marcan como no vigentes (no se borran: trazabilidad).
6. La matriz **nunca** recibe datos de la plataforma.

## 1. Base maestra de personal — pestaña «Personal» (gid `1340025527`)

Identificada por los metadatos del documento. Encabezados reales (fila 1, verificados el 5/11/2026):

`ID_Distributivo, Nombres_Apellidos, Cargo, Regimen_Laboral, Unidad_Organica, Estado_Distributivo, Contacto_Validado, Encuesta_Recibida, Prioridad_Social, Ultimo_Contacto, Observacion_Administrativa`

| Dato solicitado | Columna real | Se importa |
|---|---|---|
| Identificador institucional | `ID_Distributivo` | Sí (vínculo estable con «Valoraciones») |
| Nombre completo | `Nombres_Apellidos` | Sí |
| Unidad o área | `Unidad_Organica` | Sí |
| Ubicación laboral | **No existe** | — (ver filtro) |
| Datos de contacto | **No existen** (no hay teléfono ni correo) | `Contacto_Validado` solo si su valor es Sí/No; cualquier otro valor se descarta |
| Estado del servidor | `Estado_Distributivo` | Sí |

No se importan `Cargo`, `Regimen_Laboral`, `Encuesta_Recibida`, `Prioridad_Social`, `Ultimo_Contacto` ni `Observacion_Administrativa`.

### Filtro de Santa Cruz

La pestaña no tiene una columna de ubicación laboral. El filtro usa la unidad registrada: se importan los registros cuya `Unidad_Organica` contiene «SANTA CRUZ» (sin distinguir mayúsculas ni tildes). Los registros de otras unidades **no se almacenan**. Al 5/11/2026 los 105 registros tienen `Unidad_Organica = DIRECCIÓN DISTRITAL SANTA CRUZ` y estado `ACTIVO` o `NOMBRAMIENTO PROVISIONAL` (se revisaron solo esas dos columnas categóricas, sin nombres ni contactos).

**Pendiente de confirmación institucional:** que «Dirección Distrital Santa Cruz» equivale a «labora en Santa Cruz», o bien agregar una columna de ubicación laboral (`SHEETS_UBICACION_COLUMNA`).

## 2. Valoraciones — pestaña «Valoraciones» (gid `133021335`)

Encabezados reales: `ID_Valoracion, Fecha_Registro, ID_Distributivo, Servidor, Sector_Residencia, Situacion_Seguridad, Afectacion_Vivienda, Evacuacion, Integrantes_Hogar, Familiares_Afectados, Grupos_Atencion_Prioritaria, Necesidades_Sociales, Necesidad_Atencion_Salud, Necesidad_Apoyo_Psicosocial, Red_Apoyo_Familiar, Solicita_Seguimiento_TS, Prioridad_TS, Estado_Gestion, Canal_Contacto, Aviso_Privacidad_Aceptado`.

Con la base maestra habilitada se leen solo `ID_Valoracion`, `Fecha_Registro`, `ID_Distributivo`, `Canal_Contacto` y `Aviso_Privacidad_Aceptado`. La valoración se vincula al servidor **por `ID_Distributivo`**, nunca por nombre; las que no tienen identificador o no corresponden a un servidor de Santa Cruz quedan «sin vínculo» y se reportan en el estado de sincronización. No se importan respuestas de cuestionario, vivienda, salud, red de apoyo ni campos de Trabajo Social.

`Aviso_Privacidad_Aceptado` se guarda como un dato separado y **no** se interpreta como consentimiento informado para la atención clínica.

### Clasificación de riesgo alto — limitación

La pestaña **no contiene un campo explícito de clasificación profesional de riesgo**. `Prioridad_TS` es una prioridad de Trabajo Social y `Necesidad_Apoyo_Psicosocial` es una respuesta del cuestionario: ninguna es una clasificación clínica validada, por lo que **no se usan ni se infiere riesgo** a partir de ellas.

Para habilitar la importación, la institución debe confirmar:

1. la columna que registra la clasificación profesional de riesgo (puede agregarse, por ejemplo, `Clasificacion_Riesgo`);
2. los valores que significan «riesgo alto»;
3. que la clasificación fue registrada y validada por un profesional;
4. opcionalmente, la columna que indica si requiere seguimiento.

Luego basta configurar `SHEETS_RIESGO_COLUMNA`, `SHEETS_RIESGO_VALORES` y `SHEETS_SEGUIMIENTO_COLUMNA`. Solo se importan coincidencias literales con esos valores; si el valor cambia, la clasificación se retira sin borrarse. Mientras tanto, la atención prioritaria se alimenta con las clasificaciones que **registran los profesionales asignados** desde la ficha del servidor (también trazadas y sin algoritmos).

## Sincronización

Consulta periódica (no instantánea) cada `SHEETS_SYNC_INTERVAL_SECONDS` (30–3600; por defecto 60). Son 5 lecturas por ciclo (metadatos, 2 encabezados, 2 `batchGet`): a 60 s, unas 300 por hora, muy por debajo de la cuota de la API. El estado, la última sincronización exitosa, el detalle (Santa Cruz, excluidos, valoraciones vinculadas o sin vínculo) y los errores se ven en **Configuración → Integración Google Sheets**.

Sin `SHEETS_MAESTRA_GID` la plataforma funciona en el modo anterior (solo «Valoraciones»).

## Cómo autorizar (administrador de Google Workspace)

1. En Google Cloud Console, cree o elija un proyecto institucional y **habilite «Google Sheets API»**.
2. Cree una **cuenta de servicio** (sin roles de proyecto) y genere una clave JSON. Guárdela fuera del repositorio.
3. Abra la matriz y **compártala con el correo de la cuenta de servicio con permiso «Lector»** (nunca «Editor»).
4. En el servidor, configure una de estas variables (nunca en el navegador ni en el repositorio):
   ```bash
   GOOGLE_SERVICE_ACCOUNT_JSON_BASE64=$(base64 -w0 cuenta-servicio.json)
   # o
   GOOGLE_APPLICATION_CREDENTIALS=/ruta/segura/cuenta-servicio.json
   ```
   y `SHEETS_MAESTRA_GID=1340025527`.
5. Verifique sin importar datos: `npm run sheets:check`.
6. Reinicie el servicio. La primera sincronización corre a los pocos segundos.

Si la organización restringe compartir con cuentas de servicio, la alternativa equivalente es la delegación de dominio con el mismo ámbito `spreadsheets.readonly`.
