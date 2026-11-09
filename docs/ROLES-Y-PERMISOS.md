# Roles, funciones y permisos de la Brigada de Apoyo Psicosocial

**Principio:** todos trabajan en la Oficina Virtual, pero cada integrante ve y gestiona solo lo que corresponde a sus responsabilidades.

## Modelo
- **Rol base** (uno por cuenta): `coordinacion`, `profesional`, `epidemiologia`, `trabajo_social`, `territorial`, `admin`, `autoridad`, `auditoria`.
- **Funciones complementarias** (cero o más por cuenta, en `core.usuario_funciones`): se **suman** al rol base, nunca lo restan. Las otorga y revoca Administración con un motivo obligatorio, y quedan en auditoría (`usuario.funcion_otorgada` / `usuario.funcion_revocada`). No se deducen del nombre ni del título.
- **Permisos efectivos** = rol base ∪ funciones (`shared/permissions.ts` → `puede()`). El backend los exige en cada ruta (`requirePerm`); el menú solo los refleja. Cada intento sin permiso se audita como `acceso.denegado`.
- **Información clínica**: además del permiso, exige **relación asistencial** con la persona (asignación activa, derivación o atención propia) y especialidad clínica (`server/hce.ts`). Niveles: clínico, social (Trabajo Social) o administrativo (Coordinación, sin contenido clínico).
- **Vínculo con el directorio**: cada cuenta profesional se vincula a su registro del directorio. Los vínculos **no se reasignan**: la API rechaza vincular una cuenta ya vinculada o un registro que ya tiene cuenta, y exige que el rol corresponda a la profesión del registro.
- **Instituciones de vinculación**: solo descriptivas en el directorio; no otorgan permisos.

## Matriz (generada desde el código)

| Permiso | Coord.+TS | Salud Mental | Andrea | Psiquiatría | Epidemiol. | Admin | Autoridad | Auditoría |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `oficina.ver` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `oficina.entrar` | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | · |
| `presencia.propia` | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | · |
| `comando.ver` | ✓ | · | · | · | · | · | · | · |
| `indicadores.agregados` | ✓ | · | · | · | ✓ | · | ✓ | · |
| `equipo.ver` | ✓ | · | · | · | · | · | · | · |
| `directorio.ver` | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | · |
| `agenda.ver_todas` | ✓ | · | · | · | · | · | · | · |
| `agenda.propia` | · | ✓ | ✓ | ✓ | · | · | · | · |
| `agenda.gestionar` | ✓ | ✓ | ✓ | ✓ | · | · | · | · |
| `disponibilidad.gestionar` | ✓ | · | · | · | · | · | · | · |
| `servidores.ver_todos` | ✓ | · | · | · | · | · | · | · |
| `servidores.ver_asignados` | ✓ | ✓ | ✓ | ✓ | · | · | · | · |
| `servidores.asignar` | ✓ | · | · | · | · | · | · | · |
| `atenciones.registrar` | · | ✓ | ✓ | ✓ | · | · | · | · |
| `clinico.leer_propio` | · | ✓ | ✓ | ✓ | · | · | · | · |
| `derivaciones.crear` | · | ✓ | ✓ | ✓ | · | · | · | · |
| `derivaciones.coordinar` | ✓ | · | · | · | · | · | · | · |
| `derivaciones.valorar` | · | ✓ | ✓ | ✓ | · | · | · | · |
| `solicitudes.crear` | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | · |
| `solicitudes.gestionar` | ✓ | · | · | · | · | · | · | · |
| `actividades.ver` | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | · |
| `actividades.gestionar` | ✓ | ✓ | ✓ | ✓ | · | · | · | · |
| `territorio.registrar` | ✓ | · | ✓ | · | ✓ | · | · | · |
| `necesidades.registrar` | ✓ | ✓ | ✓ | ✓ | · | · | · | · |
| `reportes.ver` | ✓ | · | · | · | · | · | ✓ | · |
| `usuarios.gestionar` | · | · | · | · | · | ✓ | · | · |
| `sync.ver` | ✓ | · | · | · | · | ✓ | · | · |
| `sync.ejecutar` | ✓ | · | · | · | · | ✓ | · | · |
| `auditoria.ver` | · | · | · | · | · | ✓ | · | ✓ |
| `prioritaria.ver` | ✓ | ✓ | ✓ | ✓ | · | · | · | · |
| `riesgo.registrar` | · | ✓ | ✓ | ✓ | · | · | · | · |
| `abierta.gestionar` | ✓ | · | · | · | · | · | · | · |
| `abierta.registrar` | ✓ | ✓ | ✓ | ✓ | · | · | · | · |
| `abierta.ver` | ✓ | ✓ | ✓ | ✓ | · | · | · | · |
| `hce.ver` | ✓ | ✓ | ✓ | ✓ | · | · | · | · |
| `consentimientos.gestionar` | ✓ | ✓ | ✓ | ✓ | · | · | · | · |
| `consentimientos.validar` | · | ✓ | ✓ | ✓ | · | · | · | · |
| `plantillas.gestionar` | · | · | · | · | · | ✓ | · | · |
| `social.registrar` | ✓ | · | · | · | · | · | · | · |

