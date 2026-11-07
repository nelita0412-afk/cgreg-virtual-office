# Voz alternativa gratuita (Azure no configurado): Piper, voz femenina es_MX-claude-high.
# Solo cambia lo que se OYE: «CGREG» → «Segreg» (se oye «CEGREG», una palabra), «Virtual Office» → «Virtual Ófis». El texto escrito no cambia.
import json, os, subprocess, sys
MODELO = os.environ.get('PIPER_MODELO', 'voz/es_MX-claude-high.onnx')
ESCALA = os.environ.get('PIPER_ESCALA', '0.72')
N = json.load(open('narracion_v2.json'))
os.makedirs('audio/voz', exist_ok=True)
for e in N['escenas']:
    for f in e['frases']:
        # Ajustes fonéticos verificados por reconocimiento de voz (solo audio; el texto escrito no cambia):
        #  «Segreg» se oye «CEGREG» con la G final audible; «Perr mitirá» evita que el modelo pierda la P inicial.
        txt = f['texto'].replace('CGREG Virtual Office', 'Segreg Virtual Ófis').replace('CGREG', 'Segreg').replace('Permitirá', 'Perr mitirá')
        crudo = f"audio/voz/{f['id']}-crudo.wav"
        subprocess.run(['python3', '-m', 'piper', '-m', MODELO, '--length-scale', ESCALA, '--sentence-silence', '0.15', '-f', crudo], input=txt.encode(), check=True, capture_output=True)
        # recorte de silencios de borde y nivel homogéneo entre frases
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', crudo, '-af', 'silenceremove=start_periods=1:start_threshold=-60dB,areverse,silenceremove=start_periods=1:start_threshold=-60dB,areverse,adelay=40,apad=pad_dur=0.04,loudnorm=I=-18:TP=-2:LRA=7', '-ar', '48000', f"audio/voz/{f['id']}.wav"], check=True)
print('voz lista')
