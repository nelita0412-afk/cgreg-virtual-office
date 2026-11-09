import { Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer, MapControls, OrthographicCamera, PerformanceMonitor } from '@react-three/drei';
import * as THREE from 'three';
import type { MapControls as MapControlsImpl } from 'three-stdlib';
import { ESTADO_PRESENCIA_COLOR, ESTADO_PRESENCIA_LABEL, type PresenciaSnapshot, type Zona } from '@shared/domain';
import { Human, registroAvatares } from './Human';
import {
  Dispensador, Escritorio, Estanteria, Impresora, Planta, SalaCristal, Silla, Sofa, Tablero, useAlfombra, useCanvasTexture, useMateriales, useParquet, usePantallas, usePorcelanato,
  useTextoTextura, useVentanal, type Mats,
} from './Furniture';
import { CABINAS, ESTACIONES_PSI, PISO, PUNTOS_MUEBLES, ROOMS, ZONES_ABIERTAS, slotPara, type V2 } from './layout';
import { etiquetasStore, ubicarEtiquetas, type Anclaje } from './labels';
import { Fusionar } from './Fusionar';

export interface Foco {
  target: V2;
  zoom: number; // multiplicador sobre el zoom base
  key: number;
}

interface Props {
  presencia: PresenciaSnapshot[];
  seleccionado: string | null;
  onSelect: (clave: string, pos?: V2) => void;
  onZona: (id: string) => void;
  foco: Foco;
  reducirMovimiento: boolean;
  reservaDerecha?: number;
  /** Paseos breves de quienes no están atendiendo (no cambian su estado real). */
  ambiente?: boolean;
}

/** Calidad adaptativa observable (FPS medidos y nivel de calidad aplicado). */
const calidad = { fps: 0, dpr: 1, sombras: true, nivel: 'alta' as 'alta' | 'media' | 'baja' };
const subsCalidad = new Set<() => void>();
const publicarCalidad = () => subsCalidad.forEach((f) => f());
export function useCalidad() {
  return useSyncExternalStore(
    (f) => {
      subsCalidad.add(f);
      return () => {
        subsCalidad.delete(f);
      };
    },
    () => `${calidad.fps}|${calidad.dpr}|${calidad.nivel}`,
  );
}