Funciones complementarias:
- `trabajo_social`: `social.registrar`, `servidores.ver_asignados`, `hce.ver`, `necesidades.registrar`, `solicitudes.crear`, `directorio.ver`
- `territorial`: `territorio.registrar`, `necesidades.registrar`, `solicitudes.crear`
- `gestion_operativa`: `equipo.ver`

\* Psiquiatría comparte el rol `profesional`; el backend añade reglas por especialidad: recibe casos solo por derivación, es el único que valora derivaciones y no las emite.

## Perfiles de la Brigada
| Integrante | Rol base | Funciones | Registro |
|---|---|---|---|
| Lic. Marianella del Cisne Becerra Hernández, Espc. | Coordinación General | Trabajo Social | `marianella-becerra` |
| Gabriel Alexander Ordóñez Guzmán | Profesional (Psicología) | — | `gabriel-ordonez` |
| Sofía Fernanda Guerra Reyna | Profesional (Psicología) | — | `sofia-guerra` |
| Betsabé Córdova Wellington | Profesional (Psicología) | — | `betsabe-cordova` |
| Andrea Mayorga Molina | Profesional (Psicología) | Territorial | `andrea-mayorga` |
| Diego Estrella Almeida | Profesional (Psiquiatría) | — | `diego-estrella` |
| María de los Ángeles Alcívar Condo | Profesional (Psicología) | — | `maria-alcivar` |
| Hugo Xavier Cuenca Guerrero | Profesional (Psicología) | — | `hugo-cuenca` |
| Sally Tinizaray Soriano | Profesional (Psicología) | — | `sally-tinizaray` (registro propio) |
| Demetrio Magallanes Manzaba | Apoyo Epidemiológico y Territorial | — | `demetrio-magallanes` |

## Mi Equipo y Directorio
- **Mi Equipo** (`equipo.ver`): cargas, indicadores individuales, horarios y gestión. Coordinación, o cuentas con la función `gestion_operativa`.
- **Directorio de profesionales** (`directorio.ver`): nombre, profesión, experiencia, función e instituciones. Sin casos, cargas ni estadísticas. La disponibilidad aparece solo para Psiquiatría (para coordinar derivaciones).
- **Oficina Virtual**: tocar el avatar de un colega muestra su ficha de directorio y su estado operativo; nunca casos ni cargas. La disponibilidad en tiempo real solo se envía a quien puede entrar a la Oficina.

## Verificación
- `npx vitest run tests/brigada.test.ts`: los 12 casos obligatorios contra la API, incluido el acceso directo a rutas.
- `node e2e/brigada.mjs`: menús, URL directas y pantallas por perfil.
- `npm run demo:verificar-permisos`: con la demo en marcha, ingresa con cada cuenta y compara lo que puede abrir con esta matriz.
