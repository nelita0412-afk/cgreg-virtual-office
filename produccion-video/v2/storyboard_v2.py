# Guion y storyboard v2 (a partir de linea_tiempo_v2.json y del video renderizado).
# Genera el guion (Markdown) y el storyboard (HTML → PDF) a partir de la línea de tiempo real del video.
import json, html, subprocess, os
lt = json.load(open('linea_tiempo_v2.json'))
lt['escenas'] = [dict(e, texto=' '.join(v['texto'] for v in lt['voz'] if v['id'].startswith(str(e['n'])))) for e in lt['escenas']]
P = [
    {'recurso': 'Mapa animado con cartografía verificable (OpenStreetMap, Natural Earth): Sudamérica → Ecuador → islas Galápagos → isla Santa Cruz, con marcador en Puerto Ayora. Luego, fotografía real del muelle de Puerto Ayora con el título.',
     'camara': 'Vuelo cartográfico continuo con acercamiento progresivo; ruta dorada del continente al archipiélago; Santa Cruz se resalta en dorado y late el marcador de Puerto Ayora. Acercamiento lento sobre la fotografía.',
     'transicion': 'Entrada desde negro; fundido del mapa a la fotografía; fundido encadenado a la escena 2.',
     'texto': 'CONTEXTO TERRITORIAL · ECUADOR · OCÉANO PACÍFICO · ISLAS GALÁPAGOS · nombres de las islas · rótulo «PUERTO AYORA · ISLA SANTA CRUZ · GALÁPAGOS · ECUADOR» · título del plan con la denominación completa de ENOS.'},
    {'recurso': 'Diagrama vectorial animado: dos rutas que convergen en el nodo «8 profesionales de la brigada».',
     'camara': 'Plano fijo; las rutas se dibujan sincronizadas con la narración.', 'transicion': 'Fundido encadenado.',
     'texto': 'Ruta 1 · Atención prioritaria (riesgo alto validado profesionalmente). Ruta 2 · Atención abierta. «La ausencia de una valoración previa no impide el acceso a la atención.»'},
    {'recurso': 'Composición tipográfica con iconografía genérica (sin rostros). Fondo: imagen referencial de telesalud atenuada.',
     'camara': 'Leve acercamiento del fondo; aparición escalonada de los integrantes.', 'transicion': 'Fundido encadenado.',
     'texto': '6 Psicología clínica · Medicina / Telemedicina: Dr. Demetrio Magallanes · Psiquiatría por derivación: Dr. Diego Estrella · Articulación territorial adicional: Andrea Mayorga (DECE).'},
    {'recurso': 'Fotografía referencial de teleconsulta (USDA, dominio público) y seis servicios con íconos, separados en prestaciones clínicas y acompañamiento y fortalecimiento.',
     'camara': 'Acercamiento lento; los servicios entran al ser mencionados.', 'transicion': 'Fundido encadenado.',
     'texto': 'Nota: la teleatención no sustituye la atención presencial ni de emergencia.'},
    {'recurso': 'GRABACIÓN DE NAVEGACIÓN EN VIVO por la plataforma real (base de demostración, datos ficticios): ingreso con usuario y contraseña, oficina virtual 3D con avatares en movimiento, sala de Consultorios de Psicología, Telemedicina, Agenda, detalle de una atención con su registro clínico validado, historia clínica (evolución y consentimiento informado) y Centro de Comando.',
     'camara': 'Cursor visible con movimientos naturales, clics reales con onda, escritura, vuelo de la cámara 3D entre salas, apertura de módulos y desplazamiento por pantallas. 25 fps.',
     'transicion': 'Continuidad de la sesión; cortes en reposo entre módulos.',
     'texto': 'Banda permanente «SIMULACIÓN DE DEMOSTRACIÓN · DATOS FICTICIOS» y paso actual (1 · Ingreso … 9 · Coordinación General).'},
    {'recurso': 'Continuación de la grabación con la sesión de Coordinación General: bandeja de solicitudes y detalle de una solicitud con su historial de gestiones. Flujo animado superpuesto.',
     'camara': 'Clic en la solicitud, recorrido del cursor por el historial de comunicación y gestiones.', 'transicion': 'Fundido encadenado.',
     'texto': 'Profesional → Coordinación General → Instituciones → Respuesta y seguimiento. Panel: pendiente de validación institucional (Google Sheets, clasificación de riesgo, consentimientos, despliegue).'},
    {'recurso': 'Fotografía real de Bahía Tortuga, isla Santa Cruz. SIN logotipos ni marcas institucionales (se añadirán en la edición manual posterior).',
     'camara': 'Acercamiento muy lento y suave.', 'transicion': 'Mensaje final; segundos de imagen limpia; fundido progresivo a negro con resolución musical.',
     'texto': '«Más cerca de nuestros servidores, incluso a la distancia.» El crédito fotográfico aparece solo al inicio de la escena.'},
]
def mmss(x): return f'{int(x // 60)}:{x % 60:04.1f}'
os.makedirs('storyboard', exist_ok=True)
# Fotograma representativo de cada escena, tomado del video final
import glob
for e in lt['escenas']:
    t = e['inicio'] + (e['fin'] - e['inicio']) * (0.55 if e['n'] != 1 else 0.45)
    if os.path.exists('video-v2.mp4'):
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-ss', f'{t:.2f}', '-i', 'video-v2.mp4', '-frames:v', '1', '-vf', 'scale=960:-1', f"storyboard/escena{e['n']}.jpg"], check=True)

