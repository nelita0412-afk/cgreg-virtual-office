# Genera el guion (Markdown) y el storyboard (HTML → PDF) a partir de la línea de tiempo real del video.
import json, html, subprocess, os
lt = json.load(open('linea_tiempo.json'))
P = [
    {'recurso': 'Fotografías reales de Puerto Ayora (muelle y bahía), isla Santa Cruz. Logotipos oficiales. Título y bajada con la denominación completa del fenómeno ENOS.',
     'camara': 'Acercamiento lento (Ken Burns) sobre el muelle; fundido encadenado a la panorámica de la bahía con paneo de izquierda a derecha.',
     'transicion': 'Entrada desde negro; fundido encadenado hacia la escena 2.',
     'texto': 'ISLA SANTA CRUZ · GALÁPAGOS · Plan de acompañamiento psicosocial y de salud · Afectaciones asociadas al evento ENOS en la isla Santa Cruz.'},
    {'recurso': 'Diagrama vectorial animado: dos rutas que convergen en el nodo «8 profesionales de la brigada».',
     'camara': 'Plano fijo; las rutas se dibujan de forma progresiva, sincronizadas con la narración.',
     'transicion': 'Fundido encadenado.',
     'texto': 'Ruta 1 · Atención prioritaria (riesgo alto validado profesionalmente). Ruta 2 · Atención abierta (cualquier servidor que solicite acompañamiento). La ausencia de valoración previa no impide el acceso.'},
    {'recurso': 'Composición tipográfica con iconografía genérica (sin rostros ni fotografías de los profesionales). Fondo: imagen referencial de telesalud atenuada.',
     'camara': 'Leve acercamiento del fondo; aparición escalonada de los integrantes.',
     'transicion': 'Fundido encadenado.',
     'texto': '6 Psicología clínica (nombres) · Medicina / Telemedicina: Dr. Demetrio Magallanes · Psiquiatría por derivación: Dr. Diego Estrella · Articulación territorial adicional: Andrea Mayorga (DECE).'},
    {'recurso': 'Fotografía referencial de teleconsulta (USDA, dominio público) y lista de seis servicios con íconos, agrupados en prestaciones clínicas y acompañamiento.',
     'camara': 'Acercamiento lento sobre la fotografía; los servicios entran desde la izquierda al ser mencionados.',
     'transicion': 'Fundido encadenado.',
     'texto': 'Nota: la teleatención no sustituye la atención presencial ni de emergencia.'},
    {'recurso': 'Capturas reales de la simulación de CGREG Virtual Office con datos ficticios: vista general de la oficina, consultorios, Telemedicina, Centro de Comando y Agenda.',
     'camara': 'Recorrido por la oficina con acercamientos y desplazamientos sobre cada captura; etiquetas de funciones que aparecen con la narración.',
     'transicion': 'Fundidos encadenados entre capturas.',
     'texto': 'CGREG VIRTUAL OFFICE · Centro Digital de Operaciones · Rótulo permanente: «Simulación de demostración · datos ficticios».'},
    {'recurso': 'Captura de Coordinación en la oficina virtual y de la bandeja «Mis Solicitudes y Gestiones» (datos ficticios); flujo animado de cuatro pasos.',
     'camara': 'Acercamiento sobre Coordinación; fundido a la bandeja con desplazamiento suave.',
     'transicion': 'Fundido encadenado.',
     'texto': 'Profesional → Coordinación General → Instituciones → Respuesta y seguimiento.'},
    {'recurso': 'Fotografía real de Bahía Tortuga, isla Santa Cruz. Logotipos oficiales. Mensaje final.',
     'camara': 'Acercamiento lento; oscurecimiento progresivo para el cierre.',
     'transicion': 'Fundido a la tarjeta institucional final.',
     'texto': 'Personas · Profesionales · Tecnología · Articulación institucional → CGREG · «Más cerca de nuestros servidores, incluso a la distancia.»'},
]
def mmss(x): return f'{int(x // 60)}:{x % 60:04.1f}'
os.makedirs('storyboard', exist_ok=True)
# Fotograma representativo de cada escena, tomado del video final
for e in lt['escenas']:
    t = e['inicio'] + (e['fin'] - e['inicio']) * 0.62
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-ss', f'{t:.2f}', '-i', 'video-sin-audio.mp4', '-frames:v', '1', '-vf', 'scale=960:-1', f"storyboard/escena{e['n']}.jpg"], check=True)

# Guion de narración
g = ['# Guion de narración — Video institucional CGREG', '',
     'Voz femenina en español latinoamericano (síntesis de voz Piper, voz «es_MX claude», ritmo ≈ 153 palabras por minuto). Música instrumental original discreta. Duración total: ' + mmss(lt['duracion']) + '.', '']
for e in lt['escenas']:
    g += [f"## Escena {e['n']}. {e['titulo']} ({mmss(e['inicio'])} – {mmss(e['fin'])})", '', f"**Narración** (inicia en {mmss(e['voz'])}, {e['voz_dur']:.1f} s):", '', '> ' + e['texto'], '']
g += ['## Texto final en pantalla', '', '**CGREG**  ', 'Más cerca de nuestros servidores, incluso a la distancia.', '']
open('CGREG-video-guion.md', 'w', encoding='utf-8').write('\n'.join(g))

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
<header><div><h1>Storyboard — Video institucional (16:9, 1920 × 1080, {mmss(lt['duracion'])})</h1><div class="sub">Plan de Acompañamiento Psicosocial y de Salud · CGREG Virtual Office</div></div><img src="../deck/assets/logos-gobierno-cgreg.png"></header>
{filas}
<div class="pie">Consistencia visual: azul marino, azul institucional, blanco, turquesa y acentos dorados; tipografía Inter. Subtítulos en español integrados en el video y en archivo SRT.
Fotografías: David Broad (CC BY 3.0), Diego Delso (CC BY-SA 4.0), Wikimedia Commons; imágenes referenciales de telesalud: USDA (dominio público).
Las capturas de CGREG Virtual Office provienen de la simulación de demostración con datos ficticios; no son resultados institucionales.</div>
</body></html>"""
open('storyboard.html', 'w', encoding='utf-8').write(doc)
print('guion y storyboard listos')
