# Línea de tiempo v2: escenas, frases de voz, subtítulos y lista de cortes (EDL) de la grabación en vivo.
# Uso: python3 linea_tiempo_v2.py <carpeta_de_voz>   (contiene <id>.wav por frase)
import json, os, re, subprocess, sys, glob

VOZ = sys.argv[1] if len(sys.argv) > 1 else 'audio/voz'
FPS = 25
N = json.load(open('narracion_v2.json'))
dur = lambda f: float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], capture_output=True, text=True).stdout)

# Clips grabados: número de fotogramas y marcas internas
marcas = {}
for m in glob.glob('grabacion/marcas-*.json'): marcas.update(json.load(open(m)))
def frames(c): return len(glob.glob(f'grabacion/{c}/f*.jpg'))
def rango(ref):
    # «clip[a:b]xV» → (clip, a, b, V)
    m = re.match(r'([^\[]+)(?:\[(\d+):(\d+)\])?(?:x([\d.]+))?$', ref)
    c = m.group(1); n = frames(c)
    a = int(m.group(2)) if m.group(2) else 0; b = min(n, int(m.group(3))) if m.group(3) else n
    return c, a, b, float(m.group(4) or 1)

MAPA_SEG = 10.8   # duración de la secuencia cartográfica dentro de la escena 1
t = 0.0
escenas, voz, edl = [], [], []
for e in N['escenas']:
    ini = t
    frases = e['frases']
    d = {f['id']: dur(f'{VOZ}/{f["id"]}.wav') for f in frases}
    if e['n'] in (5, 6):
        cur = ini
        for i, f in enumerate(frases):
            arranque = cur + (1.0 if f['id'] == '5a' else 0.3)
            if 'clips' in f:
                g0 = cur
                for ref in f['clips']:
                    c, a, b, vel = rango(ref)
                    edl.append({'clip': c, 'f0': a, 'f1': b, 'vel': vel, 'ini': round(cur, 3)})
                    cur += (b - a) / FPS / vel
                # la frase debe caber en su tramo: si no, se prolonga el último plano (mantiene el último fotograma)
                fin_voz = arranque + d[f['id']] + 0.35
                if fin_voz > cur: cur = fin_voz
            else:
                arranque = voz[-1]['ini'] + voz[-1]['dur'] + 0.35
                cur = max(cur, arranque + d[f['id']] + 0.9)
            voz.append({'id': f['id'], 'ini': round(arranque, 3), 'dur': round(d[f['id']], 3), 'texto': f['texto']})
        fin = cur
    else:
        f = frases[0]
        if e['n'] == 1:
            arranque = ini + 1.2; fin = max(arranque + d['1'] + 0.7, ini + MAPA_SEG + 5.2)
        elif e['n'] == 7:
            arranque = ini + 0.6; fin = arranque + d['7'] + 5.0
        else:
            arranque = ini + 0.3; fin = arranque + d[f['id']] + 0.6
        voz.append({'id': f['id'], 'ini': round(arranque, 3), 'dur': round(d[f['id']], 3), 'texto': f['texto']})
    escenas.append({'n': e['n'], 'titulo': e['titulo'], 'inicio': round(ini, 3), 'fin': round(fin, 3)})
    t = fin

# Subtítulos: bloques de hasta ~84 caracteres, sin dejar preposiciones o artículos al final de un bloque
debiles = {'de', 'del', 'la', 'el', 'los', 'las', 'y', 'a', 'en', 'para', 'con', 'por', 'que', 'su', 'sus', 'un', 'una', 'al'}
def partir(c, maximo=84):
    if len(c) <= maximo: return [c]
    ws = c.split(' '); mejor = None
    for k in range(1, len(ws)):
        if ws[k - 1].lower() in debiles: continue
        sc = abs(len(' '.join(ws[:k])) - len(c) / 2)
        if mejor is None or sc < mejor[0]: mejor = (sc, k)
    k = mejor[1]
    return partir(' '.join(ws[:k])) + partir(' '.join(ws[k:]))
def bloques(texto, maximo=84):
    piezas = [q for c in re.split(r'(?<=[,.:;])\s+', texto) if c for q in partir(c)]
    out, cur = [], ''
    for q in piezas:
        if cur and len(cur) + 1 + len(q) > maximo: out.append(cur); cur = q
        else: cur = (cur + ' ' + q).strip()
    if cur: out.append(cur)
    return out
cues = []
for v in voz:
    bs = bloques(v['texto']); tot = sum(len(b) for b in bs); t0 = v['ini']
    for b in bs:
        dd = v['dur'] * len(b) / tot
        cues.append({'ini': round(t0, 3), 'fin': round(t0 + dd - 0.04, 3), 'texto': b}); t0 += dd

json.dump({'duracion': round(t, 3), 'fps': FPS, 'mapa_seg': MAPA_SEG, 'escenas': escenas, 'voz': voz, 'edl': edl, 'cues': cues,
           'clips': {c: frames(c) for c in sorted({x['clip'] for x in edl})}},
          open('linea_tiempo_v2.json', 'w'), ensure_ascii=False, indent=1)
def ts(x):
    h, r = divmod(x, 3600); m, s = divmod(r, 60); return f'{int(h):02d}:{int(m):02d}:{int(s):02d},{int(round((s % 1) * 1000)):03d}'
with open('CGREG-video-v2-subtitulos.srt', 'w', encoding='utf-8') as f:
    for k, c in enumerate(cues, 1): f.write(f"{k}\n{ts(c['ini'])} --> {ts(c['fin'])}\n{c['texto']}\n\n")
print(f'duración total {t:.1f} s · {len(cues)} subtítulos')
for e in escenas: print(f"  {e['n']} {e['titulo']:30s} {e['inicio']:6.1f} → {e['fin']:6.1f}  ({e['fin'] - e['inicio']:.1f} s)")