const W = PISO.w;
const D = PISO.d;
const AZ = Math.atan2(13, 36);
// Zoom 1 = la oficina completa encuadrada. Con la cámara isométrica (13, 30, 36) el piso de 64x40 m
// más los muros proyecta ~74 x 40 unidades; se suma margen y se descuenta la barra superior (52 px).
export const baseZoom = (w: number, h: number) => Math.min((w - 16) / 76, (h - 60) / 42);
const iniciales = (n: string) =>
  n
    .replace(/^(Dr\.|Dra\.|DEMO ·)\s*/i, '')
    .split(/\s+/)
    .filter((w) => /^\p{Lu}/u.test(w) && !/^\p{Lu}\.$/u.test(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

/* ------------------------------------ Cámara ------------------------------------ */
function CameraRig({ foco, controls, reserva = 0 }: { foco: Foco; controls: React.RefObject<MapControlsImpl>; reserva?: number }) {
  const { size, camera } = useThree();
  const base = baseZoom(size.width, size.height);
  const anim = useRef<{ to: THREE.Vector3; zoom: number } | null>(null);
  useEffect(() => {
    const zoom = base * foco.zoom;
    const to = new THREE.Vector3(foco.target[0], 0, foco.target[1]);
    // Con el panel lateral abierto, el punto de interés se centra en el área visible (a la izquierda del
    // panel): se desplaza el objetivo hacia la derecha de la pantalla la mitad del ancho reservado.
    if (reserva > 0) {
      const derecha = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      derecha.y = 0; // en la cámara isométrica el eje derecho ya es horizontal: 1 unidad = zoom px
      derecha.normalize().multiplyScalar(reserva / 2 / zoom);
      to.add(derecha);
    }
    anim.current = { to, zoom };
  }, [foco.key, base, reserva]); // eslint-disable-line react-hooks/exhaustive-deps
  useFrame((_, dt) => {
    const c = controls.current;
    if (!c) return;
    const a = anim.current;
    const cam = camera as THREE.OrthographicCamera;
    if (a) {
      const k = 1 - Math.exp(-Math.min(dt, 0.25) * 6);
      const delta = a.to.clone().sub(c.target).multiplyScalar(k);
      c.target.add(delta);
      cam.position.add(delta);
      cam.zoom += (a.zoom - cam.zoom) * k;
      cam.updateProjectionMatrix();
      c.update();
      if (a.to.distanceTo(c.target) < 0.01 && Math.abs(a.zoom - cam.zoom) < 0.01) anim.current = null;
    }
    const t = c.target;
    const cx = THREE.MathUtils.clamp(t.x, -W / 2, W / 2);
    const cz = THREE.MathUtils.clamp(t.z, -D / 2, D / 2);
    if (cx !== t.x || cz !== t.z) {
      cam.position.x += cx - t.x;
      cam.position.z += cz - t.z;
      t.set(cx, 0, cz);
    }
    c.minZoom = base * 0.85;
    c.maxZoom = base * 9;
  });
  return null;
}

/* ----------------------------- Proyección de etiquetas ----------------------------- */
function Anclajes({ presencia }: { presencia: PresenciaSnapshot[] }) {
  const { camera, size } = useThree();
  const acc = useRef(0);
  const v = useMemo(() => new THREE.Vector3(), []);
  const salas = useMemo(
    () => [
      ...ROOMS.map((r) => ({ id: r.id, nombre: r.nombre + (r.sub ? ` (${r.sub})` : ''), color: r.color, p: [r.center[0], 3.4, r.center[1] - r.size[1] / 2 + 0.2] as const })),
      { id: 'coordinacion', nombre: ZONES_ABIERTAS.coordinacion.nombre, color: '#4D665C', p: [0, 2.6, -3.2] as const },
      { id: 'territorial', nombre: ZONES_ABIERTAS.territorial.nombre, color: '#957556', p: [10.5, 2.9, -3.4] as const },
      { id: 'psicologia', nombre: ZONES_ABIERTAS.psicologia.nombre, color: '#607D72', p: [-30, 2.4, 9.6] as const },
    ],
    [],
  );
  useFrame((_, dt) => {
    acc.current += dt;
    if (acc.current < 0.08) return;
    acc.current = 0;
    const proy = (x: number, y: number, z: number) => {
      v.set(x, y, z).project(camera);
      return { x: ((v.x + 1) / 2) * size.width, y: ((1 - v.y) / 2) * size.height, ok: v.z < 1 && v.x > -1.05 && v.x < 1.05 && v.y > -1.05 && v.y < 1.05 };
    };
    const anclajes: Anclaje[] = [];
    for (const p of presencia) {
      const r = registroAvatares.get(p.clave);
      let pos: { x: number; y: number; ok: boolean };
      if (r?.visible) {
        pos = proy(r.x, 1.3 * (r.sentado > 0.5 ? 1.42 : 1.95) + 0.12, r.z);
      } else {
        const s = slotPara(p, 'estacion', 0);
        if (!s || !p.profesional_id) continue;
        pos = proy(s.pos[0], 1.3, s.pos[1]);
      }
      anclajes.push({
        id: p.clave,
        tipo: 'persona',
        x: pos.x,
        y: pos.y,
        visible: pos.ok,
        completo: p.nombre.replace(/^Dr\.\s*/, '').replace(/\s+\p{Lu}\.$/u, ''),
        detalle: ESTADO_PRESENCIA_LABEL[p.estado],
        corto: iniciales(p.nombre) || p.nombre.slice(0, 2),
        color: ESTADO_PRESENCIA_COLOR[p.estado],
        prioridad: p.conectado ? 20 : 5,
        atenuado: !p.conectado,
      });
    }
    for (const s of salas) {
      const pos = proy(s.p[0], s.p[1], s.p[2]);
      anclajes.push({ id: 'sala:' + s.id, tipo: 'sala', x: pos.x, y: pos.y, visible: pos.ok, completo: s.nombre, corto: s.nombre.split(' ')[0], color: s.color, prioridad: 30 });
    }
    const zoomRel = (camera as THREE.OrthographicCamera).zoom / baseZoom(size.width, size.height);
    etiquetasStore.set({ anclajes, ancho: size.width, alto: size.height, zoomRel });
  });
  return null;
}

/** Superposición HTML (nítida, fuera del lienzo WebGL) con líneas de referencia. */
function EtiquetasOverlay({ seleccionado, onSelect, onZona, reservaDerecha }: { seleccionado: string | null; onSelect: (c: string) => void; onZona: (id: string) => void; reservaDerecha: number }) {
  const st = useSyncExternalStore(etiquetasStore.subscribe, etiquetasStore.get);
  const lista = useMemo(() => ubicarEtiquetas(st.anclajes, st.ancho, st.alto, st.zoomRel, seleccionado, { top: 52, right: reservaDerecha, bottom: 30 }), [st, seleccionado, reservaDerecha]);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden={false}>
      <svg className="absolute inset-0 h-full w-full">
        {lista
          .filter((e) => e.modo !== 'oculto' && e.tipo === 'persona')
          .map((e) => {
            const by = e.ly + e.h / 2 < e.y ? e.ly + e.h / 2 : e.ly - e.h / 2;
            const bx = Math.abs(e.lx - e.x) > e.w / 2 ? e.lx + (e.x > e.lx ? e.w / 2 : -e.w / 2) : e.x;
            return (
              <g key={e.id} opacity={e.atenuado ? 0.45 : 0.9}>
                <line x1={e.x} y1={e.y} x2={bx} y2={Math.abs(e.lx - e.x) > e.w / 2 ? e.ly : by} stroke={e.id === seleccionado ? '#4D665C' : 'rgba(52,72,63,0.45)'} strokeWidth={e.id === seleccionado ? 2 : 1.2} />
                <circle cx={e.x} cy={e.y} r={3} fill={e.color} stroke="#FFFFFF" strokeWidth={1.5} />
              </g>
            );
          })}
      </svg>
      {lista
        .filter((e) => e.modo !== 'oculto')
        .map((e) =>
          e.tipo === 'sala' ? (
            <button
              key={e.id}
              onClick={() => onZona(e.id.slice(5))}
              className="pointer-events-auto absolute flex items-center justify-center whitespace-nowrap rounded-lg border border-white/25 px-2.5 text-[12px] font-semibold text-marfil shadow-lg backdrop-blur"
              style={{ left: e.lx - e.w / 2, top: e.ly - e.h / 2, width: e.w, height: e.h, background: `linear-gradient(180deg, ${e.color}f0, #34483Ff0)` }}
            >
              {e.modo === 'corto' ? e.corto : e.completo}
            </button>
          ) : (
            <button
              key={e.id}
              onClick={() => onSelect(e.id)}
              className={`pointer-events-auto absolute flex flex-col items-center justify-center rounded-lg px-2 text-center shadow-xl ring-1 transition-[left,top] duration-150 ${
                e.id === seleccionado ? 'bg-salvia-50 ring-2 ring-salvia-500' : 'bg-nieve/95 ring-profundo-300'
              } ${e.atenuado ? 'opacity-60' : ''}`}
              style={{ left: e.lx - e.w / 2, top: e.ly - e.h / 2, width: e.w, height: e.h }}
              aria-label={`${e.completo}: ${e.detalle}`}
            >
              {e.modo === 'corto' ? (
                <span className="flex items-center gap-1 text-[11px] font-bold text-profundo-900">
                  <span className="h-2 w-2 rounded-full" style={{ background: e.color }} />
                  {e.corto}
                </span>
              ) : (
                <>
                  <span className="w-full truncate text-[11.5px] font-bold leading-tight text-profundo-900">{e.completo}</span>
                  {e.detalle && (
                    <span className="flex items-center gap-1 text-[10.5px] font-medium leading-tight text-profundo-600">
                      <span className="h-2 w-2 rounded-full" style={{ background: e.color }} />
                      {e.detalle}
                    </span>
                  )}
                </>
              )}
            </button>
          ),
        )}
    </div>
  );
}

/* ------------------------------------ Escena ------------------------------------ */
function Estacion({ x, z, m, encendida, tex }: { x: number; z: number; m: Mats; encendida: boolean; tex: THREE.Texture }) {
  return (
    <group>
      {/* mampara posterior con acceso */}
      <mesh position={[x - 3.2, 0.62, 10.4]} material={m.vidrio}>
        <boxGeometry args={[1.6, 1.24, 0.05]} />
      </mesh>
      <mesh position={[x + 1.55, 0.62, 10.4]} material={m.vidrio}>
        <boxGeometry args={[4.9, 1.24, 0.05]} />
      </mesh>
      <mesh position={[x + 4, 0.5, 13.2]} material={m.vidrio}>
        <boxGeometry args={[0.05, 1.0, 5.6]} />
      </mesh>
      <mesh position={[x + 4, 1.0, 13.2]} material={m.aluminio}>
        <boxGeometry args={[0.06, 0.04, 5.6]} />
      </mesh>
      <mesh position={[x, 0.006, 13.4]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[7.6, 5.6]} />
        <meshStandardMaterial color="#e3e7df" roughness={0.95} />
      </mesh>
      <Escritorio position={[x, 0, 13.5]} m={m} pantalla={encendida} textura={tex} />
      <Silla position={[x, 0, 12.45]} m={m} />
      <Planta position={[x + 3.1, 0, 11.2]} m={m} scale={0.9} tipo={x % 2 ? 1 : 0} />
      <mesh position={[x - 2.6, 0.32, 15.6]} material={m.madera} castShadow>
        <boxGeometry args={[0.9, 0.64, 0.45]} />
      </mesh>
    </group>
  );
}

function Escena({ presencia, seleccionado, onSelect, onZona, foco, reducirMovimiento, sombras, reservaDerecha, ambiente }: Props & { sombras: boolean }) {
  const controls = useRef<MapControlsImpl>(null!);
  const m = useMateriales();
  const piso = usePorcelanato();
  const parquet = useParquet();
  const ventanal = useVentanal();
  const { trabajo, video } = usePantallas();
  const suelos = Object.fromEntries(ROOMS.map((r) => [r.id, r.id === 'debriefing' ? parquet : null]));
  const alfCap = useAlfombra('#b9ccc1');
  const alfPsq = useAlfombra('#b9a8d0');
  const alfTel = useAlfombra('#a9cdb7');
  const alfCons = useAlfombra('#d9cbb7');
  const marca = useTextoTextura(
    [
      { t: 'CGREG', f: 'bold 150px Inter, sans-serif', c: '#34483F' },
      { t: 'Oficina Virtual', f: '600 64px Inter, sans-serif', c: '#34483F' },
      { t: 'Brigada de Atención Psicosocial y de Salud', f: '500 40px Inter, sans-serif', c: '#4D665C' },
    ],
    1400,
    420,
  );
  const presentacion = useCanvasTexture((g, w, h) => {
    g.fillStyle = '#f8fafc';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#4D665C';
    g.fillRect(0, 0, w, 70);
    g.fillStyle = '#fff';
    g.font = 'bold 40px Inter, sans-serif';
    g.fillText('Primeros auxilios psicológicos', 30, 48);
    g.fillStyle = '#334155';
    g.font = '30px Inter, sans-serif';
    ['Escuchar', 'Proteger', 'Conectar', 'Rutas de apoyo DECE'].forEach((t, i) => g.fillText(`• ${t}`, 50, 140 + i * 56));
    g.fillStyle = '#C5A989';
    g.fillRect(620, 120, 300, 260);
  }, 1024, 512);
  const tableroMadera = m.madera;

  const porPro = useMemo(() => new Map(presencia.filter((p) => p.profesional_id).map((p) => [p.profesional_id!, p])), [presencia]);
  const diego = porPro.get('diego-estrella');
  const demetrio = porPro.get('demetrio-magallanes');
  const enZona = (z: Zona) => presencia.some((p) => p.conectado && p.zona === z);
  const slots = useMemo(() => {
    const cont = new Map<string, number>();
    return presencia.map((p) => {
      if (!p.conectado) return null;
      const i = cont.get(p.zona) ?? 0;
      cont.set(p.zona, i + 1);
      return slotPara(p, p.zona, i);
    });
  }, [presencia]);

  // Gancho de lectura para pruebas visuales automatizadas (solo posiciones públicas de avatares).
  useEffect(() => {
    (window as unknown as { __cgregOffice?: unknown }).__cgregOffice = {
      avatares: () => Object.fromEntries([...registroAvatares.entries()].map(([k, v]) => [k, { ...v }])),
      calidad: () => ({ ...calidad }),
      render: () => ({ ...(window as any).__cgregRender }),
    };
  }, []);

  return (
    <>
      <OrthographicCamera makeDefault position={[13, 30, 36]} zoom={20} near={-300} far={500} />
      <MapControls
        ref={controls}
        enableDamping
        dampingFactor={0.12}
        screenSpacePanning
        minPolarAngle={0.5}
        maxPolarAngle={1.1}
        minAzimuthAngle={AZ - 0.55}
        maxAzimuthAngle={AZ + 0.55}
      />
      <CameraRig foco={foco} controls={controls} reserva={reservaDerecha} />
      <Anclajes presencia={presencia} />

      {/* Iluminación: cielo + sol desde el ventanal + entorno local para reflejos (sin recursos externos) */}
      <hemisphereLight args={['#f4f6ef', '#5b4a3a', 0.65]} />
      <ambientLight intensity={0.25} />
      <directionalLight
        position={[-18, 34, -26]}
        intensity={2.1}
        color="#fff4e2"
        castShadow={sombras}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
        shadow-camera-left={-40}
        shadow-camera-right={40}
        shadow-camera-top={34}
        shadow-camera-bottom={-34}
        shadow-camera-near={1}
        shadow-camera-far={120}
      />
      <directionalLight position={[20, 18, 30]} intensity={0.55} color="#eef2e8" />
      <Environment resolution={128} frames={1}>
        <Lightformer form="rect" intensity={2.5} position={[0, 6, -10]} scale={[20, 5, 1]} color="#ffffff" />
        <Lightformer form="rect" intensity={1.2} position={[10, 8, 10]} scale={[10, 10, 1]} color="#eef2e8" />
        <Lightformer form="ring" intensity={0.8} position={[-10, 5, 5]} scale={4} color="#fde68a" />
      </Environment>

      <Fusionar key={sombras ? 's' : 'n'}>
      {/* Piso, losa y muros */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[W, D]} />
        <meshStandardMaterial map={piso} color="#e6e4dc" roughness={0.45} metalness={0.02} envMapIntensity={0.5} />
      </mesh>
      {/* Losa: su cara superior queda 2 cm BAJO el piso. Si coincidiera con y = 0 competiría con el piso
          en el búfer de profundidad (z-fighting): manchas oscuras y rayas que cambian al hacer zoom. */}
      <mesh position={[0, -0.32, 0]}>
        <boxGeometry args={[W + 0.8, 0.6, D + 0.8]} />
        <meshStandardMaterial color="#4D665C" roughness={0.6} />
      </mesh>
      {[-6.6, 7.4].map((z) => (
        <mesh key={z} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, z]} receiveShadow>
          <planeGeometry args={[W - 1, 1.8]} />
          <meshStandardMaterial color="#d6dbd2" roughness={0.6} />
        </mesh>
      ))}
      {/* Ventanal panorámico con perfilería */}
      <mesh position={[0, 2.35, -D / 2 + 0.02]}>
        <planeGeometry args={[W, 4.5]} />
        <meshBasicMaterial map={ventanal} toneMapped={false} />
      </mesh>
      {Array.from({ length: W / 4 + 1 }).map((_, i) => (
        <mesh key={i} position={[-W / 2 + i * 4, 2.35, -D / 2 + 0.06]} material={m.aluminio}>
          <boxGeometry args={[0.1, 4.6, 0.1]} />
        </mesh>
      ))}
      <mesh position={[0, 4.65, -D / 2 + 0.05]} material={m.aluminio}>
        <boxGeometry args={[W, 0.16, 0.16]} />
      </mesh>
      <mesh position={[0, 0.06, -D / 2 + 0.08]} material={m.aluminio}>
        <boxGeometry args={[W, 0.12, 0.14]} />
      </mesh>
      {/* Muro lateral de madera con identidad institucional */}
      <mesh position={[-W / 2 + 0.05, 2.35, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[D, 4.7]} />
        <meshStandardMaterial color="#a77b52" roughness={0.6} />
      </mesh>
      {Array.from({ length: 20 }).map((_, i) => (
        <mesh key={i} position={[-W / 2 + 0.08, 2.35, -D / 2 + 1 + i * 2]} material={m.maderaOscura}>
          <boxGeometry args={[0.02, 4.7, 0.04]} />
        </mesh>
      ))}
      <mesh position={[-W / 2 + 0.12, 3.1, 14]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[8, 2.4]} />
        <meshBasicMaterial map={marca} transparent toneMapped={false} />
      </mesh>

      {/* Salas con muros de cristal */}
      {ROOMS.filter((r) => r.id !== 'consultorios').map((r) => {
        const activo =
          r.id === 'psiquiatria' ? !!diego && (diego.conectado || diego.en_horario) : r.id === 'telemedicina' ? !!demetrio?.conectado : enZona(r.id as Zona);
        const suelo = suelos[r.id] ?? (r.id === 'capacitacion' ? alfCap : r.id === 'psiquiatria' ? alfPsq : alfTel);
        return <SalaCristal key={r.id} center={r.center} size={r.size} m={m} suelo={suelo} activo={activo} color={r.color} onClick={() => onZona(r.id)} />;
      })}

      {/* Sala de Debriefing */}
      <group position={[-19, 0, -13.5]}>
        <mesh position={[0, 0.74, 0]} scale={[1.75, 1, 1]} castShadow receiveShadow material={tableroMadera}>
          <cylinderGeometry args={[1.75, 1.75, 0.07, 48]} />
        </mesh>
        <mesh position={[0, 0.37, 0]} material={m.aluminio}>
          <cylinderGeometry args={[0.18, 0.35, 0.72, 16]} />
        </mesh>
        {Array.from({ length: 8 }).map((_, i) => {
          const a = Math.PI / 2 + (i * Math.PI * 2) / 8;
          return <Silla key={i} position={[Math.cos(a) * 4.4, 0, Math.sin(a) * 2.6]} rot={Math.atan2(-Math.cos(a), -Math.sin(a))} m={m} />;
        })}
        <mesh position={[0, 1.7, -5.6]} material={m.negro}>
          <boxGeometry args={[3.2, 1.8, 0.08]} />
        </mesh>
        <mesh position={[0, 1.7, -5.55]} userData={{ dinamico: true }}>
          <planeGeometry args={[3.05, 1.65]} />
          <meshStandardMaterial map={enZona('debriefing') ? video : null} color={enZona('debriefing') ? '#ffffff' : '#0d1320'} emissive="#ffffff" emissiveMap={enZona('debriefing') ? video : null} emissiveIntensity={enZona('debriefing') ? 0.8 : 0} />
        </mesh>
        <Planta position={[-8, 0, -5]} m={m} scale={1.3} />
        <Planta position={[8, 0, -5]} m={m} scale={1.3} tipo={1} />
      </group>

      {/* Centro de Capacitación DECE */}
      <group position={[1, 0, -13.5]}>
        <mesh position={[0, 2, -5.6]} userData={{ dinamico: true }}>
          <planeGeometry args={[6, 3]} />
          <meshStandardMaterial map={presentacion} emissive="#ffffff" emissiveMap={presentacion} emissiveIntensity={enZona('capacitacion') ? 0.7 : 0.15} />
        </mesh>
        <mesh position={[0, 0.45, -4.2]} material={m.blanco} castShadow>
          <boxGeometry args={[1.2, 0.9, 0.6]} />
        </mesh>
        {Array.from({ length: 12 }).map((_, i) => (
          <Silla key={i} position={[-4.5 + (i % 4) * 3, 0, 0.5 + Math.floor(i / 4) * 2.2]} rot={Math.PI} m={m} color={m.tela} />
        ))}
        <Planta position={[-8.5, 0, -5]} m={m} scale={1.2} tipo={1} />
        <Planta position={[8.5, 0, -5]} m={m} scale={1.2} />
      </group>

      {/* Psiquiatría */}
      <group>
        <Escritorio position={[16, 0, -11.25]} m={m} pantalla={!!diego?.conectado} textura={trabajo} tablero={m.madera} />
        <Silla position={[16, 0, -12.2]} m={m} />
        <Escritorio position={[27.35, 0, -14.8]} rot={Math.PI / 2} w={1.4} m={m} monitores={1} pantalla={diego?.estado === 'en_consulta'} textura={video} />
        <Silla position={[26.4, 0, -14.8]} rot={Math.PI / 2} m={m} />
        <Estanteria position={[21.5, 0, -19.1]} m={m} />
        <Sofa position={[20.5, 0, -10]} rot={Math.PI} m={m} color="#6d5a8a" />
        <Planta position={[13.8, 0, -18.8]} m={m} scale={1.2} />
      </group>

      {/* Telemedicina */}
      <group>
        <Escritorio position={[17.5, 0, 2.55]} m={m} pantalla={!!demetrio?.conectado} textura={trabajo} />
        <Silla position={[17.5, 0, 1.5]} m={m} />
        <Escritorio position={[28.15, 0, -1.4]} rot={Math.PI / 2} w={1.5} m={m} monitores={1} pantalla={demetrio?.estado === 'en_consulta'} textura={video} />
        <Silla position={[27.2, 0, -1.4]} rot={Math.PI / 2} m={m} />
        <mesh position={[30.85, 1.75, -1.4]} rotation={[0, -Math.PI / 2, 0]} userData={{ dinamico: true }}>
          <planeGeometry args={[3.2, 1.8]} />
          <meshStandardMaterial map={demetrio?.estado === 'en_consulta' ? video : null} color={demetrio?.estado === 'en_consulta' ? '#ffffff' : '#0d1320'} emissive="#ffffff" emissiveMap={demetrio?.estado === 'en_consulta' ? video : null} emissiveIntensity={demetrio?.estado === 'en_consulta' ? 0.85 : 0} />
        </mesh>
        <mesh position={[22, 0.45, -5]} material={m.blanco} castShadow>
          <boxGeometry args={[2.2, 0.9, 0.6]} />
        </mesh>
        <Planta position={[14.8, 0, -5.2]} m={m} scale={1.1} />
      </group>

      {/* Consultorios individuales de Psicología (puerta hacia su pasillo) */}
      <mesh position={[-21, 0.01, -0.5]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow userData={{ dinamico: true }} onClick={(e) => (e.stopPropagation(), onZona('consultorios'))}>
        <planeGeometry args={[19.9, 10.9]} />
        <meshStandardMaterial map={alfCons} roughness={0.95} />
      </mesh>
      {CABINAS.map(([x, z], i) => {
        const ocupada = presencia.some((p) => p.conectado && p.zona === 'consultorio_psicologia' && p.estacion === `psi-${i + 1}`);
        const puertaZ = z < 0 ? -2.75 : 2.75; // lado de la puerta, relativo a la cabina
        return (
          <group key={i} position={[x, 0, z]}>
            <mesh position={[0, 1.25, -puertaZ]} material={m.vidrio}>
              <boxGeometry args={[6.4, 2.5, 0.05]} />
            </mesh>
            <mesh position={[3.2, 1.25, 0]} material={m.vidrio}>
              <boxGeometry args={[0.05, 2.5, 5.4]} />
            </mesh>
            {[-1, 1].map((l) => (
              <mesh key={l} position={[l * 2, 0.55, puertaZ]} material={m.vidrio}>
                <boxGeometry args={[2.4, 1.1, 0.05]} />
              </mesh>
            ))}
            {[[-3.2, -puertaZ], [3.2, -puertaZ], [3.2, puertaZ], [-3.2, puertaZ]].map(([px, pz], k) => (
              <mesh key={'p' + k} position={[px, 1.25, pz]} material={m.aluminio}>
                <boxGeometry args={[0.06, 2.5, 0.06]} />
              </mesh>
            ))}
            <Escritorio position={[0.05, 0, 0.3]} rot={Math.PI / 2} w={1.3} m={m} monitores={1} pantalla={ocupada} textura={video} />
            <Silla position={[-0.9, 0, 0.3]} rot={Math.PI / 2} m={m} />
            <Planta position={[2.4, 0, -puertaZ * 0.75]} m={m} scale={0.7} tipo={i % 2} />
            <Sofa position={[-2.3, 0, -puertaZ * 0.7]} rot={z < 0 ? 0 : Math.PI} m={m} color="#8CA89C" />
          </group>
        );
      })}

      {/* Coordinación CGREG: recepción curva */}
      <group position={[0, 0, -0.5]}>
        <mesh position={[0, 0.55, 0.4]} castShadow receiveShadow>
          <cylinderGeometry args={[2.5, 2.5, 1.1, 48, 1, true, -Math.PI * 0.42, Math.PI * 0.84]} />
          <meshStandardMaterial color="#f8fafc" roughness={0.3} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, 1.12, 0.4]} rotation={[-Math.PI / 2, 0, 0]} material={m.madera}>
          <ringGeometry args={[2.15, 2.75, 48, 1, Math.PI / 2 - Math.PI * 0.42, Math.PI * 0.84]} />
        </mesh>
        <mesh position={[0, 0.02, 0.4]} rotation={[-Math.PI / 2, 0, 0]} userData={{ dinamico: true }}>
          <ringGeometry args={[2.85, 3.0, 64]} />
          <meshBasicMaterial color={enZona('coordinacion') ? '#78958A' : '#A3B2AA'} />
        </mesh>
        <Escritorio position={[0, 0, 0.05]} w={1.8} m={m} pantalla={enZona('coordinacion')} textura={trabajo} tablero={m.madera} />
        <Silla position={[0, 0, -0.9]} m={m} />
        <Planta position={[-3.6, 0, -2]} m={m} scale={1.2} />
        <Planta position={[3.6, 0, -2]} m={m} scale={1.2} tipo={1} />
      </group>

      {/* Articulación Territorial */}
      <group position={[10.5, 0, -0.5]}>
        <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} onClick={(e) => (e.stopPropagation(), onZona('territorial'))} receiveShadow userData={{ dinamico: true }}>
          <circleGeometry args={[3, 48]} />
          <meshStandardMaterial color={enZona('territorial') ? '#fed7aa' : '#e5e7eb'} roughness={0.9} />
        </mesh>
        <Escritorio position={[0, 0, -0.05]} m={m} pantalla={enZona('territorial')} textura={trabajo} monitores={1} />
        <Silla position={[0, 0, -1]} m={m} />
        <mesh position={[0, 1.4, -2.7]} castShadow>
          <boxGeometry args={[3.2, 1.8, 0.06]} />
          <meshStandardMaterial color="#e6eee8" roughness={0.5} />
        </mesh>
      </group>

      {/* Psicología Clínica: siete estaciones */}
      {Object.entries(ESTACIONES_PSI).map(([k, [x, z]]) => (
        <Estacion key={k} x={x} z={z} m={m} tex={trabajo} encendida={presencia.some((p) => p.estacion === k && p.conectado && p.zona === 'estacion')} />
      ))}

      {/* Zona de pausa */}
      <group>
        <Sofa position={[27.4, 0, 14.05]} m={m} color="#607D72" />
        <mesh position={[27.4, 0.22, 15.4]} material={m.madera} castShadow>
          <cylinderGeometry args={[0.55, 0.55, 0.06, 32]} />
        </mesh>
        <mesh position={[27.4, 0.1, 15.4]} material={m.aluminio}>
          <cylinderGeometry args={[0.05, 0.2, 0.2, 12]} />
        </mesh>
        <Planta position={[30.4, 0, 12]} m={m} scale={1.3} tipo={1} />
        <Planta position={[24.2, 0, 17.5]} m={m} scale={1.1} />
      </group>

      {/* Plantas de ambientación y acceso */}
      {[[-30.5, 18.5], [-30.5, -8], [5.2, 18.5], [12.5, -7.2], [-10.5, -7.2], [30.5, 9.4], [-5.5, 3.5], [5.5, 3.6]].map(([x, z], i) => (
        <Planta key={i} position={[x, 0, z]} m={m} scale={1.25} tipo={i % 2} />
      ))}
      {/* Puntos de interés de los paseos: dispensadores de agua, impresora y tableros informativos */}
      {PUNTOS_MUEBLES.dispensadores.map(([x, z]) => (
        <Dispensador key={x} position={[x, 0, z]} rot={x < 0 ? Math.PI / 2 : -Math.PI / 2} m={m} />
      ))}
      <Impresora position={[PUNTOS_MUEBLES.impresora[0], 0, PUNTOS_MUEBLES.impresora[1]]} rot={Math.PI} m={m} />
      {PUNTOS_MUEBLES.tableros.map(([x, z]) => (
        <Tablero key={x} position={[x, 0, z]} m={m} />
      ))}
      <mesh position={[0, 0.015, 19.3]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[4, 1.2]} />
        <meshStandardMaterial color="#c9d3c8" roughness={1} />
      </mesh>

      </Fusionar>

      {/* Avatares (solo usuarios con conexión real) */}
      {presencia.map((p, i) => (
        <Human
          key={p.clave}
          p={p}
          slot={slots[i]}
          seleccionado={seleccionado === p.clave}
          onSelect={(pos) => onSelect(p.clave, pos)}
          reducirMovimiento={reducirMovimiento}
          sombras={sombras}
          ambiente={ambiente}
        />
      ))}
    </>
  );
}

