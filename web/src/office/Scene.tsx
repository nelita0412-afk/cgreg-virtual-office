import { Suspense, useMemo, useRef, useState, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, MapControls, OrthographicCamera, PerformanceMonitor, RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import type { MapControls as MapControlsImpl } from 'three-stdlib';
import { ESTADO_PRESENCIA_COLOR, ESTADO_PRESENCIA_LABEL, type PresenciaSnapshot, type Zona } from '@shared/domain';
import { Avatar } from './Avatar';
import { Chair, Desk, GlassRoom, Plant, Sofa, useFloorTexture, useVentanalTexture, WOOD } from './Furniture';
import { CABINAS, ESTACIONES_PSI, ROOMS, ZONES_ABIERTAS, slotPara, type V2 } from './layout';

export interface Foco {
  target: V2;
  zoom: number; // multiplicador sobre el zoom base
  key: number;
}

interface Props {
  presencia: PresenciaSnapshot[];
  seleccionado: string | null;
  onSelect: (clave: string) => void;
  onZona: (id: string) => void;
  foco: Foco;
  reducirMovimiento: boolean;
}

const W = 48;
const D = 34;

function Etiqueta({ position, children, color = '#0b2350', onClick }: { position: [number, number, number]; children: React.ReactNode; color?: string; onClick?: () => void }) {
  return (
    <Html position={position} center zIndexRange={[10, 0]} className="office-label">
      <button
        onClick={onClick}
        className="rounded-xl border border-white/25 px-3 py-1 text-[12px] font-semibold text-white shadow-xl backdrop-blur"
        style={{ background: `linear-gradient(180deg, ${color}ee, #061633ee)` }}
      >
        {children}
      </button>
    </Html>
  );
}

function Placa({ position, p, onSelect }: { position: [number, number, number]; p?: PresenciaSnapshot; onSelect: () => void }) {
  if (!p) return null;
  const nombre = p.nombre.replace(/^Dr\.\s*/, '').replace(/\s+[A-Z]\.$/, '');
  return (
    <Html position={position} center zIndexRange={[10, 0]} className="office-label">
      <button onClick={onSelect} className="w-[132px] whitespace-normal rounded-xl bg-white/95 px-2 py-1 text-center shadow-xl ring-1 ring-slate-300" aria-label={`${p.nombre}: ${ESTADO_PRESENCIA_LABEL[p.estado]}`}>
        <div className="line-clamp-2 text-[11px] font-bold leading-tight text-slate-900">{nombre}</div>
        <div className="mt-0.5 flex items-center justify-center gap-1 whitespace-nowrap text-[10px] font-medium text-slate-700">
          <span className="h-2 w-2 rounded-full" style={{ background: ESTADO_PRESENCIA_COLOR[p.estado] }} />
          {ESTADO_PRESENCIA_LABEL[p.estado]}
        </div>
      </button>
    </Html>
  );
}

/** Cámara isométrica: zoom base adaptado al tamaño del lienzo y transiciones suaves de foco. */
function CameraRig({ foco, controls }: { foco: Foco; controls: React.RefObject<MapControlsImpl> }) {
  const { size, camera } = useThree();
  const base = baseZoom(size.width, size.height);
  const anim = useRef<{ to: THREE.Vector3; zoom: number } | null>(null);
  useEffect(() => {
    anim.current = { to: new THREE.Vector3(foco.target[0], 0, foco.target[1]), zoom: base * foco.zoom };
  }, [foco.key, base]); // eslint-disable-line react-hooks/exhaustive-deps
  useFrame((_, dt) => {
    const c = controls.current;
    if (!c) return;
    const a = anim.current;
    const cam = camera as THREE.OrthographicCamera;
    if (a) {
      // Interpolación basada en tiempo: converge igual a 60 FPS o en equipos lentos.
      const k = 1 - Math.exp(-Math.min(dt, 0.25) * 7);
      const delta = a.to.clone().sub(c.target).multiplyScalar(k);
      c.target.add(delta);
      cam.position.add(delta);
      cam.zoom += (a.zoom - cam.zoom) * k;
      cam.updateProjectionMatrix();
      c.update();
      if (a.to.distanceTo(c.target) < 0.01 && Math.abs(a.zoom - cam.zoom) < 0.01) anim.current = null;
    }
    // límites de desplazamiento
    const t = c.target;
    const cx = THREE.MathUtils.clamp(t.x, -W / 2, W / 2);
    const cz = THREE.MathUtils.clamp(t.z, -D / 2, D / 2);
    if (cx !== t.x || cz !== t.z) {
      cam.position.x += cx - t.x;
      cam.position.z += cz - t.z;
      t.set(cx, 0, cz);
    }
    c.minZoom = base * 0.7;
    c.maxZoom = base * 5;
  });
  return null;
}

const baseZoom = (w: number, h: number) => Math.min(w / 50, h / 33);
const AZ = Math.atan2(12, 38);

function Escena({ presencia, seleccionado, onSelect, onZona, foco, reducirMovimiento }: Props) {
  const floor = useFloorTexture();
  const ventanal = useVentanalTexture();
  const controls = useRef<MapControlsImpl>(null!);
  const [hover, setHover] = useState<string | null>(null);
  const { camera, size } = useThree();
  const [zoomRel, setZoomRel] = useState(1);
  useFrame(() => {
    const base = baseZoom(size.width, size.height);
    const z = (camera as THREE.OrthographicCamera).zoom / base;
    if (Math.abs(z - zoomRel) > 0.15) setZoomRel(z);
  });

  const porPro = useMemo(() => new Map(presencia.filter((p) => p.profesional_id).map((p) => [p.profesional_id!, p])), [presencia]);
  const zonaActiva = (z: Zona) => presencia.some((p) => p.conectado && p.zona === z);
  const diego = porPro.get('diego-estrella');
  const demetrio = porPro.get('demetrio-magallanes');

  // índice de cada avatar dentro de su zona (para repartir asientos)
  const slots = useMemo(() => {
    const cont = new Map<string, number>();
    return presencia.map((p) => {
      if (!p.conectado) return null;
      const k = p.zona;
      const i = cont.get(k) ?? 0;
      cont.set(k, i + 1);
      return slotPara(p, p.zona, i);
    });
  }, [presencia]);

  return (
    <>
      <OrthographicCamera makeDefault position={[12, 34, 38]} zoom={10} near={-200} far={400} />
      <MapControls
        ref={controls}
        enableDamping
        dampingFactor={0.12}
        screenSpacePanning
        minPolarAngle={0.5}
        maxPolarAngle={1.15}
        minAzimuthAngle={AZ - 0.6}
        maxAzimuthAngle={AZ + 0.6}
      />
      <CameraRig foco={foco} controls={controls} />

      <hemisphereLight args={['#e0f2fe', '#1e293b', 0.9]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[18, 32, 14]} intensity={1.6} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-32} shadow-camera-right={32} shadow-camera-top={32} shadow-camera-bottom={-32} />

      {/* piso */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[W, D]} />
        <meshStandardMaterial map={floor} roughness={0.85} />
      </mesh>
      {/* borde/zócalo */}
      <mesh position={[0, -0.25, 0]}>
        <boxGeometry args={[W + 0.6, 0.5, D + 0.6]} />
        <meshStandardMaterial color="#0b2350" />
      </mesh>
      {/* pasillos */}
      {[-5, 7.6].map((z) => (
        <mesh key={z} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, z]} receiveShadow>
          <planeGeometry args={[W - 1, 1.6]} />
          <meshStandardMaterial color="#c7d2de" />
        </mesh>
      ))}

      {/* muro posterior con ventanal al mar */}
      <mesh position={[0, 2.1, -D / 2 + 0.05]}>
        <planeGeometry args={[W, 4.2]} />
        <meshBasicMaterial map={ventanal} toneMapped={false} />
      </mesh>
      <mesh position={[0, 4.25, -D / 2]}>
        <boxGeometry args={[W, 0.15, 0.2]} />
        <meshStandardMaterial color="#334155" />
      </mesh>
      {/* muro izquierdo de madera con identidad */}
      <mesh position={[-W / 2 + 0.05, 2.1, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[D, 4.2]} />
        <meshStandardMaterial color={WOOD} roughness={0.7} />
      </mesh>
      <Html position={[-W / 2 + 0.2, 3.1, 10]} rotation={[0, Math.PI / 2, 0]} transform distanceFactor={9} zIndexRange={[10, 0]} className="office-label">
        <div className="text-left font-black leading-none tracking-tight text-[#0b1d42]" style={{ width: 340 }}>
          <div className="text-[64px]">CGREG</div>
          <div className="mt-1 text-[30px] font-bold">Oficina Virtual</div>
          <div className="text-[20px] font-semibold text-[#123170]">Brigada de Atención Psicosocial y de Salud</div>
        </div>
      </Html>

      {/* salas */}
      {ROOMS.map((r) => {
        const activo =
          r.id === 'psiquiatria'
            ? !!diego && (diego.conectado || diego.en_horario)
            : r.id === 'telemedicina'
              ? !!demetrio?.conectado
              : r.id === 'consultorios'
                ? zonaActiva('consultorio_psicologia')
                : zonaActiva(r.id as Zona);
        return (
          <group key={r.id}>
            <GlassRoom center={r.center} size={r.size} color={r.color} activo={activo || hover === r.id} onClick={() => onZona(r.id)} onOver={(v) => setHover(v ? r.id : null)} />
            <Etiqueta position={[r.center[0] + (r.id === 'telemedicina' ? 2.4 : 0), 3.4, r.center[1] - r.size[1] / 2 + 0.3]} color={r.color} onClick={() => onZona(r.id)}>
              {r.nombre}
              {r.sub && <span className="ml-1 font-normal opacity-80">({r.sub})</span>}
            </Etiqueta>
          </group>
        );
      })}

      {/* Sala de Debriefing: mesa ovalada */}
      <group position={[-14, 0, -10.5]}>
        <mesh position={[0, 0.74, 0]} scale={[1.6, 1, 1]} castShadow receiveShadow>
          <cylinderGeometry args={[2, 2, 0.08, 40]} />
          <meshStandardMaterial color={WOOD} roughness={0.5} />
        </mesh>
        <mesh position={[0, 0.37, 0]}>
          <cylinderGeometry args={[0.3, 0.4, 0.74, 12]} />
          <meshStandardMaterial color="#334155" />
        </mesh>
        {Array.from({ length: 8 }).map((_, i) => {
          const a = Math.PI / 2 + (i * Math.PI * 2) / 8;
          return <Chair key={i} position={[Math.cos(a) * 4, 0, Math.sin(a) * 2.6]} rot={Math.atan2(-Math.cos(a), -Math.sin(a))} />;
        })}
        <mesh position={[0, 1.8, -4.35]}>
          <boxGeometry args={[4, 1.4, 0.08]} />
          <meshStandardMaterial color="#0f172a" emissive={zonaActiva('debriefing') ? '#0ea5e9' : '#000'} emissiveIntensity={0.5} />
        </mesh>
      </group>

      {/* Centro de Capacitación DECE */}
      <group position={[2.5, 0, -10.5]}>
        <mesh position={[0, 1.9, -4.3]}>
          <boxGeometry args={[5.5, 2, 0.08]} />
          <meshStandardMaterial color="#e2e8f0" emissive={zonaActiva('capacitacion') ? '#22d3ee' : '#000'} emissiveIntensity={0.35} />
        </mesh>
        {Array.from({ length: 12 }).map((_, i) => (
          <Chair key={i} position={[-3.5 + (i % 4) * 2.3, 0, 0.8 + Math.floor(i / 4) * 1.6]} rot={Math.PI} color="#1e3a8a" />
        ))}
        <Desk position={[0, 0, -2.6]} w={1.6} pantalla={zonaActiva('capacitacion')} />
      </group>

      {/* Psiquiatría */}
      <group position={[18, 0, -10.5]}>
        <Desk position={[-3, 0, 1.6]} pantalla={!!diego?.conectado} colorPantalla="#a855f7" />
        <Chair position={[-3, 0, 0.9]} />
        <Desk position={[2.2, 0, -0.7]} rot={-Math.PI / 2} w={1.6} pantalla={diego?.estado === 'en_consulta'} colorPantalla="#c084fc" />
        <mesh position={[3.5, 1.1, -4.2]} castShadow>
          <boxGeometry args={[2, 2.2, 0.5]} />
          <meshStandardMaterial color="#6b4f37" />
        </mesh>
        <Plant position={[-4.3, 0, -3.8]} />
      </group>

      {/* Telemedicina */}
      <group position={[18, 0, 1.5]}>
        <Desk position={[-2.4, 0, 3.2]} pantalla={!!demetrio?.conectado} colorPantalla="#10b981" monitores={2} />
        <Desk position={[3, 0, -1.3]} rot={-Math.PI / 2} w={1.8} pantalla={demetrio?.estado === 'en_consulta'} colorPantalla="#34d399" />
        <mesh position={[4.9, 1.6, -1.3]} rotation={[0, -Math.PI / 2, 0]}>
          <planeGeometry args={[2.6, 1.5]} />
          <meshStandardMaterial color={demetrio?.estado === 'en_consulta' ? '#d1fae5' : '#0f172a'} emissive={demetrio?.estado === 'en_consulta' ? '#10b981' : '#000'} emissiveIntensity={0.6} side={THREE.DoubleSide} />
        </mesh>
        <Plant position={[-4.3, 0, -3.6]} />
      </group>

      {/* Consultorios de psicología: cabinas */}
      {CABINAS.map(([x, z], i) => {
        const ocupada = presencia.some((p) => p.conectado && p.zona === 'consultorio_psicologia' && p.estacion === `psi-${i + 1}`);
        return (
          <group key={i} position={[x, 0, z]}>
            <mesh position={[0, 1.1, -1.7]}>
              <boxGeometry args={[4.2, 2.2, 0.06]} />
              <meshStandardMaterial color="#93c5fd" transparent opacity={0.22} depthWrite={false} />
            </mesh>
            <mesh position={[2.1, 0.9, 0]}>
              <boxGeometry args={[0.06, 1.8, 3.4]} />
              <meshStandardMaterial color="#93c5fd" transparent opacity={0.18} depthWrite={false} />
            </mesh>
            <Desk position={[0, 0, 0.5]} w={1.6} d={0.8} pantalla={ocupada} colorPantalla="#60a5fa" />
            {ocupada && <pointLight position={[0, 2, 0]} color="#60a5fa" intensity={3} distance={4} />}
          </group>
        );
      })}

      {/* Coordinación central */}
      <group position={[0, 0, 1]}>
        <mesh position={[0, 0.5, 0.2]} castShadow receiveShadow>
          <cylinderGeometry args={[2.6, 2.6, 1, 48, 1, true, -Math.PI * 0.35, Math.PI * 0.7]} />
          <meshStandardMaterial color="#f8fafc" side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, 1.02, 0.2]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[2.1, 2.7, 48, 1, Math.PI / 2 - Math.PI * 0.35 - 0.0, Math.PI * 0.7]} />
          <meshStandardMaterial color={WOOD} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, 0.06, 0.2]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[2.7, 2.85, 48]} />
          <meshBasicMaterial color={zonaActiva('coordinacion') ? '#22d3ee' : '#94a3b8'} />
        </mesh>
        <Desk position={[0, 0, 0.9]} w={1.8} d={0.7} monitores={2} pantalla={zonaActiva('coordinacion')} />
        <Etiqueta position={[0, 2.9, 3.2]} color="#123170" onClick={() => onZona('coordinacion')}>
          {ZONES_ABIERTAS.coordinacion.nombre}
        </Etiqueta>
      </group>
      <Plant position={[-3.6, 0, -2.2]} scale={1.1} />
      <Plant position={[3.4, 0, -2.4]} />

      {/* Articulación territorial */}
      <group position={[8.5, 0, 1.5]}>
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} onClick={(e) => (e.stopPropagation(), onZona('territorial'))}>
          <circleGeometry args={[2.6, 40]} />
          <meshStandardMaterial color={zonaActiva('territorial') ? '#fdba74' : '#e2e8f0'} transparent opacity={0.7} />
        </mesh>
        <Desk position={[0, 0, 0]} w={1.6} pantalla={zonaActiva('territorial')} colorPantalla="#fb923c" />
        <mesh position={[0, 1.4, -2.3]}>
          <boxGeometry args={[2.6, 1.6, 0.06]} />
          <meshStandardMaterial color="#e0f2fe" />
        </mesh>
        <Etiqueta position={[0, 3.6, -2.2]} color="#9a3412" onClick={() => onZona('territorial')}>
          {ZONES_ABIERTAS.territorial.nombre}
        </Etiqueta>
      </group>

      {/* Zona de pausa */}
      <group position={[21, 0, 12]}>
        <Sofa position={[0, 0, 0.6]} rot={-Math.PI / 4} />
        <mesh position={[-0.6, 0.25, -0.4]}>
          <cylinderGeometry args={[0.5, 0.5, 0.5, 20]} />
          <meshStandardMaterial color={WOOD} />
        </mesh>
        <Plant position={[1.6, 0, -1.6]} />
      </group>

      {/* Área de Psicología Clínica: seis estaciones */}
      {Object.entries(ESTACIONES_PSI).map(([k, [x, z]], i) => (
        <group key={k} position={[x, 0, z]}>
          <mesh position={[0, 0.6, -1.8]}>
            <boxGeometry args={[5.2, 1.2, 0.06]} />
            <meshStandardMaterial color="#bfdbfe" transparent opacity={0.3} depthWrite={false} />
          </mesh>
          {i > 0 && (
            <mesh position={[-2.6, 0.6, 0]}>
              <boxGeometry args={[0.06, 1.2, 3.6]} />
              <meshStandardMaterial color="#bfdbfe" transparent opacity={0.3} depthWrite={false} />
            </mesh>
          )}
          <Desk position={[0, 0, 0.3]} rot={Math.PI} pantalla={presencia.some((p) => p.estacion === k && p.conectado && p.zona === 'estacion')} />
          <Chair position={[0, 0, -0.9]} />
          <Plant position={[2, 0, -1.2]} scale={0.7} />
        </group>
      ))}
      <Etiqueta position={[-20.6, 2.2, 11]} color="#1d4ed8" onClick={() => onZona('psicologia')}>
        {ZONES_ABIERTAS.psicologia.nombre}
      </Etiqueta>
      {/* placas de nombre en cada estación (estado real) */}
      {Object.entries(ESTACIONES_PSI).map(([k, [x, z]]) => {
        const p = presencia.find((q) => q.estacion === k);
        return <Placa key={k} position={[x, 0.35, z + 1.6]} p={p} onSelect={() => p && onSelect(p.clave)} />;
      })}
      <Placa position={[15.6, 0.35, 6.1]} p={demetrio} onSelect={() => demetrio && onSelect(demetrio.clave)} />
      <Placa position={[14.2, 0.35, -8.6]} p={diego} onSelect={() => diego && onSelect(diego.clave)} />
      {porPro.get('andrea-mayorga') && <Placa position={[8.5, 0.35, 4.6]} p={porPro.get('andrea-mayorga')} onSelect={() => onSelect('andrea-mayorga')} />}

      {/* plantas decorativas */}
      {[
        [-23, 0, 14.5],
        [23, 0, -3.5],
        [-6.5, 0, 6],
        [6.5, 0, 6],
        [-23, 0, -4],
        [12.5, 0, -4],
      ].map((p, i) => (
        <Plant key={i} position={p as [number, number, number]} scale={1.2} />
      ))}
      {/* entrada */}
      <RoundedBox args={[3, 0.04, 1.2]} position={[0, 0.02, 16.3]} radius={0.02}>
        <meshStandardMaterial color="#0b2350" />
      </RoundedBox>

      {/* avatares (solo usuarios con conexión real) */}
      {presencia.map((p, i) => (
        <Avatar
          key={p.clave}
          p={p}
          slot={slots[i]}
          seleccionado={seleccionado === p.clave}
          onSelect={() => onSelect(p.clave)}
          reducirMovimiento={reducirMovimiento}
          mostrarNombre={zoomRel > 1.5 && p.zona !== 'estacion'}
        />
      ))}
    </>
  );
}

export default function OfficeScene(props: Props) {
  const [dpr, setDpr] = useState(1.5);
  const [sombras, setSombras] = useState(true);
  return (
    <Canvas
      shadows={sombras}
      dpr={dpr}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => {
        gl.setClearColor('#04102b');
      }}
      aria-label="Oficina virtual isométrica"
    >
      <PerformanceMonitor
        onDecline={() => {
          setDpr(1);
          setSombras(false);
        }}
      />
      <fog attach="fog" args={['#04102b', 120, 260]} />
      <Suspense fallback={null}>
        <Escena {...props} />
      </Suspense>
    </Canvas>
  );
}
