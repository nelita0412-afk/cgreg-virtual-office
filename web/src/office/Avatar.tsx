import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { ESTADO_PRESENCIA_COLOR, ESTADO_PRESENCIA_LABEL, type PresenciaSnapshot } from '@shared/domain';
import { ENTRADA, ruta, type Slot, type V2 } from './layout';

const PIELES = ['#c58c6a', '#a8714f', '#d9a07c', '#8d5a3b', '#e0ac85', '#b67b58'];
const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
const SPEED = 6;

interface Props {
  p: PresenciaSnapshot;
  slot: Slot | null;
  seleccionado: boolean;
  onSelect: () => void;
  reducirMovimiento: boolean;
  mostrarNombre: boolean;
}

/**
 * Avatar estilizado. Su destino lo determina exclusivamente el estado real (snapshot del backend):
 * cuando cambia la zona, recorre los pasillos hasta el nuevo destino; si se desconecta, sale por la entrada.
 */
export function Avatar({ p, slot, seleccionado, onSelect, reducirMovimiento, mostrarNombre }: Props) {
  const root = useRef<THREE.Group>(null!);
  const legL = useRef<THREE.Group>(null!);
  const legR = useRef<THREE.Group>(null!);
  const armL = useRef<THREE.Group>(null!);
  const armR = useRef<THREE.Group>(null!);
  const ring = useRef<THREE.Mesh>(null!);
  const st = useRef<{ pos: V2; path: V2[]; visible: boolean; rotTarget: number; init: boolean; walking: boolean }>({
    pos: slot?.pos ?? ENTRADA,
    path: [],
    visible: !!slot,
    rotTarget: slot?.rot ?? 0,
    init: false,
    walking: false,
  });
  const piel = useMemo(() => PIELES[hash(p.clave) % PIELES.length], [p.clave]);
  const camisa = p.color ?? (p.rol === 'coordinacion' ? '#0e7490' : '#ea580c');
  const cabello = p.cabello ?? '#2b1d14';
  const color = ESTADO_PRESENCIA_COLOR[p.estado];

  useEffect(() => {
    const s = st.current;
    if (!s.init) {
      // Carga inicial (recuperación de estado): se ubica directamente, sin animar movimientos que no ocurrieron ahora.
      s.init = true;
      s.pos = slot?.pos ?? ENTRADA;
      s.visible = !!slot;
      s.rotTarget = slot?.rot ?? 0;
      root.current?.position.set(s.pos[0], 0, s.pos[1]);
      if (root.current) root.current.rotation.y = s.rotTarget;
      return;
    }
    const destino = slot?.pos ?? ENTRADA;
    if (!s.visible) {
      if (!slot) return;
      s.pos = ENTRADA; // ingresa por la puerta
      s.visible = true;
    }
    if (reducirMovimiento) {
      s.pos = destino;
      s.path = [];
      s.visible = !!slot;
      s.rotTarget = slot?.rot ?? 0;
      return;
    }
    s.path = ruta(s.pos, destino);
    s.rotTarget = slot?.rot ?? Math.PI;
  }, [slot?.pos[0], slot?.pos[1], slot?.rot, !!slot, reducirMovimiento]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((state, dt) => {
    const s = st.current;
    const g = root.current;
    if (!g) return;
    g.visible = s.visible;
    if (!s.visible) return;
    const step = Math.min(dt, 0.25) * SPEED; // basado en tiempo real: misma velocidad aunque el equipo vaya lento
    let moving = false;
    if (s.path.length) {
      const [tx, tz] = s.path[0];
      const dx = tx - s.pos[0];
      const dz = tz - s.pos[1];
      const dist = Math.hypot(dx, dz);
      if (dist <= step) {
        s.pos = [tx, tz];
        s.path.shift();
        if (!s.path.length && !slot) s.visible = false; // salió de la oficina
      } else {
        s.pos = [s.pos[0] + (dx / dist) * step, s.pos[1] + (dz / dist) * step];
        moving = true;
        const ang = Math.atan2(dx, dz);
        g.rotation.y = lerpAngle(g.rotation.y, ang, 0.25);
      }
    }
    if (!moving) g.rotation.y = lerpAngle(g.rotation.y, s.rotTarget, 0.12);
    g.position.set(s.pos[0], 0, s.pos[1]);
    const t = state.clock.elapsedTime;
    const sw = moving ? Math.sin(t * 9) * 0.6 : 0;
    legL.current.rotation.x = sw;
    legR.current.rotation.x = -sw;
    armL.current.rotation.x = -sw * 0.8;
    armR.current.rotation.x = sw * 0.8;
    g.position.y = moving ? Math.abs(Math.sin(t * 9)) * 0.05 : reducirMovimiento ? 0 : Math.sin(t * 1.6 + hash(p.clave)) * 0.012;
    if (ring.current) {
      const pulse = p.estado === 'en_consulta' || p.estado === 'en_reunion';
      const sc = seleccionado ? 1.25 : pulse && !reducirMovimiento ? 1 + Math.sin(t * 3) * 0.08 : 1;
      ring.current.scale.setScalar(sc);
    }
  });

  return (
    <group
      ref={root}
      scale={1.3}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onPointerOver={() => (document.body.style.cursor = 'pointer')}
      onPointerOut={() => (document.body.style.cursor = '')}
    >
      {/* indicador de estado */}
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry args={[0.42, 0.56, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.95} />
      </mesh>
      {seleccionado && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]}>
          <circleGeometry args={[0.8, 32]} />
          <meshBasicMaterial color="#22d3ee" transparent opacity={0.25} />
        </mesh>
      )}
      {/* piernas */}
      {[
        [legL, -0.12],
        [legR, 0.12],
      ].map(([ref, x], i) => (
        <group key={i} ref={ref as React.RefObject<THREE.Group>} position={[x as number, 0.82, 0]}>
          <mesh position={[0, -0.4, 0]} castShadow>
            <capsuleGeometry args={[0.1, 0.6, 4, 8]} />
            <meshStandardMaterial color="#1e293b" />
          </mesh>
          <mesh position={[0, -0.78, 0.06]}>
            <boxGeometry args={[0.16, 0.08, 0.28]} />
            <meshStandardMaterial color="#0f172a" />
          </mesh>
        </group>
      ))}
      {/* torso */}
      <mesh position={[0, 1.18, 0]} castShadow>
        <capsuleGeometry args={[0.28, 0.42, 4, 12]} />
        <meshStandardMaterial color={camisa} roughness={0.7} />
      </mesh>
      {/* credencial */}
      <mesh position={[0.12, 1.22, 0.27]}>
        <boxGeometry args={[0.1, 0.13, 0.02]} />
        <meshStandardMaterial color="#e0f2fe" />
      </mesh>
      {/* brazos */}
      {[
        [armL, -0.36],
        [armR, 0.36],
      ].map(([ref, x], i) => (
        <group key={i} ref={ref as React.RefObject<THREE.Group>} position={[x as number, 1.42, 0]}>
          <mesh position={[0, -0.28, 0]} castShadow>
            <capsuleGeometry args={[0.08, 0.42, 4, 8]} />
            <meshStandardMaterial color={camisa} roughness={0.7} />
          </mesh>
          <mesh position={[0, -0.56, 0]}>
            <sphereGeometry args={[0.075, 10, 10]} />
            <meshStandardMaterial color={piel} />
          </mesh>
        </group>
      ))}
      {/* cabeza */}
      <mesh position={[0, 1.66, 0]}>
        <cylinderGeometry args={[0.08, 0.09, 0.12, 10]} />
        <meshStandardMaterial color={piel} />
      </mesh>
      <mesh position={[0, 1.88, 0]} castShadow>
        <sphereGeometry args={[0.23, 20, 16]} />
        <meshStandardMaterial color={piel} roughness={0.6} />
      </mesh>
      <mesh position={[0, 1.96, -0.04]} scale={[1.05, 0.85, 1.08]}>
        <sphereGeometry args={[0.235, 20, 16, 0, Math.PI * 2, 0, Math.PI / 1.9]} />
        <meshStandardMaterial color={cabello} roughness={0.9} />
      </mesh>
      {/* ojos */}
      {[-0.08, 0.08].map((x) => (
        <mesh key={x} position={[x, 1.9, 0.205]}>
          <sphereGeometry args={[0.025, 8, 8]} />
          <meshBasicMaterial color="#0f172a" />
        </mesh>
      ))}
      {(mostrarNombre || seleccionado) && (
        <Html position={[0, 2.45, 0]} center zIndexRange={[10, 0]} className="office-label">
          <button
            onClick={onSelect}
            className="flex items-center gap-1.5 rounded-full border border-white/15 bg-slate-950/85 px-2 py-0.5 text-[11px] font-medium text-white shadow-lg"
            aria-label={`${p.nombre}: ${ESTADO_PRESENCIA_LABEL[p.estado]}`}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: color }} />
            {p.nombre_corto}
          </button>
        </Html>
      )}
    </group>
  );
}

function lerpAngle(a: number, b: number, t: number) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
