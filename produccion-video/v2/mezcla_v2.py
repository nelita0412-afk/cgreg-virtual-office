# Mezcla final: cada frase de voz en su instante, música subordinada (≈ -20 dB respecto de la voz), normalización -16 LUFS.
import json, subprocess, sys
VOZ = sys.argv[1] if len(sys.argv) > 1 else 'audio/voz'
lt = json.load(open('linea_tiempo_v2.json'))
ins, fil = [], []
for k, v in enumerate(lt['voz']):
    ins += ['-i', f"{VOZ}/{v['id']}.wav"]; ms = int(v['ini'] * 1000)
    fil.append(f"[{k}:a]aresample=48000,aformat=channel_layouts=stereo,adelay={ms}|{ms}[v{k}]")
n = len(lt['voz']); ins += ['-i', 'audio/musica-v2.wav']
fil.append(''.join(f'[v{k}]' for k in range(n)) + f"amix=inputs={n}:normalize=0:duration=longest[voz]")
fil.append(f"[{n}:a]aresample=48000,volume=0.085[mus]")
fil.append(f"[voz][mus]amix=inputs=2:normalize=0:duration=longest,loudnorm=I=-16:TP=-1.5:LRA=11,atrim=0:{lt['duracion']},afade=t=out:st={lt['duracion'] - 1.4}:d=1.4[out]")
subprocess.run(['ffmpeg', '-y', '-v', 'error', *ins, '-filter_complex', ';'.join(fil), '-map', '[out]', '-ar', '48000', '-c:a', 'pcm_s16le', 'audio/mezcla-v2.wav'], check=True)
print('audio/mezcla-v2.wav')
