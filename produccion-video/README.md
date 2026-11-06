# Producción audiovisual — Video institucional CGREG

Respaldo de las **fuentes de producción** del video institucional (versión 1 y versión 2).
No contiene fotogramas grabados, renders, audio ni credenciales: todo eso se regenera.

## Versión 2 (`v2/`)
| Archivo | Función |
|---|---|
| `narracion_v2.json` | Guion **literal** dividido en frases y su anclaje a los tramos de la grabación |
| `voz_azure.py` | Voz Azure **es-EC-AndreaNeural**; `voces` (verifica disponibilidad), `muestra`, `todo`. CGREG se pronuncia «CEGREG» |
| `grabador.mjs` | Grabación de navegación **en vivo** por CGREG Virtual Office (tiempo virtual, 25 fps, cursor y clics reales) |
| `mapa.js`, `mapa-datos.json/.js` | Mapa animado Ecuador → Galápagos → Santa Cruz (OSM / Natural Earth, verificado) |
| `linea_tiempo_v2.py` | Escenas, sincronización voz–grabación (EDL) y subtítulos SRT |
| `construir_v2.js` | Composición de las 7 escenas (cierre **sin logotipos**) |
| `musica_v2.py`, `mezcla_v2.py` | Música original con cierre suave y mezcla a −16 LUFS |
| `renderizar_v2.mjs` | Render fotograma a fotograma a MP4 1920×1080 |
| `storyboard_v2.py` | Guion actualizado y storyboard PDF |
| `CREDITOS-Y-FUENTES.md` | Créditos, licencias y verificación geográfica |

### Variables de entorno (nunca en el código)
- `AZURE_SPEECH_KEY`, `AZURE_REGION` (eastus) — solo si se ejecuta fuera del entorno en la nube.
- `CGREG_DEMO_PASS` — contraseña de los usuarios de la **base de demostración** (datos ficticios).
- `CGREG_REPO` — ruta del repositorio de la plataforma (para usar su Playwright).

### Orden de producción
1. Plataforma en modo demostración (base `cgreg_demo`) en `http://localhost:4000`.
2. `node grabador.mjs` → `grabacion/` (≈ 1 500 fotogramas, ≈ 360 MB).
3. `python3 voz_azure.py muestra` → aprobación de la voz → `python3 voz_azure.py todo`.
4. `python3 linea_tiempo_v2.py audio/voz` → `python3 musica_v2.py` → `node construir_v2.js`.
5. `node renderizar_v2.mjs video video-v2-sin-audio.mp4 25` → `python3 mezcla_v2.py` → unión de video y audio con ffmpeg.
6. `python3 storyboard_v2.py` y conversión del storyboard a PDF.

## Versión 1 (`v1/`)
Scripts de la primera versión (voz Piper, capturas estáticas), conservados como referencia.