/** Medición de FPS real del navegador (no simulada). */
function MedidorFps() {
  const acc = useRef({ n: 0, t: 0 });
  const gl = useThree((s) => s.gl);
  useFrame((_, dt) => {
    (window as any).__cgregRender = { llamadas: gl.info.render.calls, triangulos: gl.info.render.triangles, geometrias: gl.info.memory.geometries, texturas: gl.info.memory.textures };
    acc.current.n++;
    acc.current.t += dt;
    if (acc.current.t >= 1) {
      calidad.fps = Math.round(acc.current.n / acc.current.t);
      acc.current = { n: 0, t: 0 };
      publicarCalidad();
    }
  });
  return null;
}

export default function OfficeScene(props: Props) {
  // Resolución nativa: en pantallas Retina se renderiza a DPR 2 (antes 1,5 → imagen reescalada y borrosa).
  // ?calidad=baja fuerza el modo liviano (equipos modestos o navegadores sin aceleración gráfica).
  const modo = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('calidad') : null;
  const baja = modo === 'baja';
  const fija = modo === 'alta' || baja; // ?calidad=alta|baja: sin ajuste automático
  const dprMax = baja ? 1 : Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2);
  const [dpr, setDpr] = useState(dprMax);
  const [sombras, setSombras] = useState(!baja);
  useEffect(() => {
    calidad.dpr = dpr;
    calidad.sombras = sombras;
    calidad.nivel = dpr >= dprMax && sombras ? 'alta' : dpr > 1 ? 'media' : 'baja';
    publicarCalidad();
  }, [dpr, sombras, dprMax]);
  return (
    <div className="relative h-full w-full">
      <Canvas
        shadows={sombras ? 'soft' : false}
        dpr={dpr}
        gl={{ antialias: true, powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 0.98, outputColorSpace: THREE.SRGBColorSpace }}
        onCreated={({ gl }) => gl.setClearColor('#E9EFEA')}
        aria-label="Oficina virtual isométrica"
      >
        {/* Calidad adaptativa: baja la resolución en pasos pequeños solo si los FPS caen de forma sostenida.
            Tras dos cambios de sentido se fija (flipflops) para no alternar resoluciones: eso se percibe como parpadeo. */}
        {!fija && <PerformanceMonitor
          bounds={() => [28, 55]}
          flipflops={2}
          onDecline={() => {
            if (dpr > 1.25) setDpr((d) => Math.max(1, +(d - 0.25).toFixed(2)));
            else setSombras(false);
          }}
          onIncline={() => setDpr((d) => Math.min(dprMax, +(d + 0.25).toFixed(2)))}
        />}
        <MedidorFps />
        <fog attach="fog" args={['#E9EFEA', 160, 320]} />
        <Suspense fallback={null}>
          <Escena {...props} sombras={sombras} />
        </Suspense>
      </Canvas>
      <EtiquetasOverlay seleccionado={props.seleccionado} onSelect={(c) => props.onSelect(c)} onZona={props.onZona} reservaDerecha={props.reservaDerecha ?? 0} />
    </div>
  );
}

export { calidad };
