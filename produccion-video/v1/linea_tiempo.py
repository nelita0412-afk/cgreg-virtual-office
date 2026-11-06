import json, re
esc = json.load(open('narracion.json')); dur = json.load(open('audio/duraciones.json'))
LEAD, GAP, TAIL = 0.6, 0.45, 2.4
escenas, t = [], 0.0
for i, ((titulo, texto), d) in enumerate(zip(esc, dur)):
    voz = t + (LEAD if i == 0 else 0.15)
    fin = voz + d + (TAIL if i == len(esc) - 1 else GAP)
    escenas.append({'n': i + 1, 'titulo': titulo, 'inicio': round(t, 3), 'voz': round(voz, 3), 'voz_dur': round(d, 3), 'fin': round(fin, 3), 'texto': texto})
    t = fin
# Subtítulos: bloques de hasta ~84 caracteres (2 líneas), cortados en signos de puntuación o entre palabras
def bloques(texto, maximo=84):
    # 1) cláusulas por puntuación; 2) se agrupan mientras quepan; 3) una cláusula larga se corta
    #    en el espacio más cercano a la mitad, nunca dejando una preposición o artículo al final.
    debiles = {'de', 'del', 'la', 'el', 'los', 'las', 'y', 'a', 'en', 'para', 'con', 'por', 'que', 'su', 'sus', 'un', 'una', 'al'}
    def partir(c):
        if len(c) <= maximo: return [c]
        ws = c.split(' '); mejor = None
        for k in range(1, len(ws)):
            izq = ' '.join(ws[:k])
            if ws[k - 1].lower() in debiles: continue
            score = abs(len(izq) - len(c) / 2)
            if mejor is None or score < mejor[0]: mejor = (score, k)
        k = mejor[1]
        return partir(' '.join(ws[:k])) + partir(' '.join(ws[k:]))
    claus = [x for x in re.split(r'(?<=[,.:;])\s+', texto) if x]
    piezas = [q for c in claus for q in partir(c)]
    out, cur = [], ''
    for q in piezas:
        if cur and len(cur) + 1 + len(q) > maximo:
            out.append(cur); cur = q
        else:
            cur = (cur + ' ' + q).strip()
    if cur: out.append(cur)
    return out
cues = []
for e in escenas:
    bs = bloques(e['texto']); total = sum(len(b) for b in bs); t0 = e['voz']
    for b in bs:
        d = e['voz_dur'] * len(b) / total
        cues.append({'ini': round(t0, 3), 'fin': round(t0 + d - 0.05, 3), 'texto': b}); t0 += d
json.dump({'duracion': round(t, 3), 'escenas': escenas, 'cues': cues}, open('linea_tiempo.json', 'w'), ensure_ascii=False, indent=1)
def ts(x):
    h, r = divmod(x, 3600); m, s = divmod(r, 60); return f'{int(h):02d}:{int(m):02d}:{int(s):02d},{int(round((s % 1) * 1000)):03d}'
with open('CGREG-video-subtitulos.srt', 'w', encoding='utf-8') as f:
    for k, c in enumerate(cues, 1):
        f.write(f"{k}\n{ts(c['ini'])} --> {ts(c['fin'])}\n{c['texto']}\n\n")
print('duración total', round(t, 1), 's |', len(cues), 'subtítulos')
for e in escenas: print(e['n'], e['titulo'], e['inicio'], '→', e['fin'])
