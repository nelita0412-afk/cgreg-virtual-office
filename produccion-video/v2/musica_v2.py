# Música instrumental original v2 (generada por código, sin licencias de terceros) con cierre suave.
# Música instrumental original (generada por código): colchón de acordes + notas tipo piano suaves.
import json, numpy as np, wave
SR = 44100; DUR = json.load(open('linea_tiempo_v2.json'))['duracion'] + 0.3
t = np.arange(int(SR * DUR)) / SR
def hz(n): return 440 * 2 ** ((n - 69) / 12)
# Progresión en Re mayor (cálida, institucional): D – Bm – G – A, 4 compases de 5,6 s
prog = [[50, 57, 62, 66, 69], [47, 54, 59, 62, 66], [43, 50, 55, 59, 62], [45, 52, 57, 61, 64]]
L = 5.6
pad = np.zeros_like(t)
FIN = DUR - 6.5   # el último tramo resuelve en el acorde de tónica (Re mayor) y se apaga suavemente
for k in range(int(DUR / L) + 1):
    ac = prog[k % 4] if k * L < FIN else prog[0]; t0 = k * L
    if t0 > FIN + L: break
    m = (t >= t0 - 1.2) & (t < t0 + L + 1.2)
    tt = t[m] - t0
    env = np.clip((tt + 1.2) / 1.8, 0, 1) * np.clip((L + 1.2 - tt) / 1.8, 0, 1)
    for i, n in enumerate(ac):
        f = hz(n)
        voz = np.sin(2 * np.pi * f * tt) + 0.25 * np.sin(2 * np.pi * 2 * f * tt + 0.3) + 0.1 * np.sin(2 * np.pi * 3 * f * tt)
        vib = 1 + 0.002 * np.sin(2 * np.pi * 0.2 * tt + i)
        pad[m] += env * voz * vib * (0.55 if i == 0 else 0.32)
# Notas tipo piano (arpegio lento, ataque suave y caída exponencial)
rng = np.random.default_rng(7)
mel = np.zeros_like(t)
for k in range(int(DUR / L) + 1):
    ac = prog[k % 4]
    if k * L > FIN - 2: break   # sin notas nuevas en el cierre: solo el acorde sostenido
    for j, off in enumerate([0.0, 1.4, 2.8, 4.2]):
        n = ac[[2, 3, 4, 3][j]] + 12; t0 = k * L + off + rng.uniform(-0.05, 0.05)
        m = (t >= t0) & (t < t0 + 3.5); tt = t[m] - t0; f = hz(n)
        env = (1 - np.exp(-tt * 60)) * np.exp(-tt * 1.6)
        mel[m] += env * (np.sin(2 * np.pi * f * tt) + 0.35 * np.sin(2 * np.pi * 2 * f * tt) + 0.12 * np.sin(2 * np.pi * 3 * f * tt)) * 0.5
# Suavizado (paso bajo simple) y mezcla
def paso_bajo(x, a=0.08):
    y = np.empty_like(x); acc = 0.0
    for i in range(0, len(x), 4096):
        seg = x[i:i + 4096]; out = np.empty_like(seg)
        for j, v in enumerate(seg): acc += a * (v - acc); out[j] = acc
        y[i:i + 4096] = out
    return y
mezcla = paso_bajo(pad, 0.05) * 0.9 + paso_bajo(mel, 0.2) * 0.7
fade = np.clip(t / 2.5, 0, 1) * np.clip((DUR - t) / 5.5, 0, 1) ** 1.6
mezcla *= fade
mezcla /= np.max(np.abs(mezcla)) + 1e-9
mezcla *= 0.8
# Estéreo con leve ensanchamiento
izq = mezcla; der = np.concatenate([np.zeros(220), mezcla[:-220]])
st = (np.stack([izq, der], 1) * 32767).astype(np.int16)
with wave.open('audio/musica-v2.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(st.tobytes())
print('música', round(DUR, 1), 's')