# Guion de narración
g = ['# Guion de narración — Video institucional CGREG (versión 2)', '',
     'Voz femenina ecuatoriana: Azure AI Speech, es-EC-AndreaNeural (velocidad +14 %). La sigla CGREG se pronuncia «CEGREG»; en textos y subtítulos se escribe CGREG. Música instrumental original discreta. Duración total: ' + mmss(lt['duracion']) + '.', '']
for e in lt['escenas']:
    g += [f"## Escena {e['n']}. {e['titulo']} ({mmss(e['inicio'])} – {mmss(e['fin'])})", '']
    for v in [v for v in lt['voz'] if v['id'].startswith(str(e['n']))]: g += [f"**{mmss(v['ini'])}** ({v['dur']:.1f} s) — {v['texto']}", '']
g += ['## Texto final en pantalla', '', 'Más cerca de nuestros servidores, incluso a la distancia.', '', '_El cierre no contiene logotipos: se incorporarán en la edición manual posterior._', '']
open('CGREG-video-v2-guion.md', 'w', encoding='utf-8').write('\n'.join(g))

# Storyboard (HTML → PDF)
filas = ''
for e, d in zip(lt['escenas'], P):
    filas += f"""<section class="esc"><img src="storyboard/escena{e['n']}.jpg"><div class="txt">
<div class="n">Escena {e['n']} · {mmss(e['inicio'])}–{mmss(e['fin'])} · {e['fin'] - e['inicio']:.1f} s</div><h2>{html.escape(e['titulo'])}</h2>
<p><b>Recurso visual.</b> {html.escape(d['recurso'])}</p><p><b>Cámara.</b> {html.escape(d['camara'])}</p><p><b>Transición.</b> {html.escape(d['transicion'])}</p>
<p><b>Texto en pantalla.</b> {html.escape(d['texto'])}</p><p class="nar"><b>Narración.</b> «{html.escape(e['texto'])}»</p></div></section>"""
doc = f"""<!doctype html><html lang="es"><head><meta charset="utf-8"><style>
@page{{size:A4 landscape;margin:12mm}} body{{font-family:Inter,sans-serif;color:#0B1F45;font-size:10.5pt}}
header{{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #13A3B5;padding-bottom:6px;margin-bottom:10px}}
header img{{height:34px}} h1{{font-size:17pt;margin:0}} .sub{{color:#5B6B86;font-size:10pt}}
.esc{{display:flex;gap:14px;break-inside:avoid;margin:0 0 10px;padding:10px;border:1px solid #D9E7F5;border-radius:8px}}
.esc img{{width:118mm;height:auto;border-radius:4px;flex:none}} .n{{color:#13A3B5;font-weight:700;font-size:9pt;letter-spacing:.05em}}
h2{{margin:2px 0 6px;font-size:13pt}} p{{margin:0 0 5px;line-height:1.35}} .nar{{color:#163A78;font-style:italic}}
.pie{{color:#5B6B86;font-size:9pt;margin-top:8px}}
</style></head><body>
<header><div><h1>Storyboard v2 — Video institucional (16:9, 1920 × 1080, {mmss(lt['duracion'])})</h1><div class="sub">Plan de Acompañamiento Psicosocial y de Salud · CGREG Virtual Office</div></div><img src="recursos/logos-gobierno-cgreg.png"></header>
{filas}
<div class="pie">Consistencia visual: azul marino, azul institucional, blanco, turquesa y acentos dorados; tipografía Inter. Subtítulos en español integrados en el video y en archivo SRT.
Cartografía: © colaboradores de OpenStreetMap (ODbL), Natural Earth. Fotografías: David Broad (CC BY 3.0), Diego Delso (CC BY-SA 4.0), Wikimedia Commons; imágenes referenciales de telesalud: USDA (dominio público). Voz: Azure AI Speech es-EC-AndreaNeural (español de Ecuador).
La navegación de CGREG Virtual Office es una grabación real de la plataforma en su base de demostración con datos ficticios; no son resultados institucionales. El cierre se entrega sin logotipos.</div>
</body></html>"""
open('storyboard.html', 'w', encoding='utf-8').write(doc)
print('guion y storyboard listos')
