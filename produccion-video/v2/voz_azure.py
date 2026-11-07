# Voz institucional: Microsoft Azure AI Speech, voz neuronal es-EC-AndreaNeural (español de Ecuador, femenina).
# Uso:  python3 voz_azure.py voces          → comprueba en Azure que la voz es-EC-AndreaNeural está disponible en la región
#       python3 voz_azure.py muestras       → dos muestras comparables: A «CEGREG» (una palabra) y B «Ce, Ge, Erre, E, Ge»
#       PRONUNCIACION=palabra|letras         → elige la pronunciación aprobada para la narración completa
#       python3 voz_azure.py todo           → audio/voz/<id>.wav por frase (narracion_v2.json)
# La clave NUNCA se escribe en este archivo ni en el repositorio:
#  · En la nube (Claude Code): se guarda como «network secret» del entorno; el proxy la añade a cada petición a Azure.
#  · En su Mac: variable de entorno AZURE_SPEECH_KEY (y opcional AZURE_REGION), p. ej. en ~/.zshrc.
import json, os, sys, time, urllib.request, html

REGION = os.environ.get('AZURE_REGION', 'eastus')
URL = f'https://{REGION}.tts.speech.microsoft.com/cognitiveservices/v1'
VOZ = 'es-EC-AndreaNeural'
CLAVE = os.environ.get('AZURE_SPEECH_KEY', 'proxy')  # 'proxy': marcador; el proxy de la nube inserta la clave real
VELOCIDAD = os.environ.get('VELOCIDAD', '-4%')   # ritmo conversacional pausado
# Solo cambia lo que se OYE; el texto escrito (pantalla y subtítulos) siempre es «CGREG».
ALIAS = {'palabra': 'Cegreg', 'letras': 'Ce, Ge, Erre, E, Ge'}
PRONUNCIACION = os.environ.get('PRONUNCIACION', 'palabra')

def ssml(texto, pron=None):
    t = html.escape(texto, quote=False)
    # Pronunciación institucional: CGREG se lee «Cegreg» (una palabra), sin deletrear. El texto escrito no cambia.
    t = t.replace('CGREG', f'<sub alias="{ALIAS[pron or PRONUNCIACION]}">CGREG</sub>')
    t = t.replace('Virtual Office', '<sub alias="Virtual Ófis">Virtual Office</sub>')
    t = t.replace('ENOS,', 'ENOS,<break time="120ms"/>')
    return (f'<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="es-EC">'
            f'<voice name="{VOZ}"><prosody rate="{VELOCIDAD}">{t}</prosody></voice></speak>')

def sintetizar(texto, destino, pron=None):
    req = urllib.request.Request(URL, data=ssml(texto, pron).encode('utf-8'), method='POST', headers={
        'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'riff-48khz-16bit-mono-pcm',
        'User-Agent': 'cgreg-video', 'Ocp-Apim-Subscription-Key': CLAVE})
    for intento in range(5):
        try:
            data = urllib.request.urlopen(req, timeout=60).read(); break
        except urllib.error.HTTPError as e:
            if e.code in (429, 503): time.sleep(3 + intento * 3); continue
            raise SystemExit(f'Azure respondió {e.code}: {e.read()[:300]!r}')
    os.makedirs(os.path.dirname(destino), exist_ok=True)
    open(destino, 'wb').write(data)
    print('ok', destino, len(data) // 1024, 'KB')

if sys.argv[1] == 'voces':
    req = urllib.request.Request(f'https://{REGION}.tts.speech.microsoft.com/cognitiveservices/voices/list', headers={'Ocp-Apim-Subscription-Key': CLAVE, 'User-Agent': 'cgreg-video'})
    voces = json.load(urllib.request.urlopen(req, timeout=60))
    ec = [v for v in voces if v['Locale'] == 'es-EC']
    for v in ec: print(v['ShortName'], v['Gender'], v.get('VoiceType'), v.get('Status'))
    print('es-EC-AndreaNeural disponible:', any(v['ShortName'] == VOZ for v in ec), f'(región {REGION}, {len(voces)} voces en total)')
elif sys.argv[1] == 'muestras':
    # Mismo texto, voz, velocidad y tono; solo cambia la pronunciación de la sigla. Volumen igualado a -16 LUFS.
    import subprocess
    TEXTO = ('El Consejo de Gobierno del Régimen Especial de Galápagos, CGREG, impulsa un plan de acompañamiento para sus servidores. '
             'CGREG Virtual Office será el centro digital de operaciones de esta intervención, y cualquier servidor del CGREG que labore '
             'en Santa Cruz podrá solicitar acompañamiento.')
    for clave, nombre in (('palabra', 'A-CEGREG-una-palabra'), ('letras', 'B-letra-por-letra')):
        crudo = f'audio/muestra-{nombre}-crudo.wav'
        sintetizar(TEXTO, crudo, clave)
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', crudo, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '48000',
                        f'audio/muestra-{nombre}.wav'], check=True)
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', f'audio/muestra-{nombre}.wav', '-b:a', '192k', f'audio/muestra-{nombre}.mp3'], check=True)
        print('muestra lista:', f'audio/muestra-{nombre}.mp3')
elif sys.argv[1] == 'muestra':
    sintetizar('Ante las afectaciones asociadas al fenómeno El Niño-Oscilación del Sur, ENOS, en la isla Santa Cruz, el Consejo de Gobierno '
               'del Régimen Especial de Galápagos propone fortalecer el acompañamiento a sus servidores. CGREG Virtual Office será el centro '
               'digital de operaciones de esta intervención, y cualquier servidor del CGREG que labore en Santa Cruz podrá solicitar acompañamiento.',
               'audio/muestra-voz.wav')
else:
    N = json.load(open('narracion_v2.json'))
    for e in N['escenas']:
        for f in e['frases']:
            sintetizar(f['texto'], f"audio/voz/{f['id']}.wav")
